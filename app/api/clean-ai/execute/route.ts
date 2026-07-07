import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { CLEAN_LOUNGE_ENGINE_PROFILES, normalizeCleanEngine } from '@/lib/services/cleanLoungeEngines';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 순수 AI 크레딧 소모형 라우터 (Clean AI).
 * 기존 swarm/ai-lounge 의 다단계 롤업·PV/BV·바이너리 정산망 로직을 일절 포함하지 않는다.
 * 흐름: ① 가스 잔액 조회 → ② 엔진 단가만큼 consumed 원자 증가 → ③ 외부 AI 호출/파싱 → ④ 성공 응답.
 */

function chatCompletionsUrl(baseUrl: string): string {
  const root = baseUrl.trim().replace(/\/+$/, '');
  if (root.endsWith('/chat/completions')) return root;
  if (root.endsWith('/v1')) return `${root}/chat/completions`;
  return `${root}/v1/chat/completions`;
}

/** OpenAI 호환(vLLM/Ollama/자체 인프라) 단일 호출. 실패 시 null 반환(다음 폴백으로). */
async function callOAICompat(
  baseUrl: string,
  apiKey: string | undefined,
  model: string,
  system: string,
  user: string,
  maxTokens: number
): Promise<{ reply: string; provider: string } | null> {
  try {
    const res = await fetch(chatCompletionsUrl(baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: maxTokens,
        temperature: 0.6,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content ?? '';
    if (!reply) return null;
    return { reply, provider: data.model || model };
  } catch {
    return null;
  }
}

/**
 * 실제 외부 AI API 엔드포인트와 통신해 답변(reply)을 파싱한다.
 * 우선순위: OpenAI 호환 자체 인프라(B200/Vultr/Brev/vLLM) → OpenAI → Gemini.
 * 환경변수로 설정된 첫 가용 엔드포인트를 정직하게 사용한다.
 */
async function callExternalAI(system: string, user: string, maxTokens: number): Promise<{ reply: string; provider: string }> {
  const active = (process.env.ACTIVE_AI_INFRASTRUCTURE || '').toUpperCase();

  if (active === 'B200' && process.env.B200_SERVER_URL) {
    const r = await callOAICompat(process.env.B200_SERVER_URL, process.env.B200_API_KEY, process.env.B200_MODEL || 'meta-llama/Llama-3.1-70B-Instruct', system, user, maxTokens);
    if (r) return r;
  }

  if (active === 'VULTR' && process.env.VULTR_LLM_URL) {
    const r = await callOAICompat(process.env.VULTR_LLM_URL, process.env.VULTR_API_KEY, process.env.VULTR_MODEL || 'meta-llama/Llama-3.1-70B-Instruct', system, user, maxTokens);
    if (r) return r;
  }

  const brev = process.env.BREV_LLM_URL || process.env.VLLM_BASE_URL;
  if (brev) {
    const r = await callOAICompat(brev, process.env.BREV_API_KEY, process.env.BREV_MODEL || process.env.VLLM_MODEL || 'meta-llama/Llama-3.1-70B-Instruct', system, user, maxTokens);
    if (r) return r;
  }

  if (process.env.OPENAI_API_KEY) {
    const r = await callOAICompat('https://api.openai.com', process.env.OPENAI_API_KEY, process.env.OPENAI_FALLBACK_MODEL || 'gpt-4o-mini', system, user, maxTokens);
    if (r) return r;
  }

  if (process.env.GEMINI_API_KEY) {
    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: user }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.6 },
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const reply = data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
      if (reply) return { reply, provider: `Gemini (${model})` };
    }
  }

  throw new Error('가용 외부 AI 엔드포인트가 없습니다 (B200/Vultr/Brev/OpenAI/Gemini 미설정).');
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!email) return NextResponse.json({ status: 'error', error: 'email 이 필요합니다.' }, { status: 400 });
  if (!prompt) return NextResponse.json({ status: 'error', error: '프롬프트를 입력하세요.' }, { status: 400 });

  const engine = normalizeCleanEngine(body.engine);
  const profile = CLEAN_LOUNGE_ENGINE_PROFILES[engine];
  const unitPrice = profile.gasCost; // 선택된 모델의 단가(가스)

  // ① 요청 유저(email)의 TokenQuota 가스 잔액 조회
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, tokenQuota: { select: { allocated: true, consumed: true } } },
  });
  if (!user || !user.tokenQuota) {
    return NextResponse.json(
      { status: 'error', error: user ? 'TokenQuota가 없습니다.' : '가입되지 않은 이메일입니다.' },
      { status: 404 }
    );
  }

  const allocated = user.tokenQuota.allocated;
  const consumed = user.tokenQuota.consumed;
  const remainingBefore = Number(allocated - consumed);

  // 가스가 부족하면 403
  if (remainingBefore < unitPrice) {
    return NextResponse.json(
      { status: 'error', error: '가스가 부족합니다.', remainingGas: Math.max(0, remainingBefore), required: unitPrice },
      { status: 403 }
    );
  }

  // ② 엔진 단가만큼 consumed 를 원자적으로 증가 (parentId 추적·PV/BV 트랜잭션 절대 생성 안 함)
  const charged = await prisma.tokenQuota.update({
    where: { userId: user.id },
    data: { consumed: { increment: BigInt(unitPrice) } },
    select: { allocated: true, consumed: true },
  });

  try {
    // ③ 실제 외부 AI API 통신 및 reply 파싱
    const system = `You are EdenClaw ${profile.label}, a clean credit-metered AI assistant. Answer the user clearly and helpfully.`;
    const { reply, provider } = await callExternalAI(system, prompt, profile.maxTokens);

    // ④ 성공 응답: 실제 차감 후 remainingGas + reply
    const remainingGas = Number(charged.allocated - charged.consumed);
    return NextResponse.json({
      status: 'success',
      reply,
      provider,
      engine,
      gasCharged: unitPrice,
      remainingGas,
      allocated: Number(charged.allocated),
      consumed: Number(charged.consumed),
    });
  } catch (error) {
    // 외부 AI 실패 시 차감분 롤백(과금 방지) 후 502
    const reverted = await prisma.tokenQuota.update({
      where: { userId: user.id },
      data: { consumed: { decrement: BigInt(unitPrice) } },
      select: { allocated: true, consumed: true },
    }).catch(() => null);
    const remainingGas = reverted ? Number(reverted.allocated - reverted.consumed) : remainingBefore;
    return NextResponse.json(
      { status: 'error', error: error instanceof Error ? error.message : String(error), remainingGas },
      { status: 502 }
    );
  }
}
