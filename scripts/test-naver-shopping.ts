import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env') });
config({ path: resolve(__dirname, '../.env.local') });

import { naverShopping } from '../lib/agents/tools/naver-shopping';
import { analyzePrice } from '../lib/agents/tools/price-analyzer';

async function main() {
  console.log('=== Test 1: Naver Search (Nike Air Max) ===');
  try {
    const r1 = await naverShopping.search('나이키 에어맥스', { display: 5 });
    console.log(`Total: ${r1.total}, Showing: ${r1.items.length}, Cached: ${r1.cached}`);
    if (r1.items.length > 0) {
      const sample = r1.items[0];
      console.log(`Sample: ${sample.title} | ${sample.lprice.toLocaleString()}원 | ${sample.mallName}`);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('Failed:', msg);
    if (msg.includes('NAVER_SCOPE_PENDING')) {
      console.log('⚠️  Naver API scope pending. Will retry later.');
    }
  }

  console.log('\n=== Test 2: Price Analysis (Nike Air Max 90) ===');
  const r2 = await analyzePrice({
    query: '나이키 에어맥스 90',
    category: '스니커즈',
    condition: 'B',
  });
  console.log(JSON.stringify(r2, null, 2));

  console.log('\n=== Test 3: Price Analysis (iPhone 14) ===');
  const r3 = await analyzePrice({
    query: '아이폰 14',
    category: '스마트폰',
    condition: 'A',
  });
  console.log(JSON.stringify(r3, null, 2));

  console.log('\n=== Test 4: Price Analysis (Gucci Bag) ===');
  const r4 = await analyzePrice({
    query: '구찌 가방',
    category: '가방',
    condition: 'S',
  });
  console.log(JSON.stringify(r4, null, 2));

  console.log('\n=== All tests done ===');
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
