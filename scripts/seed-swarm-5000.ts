#!/usr/bin/env tsx
// 5000봇 + 2000 상품 시드 생성
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const DB_PATH = path.resolve(process.cwd(), 'prisma/dev.db');
const adapter = new PrismaBetterSqlite3({ url: DB_PATH });
const prisma  = new PrismaClient({ adapter } as Parameters<typeof PrismaClient>[0]);

// ── 데이터 풀 ───────────────────────────────────────────────
const SURNAMES  = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '홍', '유', '전', '고', '노'];
const GIVEN     = ['민수', '지영', '성호', '예린', '도현', '수아', '준혁', '나은', '태양', '하은',
                   '민준', '서연', '재원', '유나', '현우', '채원', '동현', '아린', '시우', '다은',
                   '지훈', '예지', '상우', '보미', '태민', '수현', '경훈', '가은', '진혁', '소연'];
const REGIONS   = ['서울', '부산', '제주', '광주', '대전', '인천', '대구', '울산', '수원', '창원'];
const INTERESTS = ['식품', 'IT', '패션', '유아', '건강', '문구', '가전', '스포츠', '여행', '반려동물'];

const FOOD_ITEMS    = ['강원도 햇감자 5kg', '제주 하우스 감귤 3kg', '국내산 한우 등심 500g', '전남 유기농 쌀 10kg',
  '경북 사과 10개입', '충남 배추 1포기', '남해 멸치 건어물 300g', '완도 전복 10마리', '제주 고등어 2마리', '경기 오리고기 600g',
  '홍어 무침 500g', '제주 갈치 1팩', '완도 미역 200g', '충북 복숭아 2kg', '강원 옥수수 5개'];
const ELEC_ITEMS    = ['삼성 LED TV 55인치', 'LG 드럼세탁기 17kg', '삼성 비스포크 냉장고', '다이슨 무선청소기', '쿠쿠 전기밥솥 10인용',
  '필립스 에어프라이어 5L', '발뮤다 공기청정기', '로봇청소기 S9+', 'LG 스타일러', '아이로봇 브라바'];
const FASHION_ITEMS = ['나이키 에어맥스 270', '아디다스 울트라부스트', '패딩 구스다운 롱', '캐시미어 터틀넥',
  '가죽 크로스백', '데님 재킷 오버핏', '린넨 셔츠 화이트', '스포츠 레깅스 7부', '울 코트 카멜', '스니커즈 화이트'];
const BABY_ITEMS    = ['유아용 안전식기 세트', '아기 유기농 이유식', '친환경 물티슈 100매 10팩', '유아 블록 100피스',
  '아기 침대 가드', '유아 카시트 0~4세', '아기 수면 조명', '유아 우산 캐릭터', '아기 물조리개 세트', '유아 음악 모빌'];
const IT_ITEMS      = ['맥북 에어 M3', '아이패드 프로 12.9', '기계식 키보드 텐키리스', '게이밍 마우스 무선', '외장 SSD 1TB',
  'USB-C 허브 7포트', '웹캠 4K', '노이즈캔슬링 이어폰', '스마트워치 갤럭시', '65W GaN 충전기'];
const HEALTH_ITEMS  = ['비타민D 2000IU 100정', '오메가3 피쉬오일', '홍삼 에브리데이 30포', '단백질 보충제 1kg',
  '마그네슘 글리시네이트', '루테인 지아잔틴', '유산균 프리미엄', '콜라겐 드링크', '요가매트 6mm', '덤벨 2kg 세트'];
const STATIONERY_ITEMS = ['몰스킨 노트북 A5', '제브라 사라사 볼펜 10색', '펜텔 샤프 0.5mm', '스테들러 색연필 48색',
  '포스트잇 3×3 10팩', '화이트보드 A3', '코일 스프링 노트', '형광펜 10색 세트', '독서대 접이식', '라미 만년필'];

