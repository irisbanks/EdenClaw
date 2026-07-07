// 밤샘 자율 루프 워커 (독립 프로세스 — 60초 서버리스 한계 무관)
// 실행: npx tsx --env-file=.env.local scripts/swarm-worker.ts
// 프로세스 간 잡 공유에는 Redis 필요: SWARM_JOB_STORE=redis (또는 REDIS_URL 설정)
import { getJobStore } from '../lib/swarm/job-store';
import { runWorkerLoop } from '../lib/swarm/worker';
import { defaultModelTiers } from '../lib/swarm/model-tiers';
import { consumeGasWithCache } from '../lib/services/overdraftLedger';

const controller = new AbortController();
process.on('SIGTERM', () => controller.abort());
process.on('SIGINT', () => controller.abort());

async function main(): Promise<void> {
  const mode = (process.env.SWARM_JOB_STORE || (process.env.REDIS_URL ? 'redis' : 'memory')).toLowerCase();
  if (mode !== 'redis') {
    console.warn('[swarm-worker] ⚠ 인메모리 store — 이 프로세스에 enqueue된 잡만 처리합니다. 라우트와 공유하려면 SWARM_JOB_STORE=redis 로 실행하세요.');
  }
  const store = getJobStore();
  console.log(`[swarm-worker] 시작 (store=${mode}). 잡 대기 중...`);

  await runWorkerLoop(store, defaultModelTiers(), {
    signal: controller.signal,
    onComplete: async (job) => {
      // 가스 정산: 통과시킨 티어 기준 누적 가스를 원장에 차감
      if (job.userId && job.gasCharged > 0) {
        await consumeGasWithCache(job.userId, job.gasCharged, 'SWARM_WORKER_LOOP');
      }
      console.log(`[swarm-worker] 잡 ${job.id} → ${job.status} (attempts=${job.attempts}, gas=${job.gasCharged}, provider=${job.finalProvider ?? '-'})`);
    },
  });

  console.log('[swarm-worker] 정상 종료');
}

main().catch((e) => {
  console.error('[swarm-worker] 치명적 오류:', e);
  process.exit(1);
});
