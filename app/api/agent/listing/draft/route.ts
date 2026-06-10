import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { suggestPrice } from '@/lib/agents/price-agent';
import { writeListingDraft } from '@/lib/agents/listing-writer-agent';
import { ProductAnalysis } from '@/lib/agents/types';

export async function POST(req: NextRequest) {
  const { draftId, price, currency = 'KRW', extraNote } = await req.json();
  if (!draftId) return NextResponse.json({ error: 'draftId가 필요합니다.' }, { status: 400 });
  if (!price || Number(price) <= 0) return NextResponse.json({ error: '판매 가격이 필요합니다.' }, { status: 400 });

  const draft = await prisma.productDraft.findUnique({ where: { id: draftId } });
  if (!draft) return NextResponse.json({ error: 'draft를 찾을 수 없습니다.' }, { status: 404 });
  if (draft.status === 'REJECTED_BY_POLICY') return NextResponse.json({ error: '정책상 등록할 수 없는 draft입니다.' }, { status: 400 });

  const analysis = JSON.parse(draft.aiAnalysis || '{}') as ProductAnalysis;
  const priced = await suggestPrice({ analysis, requestedPrice: Number(price), currency });
  const listingDraft = await writeListingDraft({ analysis, price: priced.suggestedPrice, currency, extraNote });
  const updated = await prisma.productDraft.update({
    where: { id: draftId },
    data: {
      status: 'DRAFT_CREATED',
      price: priced.suggestedPrice,
      currency,
      title: listingDraft.title,
      description: listingDraft.description,
      tags: JSON.stringify(listingDraft.tags),
      tradeMethod: listingDraft.tradeMethod,
    },
  });

  await prisma.agentActionLog.create({
    data: {
      draftId,
      action: 'listing_draft',
      input: JSON.stringify({ price, currency, extraNote }),
      output: JSON.stringify({ price: priced, listingDraft }),
    },
  });

  return NextResponse.json({ draft: updated, price: priced, listing: listingDraft });
}
