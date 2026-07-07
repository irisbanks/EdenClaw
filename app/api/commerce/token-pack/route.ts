import { NextResponse } from 'next/server';
import { purchaseTokenPack, TOKEN_PACKS } from '@/lib/services/tokenPacks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ok: true, packs: TOKEN_PACKS });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const packId = body.packId;

  if (!email) {
    return NextResponse.json({ ok: false, error: 'email 이 필요합니다.' }, { status: 400 });
  }

  const result = await purchaseTokenPack({ email, packId });
  if (!result.ok) {
    const status = result.status === 'pack_invalid' ? 400 : 404;
    return NextResponse.json({ ...result, error: result.message }, { status });
  }

  return NextResponse.json({ ok: true, pack: result.pack, quota: result.quota });
}
