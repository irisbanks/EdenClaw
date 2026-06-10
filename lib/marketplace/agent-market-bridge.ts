import { prisma } from '@/lib/prisma';

export async function createSellerAgentFromListing(listingId: string) {
  const listing = await prisma.product.findUnique({ where: { id: listingId } });
  if (!listing) throw new Error('Listing not found');

  return prisma.agentSession.create({
    data: {
      listingId,
      agentType: 'seller',
      status: 'SELLER_AGENT_ACTIVE',
      userId: listing.sellerId,
      context: JSON.stringify({ bridge: 'swarm-ready', listingTitle: listing.title }),
    },
  });
}

export async function injectListingToSwarmMarket(listingId: string) {
  const listing = await prisma.product.findUnique({ where: { id: listingId } });
  if (!listing) throw new Error('Listing not found');
  return {
    injected: true,
    mode: 'mock',
    listingId,
    marketKeyword: listing.category || listing.title.slice(0, 12),
    message: 'Swarm market injection is prepared but not mutating the existing 5000-bot system yet.',
  };
}

export async function simulateBuyerInterest(listingId: string, buyerCount: number) {
  const listing = await prisma.product.findUnique({ where: { id: listingId } });
  if (!listing) throw new Error('Listing not found');
  return {
    listingId,
    buyerCount,
    simulatedMessages: Array.from({ length: Math.max(0, Math.min(buyerCount, 10)) }, (_, i) => ({
      buyerName: `mock-buyer-${i + 1}`,
      message: `${listing.title} 아직 구매 가능할까요?`,
    })),
  };
}
