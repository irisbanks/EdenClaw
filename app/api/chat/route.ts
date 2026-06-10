import { NextRequest, NextResponse } from 'next/server';
import { checkQuota, settleUsage, LOCKED_PAYLOAD, DEFAULT_ESTIMATE } from '@/lib/services/tokenGuard';

// prisma(better-sqlite3) + ioredis 네이티브 모듈 → Edge 불가, 캐시 금지
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LOCAL_AI_URL = process.env.LOCAL_AI_URL || 'http://localhost:8000/v1/chat/completions';
const LOCAL_AI_MODEL = process.env.LOCAL_AI_MODEL || 'Qwen/Qwen2.5-72B-Instruct';
const GEMINI_KEY = process.env.GEMINI_API_KEY;

// userId 없는 익명 호출도 차단할지 여부. 기본 false(데모/공개 채팅 유지),
// 프로덕션에서 TOKEN_GUARD_ENFORCE=true 로 토큰 가드를 강제.
const ENFORCE_GUARD = process.env.TOKEN_GUARD_ENFORCE === 'true';
// 출력 토큰 예약치 (가드 통과 기준을 보수적으로 잡아 마이너스 진입 방지)
const OUTPUT_RESERVE = 1024;

interface LLMResult {
  content: string;
  totalTokens: number;
}

/** 대략적 토큰 추정 (provider usage 미제공 시 폴백): 4 chars ≈ 1 token */
function estimateTokens(text: string): number {
  return Math.ceil((text?.length || 0) / 4);
}

async function getRealTimeData(message: string): Promise<string> {
  let context = '';
  const lower = message.toLowerCase();
  const cryptoMap: Record<string, string> = {
    '비트코인': 'BTCUSDT', 'btc': 'BTCUSDT', '이더리움': 'ETHUSDT',
    'eth': 'ETHUSDT', '솔라나': 'SOLUSDT', 'sol': 'SOLUSDT',
    '리플': 'XRPUSDT', 'xrp': 'XRPUSDT', '코인': 'BTCUSDT', '암호화폐': 'BTCUSDT',
  };
  for (const [kw, sym] of Object.entries(cryptoMap)) {
    if (lower.includes(kw)) {
      try {
        const r = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${sym}`);
        const d = await r.json();
        context += `\n[실시간 ${sym}] 현재가: $${parseFloat(d.lastPrice).toLocaleString()}, 24h변동: ${parseFloat(d.priceChangePercent).toFixed(2)}%, 고가: $${parseFloat(d.highPrice).toLocaleString()}, 저가: $${parseFloat(d.lowPrice).toLocaleString()}\n`;
      } catch {}
      break;
    }
  }
  return context;
}

async function callLocalAI(message: string, systemPrompt: string): Promise<LLMResult> {
  const res = await fetch(LOCAL_AI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: LOCAL_AI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      max_tokens: 4096,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Local AI error: ${res.status}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '응답 없음';
  // OpenAI 호환 응답의 usage.total_tokens 우선, 없으면 길이 기반 추정
  const totalTokens =
    Number(data.usage?.total_tokens) ||
    estimateTokens(systemPrompt) + estimateTokens(message) + estimateTokens(content);
  return { content, totalTokens };
}

async function callGemini(message: string, systemPrompt: string): Promise<LLMResult> {
  if (!GEMINI_KEY) throw new Error('Gemini key not set');
  const models = ['gemini-2.0-flash', 'gemini-1.5-flash'];
  for (const model of models) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ parts: [{ text: message }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
          }),
        }
      );
      if (!r.ok) continue;
      const d = await r.json();
      const text = d.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        const totalTokens =
          Number(d.usageMetadata?.totalTokenCount) ||
          estimateTokens(systemPrompt) + estimateTokens(message) + estimateTokens(text);
        return { content: text, totalTokens };
      }
    } catch {}
  }
  throw new Error('All Gemini models failed');
}

export async function POST(req: NextRequest) {
  try {
    const { message, model = 'local', userId: bodyUserId } = await req.json();
    if (!message) return NextResponse.json({ error: 'message required' }, { status: 400 });

    const userId: string | null = bodyUserId || req.headers.get('x-user-id') || null;

    const realTimeData = await getRealTimeData(message);
    const systemPrompt = `당신은 에덴클로의 AI 비서입니다. 전문적이고 정확하게 답변하세요. 한국어로 답변합니다.${realTimeData ? `\n\n## 실시간 데이터\n${realTimeData}` : ''}`;

    // ── 1. AI 호출 직전: 토큰 잔액 가드 ──
    let metered = false;
    if (userId) {
      const estimated = estimateTokens(systemPrompt) + estimateTokens(message) + OUTPUT_RESERVE;
      const check = await checkQuota(userId, estimated);

      if (check.status === 'LOCKED') {
        return NextResponse.json({ ...LOCKED_PAYLOAD, remaining: check.remaining }, { status: 402 });
      }
      if (check.status === 'NO_QUOTA') {
        // 쿼터 미발급(미구독). 강제 모드면 결제 유도, 아니면 미터링 없이 통과.
        if (ENFORCE_GUARD) {
          return NextResponse.json({ ...LOCKED_PAYLOAD, remaining: 0 }, { status: 402 });
        }
        console.warn(`[chat] userId=${userId} 쿼터 없음 → 미터링 생략(개발/비강제 모드)`);
      } else {
        metered = true; // ALLOWED
      }
    } else if (ENFORCE_GUARD) {
      return NextResponse.json({ error: '유저 식별 정보가 필요합니다.' }, { status: 401 });
    }

    // ── 2. LLM 호출 ──
    let result: LLMResult;
    let usedModel: string;
    if (model === 'local' || process.env.USE_LOCAL_AI === 'true') {
      try {
        result = await callLocalAI(message, systemPrompt);
        usedModel = 'Qwen2.5-72B (로컬 GPU)';
      } catch {
        result = await callGemini(message, systemPrompt);
        usedModel = 'Gemini (폴백)';
      }
    } else {
      result = await callGemini(message, systemPrompt);
      usedModel = 'Gemini';
    }

    // ── 3. 응답 완료: 실제 사용 토큰 정산(차감) ──
    //    정산 실패가 사용자 응답을 막지 않도록 격리. 충전 → 웹훅에서 상위 라인 PV 정산이 연계됨.
    let remaining: number | undefined;
    if (metered && userId) {
      try {
        const tokensToCharge = result.totalTokens || DEFAULT_ESTIMATE;
        remaining = await settleUsage(userId, tokensToCharge);
      } catch (e) {
        console.error('[chat] 토큰 정산 실패(응답은 정상 반환):', e);
      }
    }

    return NextResponse.json({
      response: result.content,
      model: usedModel,
      tokensUsed: result.totalTokens,
      remaining,
      metered,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
