import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const VLLM_URL = process.env.LOCAL_AI_URL || 'http://localhost:8000/v1/chat/completions';
const AI_MODEL = process.env.LOCAL_AI_MODEL || 'Qwen/Qwen2.5-72B-Instruct';
const WHISPER_URL = process.env.WHISPER_URL || 'http://localhost:8000/v1/audio/transcriptions';

async function callAI(prompt: string, systemPrompt?: string): Promise<string> {
  try {
    const messages = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }]
      : [{ role: 'user', content: prompt }];

    const res = await fetch(VLLM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: AI_MODEL,
        messages,
        max_tokens: 400,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } catch {
    return '';
  }
}

async function transcribeAudio(audioBase64: string): Promise<string> {
  try {
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: 'audio/wav' });
    formData.append('file', blob, 'audio.wav');
    formData.append('model', 'whisper-1');
    formData.append('language', 'ko');

    const res = await fetch(WHISPER_URL, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json();
    return data.text || '';
  } catch {
    return '';
  }
}

interface ParsedIntent {
  product: string;
  quantity: number;
  condition: string;
  maxPrice?: number;
  category?: string;
}

async function parseIntent(text: string): Promise<ParsedIntent> {
  const prompt = `다음 쇼핑 요청에서 의도를 정확히 파싱하세요.

요청: "${text}"

JSON 형식으로만 답변하세요:
{
  "product": "찾는 상품명",
  "quantity": 수량(정수),
  "condition": "조건 (예: 가장 저렴한, 가장 신선한, 빠른 배송)",
  "maxPrice": 최대 예산(숫자, 없으면 null),
  "category": "카테고리 (electronics/fashion/food/digital/general 중 하나)"
}`;

  const resp = await callAI(prompt);
  try {
    const m = resp.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      return {
        product: String(parsed.product || text),
        quantity: Math.max(1, parseInt(parsed.quantity) || 1),
        condition: String(parsed.condition || '가장 적합한'),
        maxPrice: parsed.maxPrice ? Number(parsed.maxPrice) : undefined,
        category: parsed.category || undefined,
      };
    }
  } catch { /* fallback */ }

  return { product: text, quantity: 1, condition: '가장 적합한' };
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') || '';
  let inputText = '';

  if (contentType.includes('application/json')) {
    const body = await req.json().catch(() => ({})) as { text?: string; audioBase64?: string };
    if (body.audioBase64) {
      inputText = await transcribeAudio(body.audioBase64);
      if (!inputText) {
        // Whisper 폴백: 텍스트가 없으면 오류
        return NextResponse.json({
          error: 'Whisper STT 실패',
          fallback: '음성 인식에 실패했습니다. 텍스트로 입력해주세요.',
        }, { status: 422 });
      }
    } else {
      inputText = body.text || '';
    }
  }

  if (!inputText.trim()) {
    return NextResponse.json({ error: '텍스트 또는 음성 입력이 필요합니다' }, { status: 400 });
  }

  // 1단계: 의도 파싱
  const intent = await parseIntent(inputText);

  // 2단계: 상품 검색
  const where: Record<string, unknown> = {
    status: 'active',
    stock: { gt: 0 },
  };

  if (intent.category && intent.category !== 'general') {
    where.category = intent.category;
  }
  if (intent.maxPrice) {
    where.price = { lte: intent.maxPrice };
  }

  // 키워드 검색 (간단한 contains)
  const keywords = intent.product.split(/\s+/).filter(k => k.length > 1);

  let products = await prisma.product.findMany({
    where: {
      ...where,
      OR: keywords.map(k => ({
        OR: [
          { title: { contains: k } },
          { description: { contains: k } },
          { tags: { contains: k } },
        ],
      })),
    },
    include: { reviews: { select: { rating: true } } },
    orderBy: { price: 'asc' },
    take: 20,
  });

  // 결과 없으면 전체 검색
  if (products.length === 0) {
    products = await prisma.product.findMany({
      where,
      include: { reviews: { select: { rating: true } } },
      orderBy: { price: 'asc' },
      take: 20,
    });
  }

  if (products.length === 0) {
    return NextResponse.json({
      inputText,
      intent,
      result: null,
      message: '조건에 맞는 상품을 찾을 수 없습니다.',
      alternatives: [],
    });
  }

  // 3단계: AI로 최적 상품 선정
  const productList = products.slice(0, 10).map((p, i) => {
    const avgRating = p.reviews.length
      ? p.reviews.reduce((s, r) => s + r.rating, 0) / p.reviews.length
      : 0;
    return `${i + 1}. ${p.title} - ${p.price} ${p.currency} (재고:${p.stock}, 평점:${avgRating.toFixed(1)}, 구매:${p.buyCount}회)`;
  }).join('\n');

  const selectionPrompt = `사용자가 "${inputText}"를 요청했습니다.
파싱된 조건: 상품=${intent.product}, 수량=${intent.quantity}, 조건=${intent.condition}

다음 상품 목록에서 조건에 가장 맞는 상품 번호를 선택하고 이유를 설명하세요.

${productList}

JSON으로만 답변하세요:
{
  "selectedIndex": 선택한 번호(1부터 시작),
  "reason": "선택 이유 (2~3문장)",
  "totalPrice": 총 금액(수량 * 가격)
}`;

  let selectedIdx = 0;
  let selectionReason = '가격과 조건에 가장 적합한 상품입니다.';

  const selResp = await callAI(selectionPrompt);
  try {
    const m = selResp.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      selectedIdx = Math.max(0, Math.min(parseInt(parsed.selectedIndex) - 1, products.length - 1));
      selectionReason = String(parsed.reason || selectionReason);
    }
  } catch { /* use first */ }

  const selected = products[selectedIdx];
  const avgRating = selected.reviews.length
    ? selected.reviews.reduce((s, r) => s + r.rating, 0) / selected.reviews.length
    : 0;
  const totalPrice = selected.price * intent.quantity;

  // 검증 점수 조회
  const verification = await prisma.productVerification.findUnique({
    where: { productId: selected.id },
    select: { totalScore: true, grade: true },
  });

  return NextResponse.json({
    inputText,
    transcribed: inputText,
    intent,
    result: {
      product: {
        id: selected.id,
        title: selected.title,
        price: selected.price,
        currency: selected.currency,
        category: selected.category,
        images: JSON.parse(selected.images || '[]'),
        sellerName: selected.sellerName,
        stock: selected.stock,
        avgRating: Math.round(avgRating * 10) / 10,
        verifyScore: selected.verifyScore || verification?.totalScore || 0,
        verifyGrade: verification?.grade || '',
      },
      quantity: intent.quantity,
      totalPrice,
      reason: selectionReason,
      paymentReady: true,
    },
    alternatives: products.slice(0, 3).filter((_, i) => i !== selectedIdx).map(p => ({
      id: p.id,
      title: p.title,
      price: p.price,
      currency: p.currency,
    })),
    message: `"${intent.product}" ${intent.quantity}개를 ${selectionReason}`,
  });
}