const PRODUCT_POOL: { name: string; cat: string; minPrice: number; maxPrice: number; origin: string }[] = [
  ...Array.from({ length: 300 }, (_, i) => ({ name: FOOD_ITEMS[i % FOOD_ITEMS.length],       cat: 'food',        minPrice: 8000,   maxPrice: 80000,   origin: REGIONS[i % REGIONS.length] })),
  ...Array.from({ length: 200 }, (_, i) => ({ name: ELEC_ITEMS[i % ELEC_ITEMS.length],       cat: 'electronics', minPrice: 150000, maxPrice: 2000000, origin: '국내' })),
  ...Array.from({ length: 200 }, (_, i) => ({ name: FASHION_ITEMS[i % FASHION_ITEMS.length], cat: 'fashion',     minPrice: 30000,  maxPrice: 500000,  origin: '국내/수입' })),
  ...Array.from({ length: 200 }, (_, i) => ({ name: BABY_ITEMS[i % BABY_ITEMS.length],       cat: 'baby',        minPrice: 10000,  maxPrice: 300000,  origin: '국내' })),
  ...Array.from({ length: 300 }, (_, i) => ({ name: IT_ITEMS[i % IT_ITEMS.length],           cat: 'IT',          minPrice: 20000,  maxPrice: 2500000, origin: '수입' })),
  ...Array.from({ length: 200 }, (_, i) => ({ name: HEALTH_ITEMS[i % HEALTH_ITEMS.length],   cat: 'health',      minPrice: 15000,  maxPrice: 150000,  origin: '국내' })),
  ...Array.from({ length: 100 }, (_, i) => ({ name: STATIONERY_ITEMS[i % STATIONERY_ITEMS.length], cat: 'stationery', minPrice: 3000, maxPrice: 80000, origin: '국내/수입' })),
];

function randName() {
  return SURNAMES[Math.floor(Math.random() * SURNAMES.length)]
       + GIVEN[Math.floor(Math.random() * GIVEN.length)];
}
function shuffle<T>(arr: T[]): T[] { return arr.slice().sort(() => Math.random() - 0.5); }
function pickRand<T>(arr: T[], n = 1): T[] { return shuffle(arr).slice(0, n); }
function randInt(min: number, max: number) { return min + Math.floor(Math.random() * (max - min)); }

