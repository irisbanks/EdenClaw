// 검증 엔진: 5차원 상품 검증, 각 100점 만점
'use strict';

import { prisma } from '@/lib/prisma';

const VLLM_URL = process.env.LOCAL_AI_URL || 'http://localhost:8000/v1/chat/completions';
const AI_MODEL = process.env.LOCAL_AI_MODEL || 'Qwen/Qwen2.5-72B-Instruct';

function clamp(v: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(v)));
}

async function callAI(prompt: string, maxTokens = 700): Promise<string> {
  try {
    const res = await fetch(VLLM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(25000),
    });
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content || '';
  } catch {
    return '';
  }
}

export interface VerificationScores {
  price: number;
  seller: number;
  description: number;
  meta: number;
  review: number;
}

export interface VerificationResult {
  productId: string;
  totalScore: number;
  grade: string;
  scores: VerificationScores;
  comments: Record<string, string>;
  overallComment: string;
  warnings: string[];
  verifiedAt: string;
}

export async function verifyProduct(productId: string): Promise<VerificationResult> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      reviews: { select: { rating: true, comment: true, createdAt: true } },
      orders: { select: { id: true, status: true } },
    },
  });

  if (!product) throw new Error('상품을 찾을 수 없습니다');

  const images = JSON.parse(product.images || '[]') as string[];
  const tags = JSON.parse(product.tags || '[]') as string[];
  const reviewCount = product.reviews.length;
  const avgRating = reviewCount
    ? product.reviews.reduce((s, r) => s + r.rating, 0) / reviewCount
    : 0;

  // ── 1. 가격 적정성 (0~100) ───────────────────────────────
  const categoryRange: Record<string, [number, number]> = {
    electronics: [10000, 5000000], fashion: [3000, 1000000],
    food: [500, 500000], digital: [100, 500000], general: [100, 2000000],
  };
  const [minP, maxP] = categoryRange[product.category] || categoryRange.general;
  let priceScore = 50;
  if (product.price >= minP && product.price <= maxP) {
    priceScore = clamp(70 + 30 * (1 - (product.price - minP) / (maxP - minP)));
  } else {
    priceScore = product.price < minP ? 35 : 25;
  }

  // ── 2. 판매자 신뢰도 (0~100) ─────────────────────────────
  const completedOrders = product.orders.filter(o => o.status === 'completed').length;
  const totalOrders = product.orders.length;
  const completionRate = totalOrders > 0 ? completedOrders / totalOrders : 0.5;
  let sellerScore = 30
    + (product.sellerName !== '익명' ? 20 : 0)
    + (product.sellerRating > 0 ? clamp(product.sellerRating * 10, 0, 30) : 10)
    + clamp(completionRate * 20, 0, 20);
  sellerScore = clamp(sellerScore);

  // ── 3. 상품 설명 품질 (0~100) ────────────────────────────
  let descScore = 0;
  descScore += clamp(product.description.length / 300 * 50, 0, 50);
  descScore += (product.title.length >= 10 && product.title.length <= 80) ? 25 : 10;
  descScore += clamp(tags.length * 5, 0, 25);
  descScore = clamp(descScore);

  // ── 4. 사진/메타 완성도 (0~100) ──────────────────────────
  let metaScore = 0;
  metaScore += clamp(images.length * 15, 0, 45);
  metaScore += product.category !== 'general' ? 20 : 5;
  metaScore += tags.length > 0 ? 15 : 0;
  metaScore += product.stock > 0 ? 10 : 0;
  metaScore += product.sellerId ? 10 : 0;
  metaScore = clamp(metaScore);

  // ── 5. 리뷰 진정성 (0~100) ──────────────────────────────
  let reviewScore = 50;
  if (reviewCount > 0) {
    const allMax = product.reviews.every(r => r.rating === 5);
    const shortComments = product.reviews.filter(r => r.comment.length < 5).length;
    const suspicious = allMax && reviewCount > 5 ? -20 : 0;
    const shortPenalty = clamp(shortComments * 6, 0, 30);
    reviewScore = clamp(50 + avgRating * 8 + Math.min(reviewCount * 2, 20) + suspicious - shortPenalty);
  }

  // ── AI 보정 ─────────────────────────────────────────────
  const aiPrompt = `상품 검증 전문가로서 다음 상품을 5개 차원에서 평가하세요.

상품:
- 제목: ${product.title}
- 설명: ${product.description.slice(0, 400)}
- 가격: ${product.price} ${product.currency} / 카테고리: ${product.category}
- 판매자: ${product.sellerName} (평점: ${product.sellerRating})
- 이미지 ${images.length}장 / 태그: ${tags.join(', ')} / 재고: ${product.stock}
- 리뷰 ${reviewCount}개 / 평균 ${avgRating.toFixed(1)}점

JSON으로만 답변 (각 adj는 -20~20 보정치):
{
  "priceAdj":0,"sellerAdj":0,"descAdj":0,"metaAdj":0,"reviewAdj":0,
  "priceComment":"","sellerComment":"","descComment":"","metaComment":"","reviewComment":"",
  "overallComment":"",
  "warnings":["위험요소1"]
}`;

  let adj = { priceAdj:0,sellerAdj:0,descAdj:0,metaAdj:0,reviewAdj:0,
    priceComment:'',sellerComment:'',descComment:'',metaComment:'',reviewComment:'',
    overallComment:'', warnings:[] as string[] };

  const aiResp = await callAI(aiPrompt);
  try {
    const m = aiResp.match(/\{[\s\S]*\}/);
    if (m) {
      const p = JSON.parse(m[0]);
      adj = {
        priceAdj: Number(p.priceAdj) || 0, sellerAdj: Number(p.sellerAdj) || 0,
        descAdj: Number(p.descAdj) || 0, metaAdj: Number(p.metaAdj) || 0,
        reviewAdj: Number(p.reviewAdj) || 0,
        priceComment: String(p.priceComment || ''), sellerComment: String(p.sellerComment || ''),
        descComment: String(p.descComment || ''), metaComment: String(p.metaComment || ''),
        reviewComment: String(p.reviewComment || ''), overallComment: String(p.overallComment || ''),
        warnings: Array.isArray(p.warnings) ? p.warnings.map(String) : [],
      };
    }
  } catch { /* fallback */ }

  const finalScores: VerificationScores = {
    price: clamp(priceScore + adj.priceAdj),
    seller: clamp(sellerScore + adj.sellerAdj),
    description: clamp(descScore + adj.descAdj),
    meta: clamp(metaScore + adj.metaAdj),
    review: clamp(reviewScore + adj.reviewAdj),
  };

  const totalScore = clamp(
    finalScores.price * 0.25
    + finalScores.seller * 0.20
    + finalScores.description * 0.20
    + finalScores.meta * 0.15
    + finalScores.review * 0.20
  );

  const grade =
    totalScore >= 90 ? '🥇 프리미엄' :
    totalScore >= 75 ? '✅ 우수' :
    totalScore >= 60 ? '📋 표준' :
    totalScore >= 40 ? '⚠️ 주의' : '❌ 비추천';

  const comments = {
    price: adj.priceComment || `가격 적정성 ${finalScores.price}점`,
    seller: adj.sellerComment || `판매자 신뢰도 ${finalScores.seller}점`,
    description: adj.descComment || `설명 품질 ${finalScores.description}점`,
    meta: adj.metaComment || `메타 완성도 ${finalScores.meta}점`,
    review: adj.reviewComment || (reviewCount > 0 ? `리뷰 ${reviewCount}개 분석` : '리뷰 없음'),
  };

  const overallComment = adj.overallComment || `종합 ${totalScore}점 (${grade})`;

  // DB upsert
  await prisma.productVerification.upsert({
    where: { productId },
    create: {
      productId,
      scores: JSON.stringify(finalScores),
      priceScore: finalScores.price, sellerScore: finalScores.seller,
      descriptionScore: finalScores.description, metaScore: finalScores.meta,
      reviewScore: finalScores.review, totalScore, grade,
      comments: JSON.stringify(comments),
      priceComment: comments.price, sellerComment: comments.seller,
      descriptionComment: comments.description, metaComment: comments.meta,
      reviewComment: comments.review, overallComment,
      warnings: JSON.stringify(adj.warnings), risks: JSON.stringify(adj.warnings),
    },
    update: {
      scores: JSON.stringify(finalScores),
      priceScore: finalScores.price, sellerScore: finalScores.seller,
      descriptionScore: finalScores.description, metaScore: finalScores.meta,
      reviewScore: finalScores.review, totalScore, grade,
      comments: JSON.stringify(comments),
      priceComment: comments.price, sellerComment: comments.seller,
      descriptionComment: comments.description, metaComment: comments.meta,
      reviewComment: comments.review, overallComment,
      warnings: JSON.stringify(adj.warnings), risks: JSON.stringify(adj.warnings),
      verifiedAt: new Date(), updatedAt: new Date(),
    },
  });

  await prisma.product.update({
    where: { id: productId },
    data: { verifiedAt: new Date(), verifyScore: totalScore, verifyComment: `${grade} | ${overallComment}` },
  });

  console.log(`[VerificationEngine] ${product.title} 검증 완료: ${totalScore}점 (${grade})`);

  return {
    productId, totalScore, grade, scores: finalScores,
    comments, overallComment, warnings: adj.warnings,
    verifiedAt: new Date().toISOString(),
  };
}
