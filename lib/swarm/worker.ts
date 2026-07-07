// 자율 루프 워커 — 잡 큐에서 잡을 claim 해 시간 제한 없이 처리한다.
// HTTP 요청 수명과 분리돼 있어 60초 서버리스 한계의 영향을 받지 않는다(밤샘 루프).
import { runAutonomousLoop, type ModelTier } from './autonomous-loop';
import { runOmxLoop } from './omx-loop';
import type { JobStore, SwarmJob } from './job-store';

export interface ProcessOptions {
  /** 잡 완료 후 후처리(예: 가스 정산). 실패해도 잡 결과 기록을 막지 않는다. */
  onComplete?: (job: SwarmJob) => Promise<void>;
}

/** 단일 잡 처리: running 표시 → 루프 실행(이벤트 적재) → 최종 상태 기록 → onComplete. */
export async function processJob(
  store: JobStore,
  jobId: string,
  tiers: ModelTier[],
  opts: ProcessOptions = {}
): Promise<SwarmJob | null> {
  const job = await store.getJob(jobId);
  if (!job) return null;
  await store.updateJob(jobId, { status: 'running' });

  try {
    // ioredis는 단일 커넥션에 명령을 순서대로 큐잉하므로 fire-and-forget도 순서가 보존된다.
    let finished: SwarmJob | null;

    if (job.kind === 'omx') {
      // 격리 샌드박스 + 승격(promote) OMX 루프 (단일 파일, 라이브 트리 비오염)
      const result = await runOmxLoop({
        prompt: job.prompt,
        projectRoot: process.cwd(),
        targetFile: job.targetFile ?? 'app/api/_generated/autonomous-output.ts',
        tiers,
        maxAttempts: job.maxAttempts,
        onEvent: (e) => { void store.appendEvent(jobId, e); },
      });
      finished = await store.updateJob(jobId, {
        status: result.success ? 'succeeded' : 'failed',
        attempts: result.attempts,
        gasCharged: result.gasCharged,
        finalProvider: result.finalProvider,
        files: result.finalCode ? [{ path: result.targetFile, content: result.finalCode }] : [],
        error: result.success ? undefined : result.lastError,
      });
    } else {
      const result = await runAutonomousLoop({
        prompt: job.prompt,
        tiers,
        maxAttempts: job.maxAttempts,
        onEvent: (e) => { void store.appendEvent(jobId, e); },
      });
      finished = await store.updateJob(jobId, {
        status: result.success ? 'succeeded' : 'failed',
        attempts: result.attempts,
        gasCharged: result.gasCharged,
        finalProvider: result.finalProvider,
        files: result.files,
        error: result.success ? undefined : result.lastError,
      });
    }

    if (finished && opts.onComplete) {
      try {
        await opts.onComplete(finished);
      } catch (e) {
        console.error(`[swarm-worker] onComplete 실패 (잡 결과는 기록됨): ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return finished;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return store.updateJob(jobId, { status: 'failed', error });
  }
}

/** 큐에서 한 건 claim 해 처리. 처리할 게 있었으면 true. */
export async function runWorkerOnce(store: JobStore, tiers: ModelTier[], opts: ProcessOptions = {}): Promise<boolean> {
  const claimed = await store.claimNextQueued();
  if (!claimed) return false;
  await processJob(store, claimed.id, tiers, opts);
  return true;
}

export interface WorkerLoopOptions extends ProcessOptions {
  pollMs?: number;
  signal?: AbortSignal;
}

/** 무한 폴링 루프(밤샘 워커). SIGTERM/AbortSignal로 정상 종료. */
export async function runWorkerLoop(store: JobStore, tiers: ModelTier[], opts: WorkerLoopOptions = {}): Promise<void> {
  const pollMs = opts.pollMs ?? 1_500;
  while (!opts.signal?.aborted) {
    let worked = false;
    try {
      worked = await runWorkerOnce(store, tiers, opts);
    } catch (e) {
      console.error(`[swarm-worker] claim/process 오류: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!worked) await new Promise((r) => setTimeout(r, pollMs));
  }
}
