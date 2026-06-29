// POST /api/mobile-order-signal
// The GPU bridge POSTs the latest manual-order ticket here (authenticated by a
// shared secret that is NOT an exchange key and is NEVER sent to the browser).
// This endpoint only STORES a display signal. It places no order and calls no
// exchange/private API.
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { validateSignal } from '@/lib/mobileSignalSchema';
import { saveSignal } from '@/lib/mobileSignalStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.EDEN_MOBILE_SIGNAL_SECRET;
  if (!secret) return false; // never accept writes if no secret configured
  const bearer = req.headers.get('authorization');
  if (bearer && bearer.startsWith('Bearer ')) {
    if (timingSafeEqual(bearer.slice(7).trim(), secret)) return true;
  }
  const headerSecret =
    req.headers.get('x-eden-mobile-signal-secret') ??
    req.headers.get('x-eden-signal-secret');
  if (headerSecret && timingSafeEqual(headerSecret.trim(), secret)) return true;
  return false;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: 'unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const result = validateSignal(body);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: 'invalid_payload', details: result.errors }, { status: 400 });
  }

  const saved = await saveSignal(result.value);
  if (!saved.ok) {
    return NextResponse.json(
      {
        ok: false,
        status: 'STORAGE_NOT_CONFIGURED',
        message: 'Signal was validated, but durable mobile signal storage is not configured.',
        bot_order_execution: 'DISABLED',
        real_order_sent_by_bot: false,
        user_must_place_order_manually: true,
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      stored: true,
      backend: saved.backend,
      ticket_status: result.value.ticket_status,
      received_at: result.value.received_at,
      note: 'Display signal stored. Bot places no order; user must order manually.',
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}

// Reads happen at /api/mobile-order-signal/latest. Reject other verbs explicitly.
export function GET() {
  return NextResponse.json(
    { ok: false, error: 'use GET /api/mobile-order-signal/latest' },
    { status: 405 },
  );
}
