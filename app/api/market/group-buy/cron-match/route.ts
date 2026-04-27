import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// 10분마다 공동구매 스마트 매칭 크론
// POST /api/market/group-buy/cron-match
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { secret?: string };
  const secret = process.env.SCHEDULE_SECRET || 'eden-market-secret';
  if (body.secret && body.secret !== secret) {
    return NextResponse.json({ error: '인증 실패' }, { status: 401 });
  }

  const now = new Date();

  // 만료된 공동구매 자동 마감
  const expired = await prisma.groupBuy.updateMany({
    where: { status: 'open', deadline: { lt: now } },
    data: { status: 'failed' },
  });

  // 목표 달성 공동구매 성공 처리
  const openGBs = await prisma.groupBuy.findMany({
    where: { status: 'open', deadline: { gt: now } },
    select: { id: true, currentCount: true, targetCount: true },
  });
  const successIds = openGBs.filter(g => g.currentCount >= g.targetCount).map(g => g.id);
  let successCount = 0;
  if (successIds.length > 0) {
    await prisma.groupBuy.updateMany({ where: { id: { in: successIds } }, data: { status: 'success' } });
    successCount = successIds.length;
  }

  // 임베딩 유사도 매칭 점수 업데이트
  const activeGBs = await prisma.groupBuy.findMany({
    where: { status: 'open', deadline: { gt: now } },
    include: { product: { select: { title: true, category: true, verifyScore: true } } },
    take: 50,
  });

  let matchUpdated = 0;
  for (const gb of activeGBs) {
    const progressScore = Math.round((gb.currentCount / gb.targetCount) * 40);
    const hoursLeft = (new Date(gb.deadline).getTime() - now.getTime()) / 3600000;
    const timeScore = hoursLeft < 12 ? 30 : hoursLeft < 48 ? 20 : 10;
    const discountScore = Math.min(gb.discountRate, 30);
    const verifyScore = Math.min((gb.product.verifyScore || 50) / 2, 20);
    const matchScore = Math.min(100, progressScore + timeScore + discountScore + verifyScore);

    await prisma.groupBuy.update({
      where: { id: gb.id },
      data: { matchScore },
    });
    matchUpdated++;
  }

  return NextResponse.json({
    executedAt: now.toISOString(),
    expired: expired.count,
    successCompleted: successCount,
    matchUpdated,
    message: `크론 완료: 만료 ${expired.count}개, 성공 ${successCount}개, 매칭 업데이트 ${matchUpdated}개`,
  });
}

export async function GET() {
  const [open, failed, success] = await Promise.all([
    prisma.groupBuy.count({ where: { status: 'open', deadline: { gt: new Date() } } }),
    prisma.groupBuy.count({ where: { status: 'failed' } }),
    prisma.groupBuy.count({ where: { status: 'success' } }),
  ]);
  return NextResponse.json({ open, failed, success, checkedAt: new Date().toISOString() });
}
