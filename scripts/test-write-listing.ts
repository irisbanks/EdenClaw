import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env') });
config({ path: resolve(__dirname, '../.env.local') });

async function runTest(label: string, body: object) {
  const res = await fetch('http://localhost:3000/api/expert/respond', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  console.log(`\n=== ${label} ===`);
  console.log('intent_detected:', data.intent_detected);
  console.log('message:\n', data.message);
  console.log('tools_used:', data.tools_used);
  console.log('reasoning:', data.reasoning_steps?.join(' → '));
}

async function main() {
  await runTest('Test 1: 나이키 에어맥스 47,000원', {
    intent: 'write_listing',
    itemDescription: '나이키 에어맥스 90 사이즈 270 상태 A급',
    userPrice: 47000,
  });

  await runTest('Test 2: 아이폰 13 Pro 가격 미입력', {
    intent: 'write_listing',
    itemDescription: '아이폰 13 Pro 256GB 실버',
  });

  await runTest('Test 3: 맥북 M3 1,500,000원', {
    intent: 'write_listing',
    itemDescription: '맥북 에어 M3 15인치 256GB 미드나잇',
    userPrice: 1500000,
  });

  console.log('\n=== All tests done ===');
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
