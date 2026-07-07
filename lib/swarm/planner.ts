// 대화형 기획 엔진: 질문에 먼저 답하고, 대화를 누적해 구조화된 기획서(spec)를 수립한다.
// spec.ready 가 되면 specToBuildPrompt()로 OMX 자율 빌드 루프에 그대로 넘긴다.
import type { LoopMessage, ModelTier } from './autonomous-loop';

export interface PlanSpec {
  title?: string;
  summary?: string;
  decisions?: Record<string, string>;
  requirements?: string[];
  open_questions?: string[];
  deliverables?: string[];
}

export interface PlannerResult {
  answer: string;
  spec: PlanSpec;
  questions: string[];
  ready: boolean;
  provider: string;
}

export interface PlannerOptions {
  history?: LoopMessage[];
  message: string;
  priorSpec?: PlanSpec;
  tiers: ModelTier[];
}

const PLANNER_SYSTEM = `너는 에덴클로의 수석 기획 아키텍트다. 두 가지를 동시에 한다.
1) 사용자의 기술 질문에 먼저 명확하고 실용적으로 답한다(과장 없이, 핵심 + 다음에 결정할 질문 포함).
2) 전체 대화를 바탕으로 구조화된 '기획서(spec)'를 누적·갱신한다.
반드시 아래 JSON 객체 "하나만" 출력하라. 마크다운/코드펜스/설명문 금지.
{
  "answer": "사용자에게 보여줄 한국어 답변(질문에 대한 답 + 다음 결정 질문)",
  "spec": {
    "title": "프로젝트 제목",
    "summary": "한 줄 개요",
    "decisions": { "키": "확정된 값" },
    "requirements": ["확정 요구사항"],
    "open_questions": ["아직 결정 안 된 핵심 질문"],
    "deliverables": ["생성할 산출물(파일/모듈)"]
  },
  "ready": false
}
규칙: 이미 확정된 결정은 spec.decisions/requirements에 누적 유지하라. 미정은 open_questions에.
하드웨어/통신방식/언어/핵심 산출물이 충분히 확정돼 개발을 시작해도 될 때만 ready=true.`;

function parsePlannerJson(raw: string): Partial<PlannerResult> & { spec?: PlanSpec } | null {
  let t = (raw ?? '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  try {
    const obj = JSON.parse(t) as { answer?: unknown; spec?: unknown; ready?: unknown };
    return {
      answer: typeof obj.answer === 'string' ? obj.answer : undefined,
      spec: obj.spec && typeof obj.spec === 'object' ? (obj.spec as PlanSpec) : undefined,
      ready: Boolean(obj.ready),
    };
  } catch {
    return null;
  }
}

/** 한 번의 기획 대화 턴. tiers를 순서대로 시도(폴백)하며 첫 성공 응답을 사용. */
export async function runPlannerTurn(opts: PlannerOptions): Promise<PlannerResult> {
  const { message, tiers } = opts;
  const priorSpec = opts.priorSpec ?? {};
  const history = (opts.history ?? []).filter((m) => m.role === 'user' || m.role === 'assistant');
  const userContent = `[현재까지의 기획서(JSON)]\n${JSON.stringify(priorSpec)}\n\n[사용자 메시지]\n${message}`;
  const messages: LoopMessage[] = [...history, { role: 'user', content: userContent }];

  let lastError = '';
  for (const tier of tiers) {
    let text = '';
    let provider = tier.label;
    try {
      const gen = await tier.generate(PLANNER_SYSTEM, messages);
      text = gen.text;
      provider = gen.provider;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      continue; // 다음 티어로 폴백
    }
    if (!text.trim()) continue;

    const parsed = parsePlannerJson(text);
    if (parsed && (parsed.answer || parsed.spec)) {
      const spec = parsed.spec ?? priorSpec;
      return {
        answer: parsed.answer ?? text,
        spec,
        questions: spec.open_questions ?? [],
        ready: Boolean(parsed.ready),
        provider,
      };
    }
    // JSON 파싱 실패 → 평문 답변으로 처리(대화는 끊기지 않게)
    return { answer: text, spec: priorSpec, questions: priorSpec.open_questions ?? [], ready: false, provider };
  }
  throw new Error(`모든 기획 모델 실패: ${lastError || '가용 엔드포인트 없음'}`);
}

/** 확정된 기획서를 OMX 빌드 루프용 프롬프트로 변환. */
export function specToBuildPrompt(spec: PlanSpec): string {
  const lines: string[] = ['아래 기획서(spec)에 따라 완전히 컴파일되는 구현을 생성하라.'];
  if (spec.title) lines.push(`제목: ${spec.title}`);
  if (spec.summary) lines.push(`개요: ${spec.summary}`);
  if (spec.decisions && Object.keys(spec.decisions).length) {
    lines.push(`결정사항: ${Object.entries(spec.decisions).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  }
  if (spec.requirements?.length) lines.push(`요구사항:\n- ${spec.requirements.join('\n- ')}`);
  if (spec.deliverables?.length) lines.push(`산출물:\n- ${spec.deliverables.join('\n- ')}`);
  return lines.join('\n');
}
