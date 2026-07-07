import { NextRequest, NextResponse } from 'next/server';
import { runPlannerTurn, type PlanSpec } from '@/lib/swarm/planner';
import { defaultModelTiers } from '@/lib/swarm/model-tiers';
import type { LoopMessage } from '@/lib/swarm/autonomous-loop';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ChatMsg = { role: string; content: string };

// 대화형 기획 턴: 질문에 답하고 기획서(spec)를 누적 갱신. ready 되면 클라이언트가 빌드로 핸드오프.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return NextResponse.json({ error: 'message 가 필요합니다.' }, { status: 400 });

  const history: LoopMessage[] = Array.isArray(body.messages)
    ? body.messages
        .filter((m: unknown): m is ChatMsg => !!m && typeof (m as ChatMsg).role === 'string' && typeof (m as ChatMsg).content === 'string')
        .filter((m: ChatMsg) => m.role === 'user' || m.role === 'assistant')
        .map((m: ChatMsg) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    : [];
  const priorSpec: PlanSpec = body.spec && typeof body.spec === 'object' ? (body.spec as PlanSpec) : {};

  try {
    const result = await runPlannerTurn({ history, message, priorSpec, tiers: defaultModelTiers() });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
