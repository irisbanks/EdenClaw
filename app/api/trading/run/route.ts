import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const GAS_PER_PV = 10_000;
const GAS_PER_EP = 1_000;

const SYSTEM_PROMPT =
  '너는 EdenClaw 플랫폼의 단독 AI 개발 어시스턴트다. 사용자의 개발/기획 요청에 한국어로 간결하고 정확하게, 실행 가능한 형태로 답하라.';

/** provider usage 미제공 시 폴백 추정: 4 chars ≈ 1 token */
function estimateTokens(text: string): number {
  return Math.ceil((text?.length || 0) / 4);
}

type LLMResult = { content: string; totalTokens: number; model: string };

async function callGemini(prompt: string): Promise<LLMResult> {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY 미설정');
  const models = ['gemini-2.0-flash', 'gemini-1.5-flash'];
  for (const model of models) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
          }),
        }
      );
      if (!r.ok) continue;
      const d = await r.json();
      const text = d.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        const totalTokens =
          Number(d.usageMetadata?.totalTokenCount) ||
          estimateTokens(SYSTEM_PROMPT) + estimateTokens(prompt) + estimateTokens(text);
        return { content: text, totalTokens, model: `Gemini (${model})` };
      }
    } catch {}
  }
  throw new Error('Gemini 호출 실패');
}

async function callOpenAI(prompt: string): Promise<LLMResult> {
  if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY 미설정');
  const model = process.env.OPENAI_FALLBACK_MODEL || 'gpt-4o-mini';
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      max_tokens: 2048,
      temperature: 0.7,
    }),
  });
  if (!r.ok) throw new Error(`OpenAI HTTP ${r.status}`);
  const d = await r.json();
  const text = d.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenAI 빈 응답');
  const totalTokens =
    Number(d.usage?.total_tokens) || estimateTokens(SYSTEM_PROMPT) + estimateTokens(prompt) + estimateTokens(text);
  return { content: text, totalTokens, model: `OpenAI (${model})` };
}

// POST /api/trading/run — { email, prompt } : 실제 AI 호출 → 실토큰을 TokenQuota.consumed 에 반영
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email: string | undefined = body.email?.trim();
  const prompt: string | undefined = body.prompt?.trim();
  if (!email) return NextResponse.json({ error: 'email 이 필요합니다.' }, { status: 400 });
  if (!prompt) return NextResponse.json({ error: '프롬프트를 입력하세요.' }, { status: 400 });

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      epBalance: true,
      tokenQuota: { select: { allocated: true, consumed: true } },
      legBalance: { select: { leftPV: true, rightPV: true, leftBV: true, rightBV: true } },
    },
  });
  if (!user || !user.tokenQuota) {
    return NextResponse.json({ error: user ? 'TokenQuota가 없습니다.' : '가입되지 않은 이메일입니다.' }, { status: 404 });
  }

  const allocated = Number(user.tokenQuota.allocated);
  const remainingBefore = Math.max(0, allocated - Number(user.tokenQuota.consumed));
  if (remainingBefore <= 0) {
    return NextResponse.json(
      { error: '가스(토큰) 소진 — Overdraft 충전 후 다시 시도하세요.', depleted: true },
      { status: 402 }
    );
  }

  // 1) 실제 AI 호출 (OpenAI 우선 → Gemini 폴백)
  let result: LLMResult;
  try {
    result = await callOpenAI(prompt);
  } catch (e1) {
    try {
      result = await callGemini(prompt);
    } catch (e2) {
      const m1 = e1 instanceof Error ? e1.message : String(e1);
      const m2 = e2 instanceof Error ? e2.message : String(e2);
      return NextResponse.json({ error: `AI 호출 실패 (OpenAI: ${m1} / Gemini: ${m2})` }, { status: 502 });
    }
  }

  // 2) 실제 소모 토큰을 가스로 차감 (TokenQuota.consumed += 실토큰)
  const charge = Math.max(1, Math.trunc(result.totalTokens));
  const updated = await prisma.tokenQuota.update({
    where: { userId: user.id },
    data: { consumed: { increment: BigInt(charge) } },
    select: { allocated: true, consumed: true, isOverdraftAdvanced: true },
  });

  const nAlloc = Number(updated.allocated);
  const nCons = Number(updated.consumed);
  const nRem = Math.max(0, nAlloc - nCons);
  const legs = user.legBalance ?? { leftPV: 0, rightPV: 0, leftBV: 0, rightBV: 0 };

  // 3) AI 응답 + 실토큰 + 갱신 장부(전역 컨텍스트 동기화용 ledger 포함) 반환
  return NextResponse.json({
    content: result.content,
    model: result.model,
    tokensUsed: charge,
    quota: {
      email,
      allocated: nAlloc,
      consumed: nCons,
      remaining: nRem,
      percentUsed: nAlloc > 0 ? Math.min(100, (nCons / nAlloc) * 100) : 0,
      depleted: nRem <= 0,
      isOverdraftAdvanced: updated.isOverdraftAdvanced,
      ledger: {
        legs,
        lesserLegPV: Math.min(legs.leftPV, legs.rightPV),
        epBalance: user.epBalance,
        swappableGas: Math.floor((legs.leftPV + legs.rightPV) * GAS_PER_PV) + Math.floor(user.epBalance * GAS_PER_EP),
        gasPerPV: GAS_PER_PV,
        gasPerEP: GAS_PER_EP,
      },
    },
  });
}
