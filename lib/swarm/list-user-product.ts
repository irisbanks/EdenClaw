import { prisma } from '@/lib/prisma';

export interface BotExposureResult {
  listingId: string;
  category: string;
  keyword: string;
  matchedBots: number;
  enqueuedBots: SelectedBot[];
  status: 'queued' | 'skipped' | 'error';
  reason?: string;
}

interface SelectedBot {
  id: string;
  botType: string;
  reputation: number;
}

export async function listUserProductInSwarm(listingId: string): Promise<BotExposureResult> {
  const listing = await prisma.product.findUnique({ where: { id: listingId } });
  if (!listing) {
    return { listingId, category: '', keyword: '', matchedBots: 0, enqueuedBots: [], status: 'error', reason: 'listing not found' };
  }

  const keyword = listing.category || listing.title.slice(0, 12);

  let bots = await prisma.swarmBot.findMany({
    where: {
      botType: 'buyer',
      status: 'idle',
      reputation: { gte: 50 },
    },
    orderBy: { reputation: 'desc' },
    take: 50,
  });

  if (bots.length === 0) {
    bots = await prisma.swarmBot.findMany({
      where: { botType: 'buyer' },
      orderBy: { reputation: 'desc' },
      take: 50,
    });
    if (bots.length === 0) {
      return { listingId, category: listing.category || '', keyword, matchedBots: 0, enqueuedBots: [], status: 'skipped', reason: 'no buyer bots available' };
    }
  }

  const enqueuedBots: SelectedBot[] = [];
  for (const bot of bots.slice(0, 50)) {
    try {
      await prisma.swarmTransaction.create({
        data: {
          buyerId: bot.id,
          sellerId: 'user_seller',
          marketKeyword: keyword,
          finalPrice: listing.price || 0,
          status: 'pending',
          productInfo: JSON.stringify({ listingId, listingTitle: listing.title, source: 'list-user-product' }),
        },
      });
      enqueuedBots.push({ id: bot.id, botType: bot.botType, reputation: bot.reputation });
    } catch {
      // skip individual bot errors
    }
  }

  return {
    listingId,
    category: listing.category || '',
    keyword,
    matchedBots: enqueuedBots.length,
    enqueuedBots,
    status: 'queued',
  };
}
