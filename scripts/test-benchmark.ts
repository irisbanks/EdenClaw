// 벤치마크 집계 로직 테스트 (라이브 LLM 불필요, tsc는 실제)
// 실행: npx tsx scripts/test-benchmark.ts
import { runBenchmark } from '../lib/swarm/benchmark';
import type { ModelTier } from '../lib/swarm/autonomous-loop';
import type { BenchmarkTask } from '../lib/swarm/benchmark';

const FIXED = JSON.stringify([{ path: 'index.ts', content: 'export const ok: number = 1;\n' }]);
const BROKEN = JSON.stringify([{ path: 'index.ts', content: 'export const ok: numer = 1;\n' }]);

function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`❌ FAIL: ${msg}`); process.exit(1); }
  console.log(`✅ ${msg}`);
}

async function main(): Promise<void> {
  // Gemma: 프롬프트에 EASY가 있으면 단독 통과, 아니면 깨진 코드(→에스컬레이션). Claude: 항상 통과.
  const gemma: ModelTier = {
    key: 'gemma-31b', label: 'Gemma 31B', gasPerCall: 0,
    generate: async (_sys, messages) => {
      const firstUser = messages.find((m) => m.role === 'user')?.content ?? '';
      return { text: firstUser.includes('EASY') ? FIXED : BROKEN, provider: 'gemma-31b' };
    },
  };
  const claude: ModelTier = { key: 'claude', label: 'Claude', gasPerCall: 25_000, generate: async () => ({ text: FIXED, provider: 'claude' }) };

  const tasks: BenchmarkTask[] = [
    { id: 'easy-1', prompt: 'EASY: index.ts에 상수 작성' },
    { id: 'easy-2', prompt: 'EASY: index.ts에 또 다른 상수' },
    { id: 'hard-1', prompt: 'HARD: index.ts에 복잡한 것' },
  ];

  const report = await runBenchmark(tasks, [gemma, claude], { maxAttempts: 4 });
  console.log(JSON.stringify(report, (_k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Number(v.toFixed(3)) : v), 2));

  assert(report.total === 3 && report.passed === 3 && report.failed === 0, '3과제 전부 통과');
  assert(report.firstTierSolo === 2, 'Gemma 단독 해결 = 2 (EASY 2건)');
  assert(report.escalated === 1, '에스컬레이션 필요 = 1 (HARD 1건)');
  assert(Math.abs(report.firstTierSoloRate - 2 / 3) < 1e-6, 'Gemma 단독 해결률 = 66.7%');
  assert(report.byTier['gemma-31b'] === 2 && report.byTier['claude'] === 1, '티어별 해결 집계 정확');
  assert(report.totalGas === 25_000, '총 가스 = 25k (Gemma 0×2 + Claude 25k×1)');

  console.log('\n🎉 벤치마크 집계 로직 정상 — Gemma 단독률/에스컬레이션율 측정 검증 완료');
}

main().catch((e) => { console.error(e); process.exit(1); });
