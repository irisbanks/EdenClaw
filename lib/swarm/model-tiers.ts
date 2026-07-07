// 자율 루프용 실제 모델 티어 (raw HTTP — 코드베이스의 기존 provider 호출 방식과 일치)
// 에스컬레이션 순서: ① 튜닝 Gemma 31B(무가스, 로컬 vLLM) → ② OpenAI gpt-4o → ③ Claude(최종 방어선)
import type { LoopMessage, ModelTier } from './autonomous-loop';

function chatCompletionsUrl(baseUrl: string): string {
  const root = baseUrl.trim().replace(/\/+$/, '');
  if (root.endsWith('/chat/completions')) return root;
  if (root.endsWith('/v1')) return `${root}/chat/completions`;
  return `${root}/v1/chat/completions`;
}

/** OpenAI 호환(Gemma 로컬 vLLM / OpenAI) 호출. 실패 시 throw → 루프가 에스컬레이션. */
async function oaiCompatGenerate(
  baseUrl: string,
  apiKey: string | undefined,
  model: string,
  system: string,
  messages: LoopMessage[]
): Promise<{ text: string; provider: string }> {
  const res = await fetch(chatCompletionsUrl(baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, ...messages],
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error(`${model} HTTP ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[]; model?: string };
  const text = data.choices?.[0]?.message?.content ?? '';
  if (!text.trim()) throw new Error(`${model} 빈 응답`);
  return { text, provider: data.model || model };
}

/** Claude 최종 티어 — Anthropic raw HTTP (기존 코드베이스와 동일 방식). 기본 모델은 최신 claude-opus-4-8. */
async function claudeGenerate(system: string, messages: LoopMessage[]): Promise<{ text: string; provider: string }> {
  const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY 미설정');
  const model = process.env.CLAUDE_MODEL || 'claude-opus-4-8';
  // 60s 서버리스 윈도우 내 응답을 위해 비스트리밍 + 보수적 max_tokens.
  // (밤샘 백그라운드 워커 버전에서는 스트리밍 + adaptive thinking으로 확장 — 후속 작업)
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Claude HTTP ${res.status} ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as { content?: { type?: string; text?: string }[]; model?: string };
  const text = Array.isArray(data.content)
    ? data.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
    : '';
  if (!text.trim()) throw new Error('Claude 빈 응답');
  return { text, provider: `Claude (${data.model || model})` };
}

/** 기본 3티어 에스컬레이션 사다리: Gemma 31B → gpt-4o → Claude. */
export function defaultModelTiers(): ModelTier[] {
  return [
    {
      key: 'gemma-31b',
      label: 'Gemma 31B Private Engine',
      gasPerCall: 0,
      generate: (system, messages) =>
        oaiCompatGenerate(
          process.env.GEMMA_LOCAL_URL || 'http://localhost:1234/v1',
          process.env.GEMMA_LOCAL_API_KEY || 'gemma-31b-token',
          process.env.GEMMA_PRIVATE_MODEL || 'gemma-31b-edenclaw',
          system,
          messages
        ),
    },
    {
      key: 'gpt-4o',
      label: 'OpenAI gpt-4o',
      gasPerCall: Number(process.env.T4_GAS_CHARGE) || 15_000,
      generate: (system, messages) => {
        if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY 미설정');
        return oaiCompatGenerate(
          'https://api.openai.com/v1',
          process.env.OPENAI_API_KEY,
          process.env.OPENAI_PREMIUM_MODEL || 'gpt-4o',
          system,
          messages
        );
      },
    },
    {
      key: 'claude',
      label: 'Claude (최종 방어선)',
      gasPerCall: Number(process.env.PREMIUM_FINAL_GAS_CHARGE) || 25_000,
      generate: claudeGenerate,
    },
  ];
}
