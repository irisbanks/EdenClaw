import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const [agent, knowledge, metrics] = await Promise.all([
    prisma.agent.findUnique({ where: { slug } }),
    prisma.knowledge.findMany({
      where: { OR: [{ agentSlug: slug }, { agentSlug: null }] },
      select: { id: true, title: true, category: true, useCount: true },
      orderBy: { useCount: 'desc' },
      take: 20,
    }),
    prisma.agentMetrics.findUnique({ where: { agentSlug: slug } }),
  ]);

  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

  let inlineKB: string[] = [];
  try { inlineKB = JSON.parse(agent.knowledgeBase || '[]'); } catch {}

  return NextResponse.json({
    ...agent,
    knowledgeBase: agent.knowledgeBase,          // raw JSON string (inline KB)
    knowledgeItems: knowledge,                   // linked Knowledge table records
    knowledgeBaseList: inlineKB,                 // parsed inline KB array
    metrics,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = await req.json();
  const { name, description, systemPrompt, isActive, icon, category, tier, priceET } = body;

  const agent = await prisma.agent.update({
    where: { slug },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(systemPrompt !== undefined ? { systemPrompt } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
      ...(icon !== undefined ? { icon } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(tier !== undefined ? { tier } : {}),
      ...(priceET !== undefined ? { priceET } : {}),
    },
  });

  return NextResponse.json(agent);
}
