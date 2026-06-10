// 사용자 행동 로그 API
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    userId?: string;
    action: string;
    productId?: string;
    query?: string;
    meta?: Record<string, unknown>;
  };

  const { userId, action, productId, query, meta } = body;
  if (!action) return NextResponse.json({ error: 'action이 필요합니다' }, { status: 400 });

  const log = await prisma.userBehavior.create({
    data: { userId, action, productId, query, meta: JSON.stringify(meta || {}) },
  });

  // 상품 조회 수 증가
  if (action === 'view' && productId) {
    await prisma.product.update({
      where: { id: productId },
      data: { viewCount: { increment: 1 } },
    }).catch(() => {});
  }

  return NextResponse.json({ id: log.id, logged: true });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');
  const action = searchParams.get('action') || undefined;
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);

  const logs = await prisma.userBehavior.findMany({
    where: { ...(userId ? { userId } : {}), ...(action ? { action } : {}) },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return NextResponse.json({ logs, total: logs.length });
}
