import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getQueueStats } from '@/lib/services/settlementQueue';

export async function GET() {
  const checks: Record<string, unknown> = {};

  try {
    const r = await fetch('http://localhost:8000/v1/models', { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    checks.localAI = { status: 'up', model: d.data?.[0]?.id || 'unknown' };
  } catch {
    checks.localAI = { status: 'down' };
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    const userCount = await prisma.user.count();
    checks.database = { status: 'up', type: 'PostgreSQL (Supabase)', userCount };
  } catch (e) {
    checks.database = { status: 'down', error: String(e) };
  }

  // 바이너리 장부 핵심 불변식 + 백그라운드 정산 큐 상태
  try {
    const [audit] = await prisma.$queryRaw<Array<{
      missingQuota: number;
      missingLeg: number;
      duplicateSlots: number;
      invalidLegs: number;
      overdrawn: number;
    }>>`
      SELECT
        (SELECT COUNT(*)::int FROM "User" u LEFT JOIN "TokenQuota" q ON q."userId" = u.id WHERE q.id IS NULL) AS "missingQuota",
        (SELECT COUNT(*)::int FROM "User" u LEFT JOIN "LegBalance" l ON l."userId" = u.id WHERE l.id IS NULL) AS "missingLeg",
        (SELECT COUNT(*)::int FROM (
          SELECT "parentId", "position" FROM "User"
          WHERE "parentId" IS NOT NULL
          GROUP BY "parentId", "position" HAVING COUNT(*) > 1
        ) duplicate_slots) AS "duplicateSlots",
        (SELECT COUNT(*)::int FROM "LegBalance"
          WHERE "leftPV" < 0 OR "rightPV" < 0 OR "leftBV" < 0 OR "rightBV" < 0) AS "invalidLegs",
        (SELECT COUNT(*)::int FROM "TokenQuota"
          WHERE "consumed" < 0 OR "consumed" > "allocated") AS "overdrawn"
    `;
    const violations = Object.values(audit).reduce((sum, value) => sum + value, 0);
    checks.binaryLedger = {
      status: violations === 0 ? 'ok' : 'error',
      violations,
      queue: getQueueStats(),
      verification: 'npm run verify:world-class',
    };
  } catch (e) {
    checks.binaryLedger = { status: 'error', error: String(e) };
  }

  // ── AI MARKET V2 기능 상태 체크 ───────────────────────────────

  // [1] 협상룸
  try {
    const sessionCount = await prisma.negotiationSession.count();
    checks.negotiation = { status: 'ok', endpoint: 'POST /api/market/negotiation/start', sessions: sessionCount };
  } catch (e) {
    checks.negotiation = { status: 'error', error: String(e) };
  }

  // [2] AI 검증 v2
  try {
    const verificationCount = await prisma.productVerification.count();
    checks.verificationV2 = { status: 'ok', endpoint: 'POST /api/market/verify/[productId]', records: verificationCount };
  } catch (e) {
    checks.verificationV2 = { status: 'error', error: String(e) };
  }

  // [3] 개인화 추천
  try {
    const productCount = await prisma.product.count({ where: { status: 'active' } });
    checks.recommend = { status: 'ok', endpoint: 'GET /api/market/recommend', availableProducts: productCount };
  } catch (e) {
    checks.recommend = { status: 'error', error: String(e) };
  }

  // [4] 자연어 쇼핑
  try {
    const activeProducts = await prisma.product.count({ where: { status: 'active', stock: { gt: 0 } } });
    checks.voiceShop = { status: 'ok', endpoint: 'POST /api/market/voice-shop', searchableProducts: activeProducts };
  } catch (e) {
    checks.voiceShop = { status: 'error', error: String(e) };
  }

  // [5] 공동구매 스마트 매칭 v2
  try {
    const openGroupBuys = await prisma.groupBuy.count({ where: { status: 'open', deadline: { gt: new Date() } } });
    checks.smartMatch = { status: 'ok', endpoint: 'POST /api/market/group-buy/smart-match', openGroupBuys };
  } catch (e) {
    checks.smartMatch = { status: 'error', error: String(e) };
  }

  // [6] 판매자 신뢰도
  try {
    const reputationCount = await prisma.sellerReputation.count();
    checks.sellerReputation = { status: 'ok', endpoint: 'POST /api/market/seller/[id]/calculate-reputation', sellers: reputationCount };
  } catch (e) {
    checks.sellerReputation = { status: 'error', error: String(e) };
  }

  // [7] 가격 트렌드
  try {
    const priceHistoryCount = await prisma.priceHistory.count();
    checks.priceTrend = { status: 'ok', endpoint: 'GET /api/market/products/[id]/price-trend', historyRecords: priceHistoryCount };
  } catch (e) {
    checks.priceTrend = { status: 'error', error: String(e) };
  }

  // 전체 마켓 상태
  try {
    const [products, orders, groupBuys] = await Promise.all([
      prisma.product.count(),
      prisma.order.count(),
      prisma.groupBuy.count(),
    ]);
    checks.market = { status: 'ok', products, orders, groupBuys };
  } catch (e) {
    checks.market = { status: 'error', error: String(e) };
  }

  const allV2Ok = ['negotiation', 'verificationV2', 'recommend', 'voiceShop', 'smartMatch', 'sellerReputation', 'priceTrend']
    .every(k => (checks[k] as { status: string })?.status === 'ok');
  const coreOk =
    (checks.database as { status?: string })?.status === 'up' &&
    (checks.binaryLedger as { status?: string })?.status === 'ok';

  return NextResponse.json({
    status: coreOk && allV2Ok ? 'healthy' : 'degraded',
    version: 'AI Market v2',
    timestamp: new Date().toISOString(),
    gpu: 'NVIDIA B200 x4 (GPU 1-3 for AI, GPU 0 for trading bot)',
    features: {
      negotiationRoom: '멀티 에이전트 실시간 협상룸',
      verificationV2: 'AI 상품 검증 v2 (5차원)',
      recommend: '개인화 추천 엔진',
      voiceShop: '자연어/음성 쇼핑',
      smartMatch: '공동구매 스마트 매칭 v2',
      sellerReputation: '판매자 신뢰도 다차원 점수',
      priceTrend: '가격 트렌드 분석',
    },
    checks,
  });
}
