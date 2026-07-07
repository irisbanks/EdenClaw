import { prisma } from '@/lib/prisma';
import { redis, QUOTA_TTL_SEC, quotaKey } from '@/lib/redis';
import { enqueueSettlement } from '@/lib/services/settlementQueue';
import { loadGasAccountByEmail, quotaView, type GasQuotaView } from '@/lib/services/overdraftLedger';

// 결제 웹훅(app/api/payments/webhook/route.ts)의 TOKEN_PACK 분기와 동일한 환산율.
// 두 곳이 갈라지면 같은 상품이 경로에 따라 다른 토큰/PV를 주는 버그가 생기므로 상수를 공유한다.
const TOKENS_PER_USD = 50_000; // $10 = 500,000 토큰
const PV_RATE = 1.0;
const BV_RATE = 0.5;
const KRW_PER_USD = 1_300; // 가격 표시는 원화, 환산은 달러 기준 그대로 유지

export type TokenPackId = 'token-pack-50k';

export interface TokenPack {
  id: TokenPackId;
  name: string;
  priceUsd: number;
  priceKrw: number;
  tokens: number;
}

export const TOKEN_PACKS: TokenPack[] = [
  {
    id: 'token-pack-50k',
    name: '토큰 충전팩 (50만 토큰)',
    priceUsd: 10,
    priceKrw: Math.round(10 * KRW_PER_USD),
    tokens: 10 * TOKENS_PER_USD,
  },
];

export function getTokenPack(packId: unknown): TokenPack | null {
  return TOKEN_PACKS.find((pack) => pack.id === packId) ?? null;
}

export type TokenPackPurchaseResult =
  | { ok: true; pack: TokenPack; quota: GasQuotaView }
  | { ok: false; status: 'tenant_invalid' | 'pack_invalid'; message: string };

/**
 * 실제 결제 게이트웨이(PG) 연동 전 단계의 자체 서비스 구매 경로.
 * payments/webhook 의 TOKEN_PACK 분기는 PG 서버→서버 웹훅 전용(서명 필요)이라
 * 브라우저에서 직접 호출할 수 없다 — 그래서 이메일 확인만으로 즉시 토큰을
 * 지급하는 이 별도 경로를 둔다. 실제 카드 결제를 받는 게 아니므로 /commerce
 * 페이지에는 반드시 테스트 모드임을 명시해야 한다.
 */
export async function purchaseTokenPack(args: {
  email: string;
  packId: unknown;
}): Promise<TokenPackPurchaseResult> {
  const pack = getTokenPack(args.packId);
  if (!pack) {
    return { ok: false, status: 'pack_invalid', message: '존재하지 않는 토큰팩입니다.' };
  }

  const account = await loadGasAccountByEmail(args.email);
  if (!account) {
    return { ok: false, status: 'tenant_invalid', message: '가입되지 않은 이메일입니다.' };
  }

  const purchasedTokens = BigInt(pack.tokens);
  const pvGenerated = pack.priceUsd * PV_RATE;
  const bvGenerated = pack.priceUsd * BV_RATE;

  const [quota] = await prisma.$transaction([
    prisma.tokenQuota.upsert({
      where: { userId: account.id },
      update: { allocated: { increment: purchasedTokens } },
      create: { userId: account.id, allocated: purchasedTokens, consumed: BigInt(0) },
    }),
    prisma.transaction.create({
      data: {
        userId: account.id,
        txType: 'TOKEN_PACK',
        amount: pack.priceUsd,
        pvGenerated,
        bvGenerated,
      },
    }),
  ]);

  const remaining = Number(quota.allocated - quota.consumed);
  await redis.set(quotaKey(account.id), remaining.toString(), 'EX', QUOTA_TTL_SEC).catch(() => undefined);

  // 상위 라인 PV/BV 전파 + 매칭 정산 (in-memory 큐 → after()로 완료 보장, settlementQueue.ts 참고)
  enqueueSettlement({ userId: account.id, pv: pvGenerated, bv: bvGenerated, reason: 'TOKEN_PACK' });

  return {
    ok: true,
    pack,
    quota: quotaView({ ...account, tokenQuota: { allocated: quota.allocated, consumed: quota.consumed, isOverdraftAdvanced: account.tokenQuota?.isOverdraftAdvanced ?? false } }),
  };
}
