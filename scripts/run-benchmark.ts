// P2 벤치마크 실행 (실제 모델: Gemma 31B → gpt-4o → Claude)
// 실행: npx tsx --env-file=.env.local scripts/run-benchmark.ts
import { runBenchmark, formatReport } from '../lib/swarm/benchmark';
import { DEFAULT_BENCHMARK_TASKS } from '../lib/swarm/benchmark-tasks';
import { defaultModelTiers } from '../lib/swarm/model-tiers';

async function main(): Promise<void> {
  console.log(`자율 루프 벤치마크 시작 — 과제 ${DEFAULT_BENCHMARK_TASKS.length}개\n`);
  const report = await runBenchmark(DEFAULT_BENCHMARK_TASKS, defaultModelTiers(), {
    onTaskDone: (o) =>
      console.log(`  [${o.success ? '✅' : '❌'}] ${o.id}: tier=${o.finalTier ?? '-'} attempts=${o.attempts} gas=${o.gasCharged} ${o.ms}ms`),
  });
  console.log(`\n${formatReport(report)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
