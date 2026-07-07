import { prisma } from '@/lib/prisma';
import { redis, QUOTA_TTL_SEC, quotaKey } from '@/lib/redis';

export const GAS_PER_PV = 10_000;
export const GAS_PER_EP = 1_000;
export const PROTOTYPE_ADVANCE_GAS = 800_000;

type LegSnapshot = { leftPV: number; rightPV: number; leftBV: number; rightBV: number };
type QuotaSnapshot = { allocated: bigint; consumed: bigint; isOverdraftAdvanced: boolean };

export type GasQuotaView = {
  email: string;
  allocated: number;
  consumed: number;
  remaining: number;
  percentUsed: number;
  depleted: boolean;
  isOverdraftAdvanced: boolean;
  ledger: {
    legs: LegSnapshot;
    lesserLegPV: number;
    epBalance: number;
    swappableGas: number;
    gasPerPV: number;
    gasPerEP: number;
  };
};

export type GasAccount = {
  id: string;
  email: string;
  epBalance: number;
  tokenQuota: QuotaSnapshot | null;
  legBalance: LegSnapshot | null;
};

export type OverdraftSwapResult =
  | {
      ok: true;
      mode: 'REAL_SWAP' | 'ADVANCE' | 'HYBRID';
      swappedGas: number;
      gasFromLesser: number;
      gasFromGreater: number;
      gasFromEP: number;
      gasFromAdvance: number;
      pvUsed: number;
      epUsed: number;
      quota: GasQuotaView;
    }
  | {
      ok: false;
      code: 'NO_QUOTA' | 'ALREADY_ADVANCED' | 'NO_SWAP_SOURCE';
      message: string;
      quota?: GasQuotaView;
    };

export async function loadGasAccountByEmail(email: string): Promise<GasAccount | null> {
  return prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      epBalance: true,
      tokenQuota: { select: { allocated: true, consumed: true, isOverdraftAdvanced: true } },
      legBalance: { select: { leftPV: true, rightPV: true, leftBV: true, rightBV: true } },
    },
  });
}

export function quotaView(account: GasAccount, quota = account.tokenQuota): GasQuotaView {
  if (!quota) throw new Error('TokenQuota가 없습니다.');
  const allocated = Number(quota.allocated);
  const consumed = Number(quota.consumed);
  const remaining = Math.max(0, allocated - consumed);
  const legs = account.legBalance ?? { leftPV: 0, rightPV: 0, leftBV: 0, rightBV: 0 };
  return {
    email: account.email,
    allocated,
    consumed,
    remaining,
    percentUsed: allocated > 0 ? Math.min(100, (consumed / allocated) * 100) : 0,
    depleted: remaining <= 0,
    isOverdraftAdvanced: quota.isOverdraftAdvanced,
    ledger: {
      legs,
      lesserLegPV: Math.min(legs.leftPV, legs.rightPV),
      epBalance: account.epBalance,
      swappableGas: Math.floor((legs.leftPV + legs.rightPV) * GAS_PER_PV) + Math.floor(account.epBalance * GAS_PER_EP),
      gasPerPV: GAS_PER_PV,
      gasPerEP: GAS_PER_EP,
    },
  };
}

async function safeSetQuotaCache(userId: string, remaining: number) {
  try {
    await redis.set(quotaKey(userId), Math.trunc(remaining).toString(), 'EX', QUOTA_TTL_SEC);
  } catch {
    // Redis is an acceleration layer. The database transaction above remains the source of truth.
  }
}

export async function refreshQuotaCache(userId: string, quota: QuotaSnapshot): Promise<number> {
  const remaining = Math.max(0, Number(quota.allocated - quota.consumed));
  await safeSetQuotaCache(userId, remaining);
  return remaining;
}

export async function consumeGasWithCache(userId: string, gas: number, txType: string): Promise<QuotaSnapshot> {
  const amount = Math.max(0, Math.trunc(Number(gas) || 0));
  const updated = await prisma.$transaction(async (tx) => {
    const q = await tx.tokenQuota.update({
      where: { userId },
      data: { consumed: { increment: BigInt(amount) } },
      select: { allocated: true, consumed: true, isOverdraftAdvanced: true },
    });
    if (amount > 0) {
      await tx.transaction.create({
        data: { userId, txType, amount, pvGenerated: 0, bvGenerated: 0 },
      });
    }
    return q;
  });
  await refreshQuotaCache(userId, updated);
  return updated;
}

