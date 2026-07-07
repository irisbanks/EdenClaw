import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../.env') });
config({ path: resolve(__dirname, '../../.env.local') });

import { ExpertTrader } from '../../lib/agents/expert/expert-trader';

async function main() {
  const trader = new ExpertTrader();

  console.log('=== Test 1: General Chat ===');
  const r1 = await trader.respond({
    intent: 'general_chat',
    itemDescription: '안녕하세요, 에덴 봇!',
  });
  console.log('message:', r1.message.slice(0, 100));
  console.log('tools_used:', r1.tools_used);

  console.log('\n=== Test 2: Negotiate ===');
  const r2 = await trader.respond({
    intent: 'negotiate',
    userPrice: 50000,
    itemDescription: '나이키 운동화',
  });
  console.log('message:', r2.message);
  console.log('strategy floor:', r2.strategy?.floor_price);

  console.log('\n=== Test 3: Write Listing ===');
  const r3 = await trader.respond({
    intent: 'write_listing',
    itemDescription: '아이폰 13 Pro 256GB 블루',
    userPrice: 650000,
  });
  console.log('message:', r3.message.slice(0, 200));

  console.log('\n=== Test 4: Safety Check ===');
  const r4 = await trader.respond({
    intent: 'check_safety',
    itemDescription: '선입금 요청, 계좌이체 부탁드립니다',
  });
  console.log('message:', r4.message);
  console.log('warnings:', r4.warnings);

  console.log('\n=== All tests done ===');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
