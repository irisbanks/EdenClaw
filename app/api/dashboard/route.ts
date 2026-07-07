import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { serializeLedgerTransaction } from '@/lib/services/ledgerSerialization';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 이메일 기반 마이오피스 대시보드 조회: /api/dashboard?email=...
// (userId 기반 /api/office/[userId] 와 동일한 데이터 형태, 조회 키만 email)
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email')?.trim();
  if (!email) {
    return NextResponse.json({ error: 'email 쿼리 파라미터가 필요합니다.' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: { tokenQuota: true, legBalance: true },
  });
  if (!user) {
    return NextResponse.json({ error: '해당 이메일의 유저를 찾을 수 없습니다.' }, { status: 404 });
  }

  const transactions = await prisma.transaction.findMany({
    where: { userId: user.id },
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
    // 원화(KRW) 결제액이 EP/GAS 원장 흐름에 합산되지 않도록 통화 격리 직렬화.
    transactions: transactions.map(serializeLedgerTransaction),
  });
}
