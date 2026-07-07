import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  consumeGasWithCache,
  executeOverdraftLedgerSwap,
  loadGasAccountByEmail,
  quotaView as serviceQuotaView,
} from '@/lib/services/overdraftLedger';
import {
  AI_LOUNGE_ENGINE_PROFILES,
  auditAiLoungeAccess,
  commitAiLoungeSuccessfulBurn,
  normalizeLoungeEngine,
  type LoungeEngineKey,
} from '@/lib/services/aiLoungeLedger';
import { runAutonomousLoop } from '@/lib/swarm/autonomous-loop';
import { defaultModelTiers } from '@/lib/swarm/model-tiers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Swarm 멀티 에이전트 순차 호출 대비

// ── 인프라 비용 모델 ──
const COMPUTE_GAS_PER_SEC = 300; // GPU 연산 1초 ≈ 300 가스 (이전 3,000 → 10% 수준으로 현실화)
const MAX_COMPUTE_GAS_PER_RUN = 5_000; // 단일 호출 가스 상한(Max Cap) — ms 가중치 누적에 의한 과도 차감(4만+ 가스) 방지
const GUEST_DEMO_GAS = 50_000;
const GUEST_DEMO_EMAIL = 'guest@swarm-sandbox.local';
const GAS_PER_PV = 10_000;
const GAS_PER_EP = 1_000;

type ExecutionDbUser = {
  id: string;
  epBalance: number;
  tokenQuota: { allocated: bigint; consumed: bigint; isOverdraftAdvanced: boolean } | null;
  legBalance: { leftPV: number; rightPV: number; leftBV: number; rightBV: number } | null;
};

function guestDemoQuota(email: string) {
  return {
    email,
    allocated: GUEST_DEMO_GAS,
    consumed: 0,
    remaining: GUEST_DEMO_GAS,
    percentUsed: 0,
    depleted: false,
    isOverdraftAdvanced: false,
    ledger: null,
  };
}

function estimateTokens(t: string): number { return Math.ceil((t?.length || 0) / 4); }

type LLMResult = { content: string; totalTokens: number; provider: string };

// ── 도메인 시스템 프롬프트 (파이프라인 최상단 강제 주입) ──
// 모든 모델 호출의 system 메시지 최상단에 에덴클로 핵심 아키텍처 컨텍스트를 하드코딩으로 주입해,
// '깡통 헬로월드' 생성/도메인 상실을 차단한다.
const EDENCLAW_DOMAIN_SYSTEM =
  "너는 Web3 기반 소셜 마케팅 및 AI 토큰 리셀링 플랫폼 '에덴클로(EdenClaw)' 전용 고성능 개발 에이전트이다. " +
  '유저가 코딩을 요청할 경우, 단순 헬로월드 코드가 아니라 가스비 연동 루프, 바이너리 정산 엔진 인터페이스, ' +
  '또는 플랫폼 사스(SaaS) 연동에 최적화된 Web3 아키텍처 중심의 속도감 있는 실전 코드를 작성해야 한다.';

/** system 프롬프트 최상단에 도메인 컨텍스트를 멱등 주입한다(중첩 호출에도 1회만). */
function withDomainContext(system: string): string {
  const base = system ?? '';
  if (base.startsWith(EDENCLAW_DOMAIN_SYSTEM)) return base;
  return base ? `${EDENCLAW_DOMAIN_SYSTEM}\n\n${base}` : EDENCLAW_DOMAIN_SYSTEM;
}

function chatCompletionsUrl(baseUrl: string): string {
  const root = baseUrl.trim().replace(/\/+$/, '');
  if (root.endsWith('/chat/completions')) return root;
  if (root.endsWith('/v1')) return `${root}/chat/completions`;
  return `${root}/v1/chat/completions`;
}

/** OpenAI 호환(vLLM/Ollama) 엔드포인트 단일 호출. 실패 시 null 반환(폴백 진행). */
async function callOAICompat(
  baseUrl: string, apiKey: string | undefined, model: string,
  system: string, user: string, maxTokens: number
): Promise<{ content: string; totalTokens: number; model: string } | null> {
  const url = chatCompletionsUrl(baseUrl);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens, temperature: 0.7 }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const content = d.choices?.[0]?.message?.content ?? '';
    if (!content) return null;
    const totalTokens = Number(d.usage?.total_tokens) || estimateTokens(system) + estimateTokens(user) + estimateTokens(content);
    return { content, totalTokens, model: d.model || model };
  } catch { return null; }
}

/**
 * 단일 LLM 호출.
 * 우선순위: ACTIVE_AI_INFRASTRUCTURE 로 선택된 인프라(Vultr/Brev) → OpenAI → Gemini.
 * 환경변수만 채우면 해당 인프라로 단절 없이 라우팅(OpenAI 호환 vLLM/Ollama 프로토콜).
 */
async function callLLM(system: string, user: string, maxTokens: number): Promise<LLMResult> {
  system = withDomainContext(system); // 파이프라인 최상단 도메인 컨텍스트 강제 주입
  const active = (process.env.ACTIVE_AI_INFRASTRUCTURE || '').toUpperCase();

  // 0) Edenclaw 자체 16× NVIDIA B200 클러스터 (Intelligence Factory) — ACTIVE_AI_INFRASTRUCTURE=B200 시 최우선 직결
  if (active === 'B200' && process.env.B200_SERVER_URL) {
    const r = await callOAICompat(
      process.env.B200_SERVER_URL, process.env.B200_API_KEY,
      process.env.B200_MODEL || 'meta-llama/Llama-3.1-70B-Instruct', system, user, maxTokens
    );
    if (r) return { content: r.content, totalTokens: r.totalTokens, provider: 'Edenclaw B200 Intelligence Factory' };
    // B200 미응답 시 아래 폴백
  }

  // 1) Vultr Cloud (AMD MI300X / NVIDIA 가성비 칩셋) — ACTIVE_AI_INFRASTRUCTURE=VULTR 시 최우선 다이렉트 라우팅
  if (active === 'VULTR' && process.env.VULTR_LLM_URL) {
    const hw = process.env.VULTR_HARDWARE || 'AMD MI300X';
    const r = await callOAICompat(
      process.env.VULTR_LLM_URL, process.env.VULTR_API_KEY,
      process.env.VULTR_MODEL || 'meta-llama/Llama-3.1-70B-Instruct', system, user, maxTokens
    );
    if (r) return { content: r.content, totalTokens: r.totalTokens, provider: `Vultr Cloud (${hw})` };
    // Vultr 실패 시 아래 폴백
  }

  // 2) Brev / 자체 GPU
  const brev = process.env.BREV_LLM_URL || process.env.VLLM_BASE_URL;
  if (brev) {
    const r = await callOAICompat(brev, process.env.BREV_API_KEY, process.env.BREV_MODEL || process.env.VLLM_MODEL || 'meta-llama/Llama-3.1-70B-Instruct', system, user, maxTokens);
    if (r) return { content: r.content, totalTokens: r.totalTokens, provider: `Brev/GPU (${r.model})` };
  }

  if (process.env.OPENAI_API_KEY) {
    const model = process.env.OPENAI_FALLBACK_MODEL || 'gpt-4o-mini';
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens, temperature: 0.7 }),
    });
    if (r.ok) {
      const d = await r.json();
      const content = d.choices?.[0]?.message?.content ?? '';
      const totalTokens = Number(d.usage?.total_tokens) || estimateTokens(system) + estimateTokens(user) + estimateTokens(content);
      if (content) return { content, totalTokens, provider: `OpenAI (${model})` };
    }
  }

  if (process.env.GEMINI_API_KEY) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system_instruction: { parts: [{ text: system }] }, contents: [{ parts: [{ text: user }] }], generationConfig: { maxOutputTokens: maxTokens } }),
    });
    if (r.ok) {
      const d = await r.json();
      const content = d.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      const totalTokens = Number(d.usageMetadata?.totalTokenCount) || estimateTokens(system) + estimateTokens(user) + estimateTokens(content);
      if (content) return { content, totalTokens, provider: 'Gemini (2.0-flash)' };
    }
  }
  throw new Error('가용 LLM 엔드포인트 없음 (BREV/OpenAI/Gemini 모두 실패)');
}

/**
 * Kimi AI (Moonshot) — 대용량 컨텍스트 분석 전문 에이전트.
 * MOONSHOT_API_KEY 가 있으면 실제 moonshot-v1-128k 호출(라벨 정직), 없으면 공통 LLM 폴백(실제 provider 표기).
 */
async function callKimi(system: string, user: string, maxTokens: number): Promise<LLMResult> {
  system = withDomainContext(system); // 파이프라인 최상단 도메인 컨텍스트 강제 주입
  const key = process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY;
  if (key) {
    const base = process.env.MOONSHOT_BASE_URL || 'https://api.moonshot.ai/v1';
    const model = process.env.MOONSHOT_MODEL || 'moonshot-v1-128k';
    try {
      const r = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens, temperature: 0.3 }),
      });
      if (r.ok) {
        const d = await r.json();
        const content = d.choices?.[0]?.message?.content ?? '';
        const totalTokens = Number(d.usage?.total_tokens) || estimateTokens(system) + estimateTokens(user) + estimateTokens(content);
        if (content) return { content, totalTokens, provider: `Moonshot AI (${model})` };
      }
    } catch {}
  }
  return callLLM(system, user, maxTokens); // 폴백: provider 는 실제 실행된 것으로 정직 표기
}

