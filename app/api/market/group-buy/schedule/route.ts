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
        temperature: 0.4,
      }),
      signal: AbortSignal.timeout(12000),
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } catch {
    return '';
  }
}

async function planGroupBuy(product: { title: string; description: string; price: number; currency: string; category: string }) {
  const categoryDefaults: Record<string, { targetCount: number; discountRate: number; hours: number }> = {
    electronics: { targetCount: 20, discountRate: 15, hours: 72 },
    fashion: { targetCount: 15, discountRate: 20, hours: 48 },
    food: { targetCount: 10, discountRate: 10, hours: 24 },
    digital: { targetCount: 30, discountRate: 25, hours: 96 },
    beauty: { targetCount: 12, discountRate: 18, hours: 48 },
    sports: { targetCount: 15, discountRate: 12, hours: 72 },
    default: { targetCount: 10, discountRate: 10, hours: 72 },
  };

  const prompt = `공동구매 전략 에이전트입니다. 상품에 최적의 공동구매 조건을 설계하세요.
상품: ${product.title}
설명: ${product.description.slice(0, 150)}
가격: ${product.price} ${product.currency}
카테고리: ${product.category}

JSON으로만 답변하세요:
{"title":"공동구매 제목","description":"설명 1~2문장","targetCount":목표인원(5~100),"discountRate":할인율(5~40),"deadlineHours":마감시간(24~168)}`;

  const text = await callAI(prompt);
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const p = JSON.parse(match[0]);
      return {
        title: String(p.title || `${product.title} 공동구매`),
        description: String(p.description || ''),
        targetCount: Math.max(5, Math.min(100, Number(p.targetCount) || 10)),
        discountRate: Math.max(5, Math.min(40, Number(p.discountRate) || 10)),
        deadlineHours: Math.max(24, Math.min(168, Number(p.deadlineHours) || 72)),
      };
    } catch {}
  }

  const d = categoryDefaults[product.category] || categoryDefaults.default;
  return {
    title: `${product.title} 공동구매 - ${d.discountRate}% 할인`,
    description: `함께 구매하면 ${d.discountRate}% 저렴하게! 목표 인원 ${d.targetCount}명`,
    targetCount: d.targetCount,
    discountRate: d.discountRate,
    deadlineHours: d.hours,
  };
}

// GET: 자동매칭 현황 조회 + 추천 목록
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const interest = searchParams.get('interest') || '';
  const userId = searchParams.get('userId') || '';
  const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 30);

  // 만료된 공동구매 자동 마감
  await prisma.groupBuy.updateMany({
    where: { status: 'open', deadline: { lt: new Date() } },
    data: { status: 'failed' },
  });

  // 목표 달성한 공동구매 상태 업데이트
  const successCandidates = await prisma.groupBuy.findMany({
    where: { status: 'open', deadline: { gt: new Date() } },
    select: { id: true, currentCount: true, targetCount: true },
  });
  const successIds = successCandidates.filter(g => g.currentCount >= g.targetCount).map(g => g.id);
  if (successIds.length > 0) {
    await prisma.groupBuy.updateMany({ where: { id: { in: successIds } }, data: { status: 'success' } });
  }

  // 진행중 공동구매 조회
  const openGroupBuys = await prisma.groupBuy.findMany({
    where: { status: 'open', deadline: { gt: new Date() } },
    include: {
      product: { select: { title: true, category: true, verifyScore: true, images: true } },
      _count: { select: { participants: true } },
    },
    orderBy: [{ currentCount: 'desc' }, { createdAt: 'desc' }],
    take: 100,
  });

  // 관심사 기반 필터링 및 스코어링
  let scored = openGroupBuys.map(gb => {
    let matchScore = 0;
    const lowerInterest = interest.toLowerCase();
    const lowerUserId = userId.toLowerCase();

    if (interest) {
      if (gb.product.title.toLowerCase().includes(lowerInterest)) matchScore += 40;
      if (gb.product.category.toLowerCase().includes(lowerInterest)) matchScore += 30;
      if (gb.title.toLowerCase().includes(lowerInterest)) matchScore += 20;
    }

    // 진행률 보너스 (50~80% 구간 최적)
    const progress = gb.currentCount / gb.targetCount;
    if (progress >= 0.5 && progress < 0.8) matchScore += 25;
    else if (progress >= 0.8) matchScore += 15;
    else if (progress >= 0.3) matchScore += 10;

    // 마감 임박 보너스
    const hoursLeft = (new Date(gb.deadline).getTime() - Date.now()) / 3600000;
    if (hoursLeft < 12) matchScore += 20;
    else if (hoursLeft < 24) matchScore += 10;

    // 할인율 보너스
    matchScore += Math.floor(gb.discountRate / 2);

    // 검증 점수 보너스
    if (gb.product.verifyScore && gb.product.verifyScore >= 70) matchScore += 15;

    const reason = interest
      ? (gb.product.title.toLowerCase().includes(lowerInterest) || gb.product.category.toLowerCase().includes(lowerInterest))
        ? `"${interest}" 관련 공동구매 - ${gb.discountRate}% 할인`
        : `인기 공동구매 - ${Math.round(progress * 100)}% 달성`
      : `AI 추천 - ${gb.discountRate}% 할인 공동구매`;

    return {
      id: gb.id,
      title: gb.title,
      description: gb.description,
      discountRate: gb.discountRate,
      basePrice: gb.basePrice,
      discountedPrice: gb.discountedPrice,
      targetCount: gb.targetCount,
      currentCount: gb.currentCount,
      progressRate: Math.round(progress * 100),
      remainingHours: Math.max(0, Math.floor(hoursLeft)),
      deadline: gb.deadline,
      status: gb.status,
      product: gb.product,
      participantCount: gb._count.participants,
      matchScore,
      matchReason: reason,
    };
  });

  scored.sort((a, b) => b.matchScore - a.matchScore);
  const results = scored.slice(0, limit);

  // 통계
  const stats = {
    total: openGroupBuys.length,
    highProgress: openGroupBuys.filter(g => g.currentCount / g.targetCount >= 0.7).length,
    expiringSoon: openGroupBuys.filter(g => (new Date(g.deadline).getTime() - Date.now()) < 86400000).length,
  };

  return NextResponse.json({ matches: results, stats, total: results.length });
}

