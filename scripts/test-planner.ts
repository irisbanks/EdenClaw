// 대화형 기획 엔진 테스트 (라이브 LLM 불필요)
// 실행: npx tsx scripts/test-planner.ts
import { runPlannerTurn, specToBuildPrompt, type PlanSpec } from '../lib/swarm/planner';
import type { ModelTier } from '../lib/swarm/autonomous-loop';

function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`❌ FAIL: ${msg}`); process.exit(1); }
  console.log(`✅ ${msg}`);
}

const VALID = JSON.stringify({
  answer: '스마트폰→BLE→ESP32→정전류 LED 드라이버(MOSFET+방열)+PWM 디밍 구조를 권장합니다. 보드/통신/디밍 범위를 정해주세요.',
  spec: {
    title: '스마트폰 제어 300W 근적외선 LED',
    summary: 'BLE로 ESP32를 제어해 고출력 NIR LED를 PWM 디밍',
    decisions: { connectivity: 'BLE', controller: 'ESP32' },
    requirements: ['PWM 디밍', '과열 차단(서미스터)'],
    open_questions: ['전원 사양(전압/전류)?', '앱은 iOS/Android 둘 다?'],
    deliverables: ['esp32_firmware.ino', 'app/ble_control_spec.md'],
  },
  ready: false,
});

async function main(): Promise<void> {
  // 1) 유효 JSON 파싱
  const tierValid: ModelTier = { key: 'gpt', label: 'gpt-4o', gasPerCall: 0, generate: async () => ({ text: VALID, provider: 'gpt-4o' }) };
  const r1 = await runPlannerTurn({ message: '스마트폰에서 300W 근적외선 LED 제어하려면?', tiers: [tierValid] });
  assert(r1.answer.includes('ESP32'), '답변 파싱됨');
  assert(r1.spec.title === '스마트폰 제어 300W 근적외선 LED', 'spec.title 누적됨');
  assert(r1.questions.length === 2, 'open_questions가 questions로 노출됨');
  assert(r1.ready === false, 'ready=false (미결정 존재)');

  // 2) 평문(JSON 아님) → 폴백 답변, 대화 안 끊김
  const tierProse: ModelTier = { key: 'gemma', label: 'Gemma', gasPerCall: 0, generate: async () => ({ text: '그냥 일반 텍스트 답변입니다.', provider: 'gemma' }) };
  const r2 = await runPlannerTurn({ message: '안녕', tiers: [tierProse] });
  assert(r2.answer === '그냥 일반 텍스트 답변입니다.' && r2.ready === false, 'JSON 실패 시 평문 폴백');

  // 3) 1티어 throw → 2티어 폴백
  const tierThrow: ModelTier = { key: 'gemma', label: 'Gemma', gasPerCall: 0, generate: async () => { throw new Error('conn refused'); } };
  const r3 = await runPlannerTurn({ message: 'x', tiers: [tierThrow, tierValid] });
  assert(r3.provider === 'gpt-4o', '1티어 장애 시 다음 티어로 폴백');

  // 4) prior spec 전달 시 priorSpec 유지(폴백 경로)
  const prior: PlanSpec = { title: '기존', decisions: { a: 'b' } };
  const r4 = await runPlannerTurn({ message: 'x', priorSpec: prior, tiers: [tierProse] });
  assert(r4.spec.title === '기존', '평문 폴백 시 priorSpec 유지');

  // 5) specToBuildPrompt
  const p = specToBuildPrompt(r1.spec);
  assert(p.includes('제목:') && p.includes('PWM 디밍') && p.includes('esp32_firmware.ino'), '기획서→빌드 프롬프트 변환');

  console.log('\n🎉 기획 엔진: 답변/spec 누적/ready/폴백/빌드 프롬프트 변환 검증 완료');
}

main().catch((e) => { console.error(e); process.exit(1); });
