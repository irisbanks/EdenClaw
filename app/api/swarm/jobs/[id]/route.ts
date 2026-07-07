import { NextRequest, NextResponse } from 'next/server';
import { getJobStore } from '@/lib/swarm/job-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 잡 상태 + 진행 이벤트 폴링. ?since=<seq> 로 증분 조회.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const since = Math.max(0, Math.trunc(Number(new URL(req.url).searchParams.get('since')) || 0));

  const store = getJobStore();
  const job = await store.getJob(id);
  if (!job) return NextResponse.json({ error: '잡을 찾을 수 없습니다.' }, { status: 404 });

  const events = await store.getEvents(id, since);
  const cursor = events.length ? events[events.length - 1].seq : since;
  return NextResponse.json({ job, events, cursor });
}
