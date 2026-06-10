import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createListingPreview } from '@/lib/agents/design-preview-agent';

export async function POST(req: NextRequest) {
  const { draftId } = await req.json();
  if (!draftId) return NextResponse.json({ error: 'draftId가 필요합니다.' }, { status: 400 });

  const draft = await prisma.productDraft.findUnique({ where: { id: draftId }, include: { images: true } });
  if (!draft) return NextResponse.json({ error: 'draft를 찾을 수 없습니다.' }, { status: 404 });

  const riskFlags = JSON.parse(draft.riskFlags || '[]') as string[];
  const primary = draft.images.find((img) => img.isPrimary) || draft.images[0];
  const preview = await createListingPreview({
    title: draft.title || '개인 거래 상품',
    price: draft.price || 0,
    currency: draft.currency,
    imageUrl: primary?.url,
    condition: draft.condition || undefined,
    riskFlags,
  });

  const updated = await prisma.productDraft.update({
    where: { id: draftId },
    data: { previewCard: JSON.stringify(preview) },
  });

  await prisma.agentActionLog.create({
    data: { draftId, action: 'listing_preview', output: JSON.stringify(preview) },
  });

  return NextResponse.json({ draft: updated, previewCard: preview });
}
