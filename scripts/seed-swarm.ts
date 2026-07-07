#!/usr/bin/env tsx
// 5000봇 + 1000 상품 시드 생성
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const DB_PATH = path.resolve(process.cwd(), 'prisma/dev.db');
const adapter = new PrismaBetterSqlite3({ url: DB_PATH });
const prisma = new PrismaClient({ adapter } as Parameters<typeof PrismaClient>[0]);

// ── 한국어 이름 풀 ───────────────────────────────────────────
const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '류', '전'];
const GIVEN = ['민준', '서준', '도윤', '예준', '시우', '하준', '지호', '준서', '준우', '현우', '지민', '수아', '서연', '소율', '하은', '지유', '채원', '수빈', '나은', '다은', '민서', '아린', '예린', '지아', '유나'];
const REGIONS = ['서울', '부산', '인천', '대구', '광주', '대전', '수원', '성남', '제주', '창원', '청주', '전주', '울산', '남양주', '화성'];
const INTERESTS_POOL = ['식품', 'IT', '패션', '유아', '건강', '스포츠', '여행', '뷰티', '가전', '도서', '반려동물', '자동차', '홈인테리어', '취미'];
const ITEMS_POOL = [
  '감자', '사과', '배추', '소고기', '고등어', '쌀 5kg', '양파', '당근',
  '노트북 15인치', '무선이어폰', '스마트폰', 'USB-C 충전기', '기계식 키보드', '웹캠',
  '운동화', '청바지', '울 코트', '린넨 셔츠', '가죽 지갑', '미니 백팩',
  '영어 교재', '파이썬 강의', '그래픽 소프트웨어', '음악 스트리밍 1년권',
  '요가매트', '덤벨 세트', '단백질 보충제', '비타민C 1000mg',
  '립스틱', '선크림 SPF50', '스킨케어 세트', '헤어 에센스',
  '그림책 세트', '유아 블록', '물티슈 100매', '기저귀',
  '캡슐 커피', '홍삼 에브리데이', '다이어트 쉐이크', '천연 꿀',
];

function randName() {
  return SURNAMES[Math.floor(Math.random() * SURNAMES.length)] +
    GIVEN[Math.floor(Math.random() * GIVEN.length)];
}

