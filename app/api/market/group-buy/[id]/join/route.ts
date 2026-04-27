import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { userId, name = '익명', email } = body;

  const groupBuy = await prisma.groupBuy.findUnique({
    where: { id },
    include: { _count: { select: { participants: true } } },
  });

  if (!groupBuy) return NextResponse.json({ error: '공동구매를 찾을 수 없습니다' }, { status: 404 });
  if (groupBuy.status !== 'open') return NextResponse.json({ error: '참여 가능한 공동구매가 아닙니다' }, { status: 400 });
  if (new Date(groupBuy.deadline) < new Date()) {
    await prisma.groupBuy.update({ where: { id }, data: { status: 'failed' } });
    return NextResponse.json({ error: '마감된 공동구매입니다' }, { status: 400 });
  }

  // Prevent duplicate participation
  if (userId) {
    const existing = await prisma.groupBuyParticipant.findFirst({ where: { groupBuyId: id, userId } });
    if (existing) return NextResponse.json({ error: '이미 참여한 공동구매입니다' }, { status: 409 });
  }

  const newCount = groupBuy.currentCount + 1;
  const reachedTarget = newCount >= groupBuy.targetCount;

  const [participant] = await prisma.$transaction([
    prisma.groupBuyParticipant.create({
      data: { groupBuyId: id, userId, name, email },
    }),
    prisma.groupBuy.update({
      where: { id },
      data: {
        currentCount: { increment: 1 },
        ...(reachedTarget && groupBuy.status === 'open' ? { status: 'success' } : {}),
      },
    }),
  ]);

  return NextResponse.json({
    participant,
    currentCount: newCount,
    targetCount: groupBuy.targetCount,
    progressRate: Math.round((newCount / groupBuy.targetCount) * 100),
    reachedTarget,
    message: reachedTarget
      ? `🎉 목표 달성! ${groupBuy.discountRate}% 할인이 확정되었습니다`
      : `${groupBuy.targetCount - newCount}명 더 모이면 달성!`,
  }, { status: 201 });
}