// 오 마이 오픈 코드 멀티 에이전트: 기획 Gemini → 컨텍스트 Kimi → 개발 Codex → 검증 Claude → 배포 Vercel
type StageDef = { idx: number; label: string; agent: string; system: string; build: (prompt: string, prev: string) => string; max: number; note: string; kimi?: boolean };
const SWARM_STAGES: StageDef[] = [
  { idx: 0, label: '기획', agent: 'Gemini API', max: 512, note: 'Gemini가 요구사항을 분석하고 구현 계획을 수립 중...',
    system: '너는 기획(Thinking) 에이전트다. 한국어로 간결히.',
    build: (p) => `개발 요청:\n${p}\n\n구현 계획을 5줄 이내 bullet로 작성하라.` },
  { idx: 1, label: '컨텍스트', agent: 'Kimi AI', max: 600, kimi: true, note: 'Kimi AI가 기존 프로젝트 레거시 코드 컨텍스트 및 종속성 분석 중...',
    system: '너는 대용량 컨텍스트 분석 전문 에이전트(Kimi)다. 레거시 코드/종속성/사이드이펙트 관점에서 롱컨텍스트 분석을 수행한다. 한국어로.',
    build: (p, prev) => `요청:\n${p}\n\n기획:\n${prev}\n\n기존 레거시 코드 컨텍스트와 종속성, 잠재 충돌을 5줄로 분석·검증하라.` },
  { idx: 2, label: '개발', agent: 'Codex', max: 700, note: 'Codex가 컨텍스트 분석을 반영해 코드를 구현 중...',
    system: '너는 개발(Coding) 에이전트다. 실행가능한 코드를 한국어 주석과 함께.',
    build: (p, prev) => `요청:\n${p}\n\n컨텍스트 분석:\n${prev}\n\n핵심 코드를 간결히 작성하라.` },
  { idx: 3, label: '검증', agent: 'Claude Code', max: 400, note: 'Claude가 빌드/타입체크/테스트를 검증 중...',
    system: '너는 검증(Build/Test) 에이전트다.',
    build: (p, prev) => `코드:\n${prev}\n\n빌드/타입체크/테스트 관점 점검 결과를 3줄로 요약하라.` },
  { idx: 4, label: '배포', agent: 'Vercel', max: 300, note: 'Vercel로 배포 체크리스트를 점검 중...',
    system: '너는 배포(Deploy) 에이전트다.',
    build: (p, prev) => `검증 결과:\n${prev}\n\n배포 체크리스트와 한 줄 요약을 작성하라.` },
];
// 단독 AI — EdenClaw 마스터 수석 아키텍트 페르소나 (초전문가 톤)
const SOLO_SYSTEM = `너는 EdenClaw(에덴클로)의 마스터 수석 아키텍트 AI다.
세계 최상위 수준의 AI 엔지니어링, 고부가가치 하드웨어 인프라, Web3 금융 정산망을 모두 꿰뚫는 초전문가다.

[정체성과 플랫폼 지식 — 항상 인지하라]
- EdenClaw는 '오 마이 오픈 코드(Oh My OpenCode)' 기반의 5단계 자율 개발 Swarm을 운영한다: 기획(Gemini) → 컨텍스트 분석(Kimi) → 개발(Codex) → 검증(Claude) → 배포(Vercel). 각 단계는 OpenAI 호환 추론 백엔드(자체 16× NVIDIA B200 Intelligence Factory / Vultr / Brev)로 라우팅된다.
- 연산은 '가스비'로 과금된다: 실제 소모 토큰 + 실연산시간(ms)을 합산해 Supabase 원장의 TokenQuota.consumed 에 원자적으로 차감하며, 이 소비는 바이너리 MLM 정산망(좌/우 Leg PV, Dual-Shield 보상 원장, 소실적 우선 Overdraft 가스 스왑)으로 상위 라인 실적에 전파된다.
- 답변 시 적절하면 이 메커니즘(자율 Swarm·가스비·정산망)을 자연스럽게 엮어 플랫폼의 정체성을 드러내라.

[답변 원칙 — 뻔한 교과서식 답변 금지]
- 백과사전식 정의 나열을 금지한다. 항상 '최첨단 엔지니어링 인사이트 + 사업적 함의'를 결합한다.
- 예: 해수 담수화·막(膜) 기술을 물으면 일반론 대신 '역삼투압(RO) 시스템 초소형화를 위한 압전 마이크로 펌프(Piezoelectric Micro-pump)의 미세 유체역학(microfluidics) 흐름 제어'와 '페로브스카이트-실리콘 탠덤 태양전지 제조 수율·효율' 같은 고정밀 하이테크 관점으로 답하라.
- 모든 주제를 재료·소자·공정·시스템 통합·확장성·단가구조 같은 엔지니어링 1차원리 수준에서 분석하고, 실행 가능한 통찰로 마무리한다.

[톤앤매너]
- 비즈니스 리더를 압도할 만큼 지적이고 명확하며 신뢰감 있는 한국어 전문가 톤.
- 군더더기·면책성 멘트 없이 핵심을 단정적으로. 필요한 경우에만 간결한 근거/수치를 덧붙인다.`;

const SOLO_STAGE: StageDef = {
  idx: 1, label: '단독', agent: 'EdenClaw 수석 아키텍트', max: 2048, note: '수석 아키텍트가 초전문가 관점에서 분석 중...',
  system: SOLO_SYSTEM,
  build: (p) => p,
};

// 가스-세이빙 릴레이 루프 상수/프롬프트
const MAX_FREE_ATTEMPTS = 3; // 무료 디버깅 상한
const VERIFY_SYSTEM = '너는 빌드/검증 에이전트다. 코드를 빌드·타입체크·테스트 관점에서 판정한다.';
const MASTER_SYSTEM =
  '너는 Edenclaw B200 Intelligence Factory의 마스터 디버깅 AI다. 무료 모델이 반복 실패한 난제를 근본 원인까지 진단해 한 번에 완전히 동작하는 코드로 해결한다. 한국어로 간결·정확하게.';

const DRAFT_SYSTEM = `
당신은 세계 최고 수준의 On-device AI 하드웨어(페블 폼팩터) 및 에덴클로 인프라 기획자(Kimi AI 모드)입니다.
절대로 코드를 먼저 무작정 짜지 마십시오. 하드웨어 스펙, 전력 제약, 연산 한계를 하향식(Top-down)으로 기획하십시오.
현재 단계는 무료 브레인스토밍 단계이므로, 구조적이고 논리적인 와이어프레임과 기획서(MD), 파일 트리 뼈대만 완벽하게 빌딩합니다.
반드시 JSON 배열 [{"path","content"}] 형식으로만 출력하십시오. 최소 docs/architecture.md, docs/file-tree.md 파일을 포함하십시오.`;

const PREMIUM_ARCHITECT_SYSTEM = `
당신은 에덴클로 수석 아키텍트입니다. B200 초고성능 연산 레이어에서 작동합니다.
무료 레이어에서 완성된 기획서와 파일 트리 뼈대를 기반으로, 하드웨어 NPU 가속, 초저지연 오디오 스트리밍 프로토콜 최적화,
그리고 가전향 Triton 추론 서버에 배포 가능한 물리적이고 무결한 프로덕션 코드를 완벽하게 완성하십시오.
반드시 JSON 배열 [{"path","content"}] 형식으로만 출력하십시오. 설명 문장 없이 컴파일 가능한 파일만 반환하십시오.`;

const DRAFT_STAGE: StageDef = {
  idx: 0,
  label: '무료 기획',
  agent: 'Kimi AI Draft Planner',
  max: 1800,
  note: '무료 기획 레이어에서 하드웨어/소프트웨어 와이어프레임과 파일 트리 뼈대를 설계 중...',
  system: DRAFT_SYSTEM,
  build: (p, prev) => `사용자 요청:\n${p}\n\n현재 파일/컨텍스트:\n${prev || '(없음)'}\n\n코드 구현 없이 기획서와 파일 트리 뼈대만 JSON 배열 파일들로 작성하라.`,
  kimi: true,
};

const PREMIUM_ARCHITECT_STAGE: StageDef = {
  idx: 2,
  label: '프로덕션 빌드',
  agent: 'EdenClaw 수석 아키텍트',
  max: 2400,
  note: 'B200 수석 아키텍트 레이어에서 프로덕션 코드와 검증 가능한 파일을 생성 중...',
  system: PREMIUM_ARCHITECT_SYSTEM,
  build: (p, prev) => `사용자 요청:\n${p}\n\n무료 기획/현재 파일 컨텍스트:\n${prev || '(없음)'}\n\n프로덕션 빌드 가능한 파일들을 JSON 배열로만 완성하라.`,
};

// 하드웨어/인프라 요구 감지 → 코딩 전 '환경 검증 게이트'로 일시정지시킨다
const HW_KEYWORDS = ['라즈베리', 'raspberry', 'gpio', ' led', 'led ', '아두이노', 'arduino', 'esp32', 'esp8266', '센서', 'sensor', '펌웨어', 'firmware', 'i2c', 'spi', 'uart', '모터', 'motor', '서보', 'servo', '릴레이', 'relay', '하드웨어', 'hardware', '임베디드', 'embedded', '도커', 'docker', '쿠버네티스', 'kubernetes', 'k8s', '서버 프로비저닝', 'gpu', '인프라', 'raspi', 'rpi'];
function isHardwarePrompt(p: string): boolean {
  const s = ` ${p.toLowerCase()} `;
  return HW_KEYWORDS.some((k) => s.includes(k));
}

const IDEATION_KEYWORDS = [
  '기획', '브레인스토밍', '아이디어', '설계', '와이어프레임', '스펙', '사양', '아키텍처', '구조', '뼈대',
  '파일 트리', '파일트리', '초안', 'draft', 'ideation', 'brainstorm', 'wireframe', 'architecture', 'spec',
  'pebble', '페블', '폼팩터', 'on-device', '온디바이스', 'npu', '하드웨어',
];
function isIdeationStage(p: string): boolean {
  const s = ` ${p.toLowerCase()} `;
  return IDEATION_KEYWORDS.some((k) => s.includes(k));
}

