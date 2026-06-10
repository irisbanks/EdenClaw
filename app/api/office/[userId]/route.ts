import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 마이오피스 대시보드 데이터: 지갑 + 토큰 쿼터 + 좌/우 볼륨 + 최근 트랜잭션
export async function GET(_req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { tokenQuota: true, legBalance: true },
  });
  if (!user) return NextResponse.json({ error: '유저를 찾을 수 없습니다.' }, { status: 404 });

  const transactions = await prisma.transaction.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 15,
  });

  const allocated = user.tokenQuota ? Number(user.tokenQuota.allocated) : 0;
  const consumed = user.tokenQuota ? Number(user.tokenQuota.consumed) : 0;
  const remaining = Math.max(0, allocated - consumed);

  const leftPV = user.legBalance?.leftPV ?? 0;
  const rightPV = user.legBalance?.rightPV ?? 0;
  const leftBV = user.legBalance?.leftBV ?? 0;
  const rightBV = user.legBalance?.rightBV ?? 0;
  const lesserLegPV = Math.min(leftPV, rightPV); // 소실적
  const greaterLegPV = Math.max(leftPV, rightPV); // 대실적

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      epBalance: user.epBalance,
      subscriptionStatus: user.subscriptionStatus,
      sponsorId: user.sponsorId,
      parentId: user.parentId,
      position: user.position,
    },
    quota: {
      allocated,
      consumed,
      remaining,
      percentUsed: allocated > 0 ? Math.min(100, (consumed / allocated) * 100) : 0,
    },
    legs: {
      leftPV,
      rightPV,
      leftBV,
      rightBV,
      lesserLegPV, // 소실적 (수당 산정 기준)
      greaterLegPV, // 대실적
      carryForwardPV: greaterLegPV - lesserLegPV, // 이월 예정 볼륨
    },
    transactions: transactions.map((t) => ({
      id: t.id,
      txType: t.txType,
      amount: t.amount,
      pvGenerated: t.pvGenerated,
      bvGenerated: t.bvGenerated,
      createdAt: t.createdAt,
    })),
  });
}
