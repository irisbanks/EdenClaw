import { prisma } from '@/lib/prisma';
import { DualShieldMLMEngine } from '@/lib/services/binaryEngine';
import { loadGasAccountByEmail, quotaView, type GasQuotaView } from '@/lib/services/overdraftLedger';

export type ExternalPremiumProductId =
  | 'external-ai-gemini-pro-18m'
  | 'external-ai-youtube-premium-12m'
  | 'external-ai-youtube-gemini-infra-pack';

export type ExternalPremiumProduct = {
  id: ExternalPremiumProductId;
  name: string;
  title: string;
  description: string;
  price: number;
  pvValue: number;
  bvValue: number;
};

export type ExternalPremiumPurchaseResult =
  | {
      ok: true;
      product: ExternalPremiumProduct;
      buyerTransactionId: string;
      quota: GasQuotaView;
      rollup: {
        depth: number;
        touchedParents: string[];
      };
    }
  | {
      ok: false;
      status: 'tenant_invalid' | 'product_invalid' | 'render_crash_prevented';
      message: string;
    };

export const EXTERNAL_PREMIUM_PRODUCTS: ExternalPremiumProduct[] = [
  {
    id: 'external-ai-gemini-pro-18m',
    name: 'Gemini Pro 18-Month Package',
    title: 'Gemini Pro 18-Month Package',
    description: 'External premium Gemini Pro binding package for EdenClaw AI Lounge enterprise sessions.',
    price: 59_800,
    pvValue: 45.0,
    bvValue: 36.0,
  },
  {
    id: 'external-ai-youtube-premium-12m',
    name: 'YouTube Premium 12-Month Package',
    title: 'YouTube Premium 12-Month Package',
    description: 'External YouTube Premium annual binding package for family and invite subscription flows.',
    price: 64_800,
    pvValue: 50.0,
    bvValue: 40.0,
  },
  {
    id: 'external-ai-youtube-gemini-infra-pack',
    name: 'Combined YouTube + Gemini Total Infrastructure Pack',
    title: 'Combined YouTube + Gemini Total Infrastructure Pack',
    description: 'Combined YouTube Premium and Gemini Pro infrastructure package for full AI Lounge activation.',
    price: 118_900,
    pvValue: 95.0,
    bvValue: 76.0,
  },
];

const PRODUCT_IDS = new Set(EXTERNAL_PREMIUM_PRODUCTS.map((product) => product.id));
const MAX_ROLLUP_DEPTH = 4096;

function asExternalProductId(value: unknown): ExternalPremiumProductId | null {
  if (typeof value !== 'string') return null;
  return PRODUCT_IDS.has(value as ExternalPremiumProductId) ? (value as ExternalPremiumProductId) : null;
}

function productTags(product: ExternalPremiumProduct) {
  return JSON.stringify([
    'external-ai',
    'premium-subscription',
    'prekart-family-invite',
    product.id,
  ]);
}