async function main() {
  console.log('[seed-swarm-5000] 기존 스웜 데이터 초기화...');
  await prisma.botReferralChain.deleteMany({});
  await prisma.swarmTransaction.deleteMany({});
  await prisma.swarmMarketSession.deleteMany({});
  await prisma.swarmBot.deleteMany({});
  console.log('[seed-swarm-5000] 초기화 완료');

  // ── 5000봇 생성 ─────────────────────────────────────────────
  const SELLER = 2000;
  const BUYER  = 2500;
  const MULTI  =  500;
  const TOTAL  = SELLER + BUYER + MULTI;

  const botData: Parameters<typeof prisma.swarmBot.createMany>[0]['data'] = [];

  for (let i = 0; i < TOTAL; i++) {
    const isSeller = i < SELLER;
    const isBuyer  = i >= SELLER && i < SELLER + BUYER;
    const type     = isSeller ? 'seller' : isBuyer ? 'buyer' : 'multipurpose';

    const budgetMin = randInt(10000, 100000);
    const budgetMax = budgetMin + randInt(50000, 900000);

    const sellingItems = (isSeller || !isBuyer)
      ? pickRand(PRODUCT_POOL, randInt(1, 5)).map(p => p.name)
      : [];

    const caps = isSeller
      ? ['design', 'sell', 'negotiate']
      : isBuyer
      ? ['buy', 'negotiate', 'group-buy']
      : ['design', 'sell', 'buy', 'negotiate', 'group-buy', 'recommend'];

    // 다단계 트리: 1270 노드 (깊이 10 이진트리)
    const parentBotId = i > 0 && i < 1270
      ? `sbot_${String(Math.floor((i - 1) / 2)).padStart(4, '0')}`
      : null;

    botData.push({
      id: `sbot_${String(i).padStart(4, '0')}`,
      persona: JSON.stringify({
        name:         randName(),
        age:          randInt(20, 65),
        region:       REGIONS[Math.floor(Math.random() * REGIONS.length)],
        interests:    pickRand(INTERESTS, randInt(1, 3)),
        budget:       { min: budgetMin, max: budgetMax },
        sellingItems,
      }),
      capabilities: JSON.stringify(caps),
      memory:       JSON.stringify({ transactions: [], learnedPatterns: [], knownBots: [], preferredKeywords: [] }),
      reputation:   40 + Math.random() * 40,
      totalEarnings: 0,
      status:       'sleeping',
      botType:      type,
      parentBotId,
    });
  }

  // 100개씩 배치 삽입
  for (let i = 0; i < botData.length; i += 100) {
    await prisma.swarmBot.createMany({ data: botData.slice(i, i + 100) });
    if ((i / 100) % 10 === 0)
      process.stdout.write(`\r[seed-swarm-5000] 봇 생성 ${Math.min(i + 100, TOTAL)}/${TOTAL}`);
  }
  console.log(`\n[seed-swarm-5000] ${TOTAL}봇 생성 완료`);

  // ── 바이너리 다단계 트리 (1270 노드, 깊이 10) ────────────────
  const refData: Parameters<typeof prisma.botReferralChain.createMany>[0]['data'] = [];
  for (let i = 1; i < 1270; i++) {
    const parentIdx = Math.floor((i - 1) / 2);
    const level     = Math.ceil(Math.log2(i + 2)) - 1;
    refData.push({
      parentBotId: `sbot_${String(parentIdx).padStart(4, '0')}`,
      childBotId:  `sbot_${String(i).padStart(4, '0')}`,
      level:       Math.min(level, 5),
      earnings:    0,
    });
  }
  for (let i = 0; i < refData.length; i += 200) {
    await prisma.botReferralChain.createMany({ data: refData.slice(i, i + 200) });
  }
  console.log(`[seed-swarm-5000] 다단계 트리 ${refData.length}노드 완료`);

  // ── 2000개 상품 삽입 ─────────────────────────────────────────
  const prodData: Parameters<typeof prisma.product.createMany>[0]['data'] = [];
  for (let i = 0; i < 2000; i++) {
    const p          = PRODUCT_POOL[i % PRODUCT_POOL.length];
    const price      = p.minPrice + Math.floor(Math.random() * (p.maxPrice - p.minPrice));
    const sellerIdx  = Math.floor(Math.random() * SELLER);
    const sellerBot  = botData[sellerIdx];
    const sellerPersona = JSON.parse(sellerBot.persona as string) as { name: string; region: string };

    prodData.push({
      title:       `${p.name} [스웜#${String(i + 1).padStart(4, '0')}]`,
      description: `${p.origin} 산지 직송 ${p.name}. 스웜 봇이 직접 검증한 고품질 상품입니다.`,
      price,
      currency:    'ET',
      category:    p.cat === 'IT' ? 'electronics' : p.cat === 'baby' ? 'general' : p.cat,
      tags:        JSON.stringify([p.name.split(' ')[0], p.cat, p.origin]),
      images:      JSON.stringify([`https://picsum.photos/seed/sw5k${i}/400/300`]),
      sellerId:    sellerBot.id,
      sellerName:  sellerPersona.name,
      stock:       5 + Math.floor(Math.random() * 100),
      status:      'active',
      region:      sellerPersona.region,
    });
  }

  for (let i = 0; i < prodData.length; i += 200) {
    await prisma.product.createMany({ data: prodData.slice(i, i + 200) });
    process.stdout.write(`\r[seed-swarm-5000] 상품 생성 ${Math.min(i + 200, 2000)}/2000`);
  }
  console.log('\n[seed-swarm-5000] 2000개 상품 생성 완료');

  const finalBots = await prisma.swarmBot.count();
  const finalProds = await prisma.product.count();
  console.log(`\n✅ 5000 bots created (${SELLER} sellers, ${BUYER} buyers, ${MULTI} multi)`);
  console.log(`   상품: ${finalProds}개 | 다단계 체인: ${refData.length}개`);
  console.log(`   실제 DB 봇 수: ${finalBots}개`);

  await prisma.$disconnect();
}

main().catch(e => {
  console.error('[seed-swarm-5000] 오류:', e);
  process.exit(1);
});
