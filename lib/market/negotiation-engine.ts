// 협상 엔진: 구매자/판매자/중개자 3개 에이전트, 최대 5턴, SSE 스트리밍
'use strict';

import { prisma } from '@/lib/prisma';

const VLLM_URL = process.env.LOCAL_AI_URL || 'http://localhost:8000/v1/chat/completions';
const AI_MODEL = process.env.LOCAL_AI_MODEL || 'Qwen/Qwen2.5-72B-Instruct';

export interface NegotiationEvent {
  type: 'session_start' | 'message' | 'agreement' | 'failed' | 'done';
  sessionId?: string;
  productTitle?: string;
  initialPrice?: number;
  currency?: string;
  message?: string;
  turn?: number;
  agent?: string;
  agentType?: 'buyer' | 'seller' | 'mediator';
  content?: string;
  proposedPrice?: number;
  agreedPrice?: number;
  originalPrice?: number;
  discount?: number;
  paymentReady?: boolean;
  transcript?: NegotiationTurn[];
}

export interface NegotiationTurn {
  turn: number;
  agentType: string;
  content: string;
  proposedPrice?: number;
}

async function callAgent(systemPrompt: string, userPrompt: string, maxTokens = 250): Promise<string> {
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
        temperature: 0.65,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content || '';
  } catch {
    return '';
  }
}

function extractPrice(text: string, fallback: number): number {
  // "제시 가격: 숫자" 또는 "제시가: 숫자" 패턴 우선
  const explicit = text.match(/제시\s*가격?\s*[:：]\s*(\d[\d,]*)/);
  if (explicit) {
    const n = parseInt(explicit[1].replace(/,/g, ''));
    if (!isNaN(n) && n > 100) return n;
  }
  // 마지막 가격 숫자 (발언 끝부분에 제시가가 위치하는 경우가 많음)
  const all = [...text.matchAll(/(\d[\d,]*)\s*(ET|원|토큰|EDEN)/g)];
  if (all.length > 0) {
    const last = all[all.length - 1];
    const n = parseInt(last[1].replace(/,/g, ''));
    if (!isNaN(n) && n > 100) return n;
  }
  return fallback;
}

export interface NegotiationOptions {
  productId: string;
  buyerId?: string;
  targetPrice?: number;
}

