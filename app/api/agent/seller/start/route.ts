import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createSellerAgentFromListing } from '@/lib/marketplace/agent-market-bridge';

export async function POST(req: NextRequest) {
  const { listingId } = await req.json();
  if (!listingId) return NextResponse.json({ error: 'listingId가 필요합니다.' }, { status: 400 });

  const listing = await prisma.product.findUnique({ where: { id: listingId } });
  if (!listing) return NextResponse.json({ error: 'listing을 찾을 수 없습니다.' }, { status: 404 });

  const existing = await prisma.agentSession.findFirst({ where: { listingId, agentType: 'seller', status: 'SELLER_AGENT_ACTIVE' } });
  const session = existing || await createSellerAgentFromListing(listingId);
  await prisma.productDraft.updateMany({
    where: { publishedProductId: listingId },
    data: { status: 'SELLER_AGENT_ACTIVE', sellerAgentEnabled: true },
  });

  return NextResponse.json({ session, status: 'SELLER_AGENT_ACTIVE' });
}
