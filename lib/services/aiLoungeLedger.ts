import { prisma } from '@/lib/prisma';
import { redis, QUOTA_TTL_SEC, quotaKey } from '@/lib/redis';
import {
  consumeGasWithCache,
  executeOverdraftLedgerSwap,
  loadGasAccountByEmail,
  quotaView,
  type GasQuotaView,
} from '@/lib/services/overdraftLedger';
import { DualShieldMLMEngine } from '@/lib/services/binaryEngine';

export type LoungeEngineKey = 'gemini-pro' | 'chatgpt-codex' | 'claude-cursor' | 'kimi-moonshot';

export type LoungeEngineProfile = {
  key: LoungeEngineKey;
  label: string;
  gasCost: number;
  maxTokens: number;
};

export const AI_LOUNGE_ENGINE_PROFILES: Record<LoungeEngineKey, LoungeEngineProfile> = {
  'gemini-pro': {
    key: 'gemini-pro',
    label: 'Gemini 3.1 / 3.5 Pro',
    gasCost: 12_000,
    maxTokens: 1_400,
  },
  'chatgpt-codex': {
    key: 'chatgpt-codex',
    label: 'ChatGPT & OpenAI Codex',
    gasCost: 15_000,
    maxTokens: 1_600,
  },
  'claude-cursor': {
    key: 'claude-cursor',
    label: 'Claude Code & Cursor Loop',
    gasCost: 25_000,
    maxTokens: 1_800,
  },
  'kimi-moonshot': {
    key: 'kimi-moonshot',
    label: 'Kimi / Moonshot AI',
    gasCost: 0,
    maxTokens: 1_200,
  },
};

type RollupLeg = 'LEFT' | 'RIGHT';
type RollupTx = { parentId: string; leg: RollupLeg; pvValue: number; bvValue: number };
type LoungeRollupResult = {
  status: 'ok';
  depth: number;
  transactions: RollupTx[];
};

export type LoungeContribution = {
  pvValue: number;
  bvValue: number;
};

export type LoungeBurnResult =
  | {
      ok: true;
      engine: LoungeEngineProfile;
      gasCharged: number;
      quota: GasQuotaView;
      contribution: LoungeContribution;
      rollup: LoungeRollupResult;
    }
  | {
      ok: false;
      status: 'paywall_blocked' | 'render_crash_prevented' | 'tenant_invalid';
      engine: LoungeEngineProfile;
      message: string;
      quota?: GasQuotaView;
      contribution?: LoungeContribution;
      overdraft?: {
        endpoint: '/api/trading/quota';
        action: 'OVERDRAFT_SWAP';
        priority: ['LESSER_LEG_PV', 'GREATER_LEG_PV', 'EP_REWARD_WALLET'];
        requestedGas: number;
      };
    };

const MAX_CONTRIBUTION_VALUE = 1_000_000;
const MAX_ROLLUP_DEPTH = 4096;
const PV_FROM_BURN_RATE = 0.15;

export function normalizeLoungeEngine(input: unknown): LoungeEngineKey {
  const key = typeof input === 'string' ? input.trim().toLowerCase().replace(/_/g, '-') : '';
  if (key in AI_LOUNGE_ENGINE_PROFILES) return key as LoungeEngineKey;
  if (key.includes('claude') || key.includes('cursor')) return 'claude-cursor';
  if (key.includes('kimi') || key.includes('moonshot')) return 'kimi-moonshot';
  if (key.includes('chatgpt') || key.includes('openai') || key.includes('codex')) return 'chatgpt-codex';
  return 'gemini-pro';
}

function strictFiniteAmount(input: unknown, field: 'pvValue' | 'bvValue'): number {
  const value = Number(input);
  if (!Number.isFinite(value)) throw new Error(`${field} must be a finite number.`);
  if (value < 0) throw new Error(`${field} cannot be negative.`);
  if (value > MAX_CONTRIBUTION_VALUE) throw new Error(`${field} exceeds the protected ledger limit.`);
  return Math.floor(value * 10_000) / 10_000;
}

export function normalizeLoungeContribution(input: { pvValue?: unknown; bvValue?: unknown }): LoungeContribution {
  return {
    pvValue: strictFiniteAmount(input.pvValue ?? 0, 'pvValue'),
    bvValue: strictFiniteAmount(input.bvValue ?? 0, 'bvValue'),
  };
}

export function contributionFromBurn(gasCharged: number): LoungeContribution {
  const pvValue = Math.floor(Math.max(0, gasCharged * PV_FROM_BURN_RATE) * 10_000) / 10_000;
  return { pvValue, bvValue: pvValue };
}

