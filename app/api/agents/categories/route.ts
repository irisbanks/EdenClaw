import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const CATEGORY_META: Record<string, { label: string; icon: string; description: string }> = {
  trading: { label: '트레이딩', icon: '💹', description: 'BTC/ETH/DeFi/파생상품 전문가' },
  business: { label: '비즈니스', icon: '🏗️', description: '성장, 브랜드, 세일즈, 협상 전문가' },
  tech: { label: '개발', icon: '💻', description: '풀스택, ML, 보안, DevOps 엔지니어' },
  creative: { label: '크리에이티브', icon: '✨', description: '카피라이팅, 번역, 영상, 디자인' },
  education: { label: '교육', icon: '📚', description: '암호화폐, 어학, 수학, 커리어 코치' },
  lifestyle: { label: '라이프스타일', icon: '❤️', description: '피트니스, 마인드셋, 여행, 재무' },
  autonomous: { label: '자율 에이전트', icon: '🤖', description: '24시간 자동 실행 에이전트' },
  'multi-agent': { label: '멀티에이전트 팀', icon: '🤝', description: '전문가 팀 협업 시스템' },
  general: { label: '일반', icon: '💬', description: '범용 AI 어시스턴트' },
};

export async function GET() {
  const stats = await prisma.agent.groupBy({
    by: ['category'],
    _count: { slug: true },
    where: { isActive: true },
  });

  const categories = stats
    .sort((a, b) => b._count.slug - a._count.slug)
    .map((s) => ({
      category: s.category,
      count: s._count.slug,
      ...(CATEGORY_META[s.category] || { label: s.category, icon: '📦', description: '' }),
    }));

  return NextResponse.json(categories);
}
