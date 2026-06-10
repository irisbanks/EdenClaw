import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const markets = await prisma.swarmMarketSession.findMany({
      where:   { status: 'active' },
      orderBy: { startedAt: 'desc' },
      take:    50,
    });

    const rows = markets.map(m => ({
      id:                 m.id,
      keyword:            m.keyword,
      participatingBots:  (JSON.parse(m.participatingBots as string) as string[]).length,
      totalTransactions:  m.totalTransactions,
      totalRevenue:       m.totalRevenue,
      startedAt:          m.startedAt,
    }));

    return NextResponse.json({ ok: true, count: rows.length, markets: rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
