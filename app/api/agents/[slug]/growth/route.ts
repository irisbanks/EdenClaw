import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { selfLearning } from '@/lib/self-learning';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const agent = await prisma.agent.findUnique({
    where: { slug },
    select: { slug: true, name: true, knowledgeBase: true, personality: true },
  });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

  const [growthStats, recentLearning, trainingDataCount] = await Promise.all([
    selfLearning.getGrowthStats(slug),
    prisma.agentLearning.findMany({
      where: { agentSlug: slug },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, question: true, quality: true, learned: true, source: true, createdAt: true },
    }),
    prisma.agentLearning.count({ where: { agentSlug: slug, quality: { gte: 3 } } }),
  ]);

  let knowledgeBase: string[] = [];
  try {
    knowledgeBase = JSON.parse(agent.knowledgeBase || '[]');
  } catch {}

  return NextResponse.json({
    ...growthStats,
    knowledgeBase,
    recentLearning,
    trainingDataCount,
  });
}

// POST /api/agents/[slug]/growth - 수동으로 지식 확장 트리거
export async function POST(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const agent = await prisma.agent.findUnique({ where: { slug }, select: { slug: true } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

  const result = await selfLearning.expandKnowledge(slug);

  return NextResponse.json({ ok: true, ...result });
}
