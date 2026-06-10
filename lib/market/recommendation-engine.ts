// 추천 엔진: 메모리 + 임베딩 코사인 유사도 Top10 + Qwen 추천 이유
'use strict';

import { prisma } from '@/lib/prisma';

const VLLM_URL = process.env.LOCAL_AI_URL || 'http://localhost:8000/v1/chat/completions';
const AI_MODEL = process.env.LOCAL_AI_MODEL || 'Qwen/Qwen2.5-72B-Instruct';

async function callAI(prompt: string, maxTokens = 500): Promise<string> {
  try {
    const res = await fetch(VLLM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.4,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content || '';
  } catch {
    return '';
  }
}

// TF 기반 벡터 (vLLM 임베딩 엔드포인트 없을 때 폴백)
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

export interface RecommendationOptions {
  userId?: string;
  limit?: number;
  excludeIds?: string[];
}

export interface RecommendedProduct {
  rank: number;
  product: {
    id: string; title: string; price: number; currency: string;
    category: string; tags: string[]; images: string[];
    sellerName: string; verifyScore: number; avgRating: number;
    reviewCount: number; viewCount: number; buyCount: number; stock: number;
  };
  matchScore: number;
  reason: string;
}

export async function recommend(options: RecommendationOptions): Promise<{
  userId: string;
  interestKeywords: string[];
  recommendations: RecommendedProduct[];
  total: number;
  generatedAt: string;
}> {
  const { userId, limit = 10, excludeIds = [] } = options;
  const safeLimit = Math.min(limit, 20);

  // ── 사용자 메모리에서 관심사 추출 ────────────────────────
  let interestKeywords: string[] = [];
  let memoryContext = '';

  if (userId) {
    const [memories, orders] = await Promise.all([
      prisma.agentMemory.findMany({
        where: { userId },
        orderBy: [{ importance: 'desc' }, { lastAccess: 'desc' }],
        take: 20,
        select: { content: true },
      }),
      prisma.order.findMany({
        where: { buyerId: userId },
        include: { product: { select: { title: true, category: true, tags: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    memoryContext = memories.map(m => m.content).join(' ');
    const purchasedCats = orders.map(o => o.product.category);
    const purchasedTags = orders.flatMap(o => JSON.parse(o.product.tags || '[]') as string[]);
    interestKeywords = [...new Set([...purchasedCats, ...purchasedTags])];

    // 행동 로그에서 추가 키워드
    const behaviors = await prisma.userBehavior.findMany({
      where: { userId, action: { in: ['view', 'search', 'wishlist'] } },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { query: true, productId: true },
    });
    const behaviorKeywords = behaviors
      .flatMap(b => b.query ? b.query.split(/\s+/) : [])
      .filter(k => k.length > 1);
    interestKeywords = [...new Set([...interestKeywords, ...behaviorKeywords])];

    if (memoryContext && interestKeywords.length < 5) {
      const kwResp = await callAI(
        `다음 사용자 메모리에서 쇼핑 관심사 키워드 10개를 JSON 배열로만 답변하세요.\n메모리: ${memoryContext.slice(0, 400)}`,
        200,
      );
      try {
        const m = kwResp.match(/\[[\s\S]*\]/);
        if (m) {
          const extracted = JSON.parse(m[0]) as string[];
          interestKeywords = [...new Set([...interestKeywords, ...extracted])];
        }
      } catch { /* ignore */ }
    }
  }

  // ── 상품 조회 ─────────────────────────────────────────────
  const products = await prisma.product.findMany({
    where: { status: 'active', stock: { gt: 0 }, id: { notIn: excludeIds } },
    include: { reviews: { select: { rating: true } } },
    orderBy: [{ viewCount: 'desc' }, { buyCount: 'desc' }],
    take: 150,
  });

  // ── 코사인 유사도 스코어링 ──────────────────────────────
  const vocab = [...new Set([
    ...interestKeywords,
    'electronics', 'fashion', 'food', 'digital', 'general',
    '전자', '패션', '음식', '디지털', '일반', '할인', '신제품',
  ])];

  const userVec = interestKeywords.length > 0
    ? textToVector(interestKeywords.join(' '), vocab)
    : null;

  const scored = products.map(p => {
    const text = `${p.title} ${p.description} ${p.category} ${JSON.parse(p.tags || '[]').join(' ')}`;
    const pVec = textToVector(text, vocab);
    const similarity = userVec ? cosineSim(userVec, pVec) : 0;

    const reviewCount = p.reviews.length;
    const avgRating = reviewCount ? p.reviews.reduce((s, r) => s + r.rating, 0) / reviewCount : 0;
    const popularity = Math.min(p.viewCount / 200 + p.buyCount / 100 + avgRating / 5, 1);
    const verifyBonus = (p.verifyScore || 0) / 100 * 0.1;

    const score = userVec
      ? similarity * 0.55 + popularity * 0.35 + verifyBonus
      : popularity * 0.9 + verifyBonus;

    return { p, score, similarity, reviewCount, avgRating };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, safeLimit);

  // ── Qwen 추천 이유 생성 ──────────────────────────────────
  let reasons: string[] = [];
  if (interestKeywords.length > 0 && top.length > 0) {
    const summary = top.slice(0, 6).map(({ p }) =>
      `- ${p.title} (${p.price} ${p.currency}, ${p.category})`
    ).join('\n');
    const resp = await callAI(
      `사용자 관심사: ${interestKeywords.slice(0, 8).join(', ')}\n추천 상품:\n${summary}\n각 상품의 추천 이유를 한 줄씩 JSON 배열로만 답변하세요.`,
      300,
    );
    try {
      const m = resp.match(/\[[\s\S]*\]/);
      if (m) reasons = JSON.parse(m[0]) as string[];
    } catch { /* no reasons */ }
  }

  const recommendations: RecommendedProduct[] = top.map(({ p, score, reviewCount, avgRating }, i) => ({
    rank: i + 1,
    product: {
      id: p.id, title: p.title, price: p.price, currency: p.currency,
      category: p.category, tags: JSON.parse(p.tags || '[]') as string[],
      images: JSON.parse(p.images || '[]') as string[],
      sellerName: p.sellerName, verifyScore: p.verifyScore || 0,
      avgRating: Math.round(avgRating * 10) / 10, reviewCount,
      viewCount: p.viewCount, buyCount: p.buyCount, stock: p.stock,
    },
    matchScore: Math.round(score * 100),
    reason: reasons[i] || (interestKeywords.length > 0
      ? `${interestKeywords[0]} 관심사 맞춤 추천`
      : '인기 상품'),
  }));

  console.log(`[RecommendationEngine] userId=${userId || 'anonymous'} 추천 ${recommendations.length}건 생성`);

  return {
    userId: userId || 'anonymous',
    interestKeywords: interestKeywords.slice(0, 10),
    recommendations, total: recommendations.length,
    generatedAt: new Date().toISOString(),
  };
}
