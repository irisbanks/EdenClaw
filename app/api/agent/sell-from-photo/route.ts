import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { analyzePhoto } from '@/lib/vision/photo-analyzer';
import { stepMessage } from '@/lib/marketplace/sell-flow';

const UPLOADS_DIR = '/tmp/edenclaw-uploads';

export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') || '';

  let base64Image = '';
  let mimeType = 'image/jpeg';
  let hint = '';
  let userId: string | undefined;

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('image') as File | null;
    hint = String(form.get('hint') || '');
    userId = form.get('userId') ? String(form.get('userId')) : undefined;

    if (!file) {
      return NextResponse.json({ error: '이미지 파일이 필요합니다.' }, { status: 400 });
    }

    mimeType = (file.type || 'image/jpeg') as string;
    const buffer = await file.arrayBuffer();
    base64Image = Buffer.from(buffer).toString('base64');
  } else {
    const body = (await req.json()) as { base64?: string; mimeType?: string; url?: string; hint?: string; userId?: string };
    base64Image = body.base64 || '';
    mimeType = body.mimeType || 'image/jpeg';
    hint = body.hint || '';
    userId = body.userId;

    if (!base64Image && !body.url) {
      return NextResponse.json({ error: 'base64 이미지 또는 url이 필요합니다.' }, { status: 400 });
    }
  }

  const analysis = await analyzePhoto([{ base64: base64Image || undefined, mimeType, hint }]);

  const imageUrl = base64Image
    ? `data:${mimeType};base64,${base64Image.slice(0, 20)}...`
    : 'uploaded';

  const draft = await prisma.productDraft.create({
    data: {
      userId,
      source: 'mobile_photo',
      status: 'AI_ANALYZING',
      title: analysis.brand !== '브랜드 미상' ? `${analysis.brand} ${analysis.category}` : analysis.category,
      category: analysis.category,
      condition: analysis.condition,
      aiAnalysis: JSON.stringify(analysis),
      riskFlags: JSON.stringify([]),
      images: {
        create: {
          url: imageUrl,
          storagePath: `${UPLOADS_DIR}/${Date.now()}.jpg`,
          mimeType,
          isPrimary: true,
        },
      },
    },
  });

  const nextStatus = analysis.needsMorePhotos ? 'ASK_MORE_PHOTOS' : 'ASK_PRICE';
  const nextStep = analysis.needsMorePhotos ? 'awaiting_more_photos' as const : 'awaiting_price' as const;

  await prisma.productDraft.update({
    where: { id: draft.id },
    data: { status: nextStatus },
  });

  await prisma.sellSession.create({
    data: {
      draftId: draft.id,
      userId,
      step: nextStep,
      context: JSON.stringify({ analysis }),
    },
  });

  await prisma.agentActionLog.create({
    data: {
      draftId: draft.id,
      action: 'sell_from_photo',
      status: 'ok',
      input: JSON.stringify({ hint, mimeType }),
      output: JSON.stringify(analysis),
    },
  });

  const suggestedPrice = analysis.suggestedPrice || 0;

  return NextResponse.json({
    sessionId: draft.id,
    message: stepMessage(nextStep),
    analysis: {
      category: analysis.category,
      brand: analysis.brand,
      color: analysis.color,
      condition: analysis.condition,
      description: analysis.description,
      needsMorePhotos: analysis.needsMorePhotos,
      suggestedAngles: analysis.suggestedAngles,
      confidence: analysis.confidence,
    },
    suggestedPrice,
    priceRange: { min: analysis.minPrice, max: analysis.maxPrice },
    nextStep,
  });
}
