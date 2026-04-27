import { NextRequest, NextResponse } from 'next/server';

const LOCAL_AI_URL = process.env.LOCAL_AI_URL || 'http://localhost:8000/v1/chat/completions';
const LOCAL_AI_MODEL = process.env.LOCAL_AI_MODEL || 'Qwen/Qwen2.5-72B-Instruct';
const GEMINI_KEY = process.env.GEMINI_API_KEY;

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

async function callLocalAI(message: string, systemPrompt: string): Promise<string> {
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
  return data.choices?.[0]?.message?.content || '응답 없음';
}

async function callGemini(message: string, systemPrompt: string): Promise<string> {
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
      if (text) return text;
    } catch {}
  }
  throw new Error('All Gemini models failed');
}

export async function POST(req: NextRequest) {
  try {
    const { message, model = 'local' } = await req.json();
    if (!message) return NextResponse.json({ error: 'message required' }, { status: 400 });

    const realTimeData = await getRealTimeData(message);
    const systemPrompt = `당신은 에덴클로의 AI 비서입니다. 전문적이고 정확하게 답변하세요. 한국어로 답변합니다.${realTimeData ? `\n\n## 실시간 데이터\n${realTimeData}` : ''}`;

    let response: string;
    let usedModel: string;

    if (model === 'local' || process.env.USE_LOCAL_AI === 'true') {
      try {
        response = await callLocalAI(message, systemPrompt);
        usedModel = 'Qwen2.5-72B (로컬 GPU)';
      } catch {
        response = await callGemini(message, systemPrompt);
        usedModel = 'Gemini (폴백)';
      }
    } else {
      response = await callGemini(message, systemPrompt);
      usedModel = 'Gemini';
    }

    return NextResponse.json({ response, model: usedModel, timestamp: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
