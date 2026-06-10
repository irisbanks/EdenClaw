interface VllmOptions {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}

interface VllmChoice {
  message?: { content?: string };
}

interface VllmResponse {
  choices?: VllmChoice[];
  usage?: { total_tokens?: number };
}

export interface VllmResult {
  content: string;
  /** 실제 LLM 응답인지, mock 폴백인지 */
  source: 'llm' | 'mock';
  /** 실제 LLM 호출 시 총 토큰(usage 우선, 없으면 길이 추정). mock 이면 0. */
  totalTokens: number;
}

/** 대략적 토큰 추정 (provider usage 미제공 시 폴백): 4 chars ≈ 1 token */
function estimateTokens(text: string): number {
  return Math.ceil((text?.length || 0) / 4);
}

/**
 * VLLM 호출 + 사용량/출처 메타데이터 반환.
 * 토큰 미터링이 필요한 호출부(예: 결제 가드 연동)에서 사용한다.
 * mock 폴백 시 totalTokens=0 으로 과금되지 않는다.
 */
export async function callVllmDetailed(options: VllmOptions, mock: () => string): Promise<VllmResult> {
  const baseUrl = process.env.VLLM_BASE_URL;
  if (!baseUrl) return { content: mock(), source: 'mock', totalTokens: 0 };

  try {
    const url = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.VLLM_MODEL || 'Qwen/Qwen2.5-72B-Instruct',
        messages: [
          { role: 'system', content: options.system },
          { role: 'user', content: options.user },
        ],
        max_tokens: options.maxTokens ?? 600,
        temperature: options.temperature ?? 0.2,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { content: mock(), source: 'mock', totalTokens: 0 };
    const data = (await res.json()) as VllmResponse;
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return { content: mock(), source: 'mock', totalTokens: 0 };
    const totalTokens =
      Number(data.usage?.total_tokens) ||
      estimateTokens(options.system) + estimateTokens(options.user) + estimateTokens(content);
    return { content, source: 'llm', totalTokens };
  } catch {
    return { content: mock(), source: 'mock', totalTokens: 0 };
  }
}

/** 하위 호환 래퍼 — 콘텐츠 문자열만 필요한 기존 호출부용 */
export async function callVllmOrMock(options: VllmOptions, mock: () => string): Promise<string> {
  return (await callVllmDetailed(options, mock)).content;
}

export function safeJsonParse<T>(text: string, fallback: T): T {
  try {
    const clean = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    return JSON.parse(clean) as T;
  } catch {
    return fallback;
  }
}
