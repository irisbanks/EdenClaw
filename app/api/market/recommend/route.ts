import { NextRequest, NextResponse } from 'next/server';
import { recommend } from '@/lib/market/recommendation-engine';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId') || undefined;
  const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 20);

  const result = await recommend({ userId, limit });
  return NextResponse.json(result);
}
