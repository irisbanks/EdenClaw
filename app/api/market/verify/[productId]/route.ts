import { NextRequest, NextResponse } from 'next/server';
import { verifyProduct } from '@/lib/market/verification-engine';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const { productId } = await params;

  try {
    const result = await verifyProduct(productId);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '검증 실패';
    console.error(`[API/verify] 에러: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
