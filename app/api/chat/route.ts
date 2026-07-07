import { NextRequest, NextResponse } from 'next/server';
import { runOmxLoop, estimateOmxGas, resolveSafeTarget, type OmxEvent } from '@/lib/swarm/omx-loop';
import { defaultModelTiers } from '@/lib/swarm/model-tiers';
import { getJobStore } from '@/lib/swarm/job-store';
import { processJob } from '@/lib/swarm/worker';
import { checkQuota, settleUsage, LOCKED_PAYLOAD } from '@/lib/services/tokenGuard';
import { specToBuildPrompt, type PlanSpec } from '@/lib/swarm/planner';
import type { LoopMessage } from '@/lib/swarm/autonomous-loop';

// child_process(exec)+fs → Node 런타임. 동기 7회 루프(Claude 포함) 대비 길게.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const ENFORCE_GUARD = process.env.TOKEN_GUARD_ENFORCE === 'true';
const MAX_ATTEMPTS = 7;

type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };

function toHistory(messages: unknown): LoopMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m: unknown): m is ChatMsg => !!m && typeof (m as ChatMsg).role === 'string' && typeof (m as ChatMsg).content === 'string')
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  // 기획서(spec)가 오면 빌드 프롬프트로 변환(기획→자동 빌드 핸드오프). 아니면 prompt 사용.
  const spec: PlanSpec | null = body.spec && typeof body.spec === 'object' ? (body.spec as PlanSpec) : null;
  const prompt: string = typeof body.prompt === 'string' && body.prompt ? body.prompt : spec ? specToBuildPrompt(spec) : '';
  const userId: string | null = typeof body.userId === 'string' && body.userId ? body.userId : null;
  const targetFile: string = typeof body.targetFile === 'string' && body.targetFile.trim() ? body.targetFile.trim() : 'app/api/_generated/autonomous-output.ts';
  const isAsync = Boolean(body.async);
  const projectRoot = process.cwd();

  if (!prompt) return NextResponse.json({ success: false, error: 'prompt 가 필요합니다.' }, { status: 400 });

  // ── 보안 가드 (캐VEAT①: 라이브 트리 보호 — 잘못된 경로 사전 차단) ──
  try {
    resolveSafeTarget(projectRoot, targetFile);
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : 'Invalid target path.' }, { status: 400 });
  }

  const tiers = defaultModelTiers();

  // ── 토큰 미터링 (캐VEAT④) ──
  let metered = false;
  if (userId) {
    const estimate = estimateOmxGas(tiers, MAX_ATTEMPTS);
    const check = await checkQuota(userId, estimate);
    if (check.status === 'LOCKED') return NextResponse.json({ ...LOCKED_PAYLOAD, remaining: check.remaining }, { status: 402 });
    if (check.status === 'NO_QUOTA') {
      if (ENFORCE_GUARD) return NextResponse.json({ ...LOCKED_PAYLOAD, remaining: 0 }, { status: 402 });
    } else {
      metered = true;
    }
  } else if (ENFORCE_GUARD) {
    return NextResponse.json({ success: false, error: '유저 식별 정보가 필요합니다.' }, { status: 401 });
  }

  // ── 비동기 모드 (캐VEAT②: 60초 한계 무관 — 잡 큐 워커가 무제한 처리) ──
  if (isAsync) {
    const store = getJobStore();
    const job = await store.createJob({ userId, prompt, maxAttempts: MAX_ATTEMPTS, kind: 'omx', targetFile });
    if (process.env.SWARM_INLINE_WORKER === 'true') {
      void processJob(store, job.id, tiers, {
        onComplete: async (j) => { if (metered && j.userId && j.gasCharged > 0) await settleUsage(j.userId, j.gasCharged); },
      });
    }
    return NextResponse.json({ success: true, status: 'QUEUED', jobId: job.id, pollUrl: `/api/swarm/jobs/${job.id}`, metered }, { status: 202 });
  }

  // ── 동기 모드: 격리 샌드박스에서 반복하고 통과 시에만 타겟으로 승격(캐VEAT①) ──
  const logs: OmxEvent[] = [];
  let result;
  try {
    result = await runOmxLoop({
      prompt,
      projectRoot,
      targetFile,
      tiers,
      maxAttempts: MAX_ATTEMPTS,
      history: toHistory(body.messages),
      onEvent: (e) => logs.push(e),
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }

  let remaining: number | undefined;
  if (metered && userId && result.gasCharged > 0) {
    try { remaining = await settleUsage(userId, result.gasCharged); } catch { /* 정산 실패가 응답을 막지 않음 */ }
  }

  return NextResponse.json({
    success: result.success,
    status: result.success ? 'SUCCESS' : 'MAX_ATTEMPTS_EXCEEDED',
    finalModel: result.finalProvider ?? result.finalTier,
    attempts: result.attempts,
    targetFile: result.targetFile,
    gasCharged: result.gasCharged,
    remaining,
    metered,
    logs,
    response: result.success
      ? 'OMX 격리 샌드박스 반복 + tsc 검증을 통과해 타겟으로 자율 승격(promote) 완료되었습니다.'
      : undefined,
    error: result.success ? undefined : result.lastError,
  });
}
