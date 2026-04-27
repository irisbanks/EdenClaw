import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const VLLM_URL = process.env.LOCAL_AI_URL || 'http://localhost:8000/v1/chat/completions';
const AI_MODEL = process.env.LOCAL_AI_MODEL || 'Qwen/Qwen2.5-72B-Instruct';

async function callAI(prompt: string, maxTokens = 600): Promise<string> {
  try {
    const res = await fetch(VLLM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
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

function clamp(v: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const { productId } = await params;

  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      reviews: { select: { rating: true, comment: true, createdAt: true } },
      orders: { select: { id: true, status: true } },
    },
  });
  if (!product) return NextResponse.json({ error: '상품을 찾을 수 없습니다' }, { status: 404 });

  const images = JSON.parse(product.images || '[]') as string[];
  const tags = JSON.parse(product.tags || '[]') as string[];
  const reviewCount = product.reviews.length;
  const avgRating = reviewCount
    ? product.reviews.reduce((s, r) => s + r.rating, 0) / reviewCount
    : 0;

  // ── 1. 가격 적정성 (0~100) ──────────────────────────────────
  // 카테고리별 기준가 대비 평가
  const categoryPriceMap: Record<string, [number, number]> = {
    electronics: [50000, 5000000],
    fashion: [5000, 500000],
    food: [1000, 100000],
    digital: [500, 200000],
    general: [100, 1000000],
  };
  const [minP, maxP] = categoryPriceMap[product.category] || categoryPriceMap.general;
  let priceScore = 50;
  if (product.price >= minP && product.price <= maxP) {
    priceScore = 70 + Math.round(30 * (1 - (product.price - minP) / (maxP - minP)));
  } else if (product.price < minP) {
    priceScore = 40; // 비정상적으로 저렴
  } else {
    priceScore = 30; // 비정상적으로 비쌈
  }

  // ── 2. 판매자 신뢰도 (0~100) ────────────────────────────────
  const completedOrders = product.orders.filter(o => o.status === 'completed').length;
  const totalOrders = product.orders.length;
  const completionRate = totalOrders > 0 ? completedOrders / totalOrders : 0.5;
  let sellerScore = 40;
  sellerScore += product.sellerName !== '익명' ? 20 : 0;
  sellerScore += product.sellerRating > 0 ? Math.round(product.sellerRating * 10) : 10;
  sellerScore += Math.round(completionRate * 20);
  sellerScore = clamp(sellerScore);

  // ── 3. 상품 설명 품질 (0~100) ────────────────────────────────
  let descScore = 0;
  descScore += Math.min(product.description.length / 200 * 40, 40);
  descScore += product.title.length >= 10 && product.title.length <= 60 ? 20 : 10;
  descScore += tags.length >= 3 ? 20 : tags.length * 5;
  descScore += 20; // AI 평가 기본값 (아래에서 보정)
  descScore = clamp(Math.round(descScore));

  // ── 4. 사진/메타데이터 완성도 (0~100) ───────────────────────
  let metaScore = 0;
  metaScore += Math.min(images.length * 15, 45);
  metaScore += product.category !== 'general' ? 20 : 10;
  metaScore += tags.length > 0 ? 15 : 0;
  metaScore += product.stock > 0 ? 10 : 0;
  metaScore += product.sellerId ? 10 : 0;
  metaScore = clamp(Math.round(metaScore));

  // ── 5. 리뷰 진정성 (0~100) ──────────────────────────────────
  let reviewScore = 50;
  if (reviewCount === 0) {
    reviewScore = 50;
  } else {
    // 이상 패턴 탐지: 모두 5점, 짧은 댓글, 한날 집중
    const allMax = product.reviews.every(r => r.rating === 5);
    const shortComments = product.reviews.filter(r => r.comment.length < 5).length;
    const suspicious = allMax && reviewCount > 3 ? -20 : 0;
    const shortPenalty = Math.min(shortComments * 5, 30);
    reviewScore = clamp(
      Math.round(50 + avgRating * 8 + Math.min(reviewCount * 2, 20) + suspicious - shortPenalty)
    );
  }

  // ── AI 심층 평가 ─────────────────────────────────────────────
  const aiPrompt = `당신은 AI 상품 검증 전문가입니다. 다음 상품을 5개 차원에서 정밀 평가하세요.

상품 정보:
- 제목: ${product.title}
- 설명: ${product.description.slice(0, 400)}
- 가격: ${product.price} ${product.currency}
- 카테고리: ${product.category}
- 태그: ${tags.join(', ')}
- 판매자: ${product.sellerName} (평점: ${product.sellerRating})
- 재고: ${product.stock}개
- 리뷰 수: ${reviewCount}, 평균 평점: ${avgRating.toFixed(1)}
- 이미지 수: ${images.length}

다음 JSON 형식으로만 답변하세요 (각 score는 0~20 보정치):
{
  "priceAdj": 보정치(-20~20),
  "sellerAdj": 보정치(-20~20),
  "descAdj": 보정치(-20~20),
  "metaAdj": 보정치(-10~10),
  "reviewAdj": 보정치(-20~20),
  "priceComment": "가격 평가 한 줄",
  "sellerComment": "판매자 신뢰도 평가 한 줄",
  "descComment": "설명 품질 평가 한 줄",
  "metaComment": "메타데이터 완성도 한 줄",
  "reviewComment": "리뷰 진정성 평가 한 줄",
  "overallComment": "종합 평가 2~3문장",
  "risks": ["위험 요소1", "위험 요소2"]
}`;

  let aiAdj = {
    priceAdj: 0, sellerAdj: 0, descAdj: 0, metaAdj: 0, reviewAdj: 0,
    priceComment: '', sellerComment: '', descComment: '', metaComment: '', reviewComment: '',
    overallComment: '', risks: [] as string[],
  };

  const aiResp = await callAI(aiPrompt, 600);
  try {
    const m = aiResp.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      aiAdj = {
        priceAdj: Number(parsed.priceAdj) || 0,
        sellerAdj: Number(parsed.sellerAdj) || 0,
        descAdj: Number(parsed.descAdj) || 0,
        metaAdj: Number(parsed.metaAdj) || 0,
        reviewAdj: Number(parsed.reviewAdj) || 0,
        priceComment: String(parsed.priceComment || ''),
        sellerComment: String(parsed.sellerComment || ''),
        descComment: String(parsed.descComment || ''),
        metaComment: String(parsed.metaComment || ''),
        reviewComment: String(parsed.reviewComment || ''),
        overallComment: String(parsed.overallComment || ''),
        risks: Array.isArray(parsed.risks) ? parsed.risks.map(String) : [],
      };
    }
  } catch { /* use default adj */ }

  // 최종 점수 (알고리즘 + AI 보정)
  const finalPrice = clamp(priceScore + aiAdj.priceAdj);
  const finalSeller = clamp(sellerScore + aiAdj.sellerAdj);
  const finalDesc = clamp(descScore + aiAdj.descAdj);
  const finalMeta = clamp(metaScore + aiAdj.metaAdj);
  const finalReview = clamp(reviewScore + aiAdj.reviewAdj);
  const totalScore = clamp(Math.round(
    finalPrice * 0.25 + finalSeller * 0.20 + finalDesc * 0.20 + finalMeta * 0.15 + finalReview * 0.20
  ));

  let grade = '❌ 비추천';
  if (totalScore >= 90) grade = '🥇 프리미엄';
  else if (totalScore >= 75) grade = '✅ 우수';
  else if (totalScore >= 60) grade = '📋 표준';
  else if (totalScore >= 40) grade = '⚠️ 주의';

  // DB 저장
  await prisma.productVerification.upsert({
    where: { productId },
    update: {
      priceScore: finalPrice,
      sellerScore: finalSeller,
      descriptionScore: finalDesc,
      metaScore: finalMeta,
      reviewScore: finalReview,
      totalScore,
      grade,
      priceComment: aiAdj.priceComment || `${product.category} 카테고리 기준가 대비 평가`,
      sellerComment: aiAdj.sellerComment || `판매자 신뢰도 ${sellerScore}점`,
      descriptionComment: aiAdj.descComment || `설명 완성도 ${descScore}점`,
      metaComment: aiAdj.metaComment || `메타데이터 완성도 ${metaScore}점`,
      reviewComment: aiAdj.reviewComment || (reviewCount > 0 ? `리뷰 ${reviewCount}개 분석` : '리뷰 없음'),
      overallComment: aiAdj.overallComment || `종합 점수 ${totalScore}점 (${grade})`,
      risks: JSON.stringify(aiAdj.risks),
      verifiedAt: new Date(),
      updatedAt: new Date(),
    },
    create: {
      productId,
      priceScore: finalPrice,
      sellerScore: finalSeller,
      descriptionScore: finalDesc,
      metaScore: finalMeta,
      reviewScore: finalReview,
      totalScore,
      grade,
      priceComment: aiAdj.priceComment || `${product.category} 카테고리 기준가 대비 평가`,
      sellerComment: aiAdj.sellerComment || `판매자 신뢰도 ${sellerScore}점`,
      descriptionComment: aiAdj.descComment || `설명 완성도 ${descScore}점`,
      metaComment: aiAdj.metaComment || `메타데이터 완성도 ${metaScore}점`,
      reviewComment: aiAdj.reviewComment || (reviewCount > 0 ? `리뷰 ${reviewCount}개 분석` : '리뷰 없음'),
      overallComment: aiAdj.overallComment || `종합 점수 ${totalScore}점 (${grade})`,
      risks: JSON.stringify(aiAdj.risks),
    },
  });

  // 기존 Product 테이블도 업데이트
  await prisma.product.update({
    where: { id: productId },
    data: {
      verifiedAt: new Date(),
      verifyScore: totalScore,
      verifyComment: `${grade} | ${aiAdj.overallComment || `종합 ${totalScore}점`}`,
    },
  });

  return NextResponse.json({
    productId,
    totalScore,
    grade,
    dimensions: {
      price: { score: finalPrice, label: '가격 적정성', comment: aiAdj.priceComment || '' },
      seller: { score: finalSeller, label: '판매자 신뢰도', comment: aiAdj.sellerComment || '' },
      description: { score: finalDesc, label: '상품 설명 품질', comment: aiAdj.descComment || '' },
      meta: { score: finalMeta, label: '사진/메타 완성도', comment: aiAdj.metaComment || '' },
      review: { score: finalReview, label: '리뷰 진정성', comment: aiAdj.reviewComment || '' },
    },
    overallComment: aiAdj.overallComment || `종합 점수 ${totalScore}점 (${grade})`,
    risks: aiAdj.risks,
    verifiedAt: new Date().toISOString(),
  });
}