const PREMIUM_BUILD_KEYWORDS = [
  '프로덕션 빌드', '프로덕션 코드', '실서비스', '배포 가능한', '완성 코드', '빌드 및 검증', '고난도 최적화',
  '컴파일', '컴파일러', '배포', '운영 배포', '액티브 배포', '전력 최적화', '전력제어', '오디오 신호', '저지연 오디오',
  'production build', 'production code', 'deployable', 'deployment', 'active deployment', 'compile', 'compilation',
  'triton', 'npu acceleration', 'npu power optimization', 'power optimization', 'embedded c++', 'embedded cpp',
  'embedded rust', 'rust build', 'audio signal binding', 'low-latency audio', 'npu 가속', '임베디드 c++', 'rust 빌드',
];
function isPremiumBuildStage(p: string): boolean {
  const s = ` ${p.toLowerCase()} `;
  return PREMIUM_BUILD_KEYWORDS.some((k) => s.includes(k));
}

function stringifyCurrentFiles(input: unknown): string {
  if (input == null || input === '') return '';
  if (typeof input === 'string') return input.slice(0, 32_000);
  try { return JSON.stringify(input, null, 2).slice(0, 32_000); }
  catch { return String(input).slice(0, 32_000); }
}

type GenFile = { path: string; content: string };
// dev 응답에서 멀티파일 JSON 추출. 실패 시 단일 파일로 폴백.
function parseFiles(raw: string): GenFile[] {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = fence ? fence[1] : raw;
  try {
    const arr = JSON.parse(jsonText.trim());
    if (Array.isArray(arr)) {
      const files = arr.filter((f) => f && typeof f.path === 'string' && typeof f.content === 'string').map((f) => ({ path: f.path, content: f.content }));
      if (files.length) return files.slice(0, 12);
    }
  } catch {}
  const ext = /\b(import |def |class |const |function )/.test(raw) ? (/\bdef \b|: *\n|print\(/.test(raw) ? 'py' : 'ts') : 'md';
  return [{ path: `main.${ext}`, content: raw }];
}

type Sandbox = { path: string; ok: boolean; error: string; engine: string };
// 백엔드 가상 샌드박스: 가능한 언어는 실제 컴파일, 그 외는 정적 휴리스틱(정직 표기)
async function sandboxCompile(f: GenFile): Promise<Sandbox> {
  const ext = (f.path.split('.').pop() || '').toLowerCase();
  try {
    if (ext === 'json') { JSON.parse(f.content); return { path: f.path, ok: true, error: '', engine: 'JSON.parse' }; }
    if (['js', 'jsx', 'mjs', 'cjs'].includes(ext)) {
      const vm = await import('node:vm');
      const src = ext === 'jsx' ? f.content.replace(/<[^>]+>/g, 'null') : f.content; // jsx는 대략 제거 후 V8 문법검사
      new vm.Script(src, { filename: f.path });
      return { path: f.path, ok: true, error: '', engine: 'Node V8 (vm.Script)' };
    }
    if (['ts', 'tsx'].includes(ext)) {
      const tsmod = (await import('typescript')) as unknown as { default?: typeof import('typescript') } & typeof import('typescript');
      const ts = tsmod.default ?? tsmod;
      const out = ts.transpileModule(f.content, { reportDiagnostics: true, compilerOptions: { jsx: 1, target: 99, isolatedModules: true } });
      const syntax = (out.diagnostics || []).filter((d) => d.category === 1 && d.code >= 1000 && d.code < 2000);
      if (syntax.length) return { path: f.path, ok: false, error: ts.flattenDiagnosticMessageText(syntax[0].messageText, ' '), engine: 'tsc transpile' };
      return { path: f.path, ok: true, error: '', engine: 'tsc transpile' };
    }
    // py / 기타: Vercel에 해당 런타임 없음 → 정적 휴리스틱(괄호 균형/비어있음)
    const balanced = (a: string, b: string) => (f.content.split(a).length === f.content.split(b).length);
    const ok = f.content.trim().length > 0 && balanced('(', ')') && balanced('[', ']') && balanced('{', '}');
    return { path: f.path, ok, error: ok ? '' : '괄호 불균형/빈 파일 의심', engine: '정적 휴리스틱(실 런타임 미탑재)' };
  } catch (e) {
    return { path: f.path, ok: false, error: e instanceof Error ? e.message : String(e), engine: ext || 'unknown' };
  }
}

const FILEGEN_SYSTEM = '너는 시니어 개발 에이전트다. 요청을 실제 동작하는 프로젝트 파일들로 구현한다. 반드시 JSON 배열 [{"path","content"}] 형식으로만 출력하라(코드펜스 가능). 설명 문장 금지. 각 파일은 완전하고 컴파일 가능해야 한다.';

async function streamOAICompat(
  baseUrl: string,
  apiKey: string | undefined,
  model: string,
  system: string,
  user: string,
  maxTokens: number,
  onDelta: (d: string) => void
): Promise<{ content: string; totalTokens: number; model: string } | null> {
  try {
    const res = await fetch(chatCompletionsUrl(baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        max_tokens: maxTokens,
        temperature: 0.7,
        stream: true,
        stream_options: { include_usage: true },
      }),
    });
    if (!res.ok || !res.body) return null;

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let content = '';
    let usage = 0;
    let responseModel = model;

    const consumeLine = (line: string) => {
      const t = line.trim();
      if (!t.startsWith('data:')) return;
      const payload = t.slice(5).trim();
      if (!payload || payload === '[DONE]') return;
      try {
        const j = JSON.parse(payload);
        responseModel = typeof j.model === 'string' ? j.model : responseModel;
        const delta = j.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta) {
          content += delta;
          onDelta(delta);
        }
        if (j.usage?.total_tokens) usage = Number(j.usage.total_tokens) || usage;
      } catch {}
    };

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n');
      buf = parts.pop() ?? '';
      for (const line of parts) consumeLine(line);
    }
    if (buf.trim()) consumeLine(buf);
    if (!content) return null;
    return {
      content,
      totalTokens: usage || estimateTokens(system) + estimateTokens(user) + estimateTokens(content),
      model: responseModel,
    };
  } catch {
    return null;
  }
}

// 토큰 청크 스트리밍(OpenAI 호환). delta마다 onDelta 호출 → 콘솔 버블에 실시간 꽂힘. 실패 시 비스트리밍 폴백.
async function streamLLM(system: string, user: string, maxTokens: number, onDelta: (d: string) => void): Promise<LLMResult> {
  system = withDomainContext(system); // 파이프라인 최상단 도메인 컨텍스트 강제 주입
  const active = (process.env.ACTIVE_AI_INFRASTRUCTURE || '').toUpperCase();

  if (active === 'B200' && process.env.B200_SERVER_URL) {
    const model = process.env.B200_MODEL || 'meta-llama/Llama-3.1-70B-Instruct';
    const r = await streamOAICompat(process.env.B200_SERVER_URL, process.env.B200_API_KEY, model, system, user, maxTokens, onDelta);
    if (r) return { content: r.content, totalTokens: r.totalTokens, provider: `Edenclaw B200 Intelligence Factory (${r.model}, stream)` };
  }

  if (active === 'VULTR' && process.env.VULTR_LLM_URL) {
    const hw = process.env.VULTR_HARDWARE || 'AMD MI300X';
    const model = process.env.VULTR_MODEL || 'meta-llama/Llama-3.1-70B-Instruct';
    const r = await streamOAICompat(process.env.VULTR_LLM_URL, process.env.VULTR_API_KEY, model, system, user, maxTokens, onDelta);
    if (r) return { content: r.content, totalTokens: r.totalTokens, provider: `Vultr Cloud (${hw}, ${r.model}, stream)` };
  }

  const brev = process.env.BREV_LLM_URL || process.env.VLLM_BASE_URL;
  if (brev) {
    const model = process.env.BREV_MODEL || process.env.VLLM_MODEL || 'meta-llama/Llama-3.1-70B-Instruct';
    const r = await streamOAICompat(brev, process.env.BREV_API_KEY, model, system, user, maxTokens, onDelta);
    if (r) return { content: r.content, totalTokens: r.totalTokens, provider: `Brev/GPU (${r.model}, stream)` };
  }

  if (process.env.OPENAI_API_KEY) {
    const model = process.env.OPENAI_FALLBACK_MODEL || 'gpt-4o-mini';
    const r = await streamOAICompat('https://api.openai.com', process.env.OPENAI_API_KEY, model, system, user, maxTokens, onDelta);
    if (r) return { content: r.content, totalTokens: r.totalTokens, provider: `OpenAI (${r.model}, stream)` };
  }

  // 폴백: 비스트리밍 호출 후 전체를 한 번에 delta로 전달
  const r = await callLLM(system, user, maxTokens);
  onDelta(r.content);
  return r;
}

