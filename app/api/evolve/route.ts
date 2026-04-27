import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const VLLM_URL = process.env.VLLM_URL || 'http://localhost:8000';
const VLLM_MODEL = process.env.VLLM_MODEL || 'Qwen/Qwen2.5-72B-Instruct';

async function scoreFeedbacks(agentSlug: string): Promise<{ avg: number; count: number; comments: string[] }> {
  const feedbacks = await prisma.chatFeedback.findMany({
    where: { agentSlug },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  if (feedbacks.length === 0) return { avg: 0, count: 0, comments: [] };
  const avg = feedbacks.reduce((s, f) => s + f.rating, 0) / feedbacks.length;
  const comments = feedbacks.filter((f) => f.comment).map((f) => f.comment!).slice(0, 10);
  return { avg, count: feedbacks.length, comments };
}

async function generateImprovedPrompt(currentPrompt: string, comments: string[]): Promise<string> {
  const systemMsg = `You are an AI system optimizer. Given a current system prompt and user feedback comments, generate an improved version of the system prompt that addresses user concerns while maintaining the agent's core purpose. Return ONLY the improved system prompt text, nothing else.`;
  const userMsg = `Current system prompt:\n${currentPrompt}\n\nUser feedback comments:\n${comments.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\nGenerate an improved system prompt:`;

  try {
    const res = await fetch(`${VLLM_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: VLLM_MODEL,
        messages: [
          { role: 'system', content: systemMsg },
          { role: 'user', content: userMsg },
        ],
        max_tokens: 1000,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || currentPrompt;
  } catch {
    return currentPrompt;
  }
}

// POST /api/evolve - trigger evolution for an agent
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { agentSlug, force = false } = body;

  if (!agentSlug) return NextResponse.json({ error: 'agentSlug required' }, { status: 400 });

  const agent = await prisma.agent.findUnique({ where: { slug: agentSlug } });
  if (!agent) return NextResponse.json({ error: 'agent not found' }, { status: 404 });

  const { avg, count, comments } = await scoreFeedbacks(agentSlug);

  // only evolve if enough feedback and low score (or forced)
  if (!force && (count < 5 || avg >= 4.0)) {
    return NextResponse.json({ skipped: true, reason: `avg=${avg.toFixed(2)}, count=${count}` });
  }

  if (comments.length === 0) {
    return NextResponse.json({ skipped: true, reason: 'no comments to learn from' });
  }

  const newPrompt = await generateImprovedPrompt(agent.systemPrompt, comments);

  // get latest version
  const latest = await prisma.agentEvolution.findFirst({
    where: { agentSlug },
    orderBy: { version: 'desc' },
  });
  const version = (latest?.version || 0) + 1;

  await prisma.$transaction([
    prisma.agentEvolution.create({
      data: {
        agentSlug,
        version,
        prevPrompt: agent.systemPrompt,
        newPrompt,
        reason: `Auto-evolution from ${count} feedbacks, avg=${avg.toFixed(2)}`,
        scoreBefore: avg,
        scoreAfter: 0, // will be measured later
        feedbackCount: count,
      },
    }),
    prisma.agent.update({
      where: { slug: agentSlug },
      data: { systemPrompt: newPrompt },
    }),
  ]);

  return NextResponse.json({ evolved: true, version, scoreBefore: avg, feedbackCount: count });
}

// GET /api/evolve - get evolution history
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const agentSlug = searchParams.get('agentSlug');

  if (!agentSlug) return NextResponse.json({ error: 'agentSlug required' }, { status: 400 });

  const history = await prisma.agentEvolution.findMany({
    where: { agentSlug },
    orderBy: { version: 'desc' },
    take: 20,
  });

  return NextResponse.json(history);
}
