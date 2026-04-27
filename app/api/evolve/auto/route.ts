import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const EVOLVE_URL = 'http://localhost:3000/api/evolve';

// Trigger evolution for all agents with enough low-rated feedback
export async function POST(req: NextRequest) {
  const agents = await prisma.agent.findMany({
    where: { isActive: true },
    select: { slug: true },
  });

  const results: { slug: string; result: any }[] = [];

  for (const agent of agents) {
    try {
      const res = await fetch(EVOLVE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentSlug: agent.slug }),
      });
      const data = await res.json();
      results.push({ slug: agent.slug, result: data });
    } catch (e) {
      results.push({ slug: agent.slug, result: { error: String(e) } });
    }
  }

  const evolved = results.filter((r) => r.result?.evolved).length;
  const skipped = results.filter((r) => r.result?.skipped).length;

  return NextResponse.json({ total: agents.length, evolved, skipped, results });
}
