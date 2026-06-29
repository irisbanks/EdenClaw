// GET /api/mobile-order-signal/latest
// Public read endpoint the phone polls every ~15-20s. Returns the latest display
// signal or { status: 'NO_SIGNAL' }. Contains no secret and no order capability.
import { NextResponse } from 'next/server';
import { getLatestSignal } from '@/lib/mobileSignalStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const env = await getLatestSignal();
  return NextResponse.json(env, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
