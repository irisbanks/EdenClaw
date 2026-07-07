import { NextResponse } from 'next/server';
import { purchaseExternalPremiumProduct } from '@/lib/services/externalPremiumProducts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const productId = body.productId;

  if (!email) {
    return NextResponse.json({ ok: false, error: 'email 이 필요합니다.' }, { status: 400 });
  }

  const result = await purchaseExternalPremiumProduct({ email, productId });
  if (!result.ok) {
    const status = result.status === 'tenant_invalid' || result.status === 'product_invalid' ? 400 : 500;
    return NextResponse.json({ ...result, error: result.message }, { status });
  }

  return NextResponse.json({
    ok: true,
    product: result.product,
    transactionId: result.buyerTransactionId,
    quota: result.quota,
    rollup: result.rollup,
    activationEligible: true,
  });
}
