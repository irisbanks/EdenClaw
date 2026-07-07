import { NextResponse } from 'next/server';
import { ensureExternalPremiumProducts } from '@/lib/services/externalPremiumProducts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const products = await ensureExternalPremiumProducts();
    return NextResponse.json({ ok: true, products });
  } catch (error) {
    console.error('[commerce/products]', error);
    return NextResponse.json(
      {
        ok: false,
        status: 'render_crash_prevented',
        error: error instanceof Error ? error.message : 'Product registry binding failed.',
      },
      { status: 500 }
    );
  }
}