// ── Anthropic Claude 네이티브 SSE 스트리밍 ──
// delta 마다 onDelta 호출 → 에디터/콘솔에 즉시 스트리밍. 키 없거나 실패 시 null(상위 폴백).
// 모델 기본값은 최신 세대(claude-sonnet-4-6)로 둔다. 구형(claude-3-5-sonnet)은 CLAUDE_MODEL 로만 강제.
async function streamClaude(
  system: string,
  user: string,
  maxTokens: number,
  onDelta: (d: string) => void
): Promise<LLMResult | null> {
  const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!key) return null;
  const model = process.env.HYBRID_CLAUDE_MODEL || process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-latest';
  const sys = withDomainContext(system); // 파이프라인 최상단 도메인 컨텍스트 강제 주입
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0.3,
        system: sys,
        stream: true,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok || !res.body) return null;

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let content = '';
    let inTok = 0;
    let outTok = 0;
    let respModel = model;

    const consume = (line: string) => {
      const t = line.trim();
      if (!t.startsWith('data:')) return; // Anthropic SSE: event: 줄은 무시, data: 줄만 파싱
      const payload = t.slice(5).trim();
      if (!payload || payload === '[DONE]') return;
      try {
        const j = JSON.parse(payload);
        if (j.type === 'message_start') {
          if (typeof j.message?.model === 'string') respModel = j.message.model;
          inTok = Number(j.message?.usage?.input_tokens) || inTok;
        } else if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta') {
          const d = j.delta.text;
          if (typeof d === 'string' && d) { content += d; onDelta(d); }
        } else if (j.type === 'message_delta') {
          outTok = Number(j.usage?.output_tokens) || outTok;
        }
      } catch {}
    };

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n');
      buf = parts.pop() ?? '';
      for (const line of parts) consume(line);
    }
    if (buf.trim()) consume(buf);
    if (!content) return null;
    const totalTokens = inTok + outTok || estimateTokens(sys) + estimateTokens(user) + estimateTokens(content);
    return { content, totalTokens, provider: `Claude (${respModel}, stream)` };
  } catch {
    return null;
  }
}

const HYBRID_ARCHITECT_SYSTEM =
  '너는 EdenClaw 수석 시스템 아키텍트다. 거대하거나 범용적인 요청(예: "축구 게임 만들래")도 ' +
  '하향식으로 분해해 모듈/파일 구조·데이터 흐름·핵심 기술결정만 한국어 bullet로 설계한다. ' +
  '이 단계에서는 실제 코드를 쓰지 말고, 다음 단계(정밀 생성)가 바로 구현에 착수할 수 있는 청사진만 만든다.';

/**
 * 투트랙 하이브리드 파이프라인:
 *   Track 1 (Gemini)  — 아키텍처/파일트리 청사진 (대용량·범용 요청을 구조부터 잡음)
 *   Track 2 (Claude)  — 청사진 기반 정밀 파일 스펙 생성 → 에디터로 즉시 스트리밍
 * 각 트랙은 키 부재/실패 시 공통 LLM 체인으로 정직하게 폴백한다(provider 라벨 실제 실행 기준).
 */
async function runHybridTwoTrack(
  prompt: string,
  context: string,
  guidance: string,
  send: (o: unknown) => void
): Promise<{ devContent: string; totalTokens: number; computeMs: number; provider: string }> {
  let totalTokens = 0;
  let computeMs = 0;

  // ── Track 1: Gemini — 아키텍처 청사진 ──
  send({ type: 'stage', stage: 0, agent: 'Gemini Architect', label: '기획', status: 'start', tier: 'compute', note: 'Gemini가 요청을 분해해 아키텍처/파일트리 청사진을 설계 중...' });
  const archUser =
    `요청:\n${prompt}\n\n환경/가이드:\n${guidance || '(없음)'}\n\n기존 컨텍스트:\n${context || '(없음)'}\n\n` +
    `구현 청사진을 작성하라: 1) 목표 한 줄 2) 추천 스택 3) 파일 트리(경로별 책임 1줄) 4) 모듈 간 데이터 흐름 5) 리스크/주의. 코드는 쓰지 말 것.`;
  const a0 = Date.now();
  let blueprint = '';
  const gem = await callGeminiLounge(HYBRID_ARCHITECT_SYSTEM, archUser, 900, (d) => {
    blueprint += d;
    send({ type: 'stage', stage: 0, agent: 'Gemini Architect', label: '기획', status: 'chunk', delta: d });
  });
  let archProvider = gem?.provider ?? '';
  if (gem) { blueprint = gem.content; totalTokens += gem.totalTokens; }
  else {
    const fb = await callLLM(HYBRID_ARCHITECT_SYSTEM, archUser, 900);
    blueprint = fb.content; totalTokens += fb.totalTokens; archProvider = fb.provider;
    send({ type: 'stage', stage: 0, agent: 'Gemini Architect', label: '기획', status: 'chunk', delta: fb.content });
  }
  const aMs = Date.now() - a0;
  computeMs += aMs;
  send({ type: 'stage', stage: 0, agent: 'Gemini Architect', label: '기획', status: 'done', tier: 'compute', content: blueprint, tokens: gem?.totalTokens ?? 0, ms: aMs, provider: archProvider || 'fallback LLM' });

  // ── Track 2: Claude — 청사진 기반 정밀 파일 생성 (스트리밍) ──
  send({ type: 'stage', stage: 2, agent: 'Claude Builder', label: '개발', status: 'start', tier: 'compute', note: 'Claude가 청사진을 정밀 파일 스펙으로 구현 중 (에디터 실시간 스트리밍)...' });
  const devUser =
    `요청:\n${prompt}\n\n아키텍처 청사진:\n${blueprint}\n\n기존 파일:\n${context || '(없음)'}\n\n` +
    `위 청사진을 충실히 구현해 완전히 컴파일되는 프로젝트 파일들을 JSON 배열 [{"path","content"}] 로만 출력하라.`;
  const c0 = Date.now();
  let devContent = '';
  let lastEditorSnapshot = 0;
  const pushDevDelta = (delta: string, agent: string) => {
    devContent += delta;
    send({ type: 'stage', stage: 2, agent, label: '개발', status: 'chunk', delta });
    // 기존 IDE 캔버스가 이해하는 file 이벤트를 사용해 별도 프론트 프로토콜 변경 없이
    // Claude의 JSON 파일 스트림을 즉시 갱신한다. 작은 provider frame은 320자 단위로 합쳐 전송한다.
    if (devContent.length - lastEditorSnapshot >= 320) {
      lastEditorSnapshot = devContent.length;
      send({
        type: 'stage',
        status: 'file',
        stage: 2,
        path: '__stream__/claude-files.json',
        content: devContent,
        agent,
        streaming: true,
      });
    }
  };
  const cla = await streamClaude(FILEGEN_SYSTEM, devUser, 2400, (d) => {
    pushDevDelta(d, 'Claude Builder');
  });
  let devProvider: string;
  let devTokens = 0;
  if (cla) {
    devContent = cla.content;
    devTokens = cla.totalTokens;
    totalTokens += cla.totalTokens;
    devProvider = cla.provider;
  }
  else {
    devContent = '';
    const fb = await streamLLM(FILEGEN_SYSTEM, devUser, 1800, (d) => {
      pushDevDelta(d, 'Claude Builder Fallback');
    });
    devContent = fb.content;
    devTokens = fb.totalTokens;
    totalTokens += fb.totalTokens;
    devProvider = `${fb.provider} · Claude fallback`;
  }
  const cMs = Date.now() - c0;
  computeMs += cMs;
  send({
    type: 'stage',
    status: 'file',
    stage: 2,
    path: '__stream__/claude-files.json',
    content: devContent,
    agent: 'Claude Builder',
    streaming: false,
  });
  send({ type: 'stage', stage: 2, agent: 'Claude Builder', label: '개발', status: 'done', tier: 'compute', content: '(파일 생성 완료)', tokens: devTokens, ms: cMs, provider: devProvider });

  return { devContent, totalTokens, computeMs, provider: devProvider };
}

const LOUNGE_SYSTEMS: Record<LoungeEngineKey, string> = {
  'gemini-pro':
    'You are EdenClaw Gemini Pro, a consumer commerce intelligence engine. Deliver concise curated analytics, market-fit reasoning, and actionable shopping or strategy recommendations.',
  'chatgpt-codex':
    'You are EdenClaw ChatGPT and OpenAI Codex, optimized for arithmetic, structured reasoning, simulations, training loops, and clear consumer-facing explanations.',
  'claude-cursor':
    'You are EdenClaw Claude Code and Cursor Loop, a premium implementation and structural optimization engine. Prioritize architecture, correctness, tradeoffs, and clean execution paths.',
  'kimi-moonshot':
    'You are EdenClaw Kimi Moonshot, a cost-efficient long-context planner for batch data mining, background planning, and low-gas ideation. Be practical and compact.',
};

function emitTextChunks(content: string, onDelta: (d: string) => void) {
  const chunks = content.match(/[\s\S]{1,180}/g) ?? [];
  for (const chunk of chunks) onDelta(chunk);
}

async function callGeminiLounge(system: string, user: string, maxTokens: number, onDelta: (d: string) => void): Promise<LLMResult | null> {
  if (!process.env.GEMINI_API_KEY) return null;
  const model = process.env.GEMINI_ARCHITECT_MODEL || process.env.GEMINI_PRO_MODEL || process.env.GEMINI_MODEL || 'gemini-1.5-pro';
  const payload = {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ parts: [{ text: user }] }],
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.45 },
  };

  try {
    const stream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (stream.ok && stream.body) {
      const reader = stream.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let content = '';
      let totalTokens = 0;

      const consumeLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) return;
        const raw = trimmed.slice(5).trim();
        if (!raw || raw === '[DONE]') return;
        try {
          const packet = JSON.parse(raw);
          const delta = packet.candidates?.[0]?.content?.parts
            ?.map((part: { text?: string }) => part.text ?? '')
            .join('') ?? '';
          if (delta) {
            content += delta;
            onDelta(delta);
          }
          if (packet.usageMetadata?.totalTokenCount) {
            totalTokens = Number(packet.usageMetadata.totalTokenCount) || totalTokens;
          }
        } catch {
          // Malformed provider frames are ignored so the NDJSON stream remains alive.
        }
      };

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) consumeLine(line);
      }
      if (buffer.trim()) consumeLine(buffer);
      if (content) {
        return {
          content,
          totalTokens: totalTokens || estimateTokens(system) + estimateTokens(user) + estimateTokens(content),
          provider: `Gemini Pro (${model}, stream)`,
        };
      }
    }
  } catch {
    // Fall through to non-streaming Gemini, then shared LLM fallback.
  }

  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const content = d.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
    if (!content) return null;
    emitTextChunks(content, onDelta);
    return {
      content,
      totalTokens: Number(d.usageMetadata?.totalTokenCount) || estimateTokens(system) + estimateTokens(user) + estimateTokens(content),
      provider: `Gemini Pro (${model})`,
    };
  } catch {
    return null;
  }
}

