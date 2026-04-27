import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const agentSlug = searchParams.get('agentSlug');

  if (agentSlug) {
    const [metrics, recentFeedbacks, evolutionCount, memoryCount] = await Promise.all([
      prisma.agentMetrics.findUnique({ where: { agentSlug } }),
      prisma.chatFeedback.findMany({
        where: { agentSlug },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { rating: true, comment: true, createdAt: true },
      }),
      prisma.agentEvolution.count({ where: { agentSlug } }),
      prisma.agentMemory.count({ where: { agentSlug } }),
    ]);
    return NextResponse.json({ metrics, recentFeedbacks, evolutionCount, memoryCount });
  }

  // all agents summary
  const allMetrics = await prisma.agentMetrics.findMany({
    orderBy: { totalChats: 'desc' },
    take: 20,
  });
  return NextResponse.json(allMetrics);
}

// POST /api/metrics/feedback - record chat feedback
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { chatId, agentSlug, rating, comment } = body;

  if (!chatId || !agentSlug || !rating)
    return NextResponse.json({ error: 'chatId, agentSlug, rating required' }, { status: 400 });
  if (rating < 1 || rating > 5)
    return NextResponse.json({ error: 'rating must be 1-5' }, { status: 400 });

  await prisma.chatFeedback.create({ data: { chatId, agentSlug, rating, comment } });

  // update agent metrics
  const feedbacks = await prisma.chatFeedback.findMany({ where: { agentSlug }, select: { rating: true } });
  const avgRating = feedbacks.reduce((s, f) => s + f.rating, 0) / feedbacks.length;

  await prisma.agentMetrics.upsert({
    where: { agentSlug },
    update: { avgRating, updatedAt: new Date() },
    create: { agentSlug, avgRating },
  });

  return NextResponse.json({ ok: true });
}
