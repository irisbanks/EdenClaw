import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { redis, QUOTA_TTL_SEC, quotaKey } from '@/lib/redis';
import { enqueueSettlement } from '@/lib/services/settlementQueue';
import { verifyWebhookSignature } from '@/lib/webhook-security';

// prisma(better-sqlite3) + ioredis 네이티브 모듈 → Edge 불가, 캐시 금지
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ─── 비즈니스 상수 (운영값은 환경에 맞게 조정) ─────────────────────
const DEFAULT_ALLOCATION = BigInt(2_000_000); // 구독 1주기 기본 제공 토큰 (ES2017 타깃이라 BigInt() 생성자 사용)
const ZERO = BigInt(0);
const TOKENS_PER_USD = 50_000; // $10 = 500,000 토큰 (50만 토큰 충전팩 기준)
const PV_RATE = 1.0; // 결제액 → 수당 계산용 포인트 볼륨(PV) 환산율
const BV_RATE = 0.5; // 결제액 → 과지급 제어용 비즈니스 볼륨(BV) 환산율

/**
 * 결제 PG / WooCommerce 결제 성공 웹훅.
 * 멱등(idempotent) 처리: 동일 paymentId 재전송 시 토큰/EP 중복 적립을 차단.
 */
export async function POST(request: Request) {
  // ── 0. 웹훅 서명 검증 (HMAC-SHA256 또는 공유 시크릿) ──
  //    HMAC 은 raw body 기준이므로 반드시 text() 로 먼저 읽는다.
  const rawBody = await request.text();
  const verify = verifyWebhookSignature(rawBody, request);
  if (!verify.ok) {
    return NextResponse.json({ error: `웹훅 인증 실패: ${verify.reason}` }, { status: 401 });
  }

  try {
    const body = JSON.parse(rawBody || '{}');
    const { status, userId, amount, productType, paymentId } = body;

    // ── 1. 결제 성공 건만 처리 ──
    if (status !== 'success') {
      return NextResponse.json({ ok: true, skipped: `status=${status}` });
    }
    if (!userId || typeof amount !== 'number' || !productType) {
      return NextResponse.json(
        { error: 'userId, amount(number), productType 은 필수입니다.' },
        { status: 400 }
      );
    }

    // ── 멱등성 가드: 동일 결제건 재처리 방지 (Redis SET NX, 7일 보관) ──
    if (paymentId) {
      const fresh = await redis.set(`webhook:processed:${paymentId}`, '1', 'EX', 604800, 'NX');
      if (fresh === null) {
        return NextResponse.json({ ok: true, idempotent: true, paymentId });
      }
    }

    // ── 결제액 → PV/BV 마진 산정 ──
    const pvGenerated = amount * PV_RATE;
    const bvGenerated = amount * BV_RATE;

    if (productType === 'SUBSCRIPTION') {
      // ── 2. 구독 결제: 상태 ACTIVE + 쿼터 리셋(allocated=200만, consumed=0) ──
      await prisma.$transaction([
        prisma.user.update({
          where: { id: userId },
          data: { subscriptionStatus: 'ACTIVE' },
        }),
        prisma.tokenQuota.upsert({
          where: { userId },
          update: { allocated: DEFAULT_ALLOCATION, consumed: ZERO },
          create: { userId, allocated: DEFAULT_ALLOCATION, consumed: ZERO },
        }),
        prisma.transaction.create({
          data: { userId, txType: 'SUBSCRIPTION', amount, pvGenerated, bvGenerated },
        }),
      ]);

      // 리셋 직후 잔액 = allocated - consumed = 200만
      await redis.set(quotaKey(userId), DEFAULT_ALLOCATION.toString(), 'EX', QUOTA_TTL_SEC);
    } else if (productType === 'TOKEN_PACK') {
      // ── 3. 토큰팩 결제: allocated 즉시 가산 + Redis 갱신 ──
      const purchasedTokens = BigInt(Math.max(0, Math.trunc(amount * TOKENS_PER_USD)));

      const [quota] = await prisma.$transaction([
        prisma.tokenQuota.upsert({
          where: { userId },
          update: { allocated: { increment: purchasedTokens } },
          // 신규 쿼터면 기본 제공량 + 구매분으로 생성 (가입 보장 200만 유지)
          create: { userId, allocated: DEFAULT_ALLOCATION + purchasedTokens, consumed: ZERO },
        }),
        prisma.transaction.create({
          data: { userId, txType: 'TOKEN_PACK', amount, pvGenerated, bvGenerated },
        }),
      ]);

      const remaining = Number(quota.allocated - quota.consumed);
      await redis.set(quotaKey(userId), remaining.toString(), 'EX', QUOTA_TTL_SEC);
    } else {
      return NextResponse.json({ error: `알 수 없는 productType: ${productType}` }, { status: 400 });
    }

    // ── 4. 상위 라인(무한 뎁스) PV/BV 전파 + 매칭 정산을 비동기 큐로 적재(논블로킹) ──
    enqueueSettlement({ userId, pv: pvGenerated, bv: bvGenerated, reason: productType });

    return NextResponse.json({ ok: true, userId, productType, pvGenerated, bvGenerated });
  } catch (error) {
    console.error('[payments/webhook]', error);
    return NextResponse.json({ error: '웹훅 처리 중 장애' }, { status: 500 });
  }
}
