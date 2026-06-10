import { NextRequest, NextResponse } from 'next/server';
import { voiceShop, parseShoppingIntent } from '@/lib/market/voice-shop-engine';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    audio?: string;
    text?: string;
    userId?: string;
  };

  const { audio, text, userId } = body;

  if (userId) {
    await prisma.userBehavior.create({
      data: { userId, action: 'voice_shop', query: text || '[audio]' },
    }).catch(() => {});
  }

  // 텍스트 직접 입력 모드
  if (!audio && text) {
    const intent = await parseShoppingIntent(text);
    const products = await prisma.product.findMany({
      where: {
        status: 'active', stock: { gt: 0 },
        OR: [
          { title: { contains: intent.product } },
          ...intent.keywords.map(k => ({ title: { contains: k } })),
        ],
      },
      include: { reviews: { select: { rating: true } } },
      orderBy: [{ verifyScore: 'desc' }, { buyCount: 'desc' }],
      take: 5,
    });
    return NextResponse.json({ transcribed: text, intent, products, mode: 'text' });
  }

  if (!audio) {
    return NextResponse.json({ error: 'audio 또는 text가 필요합니다' }, { status: 400 });
  }

  try {
    const result = await voiceShop(audio);
    if (userId && result.transcribed) {
      await prisma.userBehavior.create({
        data: { userId, action: 'search', query: result.transcribed, productId: result.product?.id },
      }).catch(() => {});
    }
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '음성 쇼핑 처리 실패';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