// POST: 자동 공동구매 생성 실행 (스케줄러 트리거)
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    minViewCount?: number; maxCreate?: number; dryRun?: boolean; secret?: string;
  };

  const secret = process.env.SCHEDULE_SECRET || 'eden-market-secret';
  if (body.secret && body.secret !== secret) {
    return NextResponse.json({ error: '인증 실패' }, { status: 401 });
  }

  const { minViewCount = 3, maxCreate = 5, dryRun = false } = body;

  // 자동 공동구매 생성 대상: 조회수 높고 공동구매 없는 상품
  const hotProducts = await prisma.product.findMany({
    where: {
      status: 'active',
      stock: { gt: 0 },
      viewCount: { gte: minViewCount },
    },
    orderBy: [{ viewCount: 'desc' }, { buyCount: 'desc' }],
    take: 30,
    select: { id: true, title: true, description: true, price: true, currency: true, category: true, viewCount: true, buyCount: true },
  });

  const existingGBs = await prisma.groupBuy.findMany({
    where: {
      productId: { in: hotProducts.map(p => p.id) },
      status: { in: ['open', 'success'] },
    },
    select: { productId: true },
  });
  const existingIds = new Set(existingGBs.map(g => g.productId));
  const targets = hotProducts.filter(p => !existingIds.has(p.id)).slice(0, maxCreate);

  const created: { productId: string; title: string; groupBuyId?: string; plan: object }[] = [];
  const skipped: { productId: string; reason: string }[] = [];

  for (const product of targets) {
    const plan = await planGroupBuy(product);

    if (!dryRun) {
      try {
        const deadline = new Date(Date.now() + plan.deadlineHours * 3600000);
        const discountedPrice = Math.round(product.price * (1 - plan.discountRate / 100));
        const gb = await prisma.groupBuy.create({
          data: {
            productId: product.id,
            title: plan.title,
            description: plan.description,
            targetCount: plan.targetCount,
            discountRate: plan.discountRate,
            basePrice: product.price,
            discountedPrice,
            deadline,
          },
        });
        created.push({ productId: product.id, title: product.title, groupBuyId: gb.id, plan });
      } catch {
        skipped.push({ productId: product.id, reason: '생성 오류' });
      }
    } else {
      created.push({ productId: product.id, title: product.title, plan });
    }
  }

  return NextResponse.json({
    created,
    skipped,
    total: created.length,
    dryRun,
    executedAt: new Date().toISOString(),
    message: dryRun
      ? `${targets.length}개 상품 공동구매 계획 수립 (미적용)`
      : `${created.length}개 공동구매 자동 생성 완료`,
  });
}
