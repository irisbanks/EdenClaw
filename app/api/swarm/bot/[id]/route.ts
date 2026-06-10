import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const bot = await prisma.swarmBot.findUnique({ where: { id } });
  if (!bot) return NextResponse.json({ error: '봇을 찾을 수 없습니다' }, { status: 404 });

  const [sales, purchases, referrals] = await Promise.all([
    prisma.swarmTransaction.findMany({
      where: { sellerId: id }, orderBy: { timestamp: 'desc' }, take: 20,
    }),
    prisma.swarmTransaction.findMany({
      where: { buyerId: id }, orderBy: { timestamp: 'desc' }, take: 20,
    }),
    prisma.botReferralChain.findMany({
      where: { parentBotId: id }, take: 20,
    }),
  ]);

  return NextResponse.json({
    ...bot,
    persona: JSON.parse(bot.persona as string),
    capabilities: JSON.parse(bot.capabilities as string),
    memory: JSON.parse(bot.memory as string),
    stats: {
      totalSales: sales.length,
      totalPurchases: purchases.length,
      totalReferrals: referrals.length,
      totalEarnings: bot.totalEarnings,
    },
    recentSales: sales.slice(0, 5).map(t => ({
      product: JSON.parse(t.productInfo as string),
      price: t.finalPrice,
      ts: t.timestamp,
    })),
    recentPurchases: purchases.slice(0, 5).map(t => ({
      product: JSON.parse(t.productInfo as string),
      price: t.finalPrice,
      ts: t.timestamp,
    })),
  });
}
