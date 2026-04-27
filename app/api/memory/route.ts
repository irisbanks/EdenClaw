import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { saveMemory } from '@/lib/rag/embeddings';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const agentSlug = searchParams.get('agentSlug');
  const userId = searchParams.get('userId');
  const memoryType = searchParams.get('type') || undefined;

  if (!agentSlug || !userId) return NextResponse.json({ error: 'agentSlug and userId required' }, { status: 400 });

  const memories = await prisma.agentMemory.findMany({
    where: { agentSlug, userId, ...(memoryType ? { memoryType } : {}) },
    orderBy: [{ importance: 'desc' }, { lastAccess: 'desc' }],
    take: 30,
  });

  return NextResponse.json(memories);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { agentSlug, userId, content, memoryType = 'conversation', importance = 0.5 } = body;

  if (!agentSlug || !userId || !content)
    return NextResponse.json({ error: 'agentSlug, userId, content required' }, { status: 400 });

  await saveMemory(agentSlug, userId, content, memoryType, importance);
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const agentSlug = searchParams.get('agentSlug');
  const userId = searchParams.get('userId');

  if (id) {
    await prisma.agentMemory.delete({ where: { id } });
  } else if (agentSlug && userId) {
    await prisma.agentMemory.deleteMany({ where: { agentSlug, userId } });
  } else {
    return NextResponse.json({ error: 'id or agentSlug+userId required' }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
