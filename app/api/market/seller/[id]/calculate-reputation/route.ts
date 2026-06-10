import { NextRequest, NextResponse } from 'next/server';
import { calculateReputation } from '@/lib/market/reputation-engine';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sellerId } = await params;

  try {
    const result = await calculateReputation(sellerId);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '평판 계산 실패';
    return NextResponse.json({ error: msg }, { status: msg.includes('없음') ? 404 : 500 });
  }
}
