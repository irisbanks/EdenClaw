import fs from 'fs';

const VLLM_URL = process.env.LOCAL_AI_URL || 'http://localhost:8000/v1/chat/completions';
const AI_MODEL = process.env.LOCAL_AI_MODEL || 'Qwen/Qwen2.5-72B-Instruct';
const LOCAL_MODEL_PATH = process.env.LOCAL_MODEL_PATH || '/models/qwen2.5-1.5b-q4.gguf';

export type ResponseSource = 'knowledge' | 'server' | 'offline_fallback';

export interface EngineResponse {
  answer: string;
  source: ResponseSource;
  knowledgeUsed: string[];
}

export class OfflineEngine {
  private knowledgeBase: string[];
  private agentPrompt: string;
  private agentSlug: string;

  constructor(agent: { slug: string; systemPrompt: string; knowledgeBase: string }) {
    this.agentSlug = agent.slug;
    this.agentPrompt = agent.systemPrompt;
    try {
      this.knowledgeBase = JSON.parse(agent.knowledgeBase || '[]');
    } catch {
      this.knowledgeBase = [];
    }
  }

  searchKnowledge(query: string): string[] {
    const lower = query.toLowerCase();
    const keywords = lower
      .split(/[\s,.\-!?]+/)
      .filter((w) => w.length > 1)
      .slice(0, 10);

    const scored = this.knowledgeBase
      .map((kb) => {
        const kbLower = kb.toLowerCase();
        const hits = keywords.filter((kw) => kbLower.includes(kw)).length;
        return { kb, hits };
      })
      .filter((s) => s.hits > 0)
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 5)
      .map((s) => s.kb);

    return scored;
  }

  async isLocalModelAvailable(): Promise<boolean> {
    try {
      return fs.existsSync(LOCAL_MODEL_PATH);
    } catch {
      return false;
    }
  }

  async isServerAvailable(): Promise<boolean> {
    try {
      const res = await fetch('http://localhost:8000/v1/models', {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async generateResponse(
    query: string,
    conversationHistory: { role: string; content: string }[] = [],
    additionalContext = ''
  ): Promise<EngineResponse> {
    const relevant = this.searchKnowledge(query);

    const serverOk = await this.isServerAvailable();

    if (serverOk) {
      let enrichedPrompt = this.agentPrompt;
      if (relevant.length > 0) {
        enrichedPrompt += '\n\n[내장 지식베이스]\n' + relevant.map((r) => `- ${r}`).join('\n');
      }
      if (additionalContext) {
        enrichedPrompt += '\n\n' + additionalContext;
      }

      try {
        const answer = await this.callServer(query, enrichedPrompt, conversationHistory);
        return { answer, source: 'server', knowledgeUsed: relevant };
      } catch {
        // fall through to knowledge-only fallback
      }
    }

    // 서버 없을 때 내장 지식 기반 답변
    if (relevant.length > 0) {
      const answer =
        `📚 **내장 지식베이스 기반 답변** (오프라인 모드)\n\n` +
        `관련 정보:\n${relevant.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\n` +
        `더 상세한 분석은 온라인 연결 후 이용 가능합니다.`;
      return { answer, source: 'knowledge', knowledgeUsed: relevant };
    }

    // 완전 오프라인 폴백
    const fallback =
      `⚡ **오프라인 모드** — 현재 서버 연결이 없습니다.\n\n` +
      `이 에이전트의 내장 지식 예시:\n` +
      this.knowledgeBase
        .slice(0, 3)
        .map((k) => `- ${k.slice(0, 60)}${k.length > 60 ? '...' : ''}`)
        .join('\n') +
      `\n\n온라인 연결 시 전문적인 분석을 제공합니다.`;
    return { answer: fallback, source: 'offline_fallback', knowledgeUsed: [] };
  }

  // 스트리밍용: 서버 요청만 수행
  async buildStreamMessages(
    query: string,
    conversationHistory: { role: string; content: string }[] = [],
    additionalContext = ''
  ): Promise<{ messages: { role: string; content: string }[]; knowledgeUsed: string[] }> {
    const relevant = this.searchKnowledge(query);

    let enrichedPrompt = this.agentPrompt;
    if (relevant.length > 0) {
      enrichedPrompt += '\n\n[내장 지식베이스]\n' + relevant.map((r) => `- ${r}`).join('\n');
    }
    if (additionalContext) {
      enrichedPrompt += '\n\n' + additionalContext;
    }

    const messages = [
      { role: 'system', content: enrichedPrompt },
      ...conversationHistory.slice(-20),
      { role: 'user', content: query },
    ];

    return { messages, knowledgeUsed: relevant };
  }

  private async callServer(
    message: string,
    systemPrompt: string,
    history: { role: string; content: string }[] = []
  ): Promise<string> {
    const res = await fetch(VLLM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          ...history.slice(-20),
          { role: 'user', content: message },
        ],
        max_tokens: 4096,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(90000),
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '응답 생성 실패';
  }
}
