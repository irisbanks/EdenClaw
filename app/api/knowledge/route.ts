import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateEmbedding } from '@/lib/rag/embeddings';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const agentSlug = searchParams.get('agentSlug') || undefined;
  const category = searchParams.get('category') || undefined;
  const q = searchParams.get('q') || undefined;

  const items = await prisma.knowledge.findMany({
    where: {
      ...(agentSlug ? { OR: [{ agentSlug }, { agentSlug: null }] } : {}),
      ...(category ? { category } : {}),
      ...(q ? { OR: [{ title: { contains: q } }, { content: { contains: q } }] } : {}),
    },
    orderBy: { useCount: 'desc' },
    take: 50,
    select: { id: true, title: true, category: true, source: true, useCount: true, createdAt: true, agentSlug: true },
  });
  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { title, content, category = 'general', source = 'manual', agentSlug } = body;

  if (!title || !content) return NextResponse.json({ error: 'title and content required' }, { status: 400 });

  let embedding: string | undefined;
  try {
    const emb = await generateEmbedding(`${title} ${content}`);
    embedding = JSON.stringify(emb);
  } catch {
    // continue without embedding
  }

  const item = await prisma.knowledge.create({
    data: { title, content, category, source, agentSlug: agentSlug || null, embedding },
  });

  return NextResponse.json(item, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { id, title, content, category, source, agentSlug } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  let embedding: string | undefined;
  if (content || title) {
    const existing = await prisma.knowledge.findUnique({ where: { id } });
    const text = `${title || existing?.title} ${content || existing?.content}`;
    try {
      const emb = await generateEmbedding(text);
      embedding = JSON.stringify(emb);
    } catch {}
  }

  const item = await prisma.knowledge.update({
    where: { id },
    data: {
      ...(title ? { title } : {}),
      ...(content ? { content } : {}),
      ...(category ? { category } : {}),
      ...(source ? { source } : {}),
      ...(agentSlug !== undefined ? { agentSlug: agentSlug || null } : {}),
      ...(embedding ? { embedding } : {}),
    },
  });

  return NextResponse.json(item);
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await prisma.knowledge.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
