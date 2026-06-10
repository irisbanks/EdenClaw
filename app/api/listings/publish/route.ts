import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createSellerAgentFromListing } from '@/lib/marketplace/agent-market-bridge';

export async function POST(req: NextRequest) {
  const { draftId, approved, agentEnabled = false, sellerName = '개인 판매자', sellerId } = await req.json();
  if (!draftId) return NextResponse.json({ error: 'draftId가 필요합니다.' }, { status: 400 });
  if (!approved) return NextResponse.json({ error: '사용자 승인이 필요합니다.' }, { status: 403 });

  const draft = await prisma.productDraft.findUnique({ where: { id: draftId }, include: { images: true } });
  if (!draft) return NextResponse.json({ error: 'draft를 찾을 수 없습니다.' }, { status: 404 });
  const riskFlags = JSON.parse(draft.riskFlags || '[]') as string[];
  if (draft.status === 'REJECTED_BY_POLICY' || riskFlags.includes('prohibited_item')) {
    return NextResponse.json({ error: '정책상 등록할 수 없습니다.', riskFlags }, { status: 400 });
  }
  if (!draft.title || !draft.description || !draft.price) {
    return NextResponse.json({ error: '판매글 초안과 가격이 먼저 필요합니다.' }, { status: 400 });
  }

  const images = draft.images.map((img) => img.url);
  const product = await prisma.product.create({
    data: {
      title: draft.title,
      description: draft.description,
      price: draft.price,
      currency: draft.currency,
      category: draft.category || 'personal',
      tags: draft.tags,
      images: JSON.stringify(images),
      sellerId: sellerId || draft.userId || null,
      sellerName,
      stock: 1,
      status: 'active',
    },
  });

  const updated = await prisma.productDraft.update({
    where: { id: draftId },
    data: {
      status: agentEnabled ? 'SELLER_AGENT_ACTIVE' : 'LISTED',
      publishedProductId: product.id,
      sellerAgentEnabled: Boolean(agentEnabled),
      approvedAt: new Date(),
    },
  });

  const session = agentEnabled ? await createSellerAgentFromListing(product.id) : null;
  await prisma.agentActionLog.create({
    data: {
      draftId,
      sessionId: session?.id,
      action: 'listing_publish',
      input: JSON.stringify({ approved, agentEnabled }),
      output: JSON.stringify({ productId: product.id, sessionId: session?.id }),
    },
  });

  return NextResponse.json({ draft: updated, listing: product, agentSession: session });
}
