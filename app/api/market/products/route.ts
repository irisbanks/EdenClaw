import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get('category');
  const search = searchParams.get('search');
  const sort = searchParams.get('sort') || 'createdAt';
  const order = (searchParams.get('order') || 'desc') as 'asc' | 'desc';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '20');
  const status = searchParams.get('status') || 'active';
  const verified = searchParams.get('verified');

  const where: Record<string, unknown> = { status };
  if (category) where.category = category;
  if (verified === 'true') where.verifyScore = { gte: 70 };
  if (search) {
    where.OR = [
      { title: { contains: search } },
      { description: { contains: search } },
      { tags: { contains: search } },
    ];
  }

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { [sort]: order },
      skip: (page - 1) * limit,
      take: limit,
      include: { reviews: { select: { rating: true } } },
    }),
    prisma.product.count({ where }),
  ]);

  const enriched = products.map((p) => {
    const avgRating = p.reviews.length
      ? p.reviews.reduce((s, r) => s + r.rating, 0) / p.reviews.length
      : 0;
    const { reviews: _, ...rest } = p;
    return { ...rest, avgRating: Math.round(avgRating * 10) / 10, reviewCount: p.reviews.length };
  });

  return NextResponse.json({ products: enriched, total, page, pages: Math.ceil(total / limit) });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    title, description, price, currency = 'ET', category = 'general',
    tags = [], images = [], sellerName = '익명', sellerId, stock = 1,
  } = body;

  if (!title || !description || price === undefined) {
    return NextResponse.json({ error: '필수 항목이 누락되었습니다 (title, description, price)' }, { status: 400 });
  }
  if (price < 0) return NextResponse.json({ error: '가격은 0 이상이어야 합니다' }, { status: 400 });

  const product = await prisma.product.create({
    data: {
      title, description, price, currency, category,
      tags: JSON.stringify(tags),
      images: JSON.stringify(images),
      sellerName, sellerId, stock,
    },
  });

  return NextResponse.json(product, { status: 201 });
}
