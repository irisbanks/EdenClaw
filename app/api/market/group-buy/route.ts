import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') || 'open';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '20');

  // Auto-close expired group buys
  await prisma.groupBuy.updateMany({
    where: { status: 'open', deadline: { lt: new Date() } },
    data: { status: 'failed' },
  });

  const where = status === 'all' ? {} : { status };

  const [groupBuys, total] = await Promise.all([
    prisma.groupBuy.findMany({
      where,
      include: {
        product: { select: { title: true, images: true, sellerName: true, verifyScore: true } },
        _count: { select: { participants: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.groupBuy.count({ where }),
  ]);

  const enriched = groupBuys.map((gb) => ({
    ...gb,
    participantCount: gb._count.participants,
    progressRate: Math.round((gb.currentCount / gb.targetCount) * 100),
    remainingHours: Math.max(0, Math.floor((new Date(gb.deadline).getTime() - Date.now()) / 3600000)),
  }));

  return NextResponse.json({ groupBuys: enriched, total, page, pages: Math.ceil(total / limit) });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { productId, title, description = '', targetCount, discountRate, deadline } = body;

  if (!productId || !title || !targetCount || !discountRate || !deadline) {
    return NextResponse.json({ error: '필수 항목 누락: productId, title, targetCount, discountRate, deadline' }, { status: 400 });
  }
  if (discountRate < 1 || discountRate > 90) {
    return NextResponse.json({ error: '할인율은 1~90% 범위여야 합니다' }, { status: 400 });
  }

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return NextResponse.json({ error: '상품을 찾을 수 없습니다' }, { status: 404 });

  const discountedPrice = Math.round(product.price * (1 - discountRate / 100));

  const groupBuy = await prisma.groupBuy.create({
    data: {
      productId, title, description,
      targetCount, discountRate,
      basePrice: product.price,
      discountedPrice,
      deadline: new Date(deadline),
    },
  });

  return NextResponse.json(groupBuy, { status: 201 });
}
