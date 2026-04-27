import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const VLLM_URL = process.env.LOCAL_AI_URL || 'http://localhost:8000/v1/chat/completions';
const AI_MODEL = process.env.LOCAL_AI_MODEL || 'Qwen/Qwen2.5-72B-Instruct';

async function callAI(prompt: string): Promise<string> {
  try {
    const res = await fetch(VLLM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.4,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } catch {
    return '';
  }
}

// 간단한 TF 기반 임베딩 (vLLM 임베딩 없을 때 폴백)
function textToVector(text: string, vocab: string[]): number[] {
  const words = text.toLowerCase().split(/\s+/);
  return vocab.map(w => words.filter(x => x.includes(w)).length);
}

function cosineSim(a: number[], b: number[]): number {
  const dot = a.reduce((s, v, i) => s + v * (b[i] || 0), 0);
  const magA = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
  const magB = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');
  const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 20);

  // 사용자 메모리에서 관심사 추출
  let interestKeywords: string[] = [];
  let memoryContext = '';

  if (userId) {
    const memories = await prisma.agentMemory.findMany({
      where: { userId },
      orderBy: [{ importance: 'desc' }, { lastAccess: 'desc' }],
      take: 20,
      select: { content: true, memoryType: true },
    });
    memoryContext = memories.map(m => m.content).join(' ');

    // 과거 구매 이력
    const orders = await prisma.order.findMany({
      where: { buyerId: userId },
      include: { product: { select: { title: true, category: true, tags: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const purchasedCategories = orders.map(o => o.product.category);
    const purchasedTags = orders.flatMap(o => JSON.parse(o.product.tags || '[]') as string[]);
    interestKeywords = [...new Set([...purchasedCategories, ...purchasedTags])];

    if (memoryContext) {
      const kwPrompt = `다음 사용자 메모리에서 쇼핑 관심사 키워드를 최대 10개 추출하세요. JSON 배열로만 답변하세요.
메모리: ${memoryContext.slice(0, 500)}`;
      const kwResp = await callAI(kwPrompt);
      try {
        const m = kwResp.match(/\[[\s\S]*\]/);
        if (m) {
          const extracted = JSON.parse(m[0]) as string[];
          interestKeywords = [...new Set([...interestKeywords, ...extracted])];
        }
      } catch { /* use purchased keywords */ }
    }
  }

  // 활성 상품 조회
  const products = await prisma.product.findMany({
    where: { status: 'active', stock: { gt: 0 } },
    include: { reviews: { select: { rating: true } } },
    orderBy: [{ viewCount: 'desc' }, { buyCount: 'desc' }],
    take: 100,
  });

  // 코사인 유사도 계산
  const vocab = [...new Set([
    ...interestKeywords,
    'electronics', 'fashion', 'food', 'digital', 'general',
    '전자', '패션', '음식', '디지털', '일반',
  ])];

  const userVector = interestKeywords.length > 0
    ? textToVector(interestKeywords.join(' '), vocab)
    : null;

  const scored = products.map(p => {
    const productText = `${p.title} ${p.description} ${p.category} ${JSON.parse(p.tags || '[]').join(' ')}`;
    const productVector = textToVector(productText, vocab);

    let similarity = 0;
    if (userVector) {
      similarity = cosineSim(userVector, productVector);
    }

    const reviewCount = p.reviews.length;
    const avgRating = reviewCount ? p.reviews.reduce((s, r) => s + r.rating, 0) / reviewCount : 0;
    const popularityScore = Math.min(p.viewCount / 100 + p.buyCount / 50 + avgRating / 5, 1);

    const finalScore = userVector
      ? similarity * 0.6 + popularityScore * 0.4
      : popularityScore;

    return { product: p, score: finalScore, similarity, popularityScore };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);

  // AI로 추천 이유 생성
  const productSummary = top.slice(0, 5).map(({ product }) =>
    `- ${product.title} (${product.price} ${product.currency}, ${product.category})`
  ).join('\n');

  let reasonPrompt = '';
  if (interestKeywords.length > 0) {
    reasonPrompt = `당신은 AI 쇼핑 추천 에이전트입니다. 사용자 관심사를 바탕으로 각 상품 추천 이유를 한 줄씩 생성하세요.

사용자 관심사: ${interestKeywords.slice(0, 10).join(', ')}

추천 상품:
${productSummary}

각 상품마다 한 줄 추천 이유를 JSON 배열로 답변하세요: ["이유1", "이유2", "이유3", "이유4", "이유5"]`;
  }

  let reasons: string[] = [];
  if (reasonPrompt) {
    const reasonResp = await callAI(reasonPrompt);
    try {
      const m = reasonResp.match(/\[[\s\S]*\]/);
      if (m) reasons = JSON.parse(m[0]) as string[];
    } catch { /* no reasons */ }
  }

  const recommendations = top.map(({ product, score }, i) => {
    const reviews = product.reviews;
    const avgRating = reviews.length
      ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
      : 0;
    return {
      rank: i + 1,
      product: {
        id: product.id,
        title: product.title,
        price: product.price,
        currency: product.currency,
        category: product.category,
        tags: JSON.parse(product.tags || '[]'),
        images: JSON.parse(product.images || '[]'),
        sellerName: product.sellerName,
        verifyScore: product.verifyScore || 0,
        avgRating: Math.round(avgRating * 10) / 10,
        reviewCount: reviews.length,
        viewCount: product.viewCount,
        buyCount: product.buyCount,
        stock: product.stock,
      },
      matchScore: Math.round(score * 100),
      reason: reasons[i] || (
        interestKeywords.length > 0
          ? `${interestKeywords[0]} 관심사에 맞는 상품입니다`
          : '인기 상품입니다'
      ),
    };
  });

  return NextResponse.json({
    userId: userId || 'anonymous',
    interestKeywords: interestKeywords.slice(0, 10),
    recommendations,
    total: recommendations.length,
    generatedAt: new Date().toISOString(),
  });
}