async function ensureExternalPremiumProductColumns() {
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      CREATE TYPE "ProductType" AS ENUM ('PHYSICAL', 'DIGITAL');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;
  `);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "name" TEXT NOT NULL DEFAULT ''`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "type" "ProductType" NOT NULL DEFAULT 'PHYSICAL'`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "pvValue" DOUBLE PRECISION NOT NULL DEFAULT 0`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "bvValue" DOUBLE PRECISION NOT NULL DEFAULT 0`);
}

export async function ensureExternalPremiumProducts(): Promise<ExternalPremiumProduct[]> {
  await ensureExternalPremiumProductColumns();
  await prisma.$transaction(
    EXTERNAL_PREMIUM_PRODUCTS.map((product) =>
      prisma.product.upsert({
        where: { id: product.id },
        update: {
          name: product.name,
          title: product.title,
          description: product.description,
          type: 'DIGITAL',
          price: product.price,
          pvValue: product.pvValue,
          bvValue: product.bvValue,
          currency: 'KRW',
          category: 'external_ai_subscription',
          tags: productTags(product),
          sellerName: 'EdenClaw Premium Infrastructure',
          sellerRating: 5,
          stock: 999_999,
          status: 'active',
        },
        create: {
          id: product.id,
          name: product.name,
          title: product.title,
          description: product.description,
          type: 'DIGITAL',
          price: product.price,
          pvValue: product.pvValue,
          bvValue: product.bvValue,
          currency: 'KRW',
          category: 'external_ai_subscription',
          tags: productTags(product),
          images: '[]',
          sellerName: 'EdenClaw Premium Infrastructure',
          sellerRating: 5,
          stock: 999_999,
          status: 'active',
          region: 'GLOBAL',
        },
      })
    )
  );
  return EXTERNAL_PREMIUM_PRODUCTS;
}

export async function getExternalPremiumProduct(productId: unknown): Promise<ExternalPremiumProduct | null> {
  const id = asExternalProductId(productId);
  if (!id) return null;
  await ensureExternalPremiumProducts();
  return EXTERNAL_PREMIUM_PRODUCTS.find((product) => product.id === id) ?? null;
}

async function rollUpExternalPremiumPurchase(originUserId: string, product: ExternalPremiumProduct) {
  const touchedParents = await prisma.$transaction(async (tx) => {
    const touched: string[] = [];
    const visited = new Set<string>();
    let node = await tx.user.findUnique({
      where: { id: originUserId },
      select: { parentId: true, position: true },
    });
    let depth = 0;

    while (node?.parentId && depth < MAX_ROLLUP_DEPTH) {
      const parentId = node.parentId;
      const leg = node.position === 'LEFT' || node.position === 'RIGHT' ? node.position : null;
      if (!leg || visited.has(parentId)) break;

      visited.add(parentId);
      await tx.legBalance.upsert({
        where: { userId: parentId },
        update:
          leg === 'LEFT'
            ? { leftPV: { increment: product.pvValue }, leftBV: { increment: product.bvValue } }
            : { rightPV: { increment: product.pvValue }, rightBV: { increment: product.bvValue } },
        create: {
          userId: parentId,
          leftPV: leg === 'LEFT' ? product.pvValue : 0,
          leftBV: leg === 'LEFT' ? product.bvValue : 0,
          rightPV: leg === 'RIGHT' ? product.pvValue : 0,
          rightBV: leg === 'RIGHT' ? product.bvValue : 0,
        },
      });
      await tx.transaction.create({
        data: {
          userId: parentId,
          txType: 'TOKEN_PURCHASE',
          amount: product.price,
          pvGenerated: product.pvValue,
          bvGenerated: product.bvValue,
        },
      });
      touched.push(parentId);

      node = await tx.user.findUnique({
        where: { id: parentId },
        select: { parentId: true, position: true },
      });
      depth++;
    }
    return touched;
  });

  for (const parentId of touchedParents) {
    try {
      await DualShieldMLMEngine.settleMatchingBonus(parentId);
    } catch (error) {
      console.error('[external-premium-products] Dual-Shield settlement isolated:', error);
    }
  }

  return { depth: touchedParents.length, touchedParents };
}

export async function purchaseExternalPremiumProduct(args: {
  email: string;
  productId: unknown;
}): Promise<ExternalPremiumPurchaseResult> {
  try {
    const product = await getExternalPremiumProduct(args.productId);
    if (!product) {
      return { ok: false, status: 'product_invalid', message: 'Unknown external premium AI package.' };
    }

    const account = await loadGasAccountByEmail(args.email);
    if (!account || !account.tokenQuota) {
      return {
        ok: false,
        status: 'tenant_invalid',
        message: account ? 'TokenQuota가 없습니다.' : '가입되지 않은 이메일입니다.',
      };
    }

    const buyerTransaction = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: account.id },
        data: { subscriptionStatus: 'ACTIVE' },
      });
      return tx.transaction.create({
        data: {
          userId: account.id,
          txType: 'TOKEN_PURCHASE',
          amount: product.price,
          pvGenerated: product.pvValue,
          bvGenerated: product.bvValue,
        },
      });
    });

    const rollup = await rollUpExternalPremiumPurchase(account.id, product);
    const fresh = await loadGasAccountByEmail(args.email);

    return {
      ok: true,
      product,
      buyerTransactionId: buyerTransaction.id,
      quota: fresh?.tokenQuota ? quotaView(fresh) : quotaView(account),
      rollup,
    };
  } catch (error) {
    console.error('[external-premium-products] purchase failed:', error);
    return {
      ok: false,
      status: 'render_crash_prevented',
      message: error instanceof Error ? error.message : 'External premium package purchase was isolated.',
    };
  }
}

export async function activateExternalPremiumBridge(email: string): Promise<
  | {
      ok: true;
      userId: string;
      email: string;
      source: 'ACTIVE_SUBSCRIPTION';
      boundProduct: ExternalPremiumProduct;
      quota: GasQuotaView;
    }
  | { ok: false; status: 'tenant_invalid' | 'render_crash_prevented'; message: string; products?: ExternalPremiumProduct[] }
> {
  try {
    const products = await ensureExternalPremiumProducts();
    const account = await loadGasAccountByEmail(email);
    if (!account || !account.tokenQuota) {
      return {
        ok: false,
        status: 'tenant_invalid',
        message: account ? 'TokenQuota가 없습니다.' : '가입되지 않은 이메일입니다.',
        products,
      };
    }

    await prisma.user.update({
      where: { id: account.id },
      data: { subscriptionStatus: 'ACTIVE' },
    });

    const fresh = await loadGasAccountByEmail(email);
    return {
      ok: true,
      userId: account.id,
      email: account.email,
      source: 'ACTIVE_SUBSCRIPTION',
      boundProduct: products[0],
      quota: fresh?.tokenQuota ? quotaView(fresh) : quotaView(account),
    };
  } catch (error) {
    console.error('[external-premium-products] bridge activation failed:', error);
    return {
      ok: false,
      status: 'render_crash_prevented',
      message: error instanceof Error ? error.message : 'External premium bridge activation was isolated.',
    };
  }
}

export async function resolveExternalPremiumAccess(email: string): Promise<
  | {
      ok: true;
      userId: string;
      email: string;
      source: 'ACTIVE_SUBSCRIPTION' | 'DIGITAL_PACK';
      boundProduct?: ExternalPremiumProduct;
      quota: GasQuotaView;
    }
  | { ok: false; status: 'tenant_invalid' | 'paywall_blocked' | 'render_crash_prevented'; message: string; products?: ExternalPremiumProduct[] }
> {
  try {
    const products = await ensureExternalPremiumProducts();
    const account = await loadGasAccountByEmail(email);
    if (!account || !account.tokenQuota) {
      return {
        ok: false,
        status: 'tenant_invalid',
        message: account ? 'TokenQuota가 없습니다.' : '가입되지 않은 이메일입니다.',
        products,
      };
    }

    const user = await prisma.user.findUnique({
      where: { id: account.id },
      select: { subscriptionStatus: true },
    });
    if (user?.subscriptionStatus === 'ACTIVE') {
      return {
        ok: true,
        userId: account.id,
        email: account.email,
        source: 'ACTIVE_SUBSCRIPTION',
        boundProduct: products[0],
        quota: quotaView(account),
      };
    }

    const purchase = await prisma.transaction.findFirst({
      where: {
        userId: account.id,
        txType: 'TOKEN_PURCHASE',
        OR: products.map((product) => ({
          amount: product.price,
          pvGenerated: product.pvValue,
          bvGenerated: product.bvValue,
        })),
      },
      orderBy: { createdAt: 'desc' },
    });
    const product = purchase
      ? products.find(
          (item) =>
            item.price === purchase.amount &&
            item.pvValue === purchase.pvGenerated &&
            item.bvValue === purchase.bvGenerated
        )
      : undefined;

    if (!purchase || !product) {
      return {
        ok: false,
        status: 'paywall_blocked',
        message: '외부 프리미엄 AI 디지털 패키지 구매 또는 ACTIVE 구독이 필요합니다.',
        products,
      };
    }

    return {
      ok: true,
      userId: account.id,
      email: account.email,
      source: 'DIGITAL_PACK',
      boundProduct: product,
      quota: quotaView(account),
    };
  } catch (error) {
    console.error('[external-premium-products] activation access failed:', error);
    return {
      ok: false,
      status: 'render_crash_prevented',
      message: error instanceof Error ? error.message : 'External premium activation check was isolated.',
    };
  }
}
