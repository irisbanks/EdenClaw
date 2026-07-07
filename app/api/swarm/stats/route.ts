import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// persona 는 JSON 문자열로 저장된다. null/undefined/손상된 값이 들어와도
// JSON.parse 예외로 라우트 전체가 500 으로 죽지 않도록 안전하게 이름만 추출한다.
function parseBotName(persona: unknown): string {
  if (typeof persona !== 'string' || persona.trim() === '') return 'Unknown Bot';
  try {
    const parsed = JSON.parse(persona) as { name?: unknown } | null;
    return parsed && typeof parsed.name === 'string' && parsed.name.trim() !== '' ? parsed.name : 'Unknown Bot';
  } catch {
    return 'Unknown Bot';
  }
}

// 통계 레코드가 없거나(0건) 조회 자체가 실패해도 대시보드가 깨지지 않도록
// 응답 스키마와 동일한 형태의 기본 객체를 반환한다.
const FALLBACK_STATS = {
  totalBots: 0,
  activeBots: 0,
  totalDeals: 0,
  totalRevenue: 0,
  activeMarkets: 0,
  groupBuys: 0,
  referrals: 0,
  topBots: [] as { id: string; name: string; earnings: unknown; reputation: number; type: string }[],
  topMarkets: [] as unknown[],
};

export async function GET() {
  try {
    const [totalBots, activeBots, totalDeals, markets, topBots, topMarkets, referrals] = await Promise.all([
      prisma.swarmBot.count(),
      prisma.swarmBot.count({ where: { status: { not: 'sleeping' } } }),
      prisma.swarmTransaction.count(),
      prisma.swarmMarketSession.count({ where: { status: 'active' } }),
      prisma.swarmBot.findMany({
        where: { totalEarnings: { gt: 0 } },
        orderBy: { totalEarnings: 'desc' },
        take: 10,
        select: { id: true, persona: true, totalEarnings: true, reputation: true, botType: true },
      }),
      prisma.swarmMarketSession.findMany({
        orderBy: { totalTransactions: 'desc' },
        take: 10,
        select: { keyword: true, totalTransactions: true, totalRevenue: true, status: true },
      }),
      prisma.botReferralChain.count(),
    ]);

    const revenueAgg = await prisma.swarmTransaction.aggregate({ _sum: { finalPrice: true } });
    const totalRevenue = revenueAgg._sum.finalPrice ?? 0;

    const groupBuys = await prisma.swarmTransaction.count({ where: { marketKeyword: 'group-buy' } });

    return NextResponse.json({
      totalBots,
      activeBots,
      totalDeals,
      totalRevenue,
      activeMarkets: markets,
      groupBuys,
      referrals,
      topBots: topBots.map((b) => ({
        id: b.id,
        name: parseBotName(b.persona),
        earnings: b.totalEarnings,
        reputation: b.reputation,
        type: b.botType,
      })),
      topMarkets,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    // 조회/직렬화 실패 시에도 200 + 안전한 기본 통계로 응답해 대시보드 진입을 막지 않는다.
    console.error('[swarm/stats] fallback engaged:', error);
    return NextResponse.json({ ...FALLBACK_STATS, generatedAt: new Date().toISOString(), degraded: true });
  }
}
