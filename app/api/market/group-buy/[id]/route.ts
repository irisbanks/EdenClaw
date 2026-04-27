import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const groupBuy = await prisma.groupBuy.findUnique({
    where: { id },
    include: {
      product: true,
      participants: { orderBy: { joinedAt: 'desc' }, take: 50 },
      _count: { select: { participants: true, orders: true } },
    },
  });

  if (!groupBuy) return NextResponse.json({ error: '공동구매를 찾을 수 없습니다' }, { status: 404 });

  return NextResponse.json({
    ...groupBuy,
    participantCount: groupBuy._count.participants,
    orderCount: groupBuy._count.orders,
    progressRate: Math.round((groupBuy.currentCount / groupBuy.targetCount) * 100),
    remainingHours: Math.max(0, Math.floor((new Date(groupBuy.deadline).getTime() - Date.now()) / 3600000)),
    savingsAmount: groupBuy.basePrice - groupBuy.discountedPrice,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { status } = body;

  const gb = await prisma.groupBuy.findUnique({ where: { id } });
  if (!gb) return NextResponse.json({ error: '공동구매를 찾을 수 없습니다' }, { status: 404 });

  const updated = await prisma.groupBuy.update({ where: { id }, data: { status } });
  return NextResponse.json(updated);
}
