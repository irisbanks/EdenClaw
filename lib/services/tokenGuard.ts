import { prisma } from '@/lib/prisma';
import { redis, QUOTA_TTL_SEC, quotaKey } from '@/lib/redis';
import { enqueueSettlement } from '@/lib/services/settlementQueue';

/** estimatedTokens 미지정 시 기본 예약치 */
export const DEFAULT_ESTIMATE = 1000;

/** 토큰 소비 → 상위 라인 PV 환산율. 기본 10,000 토큰 = 1 PV (env 로 조정). */
const TOKENS_PER_PV = Number(process.env.TOKENS_PER_PV) || 10_000;

/** 토큰 고갈 시 클라이언트에 내려줄 결제 유도 페이로드 */
export const LOCKED_PAYLOAD = {
  status: 'LOCKED' as const,
  message:
    '에덴클로의 업무량이 폭주하여 토큰이 고갈되었습니다! 마켓에서 50만 토큰 충전팩($10)을 충전 후 개발을 계속하세요.',
  checkoutUrl: '/commerce?item=token-pack-50k',
};

export type QuotaCheck =
  | { status: 'ALLOWED'; remaining: number }
  | { status: 'NO_QUOTA' }
  | { status: 'LOCKED'; remaining: number };

/**
 * AI 호출 전 잔여 토큰 검증.
 * Redis 1차 초고속 조회 → 미스 시 DB 조회 후 캐시 워밍.
 */
export async function checkQuota(userId: string, estimatedTokens?: number): Promise<QuotaCheck> {
  const cached = await redis.get(quotaKey(userId));
  let remaining: number;

  if (cached === null) {
    const dbQuota = await prisma.tokenQuota.findUnique({ where: { userId } });
    if (!dbQuota) return { status: 'NO_QUOTA' };
    // allocated / consumed 는 BigInt → 안전하게 차감 후 Number 캐스팅
    remaining = Number(dbQuota.allocated - dbQuota.consumed);
    await redis.set(quotaKey(userId), remaining.toString(), 'EX', QUOTA_TTL_SEC);
  } else {
    remaining = parseInt(cached, 10);
  }

  const needed = Number(estimatedTokens) || DEFAULT_ESTIMATE;
  if (remaining <= 0 || remaining < needed) {
    return { status: 'LOCKED', remaining };
  }
  return { status: 'ALLOWED', remaining };
}

/** 검증 완료된 토큰 쿼터 가드의 의미상 별칭 (외부 연동 명세 호환) */
export const verifyTokenQuota = checkQuota;

/**
 * AI 호출 완료 후 실제 사용 토큰 정산(차감) + Redis 갱신.
 * 추가로 "토큰 소비 → 상위 라인 PV 전파"를 비동기 큐에 적재한다(논블로킹).
 * 소비 전파는 bv=0 (현금 미발생): 매칭 포지션은 키우되 실지급은 실매출 BV 로만 캡됨(Dual-Shield).
 * @returns 차감 후 잔여 토큰
 */
export async function settleUsage(userId: string, actualTokens: number): Promise<number> {
  // BigInt 필드(consumed) 증분은 정수 BigInt 로 강제 변환 (음수/소수 방지)
  const tokens = Math.max(0, Math.trunc(Number(actualTokens) || 0));
  const delta = BigInt(tokens);

  const updated = await prisma.tokenQuota.update({
    where: { userId },
    data: { consumed: { increment: delta } },
  });

  const newRemaining = Number(updated.allocated - updated.consumed);
  await redis.set(quotaKey(userId), newRemaining.toString(), 'EX', QUOTA_TTL_SEC);

  // 소비량을 PV 로 환산해 상위 라인 실적으로 전파 (BM: 하위 소비 = 상위 실적)
  const consumptionPV = tokens / TOKENS_PER_PV;
  if (consumptionPV > 0) {
    enqueueSettlement({ userId, pv: consumptionPV, bv: 0, reason: 'TOKEN_CONSUMPTION' });
  }

  return newRemaining;
}
