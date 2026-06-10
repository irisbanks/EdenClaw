import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAtpRuntime, publishAgentLog, publishIntent } from '@/lib/engine/runtime';
import type { BuyIntent, SellIntent } from '@/lib/engine/match-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type IntentSide = 'buy' | 'sell';

interface IntentRequest {
  side?: IntentSide;
  intentText?: string;
  itemDescription?: string;
  product_fingerprint?: string;
  fingerprint_vector?: number[];
  budget?: number;
  minAcceptPrice?: number;
  min_accept_price?: number;
  price?: number;
  agentId?: string;
  demoCounterparty?: boolean;
}

function nowMs(): number {
  if (typeof performance !== 'undefined') return performance.now();
  return Date.now();
}

function parsePrice(text: string, fallback: number): number {
  const normalized = text.replace(/,/g, '');
  const man = normalized.match(/(\d+(?:\.\d+)?)\s*(만원|만)/);
  if (man) return Math.round(Number(man[1]) * 10_000);
  const won = normalized.match(/(\d{5,})\s*원?/);
  if (won) return Number(won[1]);
  return fallback;
}

function inferItemDescription(body: IntentRequest): string {
  const text = body.itemDescription || body.intentText || '';
  const first = text.split(/[,\n]/)[0]?.trim();
  return first || '다이슨 V15 무선청소기';
}

function normalizeFingerprint(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^a-z0-9가-힣+]+/g, ':')
    .replace(/:+/g, ':')
    .replace(/^:|:$/g, '')
    .slice(0, 96);
}

function createBuyIntent(body: IntentRequest, itemDescription: string): BuyIntent {
  const budget = Number(body.budget) > 0
    ? Number(body.budget)
    : parsePrice(body.intentText || itemDescription, 400_000);
  return {
    type: 'BUY_INTENT',
    intentId: `buy_${randomUUID()}`,
    agentId: body.agentId || `buyer_web_${randomUUID().slice(0, 8)}`,
    product_fingerprint: body.product_fingerprint || normalizeFingerprint(itemDescription),
    fingerprint_vector: body.fingerprint_vector,
    budget,
    required_margin_pct: 5,
    desiredSpec: { title: itemDescription },
    createdAtMs: nowMs(),
  };
}

function createSellIntent(body: IntentRequest, itemDescription: string): SellIntent {
  const minAcceptPrice = Number(body.minAcceptPrice || body.min_accept_price || body.price) > 0
    ? Number(body.minAcceptPrice || body.min_accept_price || body.price)
    : parsePrice(body.intentText || itemDescription, 500_000);
  return {
    type: 'SELL_INTENT',
    intentId: `sell_${randomUUID()}`,
    agentId: body.agentId || `seller_web_${randomUUID().slice(0, 8)}`,
    product_fingerprint: body.product_fingerprint || normalizeFingerprint(itemDescription),
    fingerprint_vector: body.fingerprint_vector,
    min_accept_price: minAcceptPrice,
    productSpec: { title: itemDescription },
    createdAtMs: nowMs(),
  };
}

function createDemoCounterparty(intent: BuyIntent | SellIntent): BuyIntent | SellIntent {
  if (intent.type === 'BUY_INTENT') {
    return {
      type: 'SELL_INTENT',
      intentId: `sell_demo_${randomUUID()}`,
      agentId: `seller_demo_${randomUUID().slice(0, 8)}`,
      product_fingerprint: intent.product_fingerprint,
      fingerprint_vector: intent.fingerprint_vector,
      min_accept_price: Math.max(1, Math.floor(intent.budget * 0.92)),
      productSpec: intent.desiredSpec,
      createdAtMs: nowMs(),
    };
  }

  return {
    type: 'BUY_INTENT',
    intentId: `buy_demo_${randomUUID()}`,
    agentId: `buyer_demo_${randomUUID().slice(0, 8)}`,
    product_fingerprint: intent.product_fingerprint,
    fingerprint_vector: intent.fingerprint_vector,
    budget: Math.ceil(intent.min_accept_price * 1.08),
    required_margin_pct: 5,
    desiredSpec: intent.productSpec,
    createdAtMs: nowMs(),
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as IntentRequest;
    const side: IntentSide = body.side === 'sell' ? 'sell' : 'buy';
    const itemDescription = inferItemDescription(body);
    const intent = side === 'sell'
      ? createSellIntent(body, itemDescription)
      : createBuyIntent(body, itemDescription);

    await getAtpRuntime();
    await publishAgentLog({
      source: 'API-Gateway',
      tone: 'blue',
      intentId: intent.intentId,
      message: `${intent.type} 수신 — ${itemDescription}`,
    });
    await publishIntent(intent);
    await publishAgentLog({
      source: 'ATP-Broker',
      tone: 'green',
      intentId: intent.intentId,
      message: `${intent.type} broker publish 완료.`,
    });

    let counterparty: BuyIntent | SellIntent | null = null;
    if (body.demoCounterparty !== false) {
      counterparty = createDemoCounterparty(intent);
      await publishAgentLog({
        source: 'Demo-Agent',
        tone: 'amber',
        intentId: counterparty.intentId,
        message: `매칭 검증용 반대편 ${counterparty.type} 생성.`,
      });
      await publishIntent(counterparty);
    }

    const runtimeState = await getAtpRuntime();
    return NextResponse.json({
      ok: true,
      published: intent,
      demoCounterparty: counterparty,
      stats: runtimeState.engine.getStats(),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
