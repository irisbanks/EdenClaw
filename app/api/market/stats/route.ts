import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const [
    totalProducts,
    activeProducts,
    totalOrders,
    totalGroupBuys,
    openGroupBuys,
    successGroupBuys,
    verifiedProducts,
    topProducts,
    recentOrders,
  ] = await Promise.all([
    prisma.product.count(),
    prisma.product.count({ where: { status: 'active' } }),
    prisma.order.count(),
    prisma.groupBuy.count(),
    prisma.groupBuy.count({ where: { status: 'open' } }),
    prisma.groupBuy.count({ where: { status: 'success' } }),
    prisma.product.count({ where: { verifyScore: { gte: 70 } } }),
    prisma.product.findMany({
      where: { status: 'active' },
      orderBy: { buyCount: 'desc' },
      take: 5,
      select: { id: true, title: true, price: true, currency: true, buyCount: true, verifyScore: true },
    }),
    prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { product: { select: { title: true } } },
    }),
  ]);

  const revenue = await prisma.order.aggregate({ _sum: { totalPrice: true } });

  return NextResponse.json({
    products: { total: totalProducts, active: activeProducts, verified: verifiedProducts },
    orders: { total: totalOrders, revenue: revenue._sum.totalPrice || 0 },
    groupBuys: { total: totalGroupBuys, open: openGroupBuys, success: successGroupBuys },
    topProducts,
    recentOrders,
  });
}