function randItems(count: number) {
  const shuffled = ITEMS_POOL.slice().sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function randInterests(count: number) {
  const shuffled = INTERESTS_POOL.slice().sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function randBudget(type: 'seller' | 'buyer' | 'multipurpose') {
  const base = type === 'seller'
    ? { min: 5000, max: 150000 }
    : type === 'buyer'
    ? { min: 10000, max: 500000 }
    : { min: 5000, max: 300000 };
  const min = base.min + Math.floor(Math.random() * base.min * 2);
  const max = min + 20000 + Math.floor(Math.random() * (base.max - min));
  return { min, max };
}

function randCapabilities(type: 'seller' | 'buyer' | 'multipurpose') {
  if (type === 'seller') return ['design', 'video', 'sell', 'negotiate'];
  if (type === 'buyer') return ['buy', 'negotiate', 'group-buy', 'recommend'];
  return ['design', 'video', 'sell', 'buy', 'negotiate', 'group-buy', 'recommend'];
}

// ── 바이너리 다단계 트리 인덱스 ─────────────────────────────
function getParentIndex(i: number) { return i === 0 ? -1 : Math.floor((i - 1) / 2); }

async function main() {
  console.log('[seed-swarm] 5000봇 시드 시작...');

  // 기존 봇 삭제
  await prisma.botReferralChain.deleteMany({});
  await prisma.swarmTransaction.deleteMany({});
  await prisma.swarmMarketSession.deleteMany({});
  await prisma.swarmBot.deleteMany({});
  console.log('[seed-swarm] 기존 스웜 데이터 초기화 완료');

  const TOTAL = 5000;
  const SELLER_COUNT = 2000;
  const BUYER_COUNT = 2500;
  // MULTI_COUNT = 500

  const bots: Parameters<typeof prisma.swarmBot.createMany>[0]['data'] = [];

  for (let i = 0; i < TOTAL; i++) {
    const type = i < SELLER_COUNT ? 'seller' : i < SELLER_COUNT + BUYER_COUNT ? 'buyer' : 'multipurpose';
    const name = randName();
    const region = REGIONS[Math.floor(Math.random() * REGIONS.length)];
    const budget = randBudget(type);
    const interests = randInterests(2 + Math.floor(Math.random() * 3));
    const sellingItems = type !== 'buyer' ? randItems(1 + Math.floor(Math.random() * 3)) : [];

    bots.push({
      id: `bot_${String(i).padStart(5, '0')}`,
      persona: JSON.stringify({ name, age: 20 + Math.floor(Math.random() * 40), region, interests, budget, sellingItems }),
      capabilities: JSON.stringify(randCapabilities(type)),
      memory: JSON.stringify({ transactions: [], learnedPatterns: [], knownBots: [], preferredKeywords: [] }),
      reputation: 40 + Math.floor(Math.random() * 40),
      totalEarnings: 0,
      status: 'sleeping',
      botType: type,
    });
  }

  // 배치 삽입 (500개씩)
  const BATCH = 500;
  for (let i = 0; i < bots.length; i += BATCH) {
    await prisma.swarmBot.createMany({ data: bots.slice(i, i + BATCH) });
    process.stdout.write(`\r[seed-swarm] 봇 생성 중... ${Math.min(i + BATCH, TOTAL)}/${TOTAL}`);
  }
  console.log('\n[seed-swarm] 5000봇 생성 완료');

  // ── 바이너리 다단계 트리 구축 (상위 127봇) ──────────────
  const referralData: Parameters<typeof prisma.botReferralChain.createMany>[0]['data'] = [];
  for (let i = 1; i < 127; i++) {
    const parentIdx = getParentIndex(i);
    const level = Math.floor(Math.log2(i + 1));
    referralData.push({
      id: `ref_${String(i).padStart(4, '0')}`,
      parentBotId: `bot_${String(parentIdx).padStart(5, '0')}`,
      childBotId: `bot_${String(i).padStart(5, '0')}`,
      level: Math.min(level, 4),
      earnings: 0,
    });
  }
  await prisma.botReferralChain.createMany({ data: referralData });
  console.log('[seed-swarm] 바이너리 다단계 트리 126노드 구축 완료');

  // ── 1000개 가상 상품 Product DB에 추가 ─────────────────
  const existingCount = await prisma.product.count();
  if (existingCount < 100) {
    const swarmProducts: Parameters<typeof prisma.product.createMany>[0]['data'] = [];
    for (let i = 0; i < 1000; i++) {
      const item = ITEMS_POOL[i % ITEMS_POOL.length];
      const cat = ['food', 'electronics', 'fashion', 'digital', 'general'][Math.floor(Math.random() * 5)];
      const price = 3000 + Math.floor(Math.random() * 200000);
      swarmProducts.push({
        title: `${item} (스웜 상품 #${i + 1})`,
        description: `스웜 생태계에서 봇이 생성한 ${item} 상품입니다. 고품질 보증.`,
        price,
        currency: 'ET',
        category: cat,
        tags: JSON.stringify([item.split(' ')[0], cat, '스웜']),
        images: JSON.stringify([`https://picsum.photos/seed/sw${i}/400/300`]),
        sellerId: `bot_${String(Math.floor(Math.random() * SELLER_COUNT)).padStart(5, '0')}`,
        sellerName: bots[Math.floor(Math.random() * SELLER_COUNT)].persona
          ? JSON.parse(bots[Math.floor(Math.random() * SELLER_COUNT)].persona as string).name
          : '스웜봇',
        stock: 5 + Math.floor(Math.random() * 50),
        status: 'active',
        region: REGIONS[Math.floor(Math.random() * REGIONS.length)],
      });
    }
    for (let i = 0; i < swarmProducts.length; i += 200) {
      await prisma.product.createMany({ data: swarmProducts.slice(i, i + 200) });
    }
    console.log('[seed-swarm] 1000개 스웜 상품 생성 완료');
  } else {
    console.log(`[seed-swarm] 기존 상품 ${existingCount}개 존재 — 스웜 상품 추가 생략`);
  }

  const finalCount = await prisma.swarmBot.count();
  console.log(`\n✅ [seed-swarm] 완료 — 봇 ${finalCount}개 / 다단계 체인 ${referralData.length}개`);

  await prisma.$disconnect();
}

main().catch(e => {
  console.error('[seed-swarm] 오류:', e);
  process.exit(1);
});
