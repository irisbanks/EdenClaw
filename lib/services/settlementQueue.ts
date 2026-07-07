import { after } from 'next/server';
import { propagateAndSettle } from '@/lib/services/binarySettlement';

export interface SettlementJob {
  userId: string;
  pv: number;
  bv: number;
  reason: 'TOKEN_CONSUMPTION' | 'TOKEN_PACK' | 'SUBSCRIPTION';
  enqueuedAt: number;
}

/**
 * 경량 인메모리 정산 큐.
 *
 * 토큰 소비/결제 응답을 막지 않도록 전파·정산을 백그라운드로 넘기고,
 * 단일 워커가 FIFO 로 "순차" 처리하여 LegBalance 동시 갱신 경합을 제거한다.
 *
 * Vercel 서버리스에서는 응답을 보낸 직후 인스턴스가 곧바로 얼 수 있어, 단순
 * `void promise.then(drain)` 방식은 드레인이 끝나기 전에 죽어 정산이 조용히
 * 유실될 수 있었다. `next/server`의 `after()`로 감싸 플랫폼이 드레인 완료까지
 * 인스턴스를 살려두도록 보장한다(요청 흐름은 그대로 논블로킹).
 *
 * 다중 인스턴스 간 큐 자체를 공유하진 않는다 — 각 인스턴스는 자신이 적재한
 * 작업만 자신의 after() 구간에서 끝까지 드레인한다. 진짜 크로스 인스턴스 큐가
 * 필요해지면 Redis Streams/BullMQ 등 외부 큐로 교체할 것.
 * (핫리로드 중복 방지를 위해 globalThis 에 싱글톤 보관)
 */
interface QueueState {
  jobs: SettlementJob[];
  running: boolean;
  processed: number;
  failed: number;
}

const g = globalThis as unknown as { __edenSettlementQueue?: QueueState };
const state: QueueState = g.__edenSettlementQueue ?? { jobs: [], running: false, processed: 0, failed: 0 };
if (process.env.NODE_ENV !== 'production') g.__edenSettlementQueue = state;

async function drain(): Promise<void> {
  if (state.running) return;
  state.running = true;
  try {
    while (state.jobs.length > 0) {
      const job = state.jobs.shift()!;
      try {
        await propagateAndSettle(job.userId, job.pv, job.bv);
        state.processed++;
      } catch (e) {
        state.failed++;
        console.error('[settlementQueue] 작업 처리 실패:', job, e);
      }
    }
  } finally {
    state.running = false;
  }
}

/** 정산 작업 적재 (논블로킹). 워커가 비어 있으면 즉시 드레인 시작. */
export function enqueueSettlement(job: Omit<SettlementJob, 'enqueuedAt'>): void {
  if (job.pv <= 0 && job.bv <= 0) return;
  state.jobs.push({ ...job, enqueuedAt: Date.now() });
  // 응답 이후에도 드레인이 끝날 때까지 인스턴스를 살려두도록 플랫폼에 위임
  // (요청을 만든 유저 입장에서는 여전히 논블로킹).
  try {
    after(drain);
  } catch {
    // after()는 요청 스코프 밖(예: 스크립트/테스트)에서 호출되면 던진다 —
    // 그런 컨텍스트에서는 다음 틱 드레인으로 폴백.
    void Promise.resolve().then(drain);
  }
}

export function getQueueStats() {
  return { pending: state.jobs.length, running: state.running, processed: state.processed, failed: state.failed };
}
