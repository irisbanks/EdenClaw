import { NextRequest, NextResponse } from 'next/server';
import { smartMatch } from '@/lib/market/smart-match-engine';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    userId?: string;
    productId?: string;
    region?: string;
    budgetMin?: number;
    budgetMax?: number;
  };

  const { userId, productId, region, budgetMin, budgetMax } = body;

  // 행동 로그
  if (userId) {
    await prisma.userBehavior.create({
      data: { userId, action: 'smart_match', productId, meta: JSON.stringify({ region, budgetMin, budgetMax }) },
    }).catch(() => {});
  }

  try {
    const result = await smartMatch({ userId, productId, region, budgetMin, budgetMax });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '스마트 매칭 실패';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
