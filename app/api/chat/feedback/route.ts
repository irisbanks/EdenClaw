import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { selfLearning } from '@/lib/self-learning';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { learningId, chatId, agentSlug, rating, comment } = body;

  if (!agentSlug || !rating) {
    return NextResponse.json({ error: 'agentSlug and rating required' }, { status: 400 });
  }
  if (rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'rating must be 1-5' }, { status: 400 });
  }

  // AgentLearning 품질 업데이트
  if (learningId) {
    await selfLearning.rateLearning(learningId, rating);
  }

  // ChatFeedback 저장
  if (chatId) {
    await prisma.chatFeedback.create({ data: { chatId, agentSlug, rating, comment } });

    // AgentMetrics avgRating 갱신
    const feedbacks = await prisma.chatFeedback.findMany({
      where: { agentSlug },
      select: { rating: true },
    });
    const avgRating = feedbacks.reduce((s, f) => s + f.rating, 0) / feedbacks.length;
    await prisma.agentMetrics.upsert({
      where: { agentSlug },
      update: { avgRating },
      create: { agentSlug, avgRating },
    });
  }

  return NextResponse.json({ ok: true, rating });
}
