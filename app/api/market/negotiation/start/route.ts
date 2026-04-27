import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';

const VLLM_URL = process.env.LOCAL_AI_URL || 'http://localhost:8000/v1/chat/completions';
const AI_MODEL = process.env.LOCAL_AI_MODEL || 'Qwen/Qwen2.5-72B-Instruct';

async function callAgentAI(systemPrompt: string, userPrompt: string, maxTokens = 300): Promise<string> {
  try {
    const res = await fetch(VLLM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: maxTokens,
        temperature: 0.6,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } catch {
    return '';
  }
}

function extractPrice(text: string, fallback: number): number {
  const m = text.match(/(\d[\d,]*)\s*(ET|원|토큰)?/);
  if (m) {
    const n = parseInt(m[1].replace(/,/g, ''));
    if (!isNaN(n) && n > 0) return n;
  }
  return fallback;
}

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

  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { reviews: { select: { rating: true } } },
  });
  if (!product) {
    return new Response(JSON.stringify({ error: '상품을 찾을 수 없습니다' }), { status: 404 });
  }

  const session = await prisma.negotiationSession.create({
    data: {
      productId,
      buyerId: buyerId || 'anonymous',
      sellerId: product.sellerId || 'seller',
      status: 'active',
      initialPrice: product.price,
      maxTurns: 5,
    },
  });

  const buyerTarget = targetPrice || Math.floor(product.price * 0.8);
  const sellerMin = Math.floor(product.price * 0.85);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      send({
        type: 'session_start',
        sessionId: session.id,
        productTitle: product.title,
        initialPrice: product.price,
        currency: product.currency,
        message: '협상이 시작되었습니다. 최대 5턴 진행됩니다.',
      });

      let currentBuyerOffer = buyerTarget;
      let currentSellerOffer = product.price;
      let agreed = false;
      let agreedPrice = 0;

      for (let turn = 1; turn <= 5; turn++) {
        // 구매자 에이전트 발언
        const buyerSystem = `당신은 구매자 AI 협상 에이전트입니다. 상품을 최대한 저렴하게 구매하려 합니다.
목표 가격: ${buyerTarget} ${product.currency}. 현재 판매자 제시가: ${currentSellerOffer} ${product.currency}.
합리적으로 협상하되, 무례하지 않게 행동하세요. 응답은 2~3문장 + 제시 가격으로 끝내세요.
형식: [발언 내용] 제시 가격: [숫자] ${product.currency}`;

        const buyerPrompt = `턴 ${turn}/5: 상품 "${product.title}" (${product.price} ${product.currency}) 협상 중.
판매자가 ${currentSellerOffer} ${product.currency}를 제시했습니다. 구매자로서 협상하세요.`;

        const buyerReply = await callAgentAI(buyerSystem, buyerPrompt, 200);
        const buyerOffer = buyerReply
          ? extractPrice(buyerReply, currentBuyerOffer)
          : currentBuyerOffer;
        currentBuyerOffer = Math.max(buyerTarget, Math.min(buyerOffer, currentSellerOffer));

        await prisma.negotiationMessage.create({
          data: {
            sessionId: session.id,
            role: '구매자',
            agentType: 'buyer',
            content: buyerReply || `${currentBuyerOffer} ${product.currency}에 구매하고 싶습니다.`,
            proposedPrice: currentBuyerOffer,
          },
        });

        send({
          type: 'message',
          turn,
          agent: '구매자 에이전트',
          agentType: 'buyer',
          content: buyerReply || `${currentBuyerOffer} ${product.currency}에 구매하고 싶습니다.`,
          proposedPrice: currentBuyerOffer,
          currency: product.currency,
        });

        // 합의 체크
        if (currentBuyerOffer >= sellerMin) {
          agreed = true;
          agreedPrice = currentBuyerOffer;
          break;
        }

        // 중개자 에이전트 의견
        const mediatorSystem = `당신은 AI 중개 에이전트입니다. 구매자와 판매자 사이에서 공정한 합의를 이끌어 냅니다.`;
        const mediatorPrompt = `구매자 제시: ${currentBuyerOffer} ${product.currency}, 판매자 제시: ${currentSellerOffer} ${product.currency}.
중간 합의점을 제안하세요. 2문장 이내로 답변하세요.`;

        const mediatorReply = await callAgentAI(mediatorSystem, mediatorPrompt, 150);
        const midPrice = Math.round((currentBuyerOffer + currentSellerOffer) / 2);

        await prisma.negotiationMessage.create({
          data: {
            sessionId: session.id,
            role: '중개자',
            agentType: 'mediator',
            content: mediatorReply || `중간 가격 ${midPrice} ${product.currency}를 제안합니다.`,
            proposedPrice: midPrice,
          },
        });

        send({
          type: 'message',
          turn,
          agent: '중개 에이전트',
          agentType: 'mediator',
          content: mediatorReply || `중간 가격 ${midPrice} ${product.currency}를 제안합니다.`,
          proposedPrice: midPrice,
          currency: product.currency,
        });

        // 판매자 에이전트 발언
        const sellerSystem = `당신은 판매자 AI 협상 에이전트입니다. 상품을 최대한 높은 가격에 팔려 합니다.
최소 수용 가격: ${sellerMin} ${product.currency}. 현재 구매자 제시: ${currentBuyerOffer} ${product.currency}.
중개자 제안: ${midPrice} ${product.currency}. 합리적으로 협상하세요.
형식: [발언 내용] 제시 가격: [숫자] ${product.currency}`;

        const sellerPrompt = `턴 ${turn}/5: 구매자가 ${currentBuyerOffer} ${product.currency}를 제시했습니다. 판매자로서 협상하세요.`;

        const sellerReply = await callAgentAI(sellerSystem, sellerPrompt, 200);
        const sellerOffer = sellerReply
          ? extractPrice(sellerReply, currentSellerOffer)
          : currentSellerOffer;
        currentSellerOffer = Math.max(sellerMin, Math.min(sellerOffer, currentSellerOffer));

        await prisma.negotiationMessage.create({
          data: {
            sessionId: session.id,
            role: '판매자',
            agentType: 'seller',
            content: sellerReply || `${currentSellerOffer} ${product.currency}이 최선입니다.`,
            proposedPrice: currentSellerOffer,
          },
        });

        send({
          type: 'message',
          turn,
          agent: '판매자 에이전트',
          agentType: 'seller',
          content: sellerReply || `${currentSellerOffer} ${product.currency}이 최선입니다.`,
          proposedPrice: currentSellerOffer,
          currency: product.currency,
        });

        // 합의 체크
        if (currentBuyerOffer >= currentSellerOffer || currentSellerOffer <= sellerMin) {
          agreed = true;
          agreedPrice = Math.round((currentBuyerOffer + currentSellerOffer) / 2);
          break;
        }
      }

      // 최종 결과
      if (!agreed) {
        // 5턴 후 중간값으로 합의
        agreedPrice = Math.round((currentBuyerOffer + currentSellerOffer) / 2);
        agreed = agreedPrice >= sellerMin;
      }

      if (agreed) {
        await prisma.negotiationSession.update({
          where: { id: session.id },
          data: { status: 'agreed', agreedPrice, updatedAt: new Date() },
        });

        const discount = Math.round((1 - agreedPrice / product.price) * 100);
        send({
          type: 'agreement',
          sessionId: session.id,
          agreedPrice,
          originalPrice: product.price,
          discount,
          currency: product.currency,
          message: `합의 완료! ${agreedPrice.toLocaleString()} ${product.currency} (${discount}% 할인)`,
          paymentReady: true,
        });
      } else {
        await prisma.negotiationSession.update({
          where: { id: session.id },
          data: { status: 'failed', updatedAt: new Date() },
        });
        send({
          type: 'failed',
          sessionId: session.id,
          message: '협상이 결렬되었습니다. 정가로 구매하거나 나중에 다시 시도해주세요.',
          originalPrice: product.price,
          currency: product.currency,
        });
      }

      send({ type: 'done' });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
