import { prisma } from './prisma';

const VLLM_URL = process.env.LOCAL_AI_URL || 'http://localhost:8000/v1/chat/completions';
const AI_MODEL = process.env.LOCAL_AI_MODEL || 'Qwen/Qwen2.5-72B-Instruct';

export class SelfLearningModule {
  async recordConversation(
    agentSlug: string,
    userId: string | null,
    question: string,
    answer: string,
    source = 'conversation'
  ): Promise<string> {
    const record = await prisma.agentLearning.create({
      data: {
        agentSlug,
        userId,
        question: question.slice(0, 1000),
        answer: answer.slice(0, 2000),
        quality: 0,
        source,
        learned: false,
      },
    });
    return record.id;
  }

  async rateLearning(learningId: string, quality: number): Promise<void> {
    await prisma.agentLearning.update({
      where: { id: learningId },
      data: { quality: Math.max(0, Math.min(5, quality)) },
    });
  }

  async expandKnowledge(agentSlug: string): Promise<{ added: number; total: number }> {
    const highQuality = await prisma.agentLearning.findMany({
      where: { agentSlug, quality: { gte: 4 }, learned: false },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, question: true, answer: true },
    });

    if (highQuality.length === 0) return { added: 0, total: 0 };

    const extractPrompt =
      `아래 전문 Q&A 대화에서 핵심 지식/사실/원칙을 한 줄씩 추출하세요.\n` +
      `일반 상식은 제외하고, 실용적이고 구체적인 전문 정보만 추출하세요.\n` +
      `각 줄은 독립적으로 이해 가능해야 합니다.\n\n` +
      highQuality.map((q) => `Q: ${q.question}\nA: ${q.answer.slice(0, 500)}`).join('\n---\n') +
      `\n\n추출된 지식 (한 줄에 하나씩, 최대 10개):`;

    try {
      const res = await fetch(VLLM_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: AI_MODEL,
          messages: [{ role: 'user', content: extractPrompt }],
          max_tokens: 800,
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json();
      const newKnowledge = (data.choices?.[0]?.message?.content as string)
        ?.split('\n')
        .map((l: string) => l.replace(/^\d+\.\s*|-\s*/, '').trim())
        .filter((l: string) => l.length > 15 && l.length < 200)
        .slice(0, 10) || [];

      if (newKnowledge.length === 0) return { added: 0, total: 0 };

      // 기존 지식베이스에 추가
      const agent = await prisma.agent.findUnique({
        where: { slug: agentSlug },
        select: { knowledgeBase: true },
      });

      const existing: string[] = JSON.parse(agent?.knowledgeBase || '[]');
      const combined = [...existing, ...newKnowledge];
      const deduped = [...new Set(combined)].slice(-50); // 최대 50개, 중복 제거

      await prisma.agent.update({
        where: { slug: agentSlug },
        data: { knowledgeBase: JSON.stringify(deduped) },
      });

      // 학습 완료 표시
      await prisma.agentLearning.updateMany({
        where: {
          id: { in: highQuality.map((q) => q.id) },
        },
        data: { learned: true },
      });

      console.log(`[SelfLearning] ${agentSlug}: +${newKnowledge.length}개 지식 추가 (총 ${deduped.length}개)`);
      return { added: newKnowledge.length, total: deduped.length };
    } catch (e) {
      console.error(`[SelfLearning] ${agentSlug} 지식 추출 실패:`, e);
      return { added: 0, total: 0 };
    }
  }

  async exportTrainingData(agentSlug: string): Promise<{ messages: { role: string; content: string }[] }[]> {
    const agent = await prisma.agent.findUnique({ where: { slug: agentSlug }, select: { systemPrompt: true } });
    const data = await prisma.agentLearning.findMany({
      where: { agentSlug, quality: { gte: 3 } },
      orderBy: [{ quality: 'desc' }, { createdAt: 'desc' }],
      take: 100,
      select: { question: true, answer: true },
    });

    return data.map((d) => ({
      messages: [
        { role: 'system', content: agent?.systemPrompt || '당신은 전문 AI 에이전트입니다.' },
        { role: 'user', content: d.question },
        { role: 'assistant', content: d.answer },
      ],
    }));
  }

  async getGrowthStats(agentSlug: string) {
    const [total, highQuality, learned, agentData] = await Promise.all([
      prisma.agentLearning.count({ where: { agentSlug } }),
      prisma.agentLearning.count({ where: { agentSlug, quality: { gte: 4 } } }),
      prisma.agentLearning.count({ where: { agentSlug, learned: true } }),
      prisma.agent.findUnique({ where: { slug: agentSlug }, select: { knowledgeBase: true, name: true } }),
    ]);

    const kbSize = (() => {
      try {
        return JSON.parse(agentData?.knowledgeBase || '[]').length;
      } catch {
        return 0;
      }
    })();

    return {
      agentSlug,
      agentName: agentData?.name,
      totalConversations: total,
      highQualityData: highQuality,
      learnedItems: learned,
      pendingLearning: highQuality - learned,
      knowledgeBaseSize: kbSize,
      growthRate: total > 0 ? Math.round((learned / total) * 100) : 0,
    };
  }

  // 자동 품질 평가: 대화 길이, 구체성 등으로 초기 점수 부여
  autoScore(question: string, answer: string): number {
    let score = 2; // 기본 점수
    if (answer.length > 500) score += 1; // 상세한 답변
    if (answer.includes('%') || answer.includes('$') || /\d+/.test(answer)) score += 0.5; // 수치 포함
    if (answer.includes('##') || answer.includes('\n-')) score += 0.5; // 구조화된 답변
    if (question.length > 30) score += 0.5; // 구체적인 질문
    return Math.min(5, Math.round(score));
  }
}

export const selfLearning = new SelfLearningModule();
