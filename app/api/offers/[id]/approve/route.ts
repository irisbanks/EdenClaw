import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const offer = await prisma.offer.update({ where: { id }, data: { status: 'APPROVED' } });
  await prisma.product.update({ where: { id: offer.listingId }, data: { status: 'reserved' } });
  await prisma.productDraft.updateMany({ where: { publishedProductId: offer.listingId }, data: { status: 'RESERVED' } });
  return NextResponse.json({ offer, listingStatus: 'reserved' });
}
