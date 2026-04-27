import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { OfflineEngine } from '@/lib/offline-engine';
import { selfLearning } from '@/lib/self-learning';
import { searchKnowledge, searchMemory, saveMemory } from '@/lib/rag/embeddings';

const VLLM_URL = process.env.LOCAL_AI_URL || 'http://localhost:8000/v1/chat/completions';
const AI_MODEL = process.env.LOCAL_AI_MODEL || 'Qwen/Qwen2.5-72B-Instruct';
const GEMINI_KEY = process.env.GEMINI_API_KEY;

function sseChunk(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`;
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

      // 내장 지식 사용 알림
      if (knowledgeUsed.length > 0) {
        send({ type: 'meta', knowledgeUsed: knowledgeUsed.length, source: 'knowledge+server' });
      }

      try {
        const res = await fetch(VLLM_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: AI_MODEL, messages, max_tokens: 4096, temperature: 0.7, stream: true }),
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
