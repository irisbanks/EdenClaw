import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
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
    topBots: topBots.map(b => ({
      id: b.id,
      name: (JSON.parse(b.persona as string) as { name: string }).name,
      earnings: b.totalEarnings,
      reputation: b.reputation,
      type: b.botType,
    })),
    topMarkets,
    generatedAt: new Date().toISOString(),
  });
}
