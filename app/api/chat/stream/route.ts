import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { OfflineEngine } from '@/lib/offline-engine';
import { selfLearning } from '@/lib/self-learning';
import { searchKnowledge, searchMemory, saveMemory } from '@/lib/rag/embeddings';
import { checkQuota, settleUsage, LOCKED_PAYLOAD, DEFAULT_ESTIMATE } from '@/lib/services/tokenGuard';

// prisma(better-sqlite3) + ioredis 네이티브 모듈 → Edge 불가, 캐시 금지
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VLLM_URL = process.env.LOCAL_AI_URL || 'http://localhost:8000/v1/chat/completions';
const AI_MODEL = process.env.LOCAL_AI_MODEL || 'Qwen/Qwen2.5-72B-Instruct';
const GEMINI_KEY = process.env.GEMINI_API_KEY;

// userId 없는 익명 호출 차단 여부 (기본 false: 데모 유지, 프로덕션은 true 로 강제)
const ENFORCE_GUARD = process.env.TOKEN_GUARD_ENFORCE === 'true';
const OUTPUT_RESERVE = 1024; // 출력 토큰 예약치 (가드 통과 기준 보수화)

function sseChunk(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/** 대략적 토큰 추정 (provider usage 미제공 시 폴백): 4 chars ≈ 1 token */
function estimateTokens(text: string): number {
  return Math.ceil((text?.length || 0) / 4);
}

async function getBTCContext(): Promise<string> {
  try {
    const r = await fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT', {
      signal: AbortSignal.timeout(3000),
    });
    const d = await r.json();
    return `\n[실시간 BTC] $${parseFloat(d.lastPrice).toLocaleString()} (${parseFloat(d.priceChangePercent).toFixed(2)}%)\n`;
  } catch {
    return '';
  }
}

