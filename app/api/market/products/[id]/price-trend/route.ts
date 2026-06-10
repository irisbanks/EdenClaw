import { NextRequest, NextResponse } from 'next/server';
import { analyzePriceTrend } from '@/lib/market/price-trend-engine';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: productId } = await params;

  try {
    const result = await analyzePriceTrend(productId);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '가격 트렌드 분석 실패';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
