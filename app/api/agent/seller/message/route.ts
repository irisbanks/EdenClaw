import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { runSellerAgent } from '@/lib/agents/seller-agent';

export async function POST(req: NextRequest) {
  const { listingId, buyerMessage, buyerId, buyerName = '익명 구매자' } = await req.json();
  if (!listingId || !buyerMessage) return NextResponse.json({ error: 'listingId와 buyerMessage가 필요합니다.' }, { status: 400 });

  const listing = await prisma.product.findUnique({ where: { id: listingId } });
  if (!listing) return NextResponse.json({ error: 'listing을 찾을 수 없습니다.' }, { status: 404 });

  const session = await prisma.agentSession.findFirst({
    where: { listingId, agentType: 'seller', status: 'SELLER_AGENT_ACTIVE' },
    orderBy: { createdAt: 'desc' },
  });

  const response = await runSellerAgent({
    listing: {
      id: listing.id,
      title: listing.title,
      description: listing.description,
      price: listing.price,
      currency: listing.currency,
      status: listing.status,
    },
    buyerMessage,
  });

  let offer = null;
  if (response.status === 'USER_CONFIRM_REQUIRED' && response.detectedOfferPrice) {
    offer = await prisma.offer.create({
      data: {
        listingId,
        buyerId: buyerId || null,
        buyerName,
        buyerMessage,
        offerPrice: response.detectedOfferPrice,
        currency: listing.currency,
        status: 'USER_CONFIRM_REQUIRED',
        agentReply: response.reply,
      },
    });
    await prisma.productDraft.updateMany({ where: { publishedProductId: listingId }, data: { status: 'OFFER_RECEIVED' } });
  }

  await prisma.agentActionLog.create({
    data: {
      sessionId: session?.id,
      action: 'seller_message',
      input: JSON.stringify({ listingId, buyerMessage, buyerId, buyerName }),
      output: JSON.stringify({ response, offerId: offer?.id }),
      requiresUserConfirmation: response.requiresUserConfirmation,
    },
  });
  if (session) {
    await prisma.agentSession.update({ where: { id: session.id }, data: { lastMessageAt: new Date() } });
  }

  return NextResponse.json({ response, offer });
}