async function buildContext(
  message: string,
  agentSlug: string,
  userId: string,
  isTradingAgent: boolean
): Promise<string> {
  const [knowledgeHits, memoryHits, btcCtx] = await Promise.allSettled([
    searchKnowledge(message, agentSlug, 3),
    searchMemory(agentSlug, userId, message, 3),
    isTradingAgent ? getBTCContext() : Promise.resolve(''),
  ]);

  let ctx = '';
  const knowledge = knowledgeHits.status === 'fulfilled' ? knowledgeHits.value : [];
  const memories = memoryHits.status === 'fulfilled' ? memoryHits.value : [];
  const btc = btcCtx.status === 'fulfilled' ? btcCtx.value : '';

  if (knowledge.length > 0) {
    ctx += '\n\n[참고 지식]\n' + knowledge.map((k) => `- ${k.title}: ${k.content.slice(0, 250)}`).join('\n');
    prisma.agentMetrics
      .upsert({
        where: { agentSlug },
        update: { knowledgeHits: { increment: knowledge.length }, lastActive: new Date() },
        create: { agentSlug, knowledgeHits: knowledge.length },
      })
      .catch(() => {});
  }
  if (memories.length > 0) {
    ctx += '\n\n[사용자 기억]\n' + memories.map((m) => `- ${m}`).join('\n');
  }
  if (btc) ctx += btc;

  return ctx;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { message, agentSlug = 'default', userId = 'anonymous', conversationHistory = [] } = body;
  if (!message) return new Response('message required', { status: 400 });

  // ── 토큰 잔액 가드 (스트림 열기 전 사전 검증) ──
  //    'anonymous' 는 실유저로 보지 않음 → 미터링 대상에서 제외
  const realUserId: string | null = userId && userId !== 'anonymous' ? userId : null;
  let metered = false;
  if (realUserId) {
    const estimated = estimateTokens(message) + OUTPUT_RESERVE;
    const check = await checkQuota(realUserId, estimated);
    if (check.status === 'LOCKED') {
      return Response.json({ ...LOCKED_PAYLOAD, remaining: check.remaining }, { status: 402 });
    }
    if (check.status === 'NO_QUOTA') {
      if (ENFORCE_GUARD) return Response.json({ ...LOCKED_PAYLOAD, remaining: 0 }, { status: 402 });
      console.warn(`[chat/stream] userId=${realUserId} 쿼터 없음 → 미터링 생략(비강제 모드)`);
    } else {
      metered = true;
    }
  } else if (ENFORCE_GUARD) {
    return Response.json({ error: '유저 식별 정보가 필요합니다.' }, { status: 401 });
  }

  const agent = await prisma.agent.findUnique({ where: { slug: agentSlug } }).catch(() => null);

  const isTradingAgent =
    agentSlug.includes('btc') || agentSlug.includes('crypto') || agentSlug.includes('trading') ||
    agentSlug.includes('market') || agentSlug.includes('defi') || agentSlug.includes('alt') ||
    agentSlug.includes('futures') || agentSlug.includes('quant') || agentSlug.includes('onchain');

  // OfflineEngine 초기화 (내장 지식베이스 포함)
  const engine = new OfflineEngine({
    slug: agentSlug,
    systemPrompt: agent?.systemPrompt || '당신은 에덴클로 AI 비서입니다. 한국어로 답변하세요.',
    knowledgeBase: agent?.knowledgeBase || '[]',
  });

  // RAG 컨텍스트 + BTC 실시간 (병렬 처리)
  const additionalContext = await buildContext(message, agentSlug, userId, isTradingAgent);

  // 스트리밍용 메시지 빌드 (내장 지식 + RAG 모두 포함)
  const { messages, knowledgeUsed } = await engine.buildStreamMessages(
    message,
    conversationHistory,
    additionalContext
  );

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(encoder.encode(sseChunk(data)));
      const startTime = Date.now();
      let fullText = '';
      let usageTokens = 0; // provider 가 보고한 실제 총 토큰 (0 이면 추정 폴백)

      // 내장 지식 사용 알림
      if (knowledgeUsed.length > 0) {
        send({ type: 'meta', knowledgeUsed: knowledgeUsed.length, source: 'knowledge+server' });
      }

      try {
        const res = await fetch(VLLM_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: AI_MODEL,
            messages,
            max_tokens: 4096,
            temperature: 0.7,
            stream: true,
            stream_options: { include_usage: true }, // 마지막 청크에 usage 포함 요청
          }),
          signal: AbortSignal.timeout(90000),
        });

        if (!res.ok) throw new Error(`vLLM ${res.status}`);

        const reader = res.body!.getReader();
        const dec = new TextDecoder();
        let buf = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (raw === '[DONE]') continue;
            try {
              const j = JSON.parse(raw);
              const chunk = j.choices?.[0]?.delta?.content || '';
              if (chunk) {
                fullText += chunk;
                send({ type: 'chunk', text: chunk });
              }
              // usage-only 마지막 청크(choices 비어있음)에서 실제 토큰 포착
              if (j.usage?.total_tokens) usageTokens = Number(j.usage.total_tokens);
            } catch {}
          }
        }
      } catch {
        // Gemini 폴백
        try {
          if (!GEMINI_KEY) throw new Error('no gemini key');
          const systemPrompt = messages[0].content;
          const r = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
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
          const d = await r.json();
          fullText = d.candidates?.[0]?.content?.parts?.[0]?.text || '응답 없음';
          if (d.usageMetadata?.totalTokenCount) usageTokens = Number(d.usageMetadata.totalTokenCount);
          send({ type: 'chunk', text: fullText });
        } catch (e2) {
          // 최후 오프라인 폴백
          const offline = await engine.generateResponse(message, conversationHistory);
          fullText = offline.answer;
          send({ type: 'chunk', text: fullText });
          send({ type: 'meta', source: offline.source });
        }
      }

      send({ type: 'done', fullText });

      // ── 응답 완료: 실제 사용 토큰 정산(차감). 실패해도 응답 스트림은 유지 ──
      if (metered && realUserId) {
        const inputApprox = messages.reduce((s, m) => s + estimateTokens(String(m.content || '')), 0);
        const actualTokens = usageTokens || inputApprox + estimateTokens(fullText) || DEFAULT_ESTIMATE;
        try {
          const remaining = await settleUsage(realUserId, actualTokens);
          send({ type: 'quota', tokensUsed: actualTokens, remaining });
        } catch (e) {
          console.error('[chat/stream] 토큰 정산 실패(응답은 정상):', e);
        }
      }

      const latencyMs = Date.now() - startTime;
      const autoQuality = selfLearning.autoScore(message, fullText);

      // 비동기 후처리
      prisma.chat
        .create({ data: { agentSlug, userId, message, response: fullText, model: AI_MODEL } })
        .then(async (chat) => {
          // 자기 학습 기록
          await selfLearning.recordConversation(agentSlug, userId, message, fullText, 'conversation');

          // 사용자 기억 저장
          const snippet = `Q: ${message.slice(0, 80)} A: ${fullText.slice(0, 150)}`;
          await saveMemory(agentSlug, userId, snippet, 'conversation', 0.3).catch(() => {});

          // 메트릭 업데이트
          await prisma.agentMetrics
            .upsert({
              where: { agentSlug },
              update: { totalChats: { increment: 1 }, avgLatencyMs: latencyMs, lastActive: new Date() },
              create: { agentSlug, totalChats: 1, avgLatencyMs: latencyMs },
            })
            .catch(() => {});
        })
        .catch(() => {});

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