export function createNegotiationStream(options: NegotiationOptions): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(evt: NegotiationEvent) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
      }

      const { productId, buyerId, targetPrice } = options;

      const product = await prisma.product.findUnique({
        where: { id: productId },
        include: { reviews: { select: { rating: true } } },
      });

      if (!product) {
        send({ type: 'failed', message: '상품을 찾을 수 없습니다' });
        send({ type: 'done' });
        controller.close();
        return;
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
      const transcript: NegotiationTurn[] = [];

      send({
        type: 'session_start',
        sessionId: session.id,
        productTitle: product.title,
        initialPrice: product.price,
        currency: product.currency,
        message: `협상 시작. 목표가: ${buyerTarget.toLocaleString()} ${product.currency} / 최대 5턴`,
      });

      let currentBuyerOffer = buyerTarget;
      let currentSellerOffer = product.price;
      let agreed = false;
      let agreedPrice = 0;

      console.log(`[NegotiationEngine] 세션 ${session.id} 시작 - ${product.title}`);

      for (let turn = 1; turn <= 5; turn++) {
        // ── 구매자 에이전트 ──────────────────────────────────
        const buyerSys = `당신은 구매자 AI 에이전트. 상품을 최대한 저렴하게 구매하려 한다.
목표가: ${buyerTarget} ${product.currency}. 판매자 현재가: ${currentSellerOffer} ${product.currency}.
2~3문장 협상 후 반드시 "제시가: [숫자] ${product.currency}" 형식으로 끝내라.`;

        const buyerReply = await callAgent(
          buyerSys,
          `턴 ${turn}/5. 상품: "${product.title}". 협상하라.`,
        );
        const buyerOffer = buyerReply
          ? extractPrice(buyerReply, currentBuyerOffer)
          : Math.min(currentBuyerOffer + Math.floor(product.price * 0.03), currentSellerOffer);
        currentBuyerOffer = Math.max(buyerTarget, Math.min(buyerOffer, currentSellerOffer));

        const buyerContent = buyerReply || `${currentBuyerOffer.toLocaleString()} ${product.currency}에 구매하고 싶습니다.`;

        await prisma.negotiationMessage.create({
          data: { sessionId: session.id, role: '구매자', agentType: 'buyer', content: buyerContent, proposedPrice: currentBuyerOffer },
        });
        transcript.push({ turn, agentType: 'buyer', content: buyerContent, proposedPrice: currentBuyerOffer });

        send({
          type: 'message', turn,
          agent: '구매자 에이전트', agentType: 'buyer',
          content: buyerContent, proposedPrice: currentBuyerOffer, currency: product.currency,
        });

        if (currentBuyerOffer >= sellerMin) {
          agreed = true; agreedPrice = currentBuyerOffer; break;
        }

        // ── 중개자 에이전트 ──────────────────────────────────
        const midPrice = Math.round((currentBuyerOffer + currentSellerOffer) / 2);
        const mediatorSys = `당신은 공정한 중개 AI 에이전트. 양측의 합의를 유도한다. 2문장 이내.`;
        const mediatorReply = await callAgent(
          mediatorSys,
          `구매자: ${currentBuyerOffer} ${product.currency}, 판매자: ${currentSellerOffer} ${product.currency}. 중간가 ${midPrice}를 제안하라.`,
          150,
        );
        const mediatorContent = mediatorReply || `중간 가격 ${midPrice.toLocaleString()} ${product.currency}를 제안합니다.`;

        await prisma.negotiationMessage.create({
          data: { sessionId: session.id, role: '중개자', agentType: 'mediator', content: mediatorContent, proposedPrice: midPrice },
        });
        transcript.push({ turn, agentType: 'mediator', content: mediatorContent, proposedPrice: midPrice });

        send({
          type: 'message', turn,
          agent: '중개 에이전트', agentType: 'mediator',
          content: mediatorContent, proposedPrice: midPrice, currency: product.currency,
        });

        // ── 판매자 에이전트 ──────────────────────────────────
        const sellerSys = `당신은 판매자 AI 에이전트. 최고가로 판매하려 한다.
최소가: ${sellerMin} ${product.currency}. 구매자: ${currentBuyerOffer} ${product.currency}. 중개자 제안: ${midPrice} ${product.currency}.
2~3문장 후 "제시가: [숫자] ${product.currency}" 형식으로 끝내라.`;

        const sellerReply = await callAgent(
          sellerSys,
          `턴 ${turn}/5. 구매자가 ${currentBuyerOffer} ${product.currency}를 제시. 응답하라.`,
        );
        const sellerOffer = sellerReply
          ? extractPrice(sellerReply, currentSellerOffer)
          : Math.max(sellerMin, currentSellerOffer - Math.floor(product.price * 0.03));
        currentSellerOffer = Math.max(sellerMin, Math.min(sellerOffer, currentSellerOffer));

        const sellerContent = sellerReply || `${currentSellerOffer.toLocaleString()} ${product.currency}이 최선입니다.`;

        await prisma.negotiationMessage.create({
          data: { sessionId: session.id, role: '판매자', agentType: 'seller', content: sellerContent, proposedPrice: currentSellerOffer },
        });
        transcript.push({ turn, agentType: 'seller', content: sellerContent, proposedPrice: currentSellerOffer });

        send({
          type: 'message', turn,
          agent: '판매자 에이전트', agentType: 'seller',
          content: sellerContent, proposedPrice: currentSellerOffer, currency: product.currency,
        });

        if (currentBuyerOffer >= currentSellerOffer || currentSellerOffer <= sellerMin) {
          agreed = true;
          agreedPrice = Math.round((currentBuyerOffer + currentSellerOffer) / 2);
          break;
        }
      }

      // ── 최종 처리 ────────────────────────────────────────
      if (!agreed) {
        agreedPrice = Math.round((currentBuyerOffer + currentSellerOffer) / 2);
        agreed = agreedPrice >= sellerMin;
      }

      const transcriptJson = JSON.stringify(transcript);

      if (agreed) {
        await prisma.negotiationSession.update({
          where: { id: session.id },
          data: { status: 'agreed', agreedPrice, finalPrice: agreedPrice, transcript: transcriptJson, updatedAt: new Date() },
        });
        const discount = Math.round((1 - agreedPrice / product.price) * 100);
        console.log(`[NegotiationEngine] 합의 완료 ${agreedPrice} ${product.currency} (${discount}% 할인)`);
        send({
          type: 'agreement',
          sessionId: session.id, agreedPrice, originalPrice: product.price,
          discount, currency: product.currency, paymentReady: true,
          message: `합의 완료! ${agreedPrice.toLocaleString()} ${product.currency} (${discount}% 할인)`,
          transcript,
        });
      } else {
        await prisma.negotiationSession.update({
          where: { id: session.id },
          data: { status: 'failed', transcript: transcriptJson, updatedAt: new Date() },
        });
        console.log(`[NegotiationEngine] 협상 결렬 - 세션 ${session.id}`);
        send({
          type: 'failed', sessionId: session.id,
          message: '협상 결렬. 정가로 구매하거나 나중에 다시 시도하세요.',
          originalPrice: product.price, currency: product.currency,
        });
      }

      send({ type: 'done' });
      controller.close();
    },
  });
}