async function cachedRemaining(userId: string, allocated: bigint, consumed: bigint): Promise<number> {
  try {
    const cached = await redis.get(quotaKey(userId));
    if (cached !== null) {
      const parsed = Number.parseInt(cached, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  } catch {
    // Redis is only a fast gate. The durable ledger is Prisma.
  }
  const remaining = Math.max(0, Number(allocated - consumed));
  try {
    await redis.set(quotaKey(userId), String(remaining), 'EX', QUOTA_TTL_SEC);
  } catch {
    // Cache warm failure must never block prompt execution.
  }
  return remaining;
}

async function rollUpAiLoungeContribution(
  originUserId: string,
  contribution: LoungeContribution,
  gasCharged: number
): Promise<LoungeRollupResult> {
  if (contribution.pvValue <= 0 && contribution.bvValue <= 0) {
    return { status: 'ok', depth: 0, transactions: [] };
  }

  const transactions = await prisma.$transaction(async (tx) => {
    const created: RollupTx[] = [];
    let node = await tx.user.findUnique({
      where: { id: originUserId },
      select: { parentId: true, position: true },
    });
    let depth = 0;
    const visited = new Set<string>();

    while (node?.parentId && depth < MAX_ROLLUP_DEPTH) {
      const parentId = node.parentId;
      const leg = node.position === 'RIGHT' ? 'RIGHT' : node.position === 'LEFT' ? 'LEFT' : null;
      if (!leg || visited.has(parentId)) break;

      visited.add(parentId);
      await tx.legBalance.upsert({
        where: { userId: parentId },
        update:
          leg === 'LEFT'
            ? { leftPV: { increment: contribution.pvValue }, leftBV: { increment: contribution.bvValue } }
            : { rightPV: { increment: contribution.pvValue }, rightBV: { increment: contribution.bvValue } },
        create: {
          userId: parentId,
          leftPV: leg === 'LEFT' ? contribution.pvValue : 0,
          leftBV: leg === 'LEFT' ? contribution.bvValue : 0,
          rightPV: leg === 'RIGHT' ? contribution.pvValue : 0,
          rightBV: leg === 'RIGHT' ? contribution.bvValue : 0,
        },
      });
      await tx.transaction.create({
        data: {
          userId: parentId,
          txType: 'TOKEN_PURCHASE',
          amount: gasCharged,
          pvGenerated: contribution.pvValue,
          bvGenerated: contribution.bvValue,
        },
      });
      created.push({ parentId, leg, pvValue: contribution.pvValue, bvValue: contribution.bvValue });

      node = await tx.user.findUnique({
        where: { id: parentId },
        select: { parentId: true, position: true },
      });
      depth++;
    }

    return created;
  });

  for (const tx of transactions) {
    try {
      await DualShieldMLMEngine.settleMatchingBonus(tx.parentId);
    } catch (error) {
      console.error('[ai-lounge] Dual-Shield settlement isolated:', error);
    }
  }

  return { status: 'ok', depth: transactions.length, transactions };
}

export async function reserveAiLoungeBurn(args: {
  email: string;
  engine: LoungeEngineKey;
  pvValue: unknown;
  bvValue: unknown;
}): Promise<LoungeBurnResult> {
  const engine = AI_LOUNGE_ENGINE_PROFILES[args.engine];
  let contribution: LoungeContribution;

  try {
    contribution = normalizeLoungeContribution({ pvValue: args.pvValue, bvValue: args.bvValue });
  } catch (error) {
    return {
      ok: false,
      status: 'render_crash_prevented',
      engine,
      message: error instanceof Error ? error.message : 'Malformed PV/BV packet prevented.',
    };
  }

  try {
    const account = await loadGasAccountByEmail(args.email);
    if (!account || !account.tokenQuota) {
      return {
        ok: false,
        status: 'tenant_invalid',
        engine,
        message: account ? 'TokenQuota가 없습니다.' : '가입되지 않은 이메일입니다.',
        contribution,
      };
    }

    if (engine.gasCost <= 0) {
      const rollup = await rollUpAiLoungeContribution(account.id, contribution, 0);
      const fresh = await loadGasAccountByEmail(args.email);
      return {
        ok: true,
        engine,
        gasCharged: 0,
        quota: fresh?.tokenQuota ? quotaView(fresh) : quotaView(account),
        contribution,
        rollup,
      };
    }

    let remaining = await cachedRemaining(account.id, account.tokenQuota.allocated, account.tokenQuota.consumed);
    if (remaining - engine.gasCost <= 0) {
      const swap = await executeOverdraftLedgerSwap(account.id, engine.gasCost);
      if (swap.ok) remaining = swap.quota.remaining;
      if (!swap.ok || remaining - engine.gasCost <= 0) {
        return {
          ok: false,
          status: 'paywall_blocked',
          engine,
          message: swap.ok
            ? '오버드래프트 후에도 이 엔진 실행에 필요한 가스가 부족합니다.'
            : swap.message,
          quota: swap.ok ? swap.quota : swap.quota ?? quotaView(account),
          contribution,
          overdraft: {
            endpoint: '/api/trading/quota',
            action: 'OVERDRAFT_SWAP',
            priority: ['LESSER_LEG_PV', 'GREATER_LEG_PV', 'EP_REWARD_WALLET'],
            requestedGas: engine.gasCost,
          },
        };
      }
    }

    const updatedQuota = await consumeGasWithCache(
      account.id,
      engine.gasCost,
      `AI_LOUNGE_${engine.key.toUpperCase().replace(/-/g, '_')}_BURN`
    );
    const rollup = await rollUpAiLoungeContribution(account.id, contribution, engine.gasCost);
    const fresh = await loadGasAccountByEmail(args.email);

    return {
      ok: true,
      engine,
      gasCharged: engine.gasCost,
      quota: fresh?.tokenQuota ? quotaView(fresh) : quotaView(account, updatedQuota),
      contribution,
      rollup,
    };
  } catch (error) {
    console.error('[ai-lounge] protected burn failed:', error);
    return {
      ok: false,
      status: 'render_crash_prevented',
      engine,
      message: error instanceof Error ? error.message : 'AI Lounge ledger packet was isolated.',
      contribution,
    };
  }
}

export async function auditAiLoungeAccess(args: {
  email: string;
  engine: LoungeEngineKey;
}): Promise<
  | { ok: true; engine: LoungeEngineProfile; quota: GasQuotaView; gasCost: number }
  | {
      ok: false;
      status: 'paywall_blocked' | 'tenant_invalid' | 'render_crash_prevented';
      engine: LoungeEngineProfile;
      message: string;
      quota?: GasQuotaView;
      overdraft?: {
        endpoint: '/api/trading/quota';
        action: 'OVERDRAFT_SWAP';
        priority: ['LESSER_LEG_PV', 'GREATER_LEG_PV', 'EP_REWARD_WALLET'];
        requestedGas: number;
      };
    }
> {
  const engine = AI_LOUNGE_ENGINE_PROFILES[args.engine];
  try {
    const account = await loadGasAccountByEmail(args.email);
    if (!account || !account.tokenQuota) {
      return {
        ok: false,
        status: 'tenant_invalid',
        engine,
        message: account ? 'TokenQuota가 없습니다.' : '가입되지 않은 이메일입니다.',
      };
    }

    if (engine.gasCost <= 0) {
      return { ok: true, engine, gasCost: 0, quota: quotaView(account) };
    }

    let remaining = await cachedRemaining(account.id, account.tokenQuota.allocated, account.tokenQuota.consumed);
    if (remaining - engine.gasCost <= 0) {
      const swap = await executeOverdraftLedgerSwap(account.id, engine.gasCost);
      if (swap.ok) remaining = swap.quota.remaining;
      if (!swap.ok || remaining - engine.gasCost <= 0) {
        return {
          ok: false,
          status: 'paywall_blocked',
          engine,
          message: swap.ok
            ? '오버드래프트 후에도 이 엔진 실행에 필요한 가스가 부족합니다.'
            : swap.message,
          quota: swap.ok ? swap.quota : swap.quota ?? quotaView(account),
          overdraft: {
            endpoint: '/api/trading/quota',
            action: 'OVERDRAFT_SWAP',
            priority: ['LESSER_LEG_PV', 'GREATER_LEG_PV', 'EP_REWARD_WALLET'],
            requestedGas: engine.gasCost,
          },
        };
      }
      return { ok: true, engine, gasCost: engine.gasCost, quota: swap.quota };
    }

    return { ok: true, engine, gasCost: engine.gasCost, quota: quotaView(account) };
  } catch (error) {
    console.error('[ai-lounge] access audit failed:', error);
    return {
      ok: false,
      status: 'render_crash_prevented',
      engine,
      message: error instanceof Error ? error.message : 'AI Lounge access audit was isolated.',
    };
  }
}

export async function commitAiLoungeSuccessfulBurn(args: {
  email: string;
  engine: LoungeEngineKey;
}): Promise<LoungeBurnResult> {
  const engine = AI_LOUNGE_ENGINE_PROFILES[args.engine];
  const contribution = contributionFromBurn(engine.gasCost);

  try {
    const account = await loadGasAccountByEmail(args.email);
    if (!account || !account.tokenQuota) {
      return {
        ok: false,
        status: 'tenant_invalid',
        engine,
        message: account ? 'TokenQuota가 없습니다.' : '가입되지 않은 이메일입니다.',
        contribution,
      };
    }

    const updatedQuota =
      engine.gasCost > 0
        ? await consumeGasWithCache(
            account.id,
            engine.gasCost,
            `AI_LOUNGE_${engine.key.toUpperCase().replace(/-/g, '_')}_SUCCESS_BURN`
          )
        : account.tokenQuota;
    const rollup = await rollUpAiLoungeContribution(account.id, contribution, engine.gasCost);
    const fresh = await loadGasAccountByEmail(args.email);

    return {
      ok: true,
      engine,
      gasCharged: engine.gasCost,
      quota: fresh?.tokenQuota ? quotaView(fresh) : quotaView(account, updatedQuota),
      contribution,
      rollup,
    };
  } catch (error) {
    console.error('[ai-lounge] successful burn commit failed:', error);
    return {
      ok: false,
      status: 'render_crash_prevented',
      engine,
      message: error instanceof Error ? error.message : 'AI Lounge successful burn was isolated.',
      contribution,
    };
  }
}
