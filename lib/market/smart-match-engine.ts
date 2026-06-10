// 스마트 매칭 엔진: 4차원 매칭(각 25점), 70+ 자동 GroupBuy 생성
'use strict';

import { prisma } from '@/lib/prisma';

const VLLM_URL = process.env.LOCAL_AI_URL || 'http://localhost:8000/v1/chat/completions';
const AI_MODEL = process.env.LOCAL_AI_MODEL || 'Qwen/Qwen2.5-72B-Instruct';

async function callAI(prompt: string, maxTokens = 400): Promise<string> {
  try {
    const res = await fetch(VLLM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(12000),
    });
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content || '';
  } catch {
    return '';
  }
}

function textToVector(text: string, vocab: string[]): number[] {
  const words = text.toLowerCase().split(/[\s,]+/);
  return vocab.map(w => words.filter(x => x.includes(w)).length);
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * (b[i] || 0);
    magA += a[i] ** 2;
    magB += (b[i] || 0) ** 2;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// 지역 유사도 (동일 지역 1.0, 동일 광역시도 0.7, 이외 0.3)
function regionSim(a: string, b: string): number {
  if (a === b) return 1.0;
  const toCity = (r: string) => r.replace(/(시|군|구|동|읍|면|리).*/g, '');
  return toCity(a) === toCity(b) ? 0.7 : 0.3;
}

// 예산 범위 내 상품 가격 여부
function budgetScore(price: number, budgetMin = 0, budgetMax = 9999999): number {
  if (price >= budgetMin && price <= budgetMax) return 1.0;
  if (price < budgetMin) return 0.5;
  const over = (price - budgetMax) / budgetMax;
  return Math.max(0, 1 - over);
}

// 활동 시간 점수 (07:00~23:00 활성)
function activityScore(dt: Date): number {
  const h = new Date(dt).getHours();
  return h >= 7 && h <= 23 ? 1.0 : 0.6;
}

export interface MatchOptions {
  userId?: string;
  productId?: string;
  region?: string;
  budgetMin?: number;
  budgetMax?: number;
}

export interface MatchResult {
  product: {
    id: string; title: string; price: number; currency: string;
    category: string; region: string; stock: number; sellerName: string;
  };
  matchScore: number;
  dimensions: { content: number; region: number; budget: number; activity: number };
  autoGroupBuy: boolean;
  groupBuyId?: string;
}

export async function smartMatch(options: MatchOptions): Promise<{
  matches: MatchResult[];
  autoGroupBuysCreated: number;
  generatedAt: string;
}> {
  const { userId, productId, region = '서울', budgetMin = 0, budgetMax = 9999999 } = options;

  // 관심 상품 정보
  let refProduct = productId
    ? await prisma.product.findUnique({ where: { id: productId }, select: { title: true, category: true, tags: true, createdAt: true } })
    : null;

  // 사용자 이력에서 프로파일 구성
  let userProfile = '';
  if (userId) {
    const behaviors = await prisma.userBehavior.findMany({
      where: { userId }, orderBy: { createdAt: 'desc' }, take: 20,
      select: { action: true, query: true },
    });
    userProfile = behaviors.map(b => `${b.action}:${b.query || ''}`).join(' ');
  }

  const vocab = ['electronics','fashion','food','digital','general',
    '전자','패션','음식','디지털','프리미엄','신제품','할인','무선','스마트',
    ...region.split(''),
  ];

  const userQuery = [userProfile, refProduct?.title || '', refProduct?.category || ''].join(' ');
  const userVec = textToVector(userQuery, vocab);

  // 후보 상품 조회
  const candidates = await prisma.product.findMany({
    where: { status: 'active', stock: { gt: 0 }, price: { gte: budgetMin, lte: budgetMax * 1.3 } },
    orderBy: [{ buyCount: 'desc' }, { viewCount: 'desc' }],
    take: 100,
  });

  const scored: MatchResult[] = [];
  let autoGroupBuysCreated = 0;

  for (const p of candidates) {
    const pText = `${p.title} ${p.category} ${JSON.parse(p.tags || '[]').join(' ')}`;
    const pVec = textToVector(pText, vocab);

    // 4차원 매칭 (각 25점 만점)
    const contentScore = Math.round(cosineSim(userVec, pVec) * 25);
    const regionScore = Math.round(regionSim(region, p.region) * 25);
    const bScore = Math.round(budgetScore(p.price, budgetMin, budgetMax) * 25);
    const actScore = Math.round(activityScore(p.createdAt) * 25);
    const matchScore = contentScore + regionScore + bScore + actScore;

    let autoGroupBuy = false;
    let groupBuyId: string | undefined;

    // 70점 이상이면 자동 GroupBuy 생성 시도
    if (matchScore >= 70) {
      const existing = await prisma.groupBuy.findFirst({
        where: { productId: p.id, status: 'open' },
      });
      if (!existing) {
        const deadline = new Date(Date.now() + 7 * 86400000); // 7일 후
        const discountRate = matchScore >= 90 ? 0.15 : matchScore >= 80 ? 0.10 : 0.05;
        const gb = await prisma.groupBuy.create({
          data: {
            productId: p.id,
            title: `[자동매칭] ${p.title} 공동구매`,
            description: `AI 스마트매칭 자동 생성 (매칭점수: ${matchScore}점)`,
            targetCount: 5,
            currentCount: userId ? 1 : 0,
            discountRate,
            basePrice: p.price,
            discountedPrice: Math.round(p.price * (1 - discountRate)),
            deadline,
            status: 'open',
            region,
            budgetMin,
            budgetMax,
            matchScore,
          },
        });
        groupBuyId = gb.id;
        autoGroupBuy = true;
        autoGroupBuysCreated++;
        console.log(`[SmartMatchEngine] GroupBuy 자동 생성: ${p.title} (${matchScore}점, ${(discountRate * 100).toFixed(0)}% 할인)`);
      } else {
        groupBuyId = existing.id;
        autoGroupBuy = true;
      }
    }

    scored.push({
      product: {
        id: p.id, title: p.title, price: p.price, currency: p.currency,
        category: p.category, region: p.region, stock: p.stock, sellerName: p.sellerName,
      },
      matchScore,
      dimensions: { content: contentScore, region: regionScore, budget: bScore, activity: actScore },
      autoGroupBuy,
      groupBuyId,
    });
  }

  scored.sort((a, b) => b.matchScore - a.matchScore);
  const top20 = scored.slice(0, 20);

  // AI 매칭 이유 생성 (상위 5개)
  if (top20.length > 0 && userQuery.trim().length > 0) {
    const summary = top20.slice(0, 5).map(r => `- ${r.product.title} (${r.matchScore}점)`).join('\n');
    await callAI(
      `사용자 지역:${region}, 예산:${budgetMin}~${budgetMax}\n추천 상품:\n${summary}\n매칭 이유를 한 줄씩 설명하세요.`,
      200,
    ).then(r => console.log(`[SmartMatchEngine] 매칭 이유: ${r.slice(0, 100)}`));
  }

  console.log(`[SmartMatchEngine] ${top20.length}개 매칭, GroupBuy ${autoGroupBuysCreated}개 자동 생성`);

  return { matches: top20, autoGroupBuysCreated, generatedAt: new Date().toISOString() };
}
