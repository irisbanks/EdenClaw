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
        max_tokens: 400,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(12000),
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } catch {
    return '';
  }
}

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

function regionScore(regionA: string, regionB: string): number {
  if (regionA === regionB) return 1.0;
  // 동일 광역시도면 0.7
  const extract = (r: string) => r.replace(/[시구군동읍면리].*$/, '');
  if (extract(regionA) === extract(regionB)) return 0.7;
  return 0.3;
}

function timeScore(createdAt: Date): number {
  const hour = new Date(createdAt).getHours();
  // 오전 7~23시 활성
  return hour >= 7 && hour <= 23 ? 1.0 : 0.6;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    userId?: string;
    productId?: string;
    region?: string;
    budgetMin?: number;
    budgetMax?: number;
    runCron?: boolean;
  };

  const { userId, productId, region, budgetMin = 0, budgetMax = 999999, runCron = false } = body;

  // 진행 중인 공동구매 조회
  const openGroupBuys = await prisma.groupBuy.findMany({
    where: {
      status: 'open',
      deadline: { gt: new Date() },
      discountedPrice: { gte: budgetMin, lte: budgetMax },
    },
    include: {
      product: { select: { title: true, description: true, category: true, tags: true, images: true, verifyScore: true } },
      _count: { select: { participants: true } },
    },
    orderBy: { currentCount: 'desc' },
    take: 50,
  });

  if (openGroupBuys.length === 0) {
    return NextResponse.json({ matches: [], message: '현재 진행 중인 공동구매가 없습니다.', total: 0 });
  }

  // 사용자 관심 프로파일 구성
  let userInterests = '';
  let userRegion = region || '서울';

  if (userId) {
    const memories = await prisma.agentMemory.findMany({
      where: { userId },
      orderBy: { importance: 'desc' },
      take: 10,
      select: { content: true },
    });
    userInterests = memories.map(m => m.content).join(' ');

    const orders = await prisma.order.findMany({
      where: { buyerId: userId },
      include: { product: { select: { category: true, tags: true } } },
      take: 5,
    });
    const purchasedCats = orders.map(o => o.product.category).join(' ');
    userInterests = `${userInterests} ${purchasedCats}`;
  }

  if (productId) {
    const refProduct = await prisma.product.findUnique({
      where: { id: productId },
      select: { title: true, category: true, tags: true },
    });
    if (refProduct) {
      userInterests = `${userInterests} ${refProduct.title} ${refProduct.category} ${refProduct.tags}`;
    }
  }

  // 임베딩 유사도 계산
  const vocab = ['electronics', 'fashion', 'food', 'digital', 'general',
    '전자', '패션', '음식', '디지털', '의류', '식품', '가전', '모바일'];

  const userVec = userInterests
    ? textToVector(userInterests, vocab)
    : null;

  const scored = openGroupBuys.map(gb => {
    const productText = `${gb.product.title} ${gb.product.description} ${gb.product.category} ${gb.product.tags}`;
    const productVec = textToVector(productText, vocab);

    // 다차원 매칭 점수
    const simScore = userVec ? cosineSim(userVec, productVec) : 0.5;
    const regionSc = regionScore(userRegion, gb.region || '서울');
    const timeSc = timeScore(gb.createdAt);
    const budgetSc = gb.discountedPrice <= budgetMax && gb.discountedPrice >= budgetMin ? 1.0 : 0.3;
    const progressSc = gb.currentCount / gb.targetCount; // 인기도
    const verifySc = (gb.product.verifyScore || 50) / 100;

    const matchScore = Math.round(
      (simScore * 30 + regionSc * 20 + timeSc * 10 + budgetSc * 20 + progressSc * 10 + verifySc * 10) * 100 / 100
    );

    return {
      groupBuy: gb,
      matchScore: Math.min(100, matchScore),
      breakdown: {
        similarity: Math.round(simScore * 100),
        region: Math.round(regionSc * 100),
        timing: Math.round(timeSc * 100),
        budget: Math.round(budgetSc * 100),
        popularity: Math.round(progressSc * 100),
        verified: Math.round(verifySc * 100),
      },
    };
  });

  scored.sort((a, b) => b.matchScore - a.matchScore);
  const top = scored.slice(0, 10);

  // AI 매칭 이유 생성
  const topSummary = top.slice(0, 3).map(({ groupBuy: gb, matchScore }) =>
    `- ${gb.title} (${gb.discountedPrice} ET, ${gb.discountRate}% 할인, 매칭점수:${matchScore})`
  ).join('\n');

  let matchReasons: string[] = [];
  if (userInterests) {
    const reasonPrompt = `사용자 관심사: "${userInterests.slice(0, 200)}"
지역: ${userRegion}, 예산: ${budgetMin}~${budgetMax} ET

추천 공동구매:
${topSummary}

각 공동구매 추천 이유를 한 줄씩 JSON 배열로 답변하세요: ["이유1", "이유2", "이유3"]`;

    const reasonResp = await callAI(reasonPrompt);
    try {
      const m = reasonResp.match(/\[[\s\S]*\]/);
      if (m) matchReasons = JSON.parse(m[0]) as string[];
    } catch { /* no reasons */ }
  }

  // 크론 모드: DB에 매칭 점수 저장
  if (runCron) {
    for (const { groupBuy: gb, matchScore } of top) {
      await prisma.groupBuy.update({
        where: { id: gb.id },
        data: { matchScore },
      });
    }
  }

  const matches = top.map(({ groupBuy: gb, matchScore, breakdown }, i) => ({
    rank: i + 1,
    id: gb.id,
    title: gb.title,
    description: gb.description,
    discountRate: gb.discountRate,
    basePrice: gb.basePrice,
    discountedPrice: gb.discountedPrice,
    targetCount: gb.targetCount,
    currentCount: gb.currentCount,
    progressRate: Math.round((gb.currentCount / gb.targetCount) * 100),
    remainingHours: Math.max(0, Math.floor((new Date(gb.deadline).getTime() - Date.now()) / 3600000)),
    deadline: gb.deadline,
    region: gb.region,
    product: gb.product,
    participantCount: gb._count.participants,
    matchScore,
    breakdown,
    matchReason: matchReasons[i] || '관심사와 예산에 맞는 공동구매입니다',
  }));

  return NextResponse.json({
    matches,
    total: matches.length,
    userInterests: userInterests ? userInterests.slice(0, 100) : null,
    region: userRegion,
    budget: { min: budgetMin, max: budgetMax },
    generatedAt: new Date().toISOString(),
  });
}