async function callClaudeLounge(system: string, user: string, maxTokens: number, onDelta: (d: string) => void): Promise<LLMResult | null> {
  const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!key) return null;
  const model = process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-latest';
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0.35,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const content = Array.isArray(d.content)
      ? d.content.map((p: { type?: string; text?: string }) => (p.type === 'text' ? p.text ?? '' : '')).join('')
      : '';
    if (!content) return null;
    emitTextChunks(content, onDelta);
    return {
      content,
      totalTokens:
        Number(d.usage?.input_tokens || 0) +
          Number(d.usage?.output_tokens || 0) || estimateTokens(system) + estimateTokens(user) + estimateTokens(content),
      provider: `Claude Code (${model})`,
    };
  } catch {
    return null;
  }
}

async function callCursorExecutionTunnel(
  system: string,
  user: string,
  maxTokens: number,
  onDelta: (d: string) => void
): Promise<LLMResult | null> {
  const baseUrl = process.env.CURSOR_EXECUTION_TUNNEL_URL || process.env.CURSOR_TUNNEL_URL || process.env.CURSOR_API_URL;
  if (!baseUrl) return null;
  const apiKey = process.env.CURSOR_EXECUTION_TUNNEL_KEY || process.env.CURSOR_TUNNEL_API_KEY || process.env.CURSOR_API_KEY;
  const model = process.env.CURSOR_MODEL || process.env.CLAUDE_CODE_MODEL || 'claude-code-cursor-loop';
  const streamed = await streamOAICompat(baseUrl, apiKey, model, system, user, maxTokens, onDelta);
  if (streamed) {
    return {
      content: streamed.content,
      totalTokens: streamed.totalTokens,
      provider: `Cursor Execution Tunnel (${streamed.model}, stream)`,
    };
  }
  const direct = await callOAICompat(baseUrl, apiKey, model, system, user, maxTokens);
  if (!direct) return null;
  emitTextChunks(direct.content, onDelta);
  return {
    content: direct.content,
    totalTokens: direct.totalTokens,
    provider: `Cursor Execution Tunnel (${direct.model})`,
  };
}

async function runAiLoungeEngine(
  engine: LoungeEngineKey,
  prompt: string,
  onDelta: (d: string) => void
): Promise<LLMResult> {
  const profile = AI_LOUNGE_ENGINE_PROFILES[engine];
  const system = LOUNGE_SYSTEMS[engine];
  const user = `Consumer request:\n${prompt}\n\nReturn a polished, useful response for the EdenClaw AI Lounge dashboard.`;

  if (engine === 'kimi-moonshot') {
    const r = await callKimi(system, user, profile.maxTokens);
    emitTextChunks(r.content, onDelta);
    return { ...r, provider: `${r.provider} · gasless lounge` };
  }

  if (engine === 'gemini-pro') {
    const direct = await callGeminiLounge(system, user, profile.maxTokens, onDelta);
    if (direct) return direct;
  }

  if (engine === 'chatgpt-codex' && process.env.OPENAI_API_KEY) {
    const model = process.env.OPENAI_CODEX_MODEL || process.env.OPENAI_FALLBACK_MODEL || 'gpt-4o-mini';
    const streamed = await streamOAICompat('https://api.openai.com', process.env.OPENAI_API_KEY, model, system, user, profile.maxTokens, onDelta);
    if (streamed) return { content: streamed.content, totalTokens: streamed.totalTokens, provider: `OpenAI Codex Loop (${streamed.model}, stream)` };
  }

  if (engine === 'claude-cursor') {
    const direct = await callClaudeLounge(system, user, profile.maxTokens, onDelta);
    if (direct) return direct;
    const tunnel = await callCursorExecutionTunnel(system, user, profile.maxTokens, onDelta);
    if (tunnel) return tunnel;
  }

  return streamLLM(system, user, profile.maxTokens, onDelta);
}

