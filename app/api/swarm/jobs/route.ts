import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getJobStore } from '@/lib/swarm/job-store';
import { processJob } from '@/lib/swarm/worker';
import { defaultModelTiers } from '@/lib/swarm/model-tiers';
import { consumeGasWithCache } from '@/lib/services/overdraftLedger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 자율 루프 잡 enqueue — 즉시 jobId 반환(202). 실제 루프는 독립 워커가 시간 제한 없이 처리.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const prompt =
    typeof body.prompt === 'string' ? body.prompt.trim() :
    typeof body.userPrompt === 'string' ? body.userPrompt.trim() : '';
  if (!email) return NextResponse.json({ error: 'email 이 필요합니다.' }, { status: 400 });
  if (!prompt) return NextResponse.json({ error: '프롬프트를 입력하세요.' }, { status: 400 });

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, tokenQuota: { select: { allocated: true, consumed: true } } },
  });
  if (!user || !user.tokenQuota) {
    return NextResponse.json({ error: user ? 'TokenQuota가 없습니다.' : '가입되지 않은 이메일입니다.' }, { status: 404 });
  }
  const remaining = Math.max(0, Number(user.tokenQuota.allocated) - Number(user.tokenQuota.consumed));
  if (remaining <= 0) return NextResponse.json({ error: '가스가 고갈되었습니다. 충전 후 다시 시도하세요.' }, { status: 402 });

  const maxAttempts = Math.max(3, Math.min(8, Math.trunc(Number(body.maxAttempts) || 5)));
  const store = getJobStore();
  const job = await store.createJob({ email, userId: user.id, prompt, maxAttempts });

  // 단일 서버 편의 모드: 별도 워커 없이 즉시 detached 처리(베스트에포트). 기본은 독립 워커 권장.
  if (process.env.SWARM_INLINE_WORKER === 'true') {
    void processJob(store, job.id, defaultModelTiers(), {
      onComplete: async (j) => {
        if (j.userId && j.gasCharged > 0) await consumeGasWithCache(j.userId, j.gasCharged, 'SWARM_JOB_INLINE');
      },
    });
  }

  return NextResponse.json({ jobId: job.id, status: job.status, pollUrl: `/api/swarm/jobs/${job.id}` }, { status: 202 });
}

export async function GET() {
  try {
    const store = getJobStore();
    const jobs = await store.listJobs(50);
    return NextResponse.json({ jobs });
  } catch (e) {
    // 저장소(예: Redis) 장애가 대시보드 자체를 막지 않도록 빈 목록으로 방어.
    console.warn('[swarm/jobs] listJobs 실패 — 빈 목록 반환:', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ jobs: [], degraded: true });
  }
}
