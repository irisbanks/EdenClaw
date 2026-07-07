// 자율 루프 제어흐름 + 실제 tsc 검증 테스트 (라이브 LLM 불필요)
// 실행: npx tsx scripts/test-autonomous-loop.ts
import { runAutonomousLoop, type LoopEvent, type ModelTier } from '../lib/swarm/autonomous-loop';

const BROKEN = JSON.stringify([
  {
    path: 'settlement.ts',
    // 의도적 타입 오타(numer) → 실제 tsc가 실패시켜야 함
    content: 'export const rate: numer = 0.1;\nexport function net(g: number): number { return g - g * rate; }\n',
  },
]);

const FIXED = JSON.stringify([
  {
    path: 'settlement.ts',
    content: 'export const rate: number = 0.1;\nexport function net(g: number): number { return g - g * rate; }\n',
  },
]);

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ ${msg}`);
}

async function main(): Promise<void> {
  const calls: string[] = [];
  const events: LoopEvent[] = [];

  // 1티어: 항상 깨진 코드 반환(무가스 Gemma 시뮬). 2티어: 고친 코드 반환(Claude 시뮬).
  const tierBroken: ModelTier = {
    key: 'mock-gemma',
    label: 'Mock Gemma 31B',
    gasPerCall: 0,
    generate: async () => {
      calls.push('mock-gemma');
      return { text: BROKEN, provider: 'mock-gemma' };
    },
  };
  const tierFix: ModelTier = {
    key: 'mock-claude',
    label: 'Mock Claude',
    gasPerCall: 25_000,
    generate: async () => {
      calls.push('mock-claude');
      return { text: FIXED, provider: 'mock-claude' };
    },
  };

  const result = await runAutonomousLoop({
    prompt: '정산 함수를 컴파일되게 만들어라',
    tiers: [tierBroken, tierFix],
    maxAttempts: 4,
    onEvent: (e) => events.push(e),
  });

  console.log('\n--- 이벤트 타임라인 ---');
  for (const e of events) {
    if (e.type === 'compile') console.log(`  compile attempt#${e.attempt}: ok=${e.ok} (${e.ms}ms)`);
    else if (e.type === 'escalate') console.log(`  escalate: ${e.from} → ${e.to} (${e.reason})`);
    else if (e.type === 'attempt_start') console.log(`  attempt#${e.attempt}: ${e.label}`);
    else if (e.type === 'success') console.log(`  success: tier=${e.tier} gas=${e.gasCharged}`);
  }
  console.log('--- 결과 ---');
  console.log(JSON.stringify({ success: result.success, attempts: result.attempts, finalTier: result.finalTier, gasCharged: result.gasCharged }, null, 2));
  console.log('');

  // 검증: 실제 tsc가 깨진 코드를 잡고, 에스컬레이션 후 통과해야 한다.
  const firstCompile = events.find((e) => e.type === 'compile');
  assert(!!firstCompile && firstCompile.type === 'compile' && firstCompile.ok === false, '실제 tsc가 1차(깨진 코드) 컴파일을 실패시킴');
  assert(events.some((e) => e.type === 'escalate' && e.to === 'mock-claude'), 'tsc 실패 후 다음 티어로 자동 에스컬레이션');
  assert(result.success === true, '에스컬레이션 후 최종 컴파일 성공');
  assert(result.finalTier === 'mock-claude', '최종 통과 티어 = mock-claude');
  assert(calls.includes('mock-gemma') && calls.includes('mock-claude'), '두 티어가 모두 실제로 호출됨');
  assert(result.gasCharged === 25_000, '가스는 통과시킨 티어 기준으로만 누적(무가스 Gemma 0 + Claude 25k)');

  console.log('\n🎉 모든 단언 통과 — 자율 루프(실 tsc + 에스컬레이션) 정상 동작');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
