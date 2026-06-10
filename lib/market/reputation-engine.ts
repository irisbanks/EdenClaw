// 판매자 평판 엔진: 5지표 계산 → 다이아/골드/실버/브론즈 뱃지
'use strict';

import { prisma } from '@/lib/prisma';

function clamp(v: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(v)));
}

export interface ReputationResult {
  sellerId: string;
  sellerName: string;
  completionRate: number;
  avgRating: number;
  responseSpeedSec: number;
  responseSpeedScore: number;
  claimRate: number;
  activeDays: number;
  totalScore: number;
  badge: '다이아몬드' | '골드' | '실버' | '브론즈';
  breakdown: Record<string, number>;
  calculatedAt: string;
}

export async function calculateReputation(sellerId: string): Promise<ReputationResult> {
  const products = await prisma.product.findMany({
    where: { sellerId },
    include: {
      orders: { select: { id: true, status: true, createdAt: true, updatedAt: true } },
      reviews: { select: { rating: true } },
    },
  });

  if (products.length === 0) throw new Error('판매자 상품 없음');

  const sellerName = products[0].sellerName;
  const allOrders = products.flatMap(p => p.orders);
  const allReviews = products.flatMap(p => p.reviews);

  // ── 1. 거래 완료율 (0~100) ─────────────────────────────
  const totalOrders = allOrders.length;
  const completedOrders = allOrders.filter(o => o.status === 'completed').length;
  const completionRate = totalOrders > 0
    ? Math.round((completedOrders / totalOrders) * 100)
    : 60;

  // ── 2. 평균 평점 → 점수 (0~100) ──────────────────────
  const avgRating = allReviews.length > 0
    ? allReviews.reduce((s, r) => s + r.rating, 0) / allReviews.length
    : 3.0;
  const ratingScore = clamp(avgRating * 20);

  // ── 3. 응답 속도 (주문→완료 평균 시간 기반) ─────────────
  let responseSpeedSec = 86400; // 기본값 24시간
  let responseSpeedScore = 50;
  const completedWithTime = allOrders.filter(o => o.status === 'completed');
  if (completedWithTime.length > 0) {
    const avgMs = completedWithTime.reduce((s, o) => {
      return s + (new Date(o.updatedAt).getTime() - new Date(o.createdAt).getTime());
    }, 0) / completedWithTime.length;
    responseSpeedSec = Math.round(avgMs / 1000);
    // 1시간 이내 = 100점, 24시간 = 60점, 72시간 이상 = 20점
    if (responseSpeedSec <= 3600) responseSpeedScore = 100;
    else if (responseSpeedSec <= 86400) responseSpeedScore = clamp(60 + 40 * (1 - (responseSpeedSec - 3600) / (86400 - 3600)));
    else responseSpeedScore = clamp(Math.max(20, 60 - (responseSpeedSec - 86400) / 86400 * 40));
  }

  // ── 4. 클레임율 (취소/반품 비율, 낮을수록 좋음) ─────────
  const claimedOrders = allOrders.filter(o => ['cancelled', 'refunded', 'disputed'].includes(o.status)).length;
  const claimRate = totalOrders > 0 ? Math.round((claimedOrders / totalOrders) * 100) : 5;
  const claimScore = clamp(100 - claimRate * 2);

  // ── 5. 활동 일수 (상품 등록일 기준) ──────────────────
  const firstProduct = products.slice().sort((a, b) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  )[0];
  const activeDays = Math.floor(
    (Date.now() - new Date(firstProduct.createdAt).getTime()) / 86400000
  );
  const activityScore = clamp(Math.min(activeDays / 30 * 20, 20) + (products.length >= 5 ? 10 : products.length * 2));

  // ── 종합 점수 (5지표 가중 평균) ──────────────────────
  const totalScore = clamp(
    completionRate * 0.30 + ratingScore * 0.25 + responseSpeedScore * 0.20
    + claimScore * 0.15 + activityScore * 0.10
  );

  // ── 뱃지 결정 ─────────────────────────────────────────
  const badge: ReputationResult['badge'] =
    totalScore >= 90 ? '다이아몬드' :
    totalScore >= 75 ? '골드' :
    totalScore >= 60 ? '실버' : '브론즈';

  // ── DB 저장 ───────────────────────────────────────────
  await prisma.sellerReputation.upsert({
    where: { sellerId },
    create: {
      sellerId, sellerName,
      completionRate, avgRating, responseSpeed: responseSpeedScore,
      responseSpeedSec, claimRate, activeDays, totalScore, badge,
      calculatedAt: new Date(),
    },
    update: {
      sellerName, completionRate, avgRating,
      responseSpeed: responseSpeedScore, responseSpeedSec,
      claimRate, activeDays, totalScore, badge,
      calculatedAt: new Date(), updatedAt: new Date(),
    },
  });

  console.log(`[ReputationEngine] 판매자 ${sellerName}: ${totalScore}점 → ${badge}`);

  return {
    sellerId, sellerName, completionRate, avgRating,
    responseSpeedSec, responseSpeedScore, claimRate, activeDays,
    totalScore, badge,
    breakdown: {
      completionRate, ratingScore, responseSpeedScore, claimScore, activityScore,
    },
    calculatedAt: new Date().toISOString(),
  };
}

export async function getReputation(sellerId: string): Promise<ReputationResult | null> {
  const rep = await prisma.sellerReputation.findUnique({ where: { sellerId } });
  if (!rep) return null;
  return {
    sellerId: rep.sellerId,
    sellerName: rep.sellerName,
    completionRate: rep.completionRate,
    avgRating: rep.avgRating,
    responseSpeedSec: rep.responseSpeedSec,
    responseSpeedScore: rep.responseSpeed,
    claimRate: rep.claimRate,
    activeDays: rep.activeDays,
    totalScore: rep.totalScore,
    badge: rep.badge as ReputationResult['badge'],
    breakdown: {},
    calculatedAt: rep.calculatedAt.toISOString(),
  };
}
