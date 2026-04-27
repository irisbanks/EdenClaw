import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// 스케줄 등록
export async function POST(req: NextRequest) {
  const { agentSlug, userId, cronExpr, prompt } = await req.json();
  if (!agentSlug || !userId || !cronExpr || !prompt)
    return NextResponse.json({ error: 'agentSlug, userId, cronExpr, prompt required' }, { status: 400 });

  const schedule = await prisma.schedule.create({
    data: { agentSlug, userId, cronExpr, prompt, isActive: true },
  });
  return NextResponse.json({ schedule });
}

// 스케줄 목록 조회
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');
  const schedules = await prisma.schedule.findMany({
    where: { ...(userId ? { userId } : {}), isActive: true },
    include: { agent: { select: { name: true, icon: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ schedules });
}