export async function executeOverdraftLedgerSwap(userId: string, requestedGas = PROTOTYPE_ADVANCE_GAS): Promise<OverdraftSwapResult> {
  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      epBalance: true,
      tokenQuota: { select: { allocated: true, consumed: true, isOverdraftAdvanced: true } },
      legBalance: { select: { leftPV: true, rightPV: true, leftBV: true, rightBV: true } },
    },
  });
  if (!account || !account.tokenQuota) {
    return { ok: false, code: 'NO_QUOTA', message: 'TokenQuota가 없습니다.' };
  }

  const before = quotaView(account);
  const deficit = Math.max(0, before.consumed - before.allocated);
  const targetGas = Math.max(1, Math.min(PROTOTYPE_ADVANCE_GAS, Math.trunc(requestedGas || PROTOTYPE_ADVANCE_GAS) + deficit));
  const legs = before.ledger.legs;
  const leftIsLesser = legs.leftPV <= legs.rightPV;
  const lesserPV = Math.min(legs.leftPV, legs.rightPV);
  const greaterPV = Math.max(legs.leftPV, legs.rightPV);
  let rest = targetGas;

  const takeGas = (availableGas: number) => {
    const gas = Math.max(0, Math.min(rest, Math.floor(availableGas)));
    rest -= gas;
    return gas;
  };

  const gasFromLesser = takeGas(lesserPV * GAS_PER_PV);
  const gasFromGreater = takeGas(greaterPV * GAS_PER_PV);
  const gasFromEP = takeGas(account.epBalance * GAS_PER_EP);

  let gasFromAdvance = 0;
  if (rest > 0 && !account.tokenQuota.isOverdraftAdvanced) {
    gasFromAdvance = takeGas(PROTOTYPE_ADVANCE_GAS);
  }

  const swappedGas = gasFromLesser + gasFromGreater + gasFromEP + gasFromAdvance;
  if (swappedGas <= 0) {
    return {
      ok: false,
      code: account.tokenQuota.isOverdraftAdvanced ? 'ALREADY_ADVANCED' : 'NO_SWAP_SOURCE',
      message: account.tokenQuota.isOverdraftAdvanced
        ? '이미 선지급된 오버드래프트가 있습니다. 실적 또는 EP 충전 후 재시도하세요.'
        : '스왑 가능한 PV/EP/선지급 가스가 없습니다.',
      quota: before,
    };
  }

  const pvFromLesser = gasFromLesser / GAS_PER_PV;
  const pvFromGreater = gasFromGreater / GAS_PER_PV;
  const epUsed = gasFromEP / GAS_PER_EP;
  const leftPVDecrement = leftIsLesser ? pvFromLesser : pvFromGreater;
  const rightPVDecrement = leftIsLesser ? pvFromGreater : pvFromLesser;
  const nextConsumed = BigInt(Math.max(0, before.consumed - swappedGas));

  const updatedAccount = await prisma.$transaction(async (tx) => {
    if (account.legBalance && (leftPVDecrement > 0 || rightPVDecrement > 0)) {
      await tx.legBalance.update({
        where: { userId },
        data: {
          leftPV: { decrement: leftPVDecrement },
          rightPV: { decrement: rightPVDecrement },
        },
      });
    }
    if (epUsed > 0) {
      await tx.user.update({ where: { id: userId }, data: { epBalance: { decrement: epUsed } } });
    }
    await tx.tokenQuota.update({
      where: { userId },
      data: {
        consumed: nextConsumed,
        ...(gasFromAdvance > 0 ? { isOverdraftAdvanced: true } : {}),
      },
    });
    await tx.transaction.create({
      data: {
        userId,
        txType: gasFromAdvance > 0 && swappedGas > gasFromAdvance ? 'OVERDRAFT_GAS_HYBRID' : gasFromAdvance > 0 ? 'OVERDRAFT_GAS_ADVANCE' : 'OVERDRAFT_GAS',
        amount: swappedGas,
        pvGenerated: pvFromLesser + pvFromGreater,
        bvGenerated: 0,
      },
    });
    return tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        epBalance: true,
        tokenQuota: { select: { allocated: true, consumed: true, isOverdraftAdvanced: true } },
        legBalance: { select: { leftPV: true, rightPV: true, leftBV: true, rightBV: true } },
      },
    });
  });

  const quota = quotaView(updatedAccount);
  if (updatedAccount.tokenQuota) await refreshQuotaCache(userId, updatedAccount.tokenQuota);

  return {
    ok: true,
    mode: gasFromAdvance > 0 && swappedGas > gasFromAdvance ? 'HYBRID' : gasFromAdvance > 0 ? 'ADVANCE' : 'REAL_SWAP',
    swappedGas,
    gasFromLesser,
    gasFromGreater,
    gasFromEP,
    gasFromAdvance,
    pvUsed: pvFromLesser + pvFromGreater,
    epUsed,
    quota,
  };
}
