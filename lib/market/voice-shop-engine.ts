// 음성쇼핑 엔진: STT(GPU3) → 의도파싱 → 검색 → 검증 → 최적 1개 반환
'use strict';

import { prisma } from '@/lib/prisma';

const VLLM_URL = process.env.LOCAL_AI_URL || 'http://localhost:8000/v1/chat/completions';
const AI_MODEL = process.env.LOCAL_AI_MODEL || 'Qwen/Qwen2.5-72B-Instruct';
// GPU3 Whisper STT 서버 (GPU3 서버에서 실행)
const GPU3_STT_URL = process.env.GPU3_STT_URL || 'http://localhost:9001/v1/audio/transcriptions';
const WHISPER_FALLBACK = process.env.WHISPER_URL || 'http://localhost:8000/v1/audio/transcriptions';

async function callAI(prompt: string, system?: string, maxTokens = 400): Promise<string> {
  try {
    const messages = system
      ? [{ role: 'system', content: system }, { role: 'user', content: prompt }]
      : [{ role: 'user', content: prompt }];
    const res = await fetch(VLLM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: AI_MODEL, messages, max_tokens: maxTokens, temperature: 0.25 }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content || '';
  } catch {
    return '';
  }
}

// GPU3 Whisper로 음성 → 텍스트 변환
export async function transcribeAudio(audioBase64: string, mimeType = 'audio/wav'): Promise<string> {
  const audioBuffer = Buffer.from(audioBase64, 'base64');
  const blob = new Blob([audioBuffer], { type: mimeType });
  const formData = new FormData();
  formData.append('file', blob, 'audio.wav');
  formData.append('model', 'whisper-1');
  formData.append('language', 'ko');

  // GPU3 STT 서버 우선 시도, 실패시 vLLM 폴백
  for (const url of [GPU3_STT_URL, WHISPER_FALLBACK]) {
    try {
      const res = await fetch(url, {
        method: 'POST', body: formData,
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) continue;
      const data = await res.json() as { text?: string };
      if (data.text) {
        console.log(`[VoiceShopEngine] STT 완료 (${url}): "${data.text}"`);
        return data.text;
      }
    } catch { /* try next */ }
  }
  return '';
}

export interface ParsedShoppingIntent {
  product: string;
  quantity: number;
  condition: string;
  maxPrice?: number;
  category?: string;
  keywords: string[];
}

// Qwen으로 쇼핑 의도 파싱
export async function parseShoppingIntent(text: string): Promise<ParsedShoppingIntent> {
  const prompt = `다음 쇼핑 요청에서 의도를 파싱하세요.

요청: "${text}"

JSON으로만 답변:
{
  "product": "상품명",
  "quantity": 1,
  "condition": "조건(예:가장저렴한/신선한/빠른배송)",
  "maxPrice": null,
  "category": "electronics|fashion|food|digital|general",
  "keywords": ["키워드1","키워드2"]
}`;

  const resp = await callAI(prompt);
  try {
    const m = resp.match(/\{[\s\S]*\}/);
    if (m) {
      const p = JSON.parse(m[0]);
      return {
        product: String(p.product || text),
        quantity: Number(p.quantity) || 1,
        condition: String(p.condition || '최적'),
        maxPrice: p.maxPrice ? Number(p.maxPrice) : undefined,
        category: p.category || undefined,
        keywords: Array.isArray(p.keywords) ? p.keywords.map(String) : [text],
      };
    }
  } catch { /* fallback */ }

  return { product: text, quantity: 1, condition: '최적', keywords: [text] };
}

export interface VoiceShopResult {
  transcribed: string;
  intent: ParsedShoppingIntent;
  product: {
    id: string; title: string; price: number; currency: string;
    category: string; sellerName: string; stock: number;
    verifyScore: number; avgRating: number;
  } | null;
  verifyScore: number;
  recommendation: string;
  alternatives: string[];
}

export async function voiceShop(audioBase64: string): Promise<VoiceShopResult> {
  // 1. STT
  const transcribed = await transcribeAudio(audioBase64);
  if (!transcribed) {
    console.error('[VoiceShopEngine] STT 실패 - 오디오 인식 불가');
    return {
      transcribed: '', intent: { product: '', quantity: 1, condition: '', keywords: [] },
      product: null, verifyScore: 0, recommendation: 'STT 실패', alternatives: [],
    };
  }

  // 2. 의도 파싱
  const intent = await parseShoppingIntent(transcribed);
  console.log(`[VoiceShopEngine] 의도 파싱: "${intent.product}" ${intent.condition}`);

  // 3. 검색
  const where: Record<string, unknown> = {
    status: 'active', stock: { gt: 0 },
    OR: [
      { title: { contains: intent.product } },
      { description: { contains: intent.product } },
      ...intent.keywords.map(k => ({ title: { contains: k } })),
    ],
  };
  if (intent.category) where.category = intent.category;
  if (intent.maxPrice) where.price = { lte: intent.maxPrice };

  const candidates = await prisma.product.findMany({
    where,
    include: { reviews: { select: { rating: true } } },
    orderBy: [{ verifyScore: 'desc' }, { buyCount: 'desc' }],
    take: 10,
  });

  if (candidates.length === 0) {
    return { transcribed, intent, product: null, verifyScore: 0, recommendation: '검색 결과 없음', alternatives: [] };
  }

  // 4. 조건별 최적 1개 선택
  let best = candidates[0];
  if (intent.condition.includes('저렴') || intent.condition.includes('싼')) {
    best = candidates.slice().sort((a, b) => a.price - b.price)[0];
  } else if (intent.condition.includes('평점') || intent.condition.includes('좋은')) {
    best = candidates.slice().sort((a, b) => {
      const ra = a.reviews.length ? a.reviews.reduce((s, r) => s + r.rating, 0) / a.reviews.length : 0;
      const rb = b.reviews.length ? b.reviews.reduce((s, r) => s + r.rating, 0) / b.reviews.length : 0;
      return rb - ra;
    })[0];
  }

  const avgRating = best.reviews.length
    ? best.reviews.reduce((s, r) => s + r.rating, 0) / best.reviews.length
    : 0;

  // 5. 검증 점수 조회
  const verification = await prisma.productVerification.findUnique({
    where: { productId: best.id }, select: { totalScore: true },
  });
  const verifyScore = verification?.totalScore || best.verifyScore || 0;

  // 6. Qwen 최종 추천 이유 + 대안 생성
  const altTitles = candidates.filter(c => c.id !== best.id).slice(0, 3).map(c => c.title);
  const reasonPrompt = `사용자가 "${transcribed}" 라고 요청해서 "${best.title}" (${best.price} ${best.currency})을 추천합니다. 추천 이유를 한 문장으로 설명하세요.`;
  const recommendation = await callAI(reasonPrompt, undefined, 150);

  console.log(`[VoiceShopEngine] 최적 상품: "${best.title}" (${verifyScore}점)`);

  return {
    transcribed, intent,
    product: {
      id: best.id, title: best.title, price: best.price, currency: best.currency,
      category: best.category, sellerName: best.sellerName, stock: best.stock,
      verifyScore, avgRating: Math.round(avgRating * 10) / 10,
    },
    verifyScore,
    recommendation: recommendation || `${intent.condition} 조건에 맞는 최적 상품입니다`,
    alternatives: altTitles,
  };
}
