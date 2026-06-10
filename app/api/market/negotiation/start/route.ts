import { NextRequest } from 'next/server';
import { createNegotiationStream } from '@/lib/market/negotiation-engine';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    productId?: string;
    buyerId?: string;
    targetPrice?: number;
  };

  const { productId, buyerId, targetPrice } = body;
  if (!productId) {
    return new Response(JSON.stringify({ error: 'productId가 필요합니다' }), { status: 400 });
  }

  console.log(`[API/negotiation] 시작: productId=${productId}, buyerId=${buyerId}`);

  const stream = createNegotiationStream({ productId, buyerId, targetPrice });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
