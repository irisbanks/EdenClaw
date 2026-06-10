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
 * 주의: 장기 실행 Node 서버(next start)를 전제로 한다. 다중 인스턴스/서버리스
 * 환경으로 확장 시 Redis Streams/BullMQ 등 외부 큐로 교체할 것.
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
  // 다음 틱에 드레인 (현재 요청 흐름을 막지 않음)
  void Promise.resolve().then(drain);
}

export function getQueueStats() {
  return { pending: state.jobs.length, running: state.running, processed: state.processed, failed: state.failed };
}
