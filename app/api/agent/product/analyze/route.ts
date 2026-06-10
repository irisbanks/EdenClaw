import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { runProductIntakeAgent } from '@/lib/agents/product-intake-agent';

export async function POST(req: NextRequest) {
  const { draftId, userHint } = await req.json();
  if (!draftId) return NextResponse.json({ error: 'draftId가 필요합니다.' }, { status: 400 });

  const draft = await prisma.productDraft.findUnique({ where: { id: draftId }, include: { images: true } });
  if (!draft) return NextResponse.json({ error: 'draft를 찾을 수 없습니다.' }, { status: 404 });

  await prisma.productDraft.update({ where: { id: draftId }, data: { status: 'AI_ANALYZING' } });
  const analysis = await runProductIntakeAgent({
    images: draft.images.map((img) => ({ id: img.id, url: img.url, storagePath: img.storagePath, mimeType: img.mimeType })),
    userHint,
  });

  const nextStatus = analysis.prohibited ? 'REJECTED_BY_POLICY' : 'ASK_PRICE';
  const updated = await prisma.productDraft.update({
    where: { id: draftId },
    data: {
      status: nextStatus,
      title: analysis.productName,
      category: analysis.category,
      condition: analysis.condition,
      aiAnalysis: JSON.stringify(analysis),
      riskFlags: JSON.stringify([...new Set([...analysis.riskFlags, ...analysis.privateInfoFlags])]),
    },
  });

  await prisma.agentActionLog.create({
    data: {
      draftId,
      action: 'product_analyze',
      status: analysis.prohibited ? 'blocked' : 'ok',
      input: JSON.stringify({ userHint }),
      output: JSON.stringify(analysis),
      requiresUserConfirmation: analysis.prohibited,
    },
  });

  return NextResponse.json({ draft: updated, analysis, nextStatus });
}
