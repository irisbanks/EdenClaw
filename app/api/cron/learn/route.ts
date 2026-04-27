import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { selfLearning } from '@/lib/self-learning';

// POST /api/cron/learn - 매시간 실행, 모든 에이전트 지식 자동 확장
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // 고품질 미학습 데이터가 있는 에이전트 조회
  const agentsWithData = await prisma.agentLearning.groupBy({
    by: ['agentSlug'],
    where: { quality: { gte: 4 }, learned: false },
    _count: { id: true },
    having: { id: { _count: { gte: 2 } } }, // 2개 이상 있을 때만 실행
  });

  if (agentsWithData.length === 0) {
    return NextResponse.json({ skipped: true, reason: 'no qualifying data' });
  }

  const results: { agentSlug: string; added: number; total: number }[] = [];

  for (const { agentSlug } of agentsWithData) {
    try {
      const result = await selfLearning.expandKnowledge(agentSlug);
      results.push({ agentSlug, ...result });
    } catch (e) {
      console.error(`[Cron] ${agentSlug} 지식 확장 실패:`, e);
      results.push({ agentSlug, added: 0, total: 0 });
    }
  }

  const totalAdded = results.reduce((s, r) => s + r.added, 0);
  console.log(`[Cron/Learn] ${results.length}개 에이전트, +${totalAdded}개 지식 추가`);

  return NextResponse.json({
    processed: results.length,
    totalAdded,
    results,
    timestamp: new Date().toISOString(),
  });
}

// GET /api/cron/learn - 학습 현황 전체 통계
export async function GET() {
  const agents = await prisma.agent.findMany({ select: { slug: true, name: true } });

  const stats = await Promise.all(
    agents.slice(0, 20).map((a) => selfLearning.getGrowthStats(a.slug))
  );

  const active = stats.filter((s) => s.totalConversations > 0);
  const totalConversations = stats.reduce((s, a) => s + a.totalConversations, 0);
  const totalKnowledge = stats.reduce((s, a) => s + a.knowledgeBaseSize, 0);

  return NextResponse.json({
    summary: {
      totalAgents: agents.length,
      activeAgents: active.length,
      totalConversations,
      totalKnowledgeItems: totalKnowledge,
    },
    agents: active.sort((a, b) => b.totalConversations - a.totalConversations),
  });
}