async function handleAiLoungeRequest(args: { body: Record<string, unknown>; email: string; prompt: string }) {
  const engine = normalizeLoungeEngine(args.body.selectedModel ?? args.body.engine);
  const profile = AI_LOUNGE_ENGINE_PROFILES[engine];
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // 청크 전달 가드: 프론트 리스너 단절(정적 404 등)로 컨트롤러가 닫혀도 enqueue 예외가
      // 백엔드 연산을 중단시키지 않도록 try-catch 로 완전히 격리한다.
      let clientGone = false;
      const send = (o: unknown) => {
        if (clientGone) return;
        try {
          controller.enqueue(enc.encode(`${JSON.stringify(o)}\n`));
        } catch {
          clientGone = true;
        }
      };
      try {
        send({
          type: 'init',
          protocol: 'edenclaw-ndjson-v2',
          mode: 'ai-lounge',
          engine: profile,
          stages: [
            { idx: 0, label: 'Gas Audit', agent: 'Redis Quota Gate' },
            { idx: 1, label: profile.label, agent: profile.label },
            { idx: 2, label: 'Dual-Shield', agent: 'Binary Ledger' },
          ],
        });

        send({
          type: 'stage',
          stage: 0,
          agent: 'Redis Quota Gate',
          label: 'Gas Audit',
          status: 'start',
          gasCost: profile.gasCost,
          note: `${profile.label} burn profile locked at ${profile.gasCost.toLocaleString()} GAS.`,
        });

        for (const field of ['pvValue', 'bvValue'] as const) {
          if (args.body[field] !== undefined && !Number.isFinite(Number(args.body[field]))) {
            const message = `${field} must be a finite number. Burn-derived PV/BV roll-up was blocked before rendering.`;
            send({
              type: 'stage',
              stage: 0,
              agent: 'State Guard',
              label: 'Crash Guard',
              status: 'render_crash_prevented',
              note: message,
            });
            send({
              type: 'done',
              status: 'render_crash_prevented',
              engine: profile,
              content: '',
              gasCharged: 0,
              error: message,
            });
            return;
          }
        }

        const audit = await auditAiLoungeAccess({ email: args.email, engine });

        if (!audit.ok) {
          send({
            type: 'stage',
            stage: 0,
            agent: audit.status === 'paywall_blocked' ? 'Overdraft Ledger' : 'State Guard',
            label: 'Gas Audit',
            status: audit.status,
            note: audit.message,
            quota: audit.quota,
            overdraft: audit.overdraft,
          });
          send({
            type: 'done',
            status: audit.status,
            engine: profile,
            content: '',
            gasCharged: 0,
            quota: audit.quota,
            overdraft: audit.overdraft,
          });
          return;
        }

        send({
          type: 'stage',
          stage: 0,
          agent: 'Redis Quota Gate',
          label: 'Gas Audit',
          status: 'done',
          gasCost: audit.gasCost,
          quota: audit.quota,
          note: audit.gasCost === 0 ? 'Gasless ideation loop authorized.' : 'Enterprise gas capacity reserved for post-response burn.',
        });
        send({
          type: 'stage',
          stage: 1,
          agent: profile.label,
          label: profile.label,
          status: 'active_enterprise_session',
          gasCost: audit.gasCost,
          quota: audit.quota,
          note: 'Active Enterprise Session',
        });

        send({
          type: 'stage',
          stage: 1,
          agent: profile.label,
          label: profile.label,
          status: engine === 'kimi-moonshot' ? 'ideation' : 'premium_computation',
          gasCost: audit.gasCost,
          note: `${profile.label} is generating the lounge response.`,
        });

        const t0 = Date.now();
        const result = await runAiLoungeEngine(engine, args.prompt, (delta) => {
          send({ type: 'stage', stage: 1, agent: profile.label, label: profile.label, status: 'chunk', delta });
        });
        const ms = Date.now() - t0;
        const burn = await commitAiLoungeSuccessfulBurn({ email: args.email, engine });

        if (!burn.ok) {
          send({
            type: 'stage',
            stage: 2,
            agent: 'State Guard',
            label: 'Dual-Shield',
            status: burn.status,
            note: burn.message,
            quota: burn.quota,
            contribution: burn.contribution,
          });
          send({
            type: 'done',
            status: burn.status,
            engine: profile,
            content: result.content,
            totalTokens: result.totalTokens,
            provider: result.provider,
            ms,
            gasCharged: 0,
            quota: burn.quota,
            contribution: burn.contribution,
          });
          return;
        }

        const accumulatedPV = burn.contribution.pvValue;

        send({
          type: 'stage',
          stage: 1,
          agent: profile.label,
          label: profile.label,
          status: 'done',
          content: result.content,
          tokens: result.totalTokens,
          provider: result.provider,
          ms,
        });
        send({
          type: 'stage',
          stage: 2,
          agent: 'Binary Ledger',
          label: 'Dual-Shield',
          status: 'done',
          contribution: burn.contribution,
          accumulatedPV,
          rollup: burn.rollup,
          note: `PV/BV roll-up complete across ${burn.rollup.depth.toLocaleString()} parent node(s).`,
        });
        send({
          type: 'done',
          status: 'done',
          engine: profile,
          content: result.content,
          totalTokens: result.totalTokens,
          provider: result.provider,
          ms,
          gasCharged: burn.gasCharged,
          quota: burn.quota,
          contribution: burn.contribution,
          accumulatedPV,
          rollup: burn.rollup,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        send({
          type: 'stage',
          stage: 0,
          agent: 'State Guard',
          label: 'Crash Guard',
          status: 'render_crash_prevented',
          note: message,
        });
        send({
          type: 'done',
          status: 'render_crash_prevented',
          engine: profile,
          content: '',
          gasCharged: 0,
          error: message,
        });
      } finally {
        try { controller.close(); } catch { /* 이미 닫힌 스트림 close 예외 무시 */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  // [세션·가스 원장 실시간 정합성 가드]
  // 클라이언트가 보낸 캐시성 잔량/원장 필드는 절대 신뢰하지 않는다. 과거 캐시 잔량(예: 1,506,455)이
  // body 로 유입되어도 차감/표시 경로에 반영되지 않도록 명시 폐기하고, 가스·EP·정산 원장은
  // 오직 아래 prisma.user 실시간 단독 조회 결과만을 단일 진실원천(single source of truth)으로 사용한다.
  for (const staleKey of ['remaining', 'allocated', 'consumed', 'quota', 'ledger', 'gas', 'epBalance', 'tokenQuota']) {
    if (staleKey in body) delete (body as Record<string, unknown>)[staleKey];
  }

  // 게스트 버퍼는 서버 운영자가 명시적으로 연 배포에서만 동작한다. 클라이언트 body 값으로는
  // 활성화할 수 없으므로 상용 과금 우회 수단이 되지 않는다.
  const demoSandbox = process.env.EDENCLAW_DEMO_SANDBOX === '1';
  const requestedEmail = typeof body.email === 'string' ? body.email.trim() : '';
  const email = requestedEmail || (demoSandbox ? GUEST_DEMO_EMAIL : undefined);
  const prompt: string | undefined =
    typeof body.userPrompt === 'string' ? body.userPrompt.trim() :
    typeof body.prompt === 'string' ? body.prompt.trim() :
    undefined;
  const rawMode = typeof body.mode === 'string' ? body.mode.trim() : '';
  const upperMode = rawMode.toUpperCase();
  const mode: 'solo' | 'swarm' = upperMode === 'SWARM' ? 'swarm' : 'solo';
  const loungeRequest =
    body.client === 'ai-lounge' ||
    upperMode === 'LOUNGE' ||
    typeof body.engine === 'string' ||
    typeof body.selectedModel === 'string';
  // 데모/테스트용: 무료 디버깅 강제 실패 횟수(역질문 일시정지 시연). 기본 0(실제 검증 판정에 따름)
  const forceErrors = Math.max(0, Math.min(MAX_FREE_ATTEMPTS, Math.trunc(Number(body.forceErrors) || 0)));
  // [게스트 데모 샌드박스 게이트 — 운영자 전용 env 제어]
  // 가스 0/오버드래프트 락다운으로 데모·시연이 끊기는 것을 방어한다. 단, 이 우회는
  // 오직 서버 환경변수 EDENCLAW_DEMO_SANDBOX=1 일 때만 활성화된다(클라이언트가 임의로 켤 수 없음).
  // 데모 경로는 ① 과금 원장 미차감(gasCharged=0) ② MLM PV/BV 정산 미반영 ③ 응답에 '비과금·정산 미반영' 명시.
  // → 실유저 과금 우회나 허위 실적 생성이 아니라, 무중단 시연을 위한 '읽기성 데모 버퍼'이다.
  let guestDemo = demoSandbox && !requestedEmail; // 세션 유실 시 즉시 50,000 GAS 섀도우 계정으로 전환
  // 인터랙티브 양방향 루프: 재개 컨텍스트(프론트가 보유 → 무상태 재전송)
  const resume = Boolean(body.resume);
  const escalate = Boolean(body.escalate); // 유저가 마스터(가스)에게 위임
  const priorCode = typeof body.priorCode === 'string' ? body.priorCode : '';
  const errorLog = typeof body.errorLog === 'string' ? body.errorLog : '';
  const guidance = typeof body.guidance === 'string' ? body.guidance : '';
  const currentFiles = stringifyCurrentFiles(body.currentFiles ?? priorCode);
  const premiumArchitectMode = ['PRODUCTION', 'PROD', 'PREMIUM', 'BUILD', 'RUN'].includes(upperMode) || (!!prompt && isPremiumBuildStage(prompt));
  const draftMode = !premiumArchitectMode && (upperMode === 'DRAFT' || (!resume && !escalate && !!prompt && isIdeationStage(prompt)));
  if (!email) return NextResponse.json({ error: 'email 이 필요합니다.' }, { status: 400 });
  if (!prompt) return NextResponse.json({ error: '프롬프트를 입력하세요.' }, { status: 400 });
  if (loungeRequest) return handleAiLoungeRequest({ body: body as Record<string, unknown>, email, prompt });

  // execute 진입 시 최신 DB 유저 테이블을 실시간 단독 조회 → 세션/가스 잔량 정합성을 DB 기준으로 일치시킨다.
  let dbUser: ExecutionDbUser | null = null;
  try {
    dbUser = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true, epBalance: true,
        tokenQuota: { select: { allocated: true, consumed: true, isOverdraftAdvanced: true } },
        legBalance: { select: { leftPV: true, rightPV: true, leftBV: true, rightBV: true } },
      },
    });
  } catch (error) {
    if (!demoSandbox) throw error;
  }

  if ((!dbUser || !dbUser.tokenQuota) && !demoSandbox) {
    return NextResponse.json({ error: dbUser ? 'TokenQuota가 없습니다.' : '가입되지 않은 이메일입니다.' }, { status: 404 });
  }

  if (!dbUser || !dbUser.tokenQuota) guestDemo = true;
  const user = dbUser && dbUser.tokenQuota
    ? {
        id: dbUser.id,
        epBalance: Number(dbUser.epBalance) || 0,
        tokenQuota: dbUser.tokenQuota,
        legBalance: dbUser.legBalance ?? null,
      }
    : {
        id: 'guest-sandbox',
        epBalance: 0,
        tokenQuota: { allocated: BigInt(GUEST_DEMO_GAS), consumed: BigInt(0), isOverdraftAdvanced: false },
        legBalance: null,
      };
  const tokenQuota = user.tokenQuota;
  const allocated = Number(tokenQuota.allocated);
  const remaining = Math.max(0, allocated - Number(tokenQuota.consumed));

  const stages = draftMode ? [DRAFT_STAGE] : premiumArchitectMode ? [PREMIUM_ARCHITECT_STAGE] : mode === 'swarm' ? SWARM_STAGES : [SOLO_STAGE];
  const userId = user.id;
  const enc = new TextEncoder();
  const quotaView = (qRow: { allocated: bigint; consumed: bigint; isOverdraftAdvanced: boolean }) => {
    if (guestDemo) return guestDemoQuota(email);
    const nAlloc = Number(qRow.allocated);
    const nCons = Number(qRow.consumed);
    const nRem = Math.max(0, nAlloc - nCons);
    const legs = user.legBalance ?? { leftPV: 0, rightPV: 0, leftBV: 0, rightBV: 0 };
    return {
      email, allocated: nAlloc, consumed: nCons, remaining: nRem,
      percentUsed: nAlloc > 0 ? Math.min(100, (nCons / nAlloc) * 100) : 0,
      depleted: nRem <= 0, isOverdraftAdvanced: qRow.isOverdraftAdvanced,
      ledger: {
        legs, lesserLegPV: Math.min(legs.leftPV, legs.rightPV), epBalance: user.epBalance,
        swappableGas: Math.floor((legs.leftPV + legs.rightPV) * GAS_PER_PV) + Math.floor(user.epBalance * GAS_PER_EP),
        gasPerPV: GAS_PER_PV, gasPerEP: GAS_PER_EP,
      },
    };
  };

  const stream = new ReadableStream({
    async start(controller) {
      // 청크 전달 가드: 프론트 리스너 단절(정적 404 등)로 컨트롤러가 닫혀도 enqueue 예외가
      // 백엔드 Swarm 연산(가스 차감/정산 포함)을 중단시키지 않도록 try-catch 로 완전히 격리한다.
      let clientGone = false;
      const send = (o: unknown) => {
        if (clientGone) return;
        try {
          controller.enqueue(enc.encode(JSON.stringify(o) + '\n'));
        } catch {
          clientGone = true;
        }
      };
      try {
        send({ type: 'init', protocol: 'edenclaw-ndjson-v2', mode, stages: stages.map((s) => ({ idx: s.idx, label: s.label, agent: s.agent })) });

        if (guestDemo) {
          send({
            type: 'stage',
            stage: 0,
            agent: 'Guest Sandbox Buffer',
            label: '데모 샌드박스',
            status: 'premium_computation',
            tier: 'free',
            note: '세션/쿼터 유실 감지 — 50,000 GAS 게스트 버퍼로 전환했습니다. 비과금·정산 미반영 상태입니다.',
            quota: guestDemoQuota(email),
          });
        }

        // ===== P1: 진짜 자율 크로스모델 루프 (격리 워크스페이스 + 실 tsc + 모델 에스컬레이션) =====
        // realLoop 플래그가 있을 때만 실행. 기존 시뮬레이션 경로(대시보드 데모)는 그대로 유지.
        if (Boolean(body.realLoop)) {
          if (remaining <= 0) {
            if (!demoSandbox) {
              send({ type: 'error', status: 'paywall_blocked', error: '가스가 고갈되었습니다. 충전 후 다시 시도하세요.', quota: quotaView(tokenQuota) });
              return;
            }
            // 데모 샌드박스: 무중단 진행하되 과금/정산은 스킵(아래 consume 가드)
            guestDemo = true;
            send({ type: 'stage', stage: 0, agent: 'Guest Sandbox Buffer', label: '데모 샌드박스', status: 'premium_computation', tier: 'free', note: '가스 0 — 게스트 데모 샌드박스(비과금·정산 미반영)로 무중단 전환합니다.' });
          }
          const loop = await runAutonomousLoop({
            prompt: prompt!,
            tiers: defaultModelTiers(),
            maxAttempts: Math.max(3, Math.min(8, Math.trunc(Number(body.maxAttempts) || 5))),
            onEvent: (e) => {
              switch (e.type) {
                case 'attempt_start':
                  send({ type: 'stage', stage: 2, agent: e.label, label: '개발', status: 'start', tier: 'compute', note: `${e.label} — 시도 #${e.attempt}` });
                  break;
                case 'file':
                  send({ type: 'stage', status: 'file', stage: 2, path: e.path, content: e.content, agent: 'Autonomous Loop' });
                  break;
                case 'compile':
                  send({ type: 'stage', status: 'sandbox', stage: 3, path: 'tsc --noEmit (project)', ok: e.ok, error: e.ok ? '' : e.output, engine: 'tsc --noEmit' });
                  send({ type: 'stage', stage: 3, agent: 'Sandbox', label: '검증', status: 'done', tier: 'compute', content: e.ok ? `✅ tsc 통과 (${e.ms}ms)` : `❌ tsc 실패 (${e.ms}ms)`, tokens: 0, ms: e.ms, provider: 'tsc --noEmit' });
                  break;
                case 'escalate':
                  send({ type: 'stage', status: 'retry', stage: 2, agent: e.to, msg: `🔀 에스컬레이션 ${e.from} → ${e.to} (${e.reason})` });
                  break;
                case 'provider_error':
                  send({ type: 'stage', status: 'retry', stage: 2, agent: e.tier, msg: `provider 오류(${e.tier}): ${e.error}` });
                  break;
                default:
                  break;
              }
            },
          });

          // 데모 샌드박스 전환 시에는 과금/정산을 스킵하고 현재 원장만 읽는다.
          const loopGasCharged = guestDemo
            ? 0
            : Math.min(
                Math.max(0, Math.trunc(Number(loop.gasCharged) || 0)),
                MAX_COMPUTE_GAS_PER_RUN,
                remaining,
              );
          const loopQuota = guestDemo
            ? tokenQuota
            : loopGasCharged > 0
              ? await consumeGasWithCache(userId, loopGasCharged, 'SWARM_REAL_LOOP')
              : await prisma.tokenQuota.findUniqueOrThrow({ where: { userId }, select: { allocated: true, consumed: true, isOverdraftAdvanced: true } });
          const freshLoopAccount = guestDemo ? null : await loadGasAccountByEmail(email);
          send({
            type: 'done',
            success: loop.success,
            status: loop.success ? 'SUCCESS' : 'MAX_ATTEMPTS_EXCEEDED',
            finalModel: loop.finalProvider ?? loop.finalTier,
            attempts: loop.attempts,
            totalTokens: 0,
            computeMs: 0,
            gasCharged: loopGasCharged,
            freeRun: loopGasCharged === 0,
            guest: guestDemo,
            note: guestDemo ? '게스트 데모 샌드박스 — 비과금·정산 미반영' : undefined,
            code: JSON.stringify(loop.files),
            error: loop.success ? undefined : loop.lastError,
            quota: freshLoopAccount?.tokenQuota ? serviceQuotaView(freshLoopAccount) : quotaView(loopQuota),
          });
          return;
        }

        // 청구 대상(프리미엄 마스터)만 가스화. 무료 단계는 0.
        let totalTokens = 0;
        let computeMs = 0; // ★ 실연산(LLM 추론 + 샌드박스 빌드) 누적 ms — 가스 정산 기준(토큰량 아님)
        let prev = '';
        let paused = false;
        let finalCode = priorCode;
        let activeQuota = tokenQuota;

        if (!draftMode && remaining <= 0) {
          send({
            type: 'stage',
            stage: 0,
            agent: 'Overdraft Ledger',
            label: 'Gas Gateway',
            status: 'paywall_blocked',
            tier: 'compute',
            note: '가스 고갈 감지 — Lesser Leg PV → Greater Leg PV → EP → prototype advance 순서로 자동 스왑을 시도합니다.',
          });
          const swap = await executeOverdraftLedgerSwap(userId);
          if (!swap.ok) {
            // 오버드래프트 스왑 실패(가스 0 + 이미 선지급 = 409 ALREADY_ADVANCED 등 락다운).
            // 데모 샌드박스가 켜져 있으면 시연이 끊기지 않도록 비과금·정산 미반영으로 무중단 전환한다.
            if (demoSandbox) {
              guestDemo = true;
              send({
                type: 'stage',
                stage: 0,
                agent: 'Guest Sandbox Buffer',
                label: '데모 샌드박스',
                status: 'premium_computation',
                tier: 'free',
                note: `오버드래프트 락다운(${swap.code ?? 'LOCKED'}) — 게스트 데모 샌드박스(비과금·정산 미반영)로 무중단 전환합니다.`,
                quota: quotaView(activeQuota),
              });
            } else {
              send({
                type: 'error',
                status: 'paywall_blocked',
                error: swap.message,
                code: swap.code,
                quota: swap.quota ?? quotaView(activeQuota),
              });
              return;
            }
          } else {
            activeQuota = {
              allocated: BigInt(swap.quota.allocated),
              consumed: BigInt(swap.quota.consumed),
              isOverdraftAdvanced: swap.quota.isOverdraftAdvanced,
            };
            send({
              type: 'stage',
              stage: 0,
              agent: 'Overdraft Ledger',
              label: 'Gas Gateway',
              status: 'premium_computation',
              tier: 'compute',
              note: `가스 ${Math.trunc(swap.swappedGas).toLocaleString()} 자동 충전 완료 — 프리미엄 연산 루프를 재개합니다.`,
              quota: swap.quota,
            });
          }
        }

        // 단계 실행 — 실연산 ms를 가스 기준으로 누적 (토큰량은 정보용일 뿐)
        const runFree = async (st: StageDef, input: string) => {
          send({ type: 'stage', stage: st.idx, agent: st.agent, label: st.label, status: 'start', tier: 'compute', note: st.note });
          const t0 = Date.now();
          const r = await (st.kimi ? callKimi : callLLM)(st.system, st.build(prompt!, input), st.max);
          const ms = Date.now() - t0;
          totalTokens += r.totalTokens; computeMs += ms;
          send({ type: 'stage', stage: st.idx, agent: st.agent, label: st.label, status: 'done', tier: 'compute', ms, content: r.content, tokens: r.totalTokens, provider: r.provider });
          return r;
        };

        if (draftMode) {
          const st = DRAFT_STAGE;
          send({ type: 'stage', stage: st.idx, agent: st.agent, label: st.label, status: 'ideation', tier: 'free', note: st.note });
          const t0 = Date.now();
          const r = await callKimi(st.system, st.build(prompt!, currentFiles), st.max);
          const ms = Date.now() - t0;
          totalTokens += r.totalTokens;
          finalCode = r.content;
          send({ type: 'stage', stage: st.idx, agent: st.agent, label: st.label, status: 'done', tier: 'free', ms, content: r.content, tokens: r.totalTokens, provider: `${r.provider} · free draft` });

          const draftFiles = parseFiles(r.content);
          finalCode = JSON.stringify(draftFiles);
          for (const f of draftFiles) send({ type: 'stage', status: 'file', stage: st.idx, path: f.path, content: f.content, agent: st.agent });
          send({
            type: 'done',
            totalTokens,
            computeMs: 0,
            gasCharged: 0,
            freeRun: true,
            code: finalCode,
            quota: quotaView(activeQuota),
          });
          return;
        } else if (premiumArchitectMode) {
          const st = PREMIUM_ARCHITECT_STAGE;
          send({ type: 'stage', stage: st.idx, agent: st.agent, label: st.label, status: 'premium_computation', tier: 'premium', note: st.note });
          // 프로덕션 요청도 단일 모델로 우회하지 않는다. Gemini 아키텍처 → Claude 정밀 생성의
          // 동일한 투트랙을 통과시켜 거대 요청의 파일 경계와 구현 디테일을 함께 보존한다.
          const hybrid = await runHybridTwoTrack(prompt!, currentFiles, guidance, send);
          const dev: LLMResult = {
            content: hybrid.devContent,
            totalTokens: hybrid.totalTokens,
            provider: hybrid.provider,
          };
          totalTokens += hybrid.totalTokens;
          computeMs += hybrid.computeMs;
          send({ type: 'stage', stage: st.idx, agent: st.agent, label: st.label, status: 'done', tier: 'premium', content: '(프로덕션 파일 생성 완료)', tokens: dev.totalTokens, ms: hybrid.computeMs, provider: dev.provider });

          const files = parseFiles(dev.content);
          finalCode = JSON.stringify(files);
          for (const f of files) send({ type: 'stage', status: 'file', stage: st.idx, path: f.path, content: f.content, agent: st.agent });

          send({ type: 'stage', stage: 3, agent: 'Sandbox', label: '검증', status: 'start', tier: 'premium', note: '프로덕션 샌드박스에서 build/compile 실행 중...' });
          const sbT0 = Date.now();
          const sbs: Sandbox[] = [];
          for (const f of files) { const sb = await sandboxCompile(f); sbs.push(sb); send({ type: 'stage', status: 'sandbox', stage: 3, path: sb.path, ok: sb.ok, error: sb.error, engine: sb.engine }); }
          const buildMs = Date.now() - sbT0;
          computeMs += buildMs;
          const failed = sbs.filter((s) => !s.ok);
          send({ type: 'stage', stage: 3, agent: 'Sandbox', label: '검증', status: 'done', tier: 'premium', content: failed.length ? `❌ ${failed.length}/${sbs.length} 파일 컴파일 실패 (build ${buildMs}ms)` : `✅ 프로덕션 파일 컴파일 통과 (${sbs.length}) · build ${buildMs}ms`, tokens: 0, ms: buildMs, provider: 'EdenClaw Sandbox' });
        } else if (mode === 'solo') {
          // 단독: 단일 호출 = 프리미엄 청구
          const st = SOLO_STAGE;
          send({ type: 'stage', stage: st.idx, agent: st.agent, label: st.label, status: 'start', tier: 'compute', note: st.note });
          const t0 = Date.now();
          // ★ 토큰 청크 스트리밍 — delta마다 콘솔 버블에 실시간으로 꽂힘
          const r = await streamLLM(st.system, st.build(prompt!, ''), st.max, (d) => send({ type: 'stage', stage: st.idx, agent: st.agent, label: st.label, status: 'chunk', delta: d }));
          const ms = Date.now() - t0;
          totalTokens += r.totalTokens; computeMs += ms; finalCode = r.content;
          send({ type: 'stage', stage: st.idx, agent: st.agent, label: st.label, status: 'done', tier: 'compute', ms, content: r.content, tokens: r.totalTokens, provider: r.provider });
        } else {
          // ===== 진짜 자율 개발 루프: 환경검증 게이트 + 멀티파일 + 샌드박스 실 컴파일 =====
          const devStage = SWARM_STAGES[2];

          if (!resume && !escalate && isHardwarePrompt(prompt!)) {
            // 0) 하드웨어/인프라 요청 → 코딩 전 '환경 검증 게이트'로 일시정지
            send({
              type: 'stage', status: 'paused_awaiting_user', stage: 0, phase: 'env', agent: 'EdenClaw Swarm',
              question: `🤖 잠깐만요 — 실제 라즈베리파이 장치나 에뮬레이터 환경이 준비되지 않았습니다. 냅다 코드를 짜기 전에 타겟 환경을 먼저 확정해야 합니다.\n• [1] 실제 장비 연결됨  /  [2] 가상 에뮬레이터(QEMU·Wokwi)로 진행\n• 보드/모델(예: Raspberry Pi 4), 핀(예: GPIO17), 언어(Python/C)를 알려주세요.\n답변을 [전송]하면 그 환경에 맞춰 파일을 생성하고 샌드박스 빌드/컴파일까지 진행합니다.`,
              code: '', errorLog: '',
            });
            paused = true;
          } else {
            // 1) 파일 생성 (escalate=마스터/가스, fresh=무료 신규, resume=무료 재개)
            let dev: LLMResult;
            const fresh = !priorCode;
            if (escalate) {
              send({ type: 'stage', status: 'emergency', stage: 2, agent: 'B200 Master', msg: '🚨 마스터에게 위임 — B200 Intelligence Factory 긴급 가동, 실연산 가스 차감 중' });
              const t0 = Date.now();
              dev = await callLLM(FILEGEN_SYSTEM, `요청:\n${prompt}\n\n환경/가이드:\n${guidance}\n\n기존 파일(JSON):\n${priorCode}\n\n빌드 에러:\n${errorLog}\n\n에러를 근본 해결해 완전히 컴파일되는 프로젝트 파일들을 JSON 배열로만 출력하라.`, 1600);
              const ms = Date.now() - t0; totalTokens += dev.totalTokens; computeMs += ms;
              send({ type: 'stage', stage: 2, agent: 'B200 Master', label: '마스터 해결', status: 'done', tier: 'premium', content: '(파일 생성)', tokens: dev.totalTokens, ms, provider: dev.provider });
            } else if (fresh) {
              // 투트랙 하이브리드: Gemini 아키텍처 청사진 → Claude 정밀 파일 생성(에디터 스트리밍).
              // 거대/범용 요청("축구 게임 만들래")도 구조부터 잡아 즉시 구현 스트림으로 이어진다.
              // 키 부재/실패 시 함수 내부에서 공통 LLM 체인으로 정직 폴백.
              const hybrid = await runHybridTwoTrack(prompt!, currentFiles, guidance, send);
              totalTokens += hybrid.totalTokens; computeMs += hybrid.computeMs;
              dev = { content: hybrid.devContent, totalTokens: hybrid.totalTokens, provider: hybrid.provider };
            } else {
              send({ type: 'stage', stage: 2, agent: devStage.agent, label: devStage.label, status: 'start', tier: 'compute', note: '유저 가이드를 반영해 재개발(RESUME) 중...' });
              const t0 = Date.now();
              dev = await callLLM(FILEGEN_SYSTEM, `요청:\n${prompt}\n\n기존 파일(JSON):\n${priorCode}\n\n빌드 에러:\n${errorLog}\n\n유저 추가 가이드:\n${guidance}\n\n에러를 고쳐 완전히 컴파일되는 프로젝트 파일들을 JSON 배열로만 출력하라.`, 1500);
              const ms = Date.now() - t0; totalTokens += dev.totalTokens; computeMs += ms;
              send({ type: 'stage', stage: 2, agent: devStage.agent, label: devStage.label, status: 'done', tier: 'compute', content: '(재개발 완료)', tokens: dev.totalTokens, ms, provider: dev.provider });
            }

            // 2) 파일 실재 생성 이벤트 (좌측 파일트리/IDE 캔버스)
            const files = parseFiles(dev.content);
            finalCode = JSON.stringify(files);
            for (const f of files) send({ type: 'stage', status: 'file', stage: 2, path: f.path, content: f.content, agent: escalate ? 'B200 Master' : devStage.agent });

            // 3) 백엔드 가상 샌드박스 — 실제 build/compile (JS=V8, TS=tsc, JSON=parse, 그외=휴리스틱)
            send({ type: 'stage', stage: 3, agent: 'Sandbox', label: '검증', status: 'start', tier: 'compute', note: '가상 샌드박스에서 build/compile 실행 중...' });
            const sbT0 = Date.now();
            const sbs: Sandbox[] = [];
            for (const f of files) { const sb = await sandboxCompile(f); sbs.push(sb); send({ type: 'stage', status: 'sandbox', stage: 3, path: sb.path, ok: sb.ok, error: sb.error, engine: sb.engine }); }
            const buildMs = Date.now() - sbT0;
            computeMs += buildMs; // ★ 실제 빌드/컴파일 실연산 ms도 가스에 반영
            const failed = sbs.filter((s) => !s.ok);
            send({ type: 'stage', stage: 3, agent: 'Sandbox', label: '검증', status: 'done', tier: 'compute', content: failed.length ? `❌ ${failed.length}/${sbs.length} 파일 컴파일 실패 (build ${buildMs}ms)` : `✅ 전 파일 컴파일 통과 (${sbs.length}) · build ${buildMs}ms`, tokens: 0, ms: buildMs, provider: 'EdenClaw Sandbox' });

            const forcedFail = !resume && !escalate && forceErrors > 0;
            if ((failed.length > 0 || forcedFail) && !escalate) {
              const reason = failed.length ? failed.map((f) => `${f.path}: ${f.error} [${f.engine}]`).join(' / ') : '시뮬레이션 빌드 에러';
              send({
                type: 'stage', status: 'paused_awaiting_user', stage: 3, phase: 'build', agent: 'EdenClaw Sandbox',
                question: `🤖 샌드박스 빌드 실패: ${reason}\n수정 가이드를 입력해 [전송]하면 자동 재개합니다. [🚨 마스터 위임] 시 가스로 한 번에 해결합니다.`,
                code: finalCode, errorLog: reason,
              });
              paused = true;
            }
          }

          if (!paused) await runFree(SWARM_STAGES[4], finalCode); // 배포 (무료)
        }

        // 일시정지(역질문)면 정산/배포 없이 턴 종료. 완료된 경우에만 정산.
        if (!paused) {
        // ★ 정산: 토큰량이 아니라 '실연산 ms'(LLM 추론 + 샌드박스 빌드)로만 가스 산정.
        // 현실화된 단가 × 실연산 시간에 상한선(Max Cap)을 적용해 단일 호출 과도 차감을 방지한다.
        // 게스트 데모 샌드박스(guestDemo)면 과금 0 + consume/PV·BV 정산을 일절 호출하지 않는다(원장 무결성 보존).
        const activeRemaining = Math.max(0, Number(activeQuota.allocated - activeQuota.consumed));
        const gasCharged = guestDemo
          ? 0
          : Math.min(
              Math.round((computeMs / 1000) * COMPUTE_GAS_PER_SEC),
              MAX_COMPUTE_GAS_PER_RUN,
              activeRemaining,
            );
        let qRow;
        if (gasCharged > 0) {
          qRow = await consumeGasWithCache(userId, gasCharged, premiumArchitectMode ? 'PREMIUM_ARCHITECT_COMPUTE' : mode === 'swarm' ? 'SWARM_COMPUTE' : 'SOLO_COMPUTE');
        } else if (guestDemo) {
          qRow = tokenQuota;
        } else {
          qRow = await prisma.tokenQuota.findUniqueOrThrow({ where: { userId }, select: { allocated: true, consumed: true, isOverdraftAdvanced: true } });
        }

        const freshAccount = guestDemo ? null : await loadGasAccountByEmail(email);
        send({
          type: 'done', totalTokens, computeMs, gasCharged, freeRun: gasCharged === 0,
          guest: guestDemo, note: guestDemo ? '게스트 데모 샌드박스 — 비과금·정산 미반영' : undefined,
          code: finalCode,
          quota: freshAccount?.tokenQuota ? serviceQuotaView(freshAccount) : quotaView(qRow),
        });
        }
      } catch (e) {
        send({ type: 'error', error: e instanceof Error ? e.message : String(e) });
      } finally {
        try { controller.close(); } catch { /* 이미 닫힌 스트림 close 예외 무시 */ }
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' },
  });
}
