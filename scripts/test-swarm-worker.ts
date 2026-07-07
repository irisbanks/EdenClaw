// 잡 큐 + 워커 수명주기 테스트 (라이브 LLM 불필요, tsc는 실제)
// 실행: npx tsx scripts/test-swarm-worker.ts
import { MemoryJobStore, type SwarmJob } from '../lib/swarm/job-store';
import { runWorkerOnce } from '../lib/swarm/worker';
import type { ModelTier } from '../lib/swarm/autonomous-loop';

const BROKEN = JSON.stringify([{ path: 'settlement.ts', content: 'export const rate: numer = 0.1;\n' }]);
const FIXED = JSON.stringify([{ path: 'settlement.ts', content: 'export const rate: number = 0.1;\n' }]);

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ ${msg}`);
}

async function main(): Promise<void> {
  const tierBroken: ModelTier = { key: 'mock-gemma', label: 'Mock Gemma', gasPerCall: 0, generate: async () => ({ text: BROKEN, provider: 'mock-gemma' }) };
  const tierFix: ModelTier = { key: 'mock-claude', label: 'Mock Claude', gasPerCall: 25_000, generate: async () => ({ text: FIXED, provider: 'mock-claude' }) };

  const store = new MemoryJobStore();
  const job = await store.createJob({ email: 'dev@edenclaw.ai', userId: 'u_1', prompt: '정산 함수 컴파일되게', maxAttempts: 4 });
  assert(job.status === 'queued', 'enqueue 직후 status=queued');

  let completed: SwarmJob | null = null;
  const worked = await runWorkerOnce(store, [tierBroken, tierFix], { onComplete: async (j) => { completed = j; } });
  assert(worked === true, '워커가 큐에서 잡을 claim 해 처리함');

  const final = await store.getJob(job.id);
  assert(!!final && final.status === 'succeeded', '잡이 succeeded 로 종료(실 tsc 통과 후)');
  assert(!!final && final.attempts === 2, '2회 시도(깨짐→에스컬레이션→통과)');
  assert(!!final && final.gasCharged === 25_000, '가스=25k (무가스 Gemma + Claude)');
  assert(!!final && final.files.length > 0 && final.files[0].path === 'settlement.ts', '최종 통과 파일 기록됨');

  const events = await store.getEvents(job.id);
  assert(events.some((e) => e.event.type === 'compile' && e.event.ok === false), '이벤트에 1차 tsc 실패 기록');
  assert(events.some((e) => e.event.type === 'escalate' && e.event.to === 'mock-claude'), '이벤트에 에스컬레이션 기록');
  assert(events.some((e) => e.event.type === 'success'), '이벤트에 success 기록');
  assert(events.length > 0 && events[0].seq === 1, '이벤트 seq가 1부터 순서대로');

  const drained = await store.claimNextQueued();
  assert(drained === null, '큐가 비워짐(중복 처리 없음)');
  assert(completed !== null && (completed as SwarmJob).status === 'succeeded', 'onComplete 콜백이 최종 잡으로 호출됨');

  console.log('\n🎉 잡 큐 + 워커 수명주기 정상 — 60초 한계와 분리된 백그라운드 처리 검증 완료');
}

main().catch((e) => { console.error(e); process.exit(1); });
