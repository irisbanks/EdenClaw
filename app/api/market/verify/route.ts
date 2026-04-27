import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const VLLM_URL = process.env.LOCAL_AI_URL || 'http://localhost:8000/v1/chat/completions';
const AI_MODEL = process.env.LOCAL_AI_MODEL || 'Qwen/Qwen2.5-72B-Instruct';

async function callAI(prompt: string): Promise<string> {
  try {
    const res = await fetch(VLLM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 800,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } catch {
    return '';
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { productId } = body;

  if (!productId) return NextResponse.json({ error: 'productId가 필요합니다' }, { status: 400 });

  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { reviews: { select: { rating: true, comment: true } } },
  });
  if (!product) return NextResponse.json({ error: '상품을 찾을 수 없습니다' }, { status: 404 });

  // --- Algorithmic scoring (runs regardless of AI) ---
  const titleScore = product.title.length >= 10 && product.title.length <= 60 ? 10 : 5;
  const descScore = product.description.length >= 50 ? 15 : Math.floor(product.description.length / 50 * 15);
  const imagesArr = JSON.parse(product.images || '[]') as string[];
  const imageScore = Math.min(imagesArr.length * 3, 12);
  const tagsArr = JSON.parse(product.tags || '[]') as string[];
  const tagScore = Math.min(tagsArr.length * 2, 8);
  const reviewCount = product.reviews.length;
  const avgRating = reviewCount ? product.reviews.reduce((s, r) => s + r.rating, 0) / reviewCount : 0;
  const reviewScore = Math.min(reviewCount * 2 + Math.floor(avgRating * 2), 15);
  const priceScore = product.price > 0 ? 10 : 0;
  const sellerScore = product.sellerName !== '익명' ? 10 : 5;
  const stockScore = product.stock > 0 ? 10 : 0;

  const algoScore = titleScore + descScore + imageScore + tagScore + reviewScore + priceScore + sellerScore + stockScore;

  // --- AI scoring (best-effort) ---
  let aiScore = 0;
  let aiComment = '';

  const prompt = `당신은 AI 마켓 검증 에이전트입니다. 다음 상품을 검증하고 0~20점으로 평가하세요.

상품 정보:
- 제목: ${product.title}
- 설명: ${product.description.slice(0, 300)}
- 가격: ${product.price} ${product.currency}
- 카테고리: ${product.category}
- 판매자: ${product.sellerName}
- 재고: ${product.stock}개

평가 기준 (각 항목 0~5점):
1. 가격 적정성: 시장 가격 범위 내 합리적 여부
2. 상품 설명 신뢰성: 허위/과장 광고 여부
3. 카테고리 적합성: 올바른 분류 여부
4. 판매자 신뢰도: 정보 완성도

다음 JSON 형식으로만 답변하세요:
{"price":숫자,"description":숫자,"category":숫자,"seller":숫자,"comment":"한줄 평가"}`;

  const aiResponse = await callAI(prompt);
  try {
    const jsonMatch = aiResponse.match(/\{[^}]+\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      aiScore = (parsed.price || 0) + (parsed.description || 0) + (parsed.category || 0) + (parsed.seller || 0);
      aiComment = parsed.comment || '';
    }
  } catch { /* fallback to algo score */ }

  const totalScore = Math.min(algoScore + aiScore, 100);

  let grade = '❌ 비추천';
  if (totalScore >= 90) grade = '🥇 프리미엄';
  else if (totalScore >= 70) grade = '✅ 표준';
  else if (totalScore >= 50) grade = '⚠️ 주의';

  const verifyComment = aiComment
    ? `${grade} | ${aiComment}`
    : `${grade} | 자동 검증 완료`;

  await prisma.product.update({
    where: { id: productId },
    data: {
      verifiedAt: new Date(),
      verifyScore: totalScore,
      verifyComment,
    },
  });

  return NextResponse.json({
    productId,
    score: totalScore,
    grade,
    breakdown: {
      title: titleScore,
      description: descScore,
      images: imageScore,
      tags: tagScore,
      reviews: reviewScore,
      price: priceScore,
      seller: sellerScore,
      stock: stockScore,
      ai: aiScore,
    },
    comment: verifyComment,
    verifiedAt: new Date().toISOString(),
  });
}
