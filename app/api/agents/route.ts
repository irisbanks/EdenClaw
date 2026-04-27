import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get('category');

  const agents = await prisma.agent.findMany({
    where: {
      isActive: true,
      ...(category ? { category } : {}),
    },
    orderBy: [{ tier: 'asc' }, { name: 'asc' }],
    select: {
      id: true, slug: true, name: true, description: true,
      icon: true, category: true, tier: true, priceET: true,
    },
  });

  return NextResponse.json({ agents, total: agents.length });
}
