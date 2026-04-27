import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      reviews: { orderBy: { createdAt: 'desc' } },
      groupBuys: { where: { status: { in: ['open', 'success'] } } },
      _count: { select: { orders: true } },
    },
  });

  if (!product) return NextResponse.json({ error: '상품을 찾을 수 없습니다' }, { status: 404 });

  await prisma.product.update({ where: { id }, data: { viewCount: { increment: 1 } } });

  const avgRating = product.reviews.length
    ? product.reviews.reduce((s, r) => s + r.rating, 0) / product.reviews.length
    : 0;

  return NextResponse.json({
    ...product,
    avgRating: Math.round(avgRating * 10) / 10,
    reviewCount: product.reviews.length,
    orderCount: product._count.orders,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const allowed = ['title', 'description', 'price', 'stock', 'status', 'tags', 'images', 'category'];
  const data: Record<string, unknown> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) {
      data[key] = Array.isArray(body[key]) ? JSON.stringify(body[key]) : body[key];
    }
  }

  const product = await prisma.product.update({ where: { id }, data });
  return NextResponse.json(product);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.product.update({ where: { id }, data: { status: 'deleted' } });
  return NextResponse.json({ success: true });
}
