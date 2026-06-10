import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const txs = await prisma.swarmTransaction.findMany({
      orderBy: { timestamp: 'desc' },
      take: 50,
      include: {
        buyer:  { select: { persona: true, reputation: true } },
        seller: { select: { persona: true, reputation: true } },
      },
    });

    const rows = txs.map(tx => {
      const buyerPersona  = JSON.parse(tx.buyer.persona  as string)  as { name: string; region: string };
      const sellerPersona = JSON.parse(tx.seller.persona as string) as { name: string; region: string };
      const productInfo   = JSON.parse(tx.productInfo    as string)  as { name?: string; groupBuy?: boolean };
      const log           = JSON.parse(tx.negotiationLog as string)  as string[];
      return {
        id:          tx.id,
        buyerName:   buyerPersona.name,
        sellerName:  sellerPersona.name,
        productName: productInfo.name ?? '상품',
        finalPrice:  tx.finalPrice,
        keyword:     tx.marketKeyword,
        status:      tx.status,
        isGroupBuy:  !!productInfo.groupBuy,
        lastLog:     log[log.length - 1] ?? '',
        timestamp:   tx.timestamp,
      };
    });

    return NextResponse.json({ ok: true, count: rows.length, transactions: rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
