import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const VLLM_URL = process.env.LOCAL_AI_URL || 'http://localhost:8000/v1/chat/completions';
const AI_MODEL = process.env.LOCAL_AI_MODEL || 'Qwen/Qwen2.5-72B-Instruct';

async function aiPlanGroupBuy(product: {
  title: string; description: string; price: number; currency: string; category: string;
}): Promise<{ title: string; description: string; targetCount: number; discountRate: number; deadlineHours: number } | null> {
  const prompt = `당신은 공동구매 전략 에이전트입니다. 다음 상품에 최적의 공동구매 조건을 설계하세요.

상품: ${product.title}
설명: ${product.description.slice(0, 200)}
가격: ${product.price} ${product.currency}
카테고리: ${product.category}

공동구매 조건을 JSON으로만 답변하세요:
{
  "title": "공동구매 제목 (매력적으로)",
  "description": "공동구매 설명 (1~2문장)",
  "targetCount": 목표인원(5~100 사이 정수),
  "discountRate": 할인율(5~40 사이 정수),
  "deadlineHours": 마감까지 시간(24~168 사이 정수)
}`;

  try {
    const res = await fetch(VLLM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0.4,
      }),
      signal: AbortSignal.timeout(12000),
    });
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        title: String(parsed.title || `${product.title} 공동구매`),
        description: String(parsed.description || ''),
        targetCount: Math.max(5, Math.min(100, Number(parsed.targetCount) || 10)),
        discountRate: Math.max(5, Math.min(40, Number(parsed.discountRate) || 10)),
        deadlineHours: Math.max(24, Math.min(168, Number(parsed.deadlineHours) || 72)),
      };
    }
  } catch { /* fallback */ }

  // Fallback: default values based on category
  const defaults: Record<string, { targetCount: number; discountRate: number; deadlineHours: number }> = {
    electronics: { targetCount: 20, discountRate: 15, deadlineHours: 72 },
    fashion: { targetCount: 15, discountRate: 20, deadlineHours: 48 },
    food: { targetCount: 10, discountRate: 10, deadlineHours: 24 },
    digital: { targetCount: 30, discountRate: 25, deadlineHours: 96 },
    default: { targetCount: 10, discountRate: 10, deadlineHours: 72 },
  };
  const d = defaults[product.category] || defaults.default;
  return {
    title: `${product.title} 공동구매 - ${d.discountRate}% 할인`,
    description: `함께 구매하면 ${d.discountRate}% 저렴하게!`,
    ...d,
  };
}

// GET: 자동매칭 추천 목록 (사용자가 참여할 만한 그룹바이)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const interest = searchParams.get('interest') || '';
  const limit = Math.min(parseInt(searchParams.get('limit') || '5'), 20);

  // 진행 중 공동구매 중 참여율 높은 것
  const openGroupBuys = await prisma.groupBuy.findMany({
    where: { status: 'open', deadline: { gt: new Date() } },
    include: {
      product: { select: { title: true, category: true, verifyScore: true, images: true } },
      _count: { select: { participants: true } },
    },
    orderBy: { currentCount: 'desc' },
    take: 50,
  });

  let matched = openGroupBuys;

  // 관심사가 있으면 카테고리/키워드 필터
  if (interest) {
    const lower = interest.toLowerCase();
    matched = openGroupBuys.filter(gb =>
      gb.product.title.toLowerCase().includes(lower) ||
      gb.product.category.toLowerCase().includes(lower) ||
      gb.title.toLowerCase().includes(lower)
    );
    if (matched.length < 3) matched = openGroupBuys; // fallback to all
  }

  const results = matched.slice(0, limit).map(gb => ({
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
    status: gb.status,
    product: gb.product,
    participantCount: gb._count.participants,
    matchReason: interest
      ? `"${interest}" 관련 공동구매입니다`
      : '인기 공동구매입니다',
  }));

  return NextResponse.json({ matches: results, total: results.length });
}

// POST: 인기 상품 자동 분석 후 공동구매 생성
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    mode?: string; productId?: string; dryRun?: boolean;
  };
  const { mode = 'auto', productId, dryRun = false } = body;

  const created: { productId: string; title: string; groupBuyId?: string; plan: ReturnType<typeof aiPlanGroupBuy> extends Promise<infer T> ? T : never }[] = [];
  const skipped: { productId: string; reason: string }[] = [];

  if (mode === 'single' && productId) {
    // 단일 상품 대상 공동구매 생성
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, title: true, description: true, price: true, currency: true, category: true, stock: true },
    });
    if (!product) return NextResponse.json({ error: '상품을 찾을 수 없습니다' }, { status: 404 });
    if (product.stock <= 0) return NextResponse.json({ error: '재고가 없는 상품입니다' }, { status: 400 });

    const existing = await prisma.groupBuy.findFirst({
      where: { productId: product.id, status: { in: ['open', 'success'] } },
    });
    if (existing) return NextResponse.json({ error: '이미 진행 중인 공동구매가 있습니다', groupBuyId: existing.id }, { status: 409 });

    const plan = await aiPlanGroupBuy(product);
    if (!plan) return NextResponse.json({ error: 'AI 플래닝 실패' }, { status: 500 });

    if (!dryRun) {
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
      return NextResponse.json({ plan, groupBuyId: gb.id, created: true });
    }
    return NextResponse.json({ plan, dryRun: true });
  }

  // mode === 'auto': 인기 상품 자동 스캔
  const hotProducts = await prisma.product.findMany({
    where: {
      status: 'active',
      stock: { gt: 0 },
      viewCount: { gte: 5 },
    },
    orderBy: [{ viewCount: 'desc' }, { buyCount: 'desc' }],
    take: 20,
    select: { id: true, title: true, description: true, price: true, currency: true, category: true },
  });

  // 이미 공동구매가 있는 상품 필터
  const existingGBs = await prisma.groupBuy.findMany({
    where: {
      productId: { in: hotProducts.map(p => p.id) },
      status: { in: ['open', 'success'] },
    },
    select: { productId: true },
  });
  const existingProductIds = new Set(existingGBs.map(gb => gb.productId));

  const targets = hotProducts.filter(p => !existingProductIds.has(p.id)).slice(0, 5);

  for (const product of targets) {
    const plan = await aiPlanGroupBuy(product);
    if (!plan) { skipped.push({ productId: product.id, reason: 'AI 플래닝 실패' }); continue; }

    if (!dryRun) {
      const deadline = new Date(Date.now() + plan.deadlineHours * 3600000);
      const discountedPrice = Math.round(product.price * (1 - plan.discountRate / 100));
      try {
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
    message: dryRun
      ? `${targets.length}개 상품에 공동구매 계획을 수립했습니다 (미적용)`
      : `${created.length}개 공동구매를 자동 생성했습니다`,
  });
}
