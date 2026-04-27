import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const buyerId = searchParams.get('buyerId');
  const sellerId = searchParams.get('sellerId');
  const status = searchParams.get('status');
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '20');

  const where: Record<string, unknown> = {};
  if (buyerId) where.buyerId = buyerId;
  if (status) where.status = status;
  if (sellerId) {
    where.product = { sellerId };
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: { product: { select: { title: true, images: true, sellerId: true, sellerName: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.order.count({ where }),
  ]);

  return NextResponse.json({ orders, total, page, pages: Math.ceil(total / limit) });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { productId, quantity = 1, buyerId, buyerEmail, buyerName = '익명', memo, groupBuyId } = body;

  if (!productId) return NextResponse.json({ error: 'productId가 필요합니다' }, { status: 400 });

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return NextResponse.json({ error: '상품을 찾을 수 없습니다' }, { status: 404 });
  if (product.status !== 'active') return NextResponse.json({ error: '판매 중인 상품이 아닙니다' }, { status: 400 });
  if (product.stock < quantity) return NextResponse.json({ error: '재고가 부족합니다' }, { status: 400 });

  let unitPrice = product.price;

  if (groupBuyId) {
    const gb = await prisma.groupBuy.findUnique({ where: { id: groupBuyId } });
    if (gb && gb.status === 'success') unitPrice = gb.discountedPrice;
    else if (gb && gb.status === 'open') unitPrice = gb.discountedPrice;
  }

  const [order] = await prisma.$transaction([
    prisma.order.create({
      data: {
        productId, quantity, buyerId, buyerEmail, buyerName,
        unitPrice, totalPrice: unitPrice * quantity,
        currency: product.currency,
        memo, groupBuyId,
      },
    }),
    prisma.product.update({
      where: { id: productId },
      data: {
        stock: { decrement: quantity },
        buyCount: { increment: quantity },
      },
    }),
  ]);

  return NextResponse.json(order, { status: 201 });
}
