import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

function calcBadge(score: number): string {
  if (score >= 90) return '다이아몬드';
  if (score >= 75) return '골드';
  if (score >= 55) return '실버';
  return '브론즈';
}

function clamp(v: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sellerId } = await params;

  // 판매자 상품 및 주문 통계 조회
  const products = await prisma.product.findMany({
    where: { sellerId },
    include: {
      orders: { select: { id: true, status: true, createdAt: true } },
      reviews: { select: { rating: true } },
    },
  });

  if (products.length === 0) {
    return NextResponse.json({ error: '판매자를 찾을 수 없거나 등록 상품이 없습니다' }, { status: 404 });
  }

  const sellerName = products[0].sellerName;
  const allOrders = products.flatMap(p => p.orders);
  const allReviews = products.flatMap(p => p.reviews);

  // 1. 거래 완료율 (0~100)
  const totalOrders = allOrders.length;
  const completedOrders = allOrders.filter(o => o.status === 'completed').length;
  const cancelledOrders = allOrders.filter(o => o.status === 'cancelled').length;
  const completionRate = totalOrders > 0
    ? clamp(Math.round((completedOrders / totalOrders) * 100))
    : 60; // 기본값

  // 2. 평균 평점 (0~100)
  const avgRating = allReviews.length > 0
    ? allReviews.reduce((s, r) => s + r.rating, 0) / allReviews.length
    : 3.0;
  const ratingScore = clamp(Math.round(avgRating * 20));

  // 3. 응답 속도 점수 (주문 처리 시간 기반 추정)
  // 완료된 주문의 처리 시간을 createdAt 기준으로 추정
  let responseSpeed = 70; // 기본값
  if (completedOrders > 0) {
    // 최근 완료 주문 기준 상품이 오래되지 않았으면 빠른 응답으로 간주
    const recentCompleted = allOrders
      .filter(o => o.status === 'completed')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);

    const daysSinceOldest = recentCompleted.length > 0
      ? (Date.now() - new Date(recentCompleted[recentCompleted.length - 1].createdAt).getTime()) / 86400000
      : 30;
    responseSpeed = clamp(Math.round(100 - Math.min(daysSinceOldest * 2, 50)));
  }

  // 4. 클레임 비율 (낮을수록 좋음 → 높은 점수)
  const claimCount = cancelledOrders + allOrders.filter(o => o.status === 'refunded').length;
  const claimRate = totalOrders > 0 ? claimCount / totalOrders : 0;
  const claimScore = clamp(Math.round(100 - claimRate * 200));

  // 5. 활동 일수 (상품 등록일 기준)
  const oldestProduct = products.reduce((oldest, p) =>
    new Date(p.createdAt) < new Date(oldest.createdAt) ? p : oldest
  );
  const activeDays = Math.floor(
    (Date.now() - new Date(oldestProduct.createdAt).getTime()) / 86400000
  );
  const activityScore = clamp(Math.round(Math.min(activeDays / 365 * 100, 100)));

  // 종합 점수
  const totalScore = clamp(Math.round(
    completionRate * 0.30 +
    ratingScore * 0.25 +
    responseSpeed * 0.20 +
    claimScore * 0.15 +
    activityScore * 0.10
  ));

  const badge = calcBadge(totalScore);

  // DB 저장
  await prisma.sellerReputation.upsert({
    where: { sellerId },
    update: {
      sellerName,
      completionRate,
      avgRating: Math.round(avgRating * 10) / 10,
      responseSpeed,
      claimRate: Math.round(claimRate * 100) / 100,
      activeDays,
      totalScore,
      badge,
      calculatedAt: new Date(),
      updatedAt: new Date(),
    },
    create: {
      sellerId,
      sellerName,
      completionRate,
      avgRating: Math.round(avgRating * 10) / 10,
      responseSpeed,
      claimRate: Math.round(claimRate * 100) / 100,
      activeDays,
      totalScore,
      badge,
    },
  });

  // 판매자 상품들 sellerRating 업데이트
  await prisma.product.updateMany({
    where: { sellerId },
    data: { sellerRating: Math.round(avgRating * 10) / 10 },
  });

  return NextResponse.json({
    sellerId,
    sellerName,
    totalScore,
    badge,
    badgeEmoji: badge === '다이아몬드' ? '💎' : badge === '골드' ? '🥇' : badge === '실버' ? '🥈' : '🥉',
    metrics: {
      completionRate: { score: completionRate, label: '거래 완료율', value: `${completionRate}%` },
      avgRating: { score: ratingScore, label: '평균 평점', value: `${avgRating.toFixed(1)}점` },
      responseSpeed: { score: responseSpeed, label: '응답 속도', value: `${responseSpeed}점` },
      claimRate: { score: claimScore, label: '클레임 비율 (낮을수록 좋음)', value: `${(claimRate * 100).toFixed(1)}%` },
      activityDays: { score: activityScore, label: '활동 일수', value: `${activeDays}일` },
    },
    stats: {
      totalProducts: products.length,
      totalOrders,
      completedOrders,
      totalReviews: allReviews.length,
      activeDays,
    },
    calculatedAt: new Date().toISOString(),
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sellerId } = await params;

  const reputation = await prisma.sellerReputation.findUnique({
    where: { sellerId },
  });

  if (!reputation) {
    return NextResponse.json({ error: '신뢰도 정보가 없습니다. POST로 먼저 계산하세요.' }, { status: 404 });
  }

  return NextResponse.json({
    sellerId: reputation.sellerId,
    sellerName: reputation.sellerName,
    totalScore: reputation.totalScore,
    badge: reputation.badge,
    badgeEmoji: reputation.badge === '다이아몬드' ? '💎' : reputation.badge === '골드' ? '🥇' : reputation.badge === '실버' ? '🥈' : '🥉',
    metrics: {
      completionRate: reputation.completionRate,
      avgRating: reputation.avgRating,
      responseSpeed: reputation.responseSpeed,
      claimRate: reputation.claimRate,
      activeDays: reputation.activeDays,
    },
    calculatedAt: reputation.calculatedAt,
  });
}
