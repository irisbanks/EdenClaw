// OMX 격리 자율 루프 — 라이브 서빙 트리 오염 없이 반복하고, tsc 통과 시에만 타겟으로 승격(promote).
// - 반복은 .edenclaw-sandbox/(Next 비서빙·tsconfig exclude) 안에서만 수행
// - sanitizeGeneratedCode + runLSPDiagnostics(프로젝트 tsconfig 동적 extends) 재사용
// - 성공 시에만 최종 코드를 실제 targetFile로 복사 → 깨진/중간 산출물이 절대 배포되지 않음
import fs from 'fs';
import path from 'path';
import { sanitizeGeneratedCode, runLSPDiagnostics } from './omx-sanitize';
import type { ModelTier, LoopMessage } from './autonomous-loop';

export const OMX_SYSTEM_PROMPT =
  '너는 에덴클로의 자율 코드 엔지니어다. 요청과 tsc 진단을 분석해 완전히 컴파일되는 "단일 파일 소스"만 출력한다. ' +
  'JSON·설명·마크다운·코드펜스 금지. 문자열 템플릿(백틱)과 모든 괄호의 마감을 반드시 완결하라.';

export type OmxEvent =
  | { type: 'attempt_start'; attempt: number; tier: string; label: string }
  | { type: 'compile'; attempt: number; ok: boolean; output: string; ms: number }
  | { type: 'escalate'; from: string; to: string; reason: string }
  | { type: 'provider_error'; attempt: number; tier: string; error: string }
  | { type: 'promoted'; attempt: number; tier: string; targetFile: string }
  | { type: 'success'; attempt: number; tier: string; provider: string; gasCharged: number }
  | { type: 'exhausted'; attempts: number; lastError: string; gasCharged: number };

export interface OmxOptions {
  prompt: string;
  projectRoot: string;
  targetFile: string;
  tiers: ModelTier[];
  history?: LoopMessage[];
  maxAttempts?: number;
  onEvent?: (e: OmxEvent) => void;
}

export interface OmxResult {
  success: boolean;
  attempts: number;
  finalTier?: string;
  finalProvider?: string;
  gasCharged: number;
  finalCode?: string;
  targetFile: string;
  lastError?: string;
}

/** 타겟이 프로젝트 루트 내부이며 node_modules가 아님을 보장. 위반 시 throw. */
export function resolveSafeTarget(projectRoot: string, targetFile: string): string {
  const clean = (targetFile || '').replace(/[\0\r\n]/g, '').trim() || 'app/api/_generated/autonomous-output.ts';
  const abs = path.resolve(projectRoot, clean);
  const rel = path.relative(projectRoot, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).includes('node_modules')) {
    throw new Error('Security violation: Invalid target path.');
  }
  return abs;
}

/** 기본 스케줄: 티어당 2회씩 시도하고 마지막 티어가 나머지를 흡수 (1-2→t0, 3-4→t1, 5+→마지막). */
export function omxTierForAttempt(attempt: number, tiers: ModelTier[]): ModelTier {
  const idx = Math.min(Math.floor((attempt - 1) / 2), tiers.length - 1);
  return tiers[idx];
}

/** 가드 통과 검증용 최대 가스 추정 (스케줄 기준 정확 합산). */
export function estimateOmxGas(tiers: ModelTier[], maxAttempts: number): number {
  let sum = 0;
  for (let a = 1; a <= maxAttempts; a++) sum += omxTierForAttempt(a, tiers).gasPerCall;
  return sum;
}

export async function runOmxLoop(opts: OmxOptions): Promise<OmxResult> {
  const onEvent = opts.onEvent ?? (() => {});
  const tiers = opts.tiers;
  if (tiers.length === 0) throw new Error('모델 티어가 비어 있습니다.');
  const maxAttempts = Math.max(opts.maxAttempts ?? 7, 1);

  const fullTarget = resolveSafeTarget(opts.projectRoot, opts.targetFile); // 위반 시 throw → 호출자 처리
  const targetRel = path.relative(opts.projectRoot, fullTarget).split(path.sep).join('/');

  // 격리 샌드박스: 프로젝트 내부지만 app/ 트리 밖 → Next 비서빙, tsconfig exclude 대상.
  const sandboxDir = path.join(opts.projectRoot, '.edenclaw-sandbox', `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const sandboxFile = path.join(sandboxDir, path.basename(fullTarget));
  fs.mkdirSync(sandboxDir, { recursive: true });

  const messages: LoopMessage[] = [
    ...(opts.history ?? []).filter((m) => m.role === 'user' || m.role === 'assistant'),
    { role: 'user', content: opts.prompt },
  ];

  let gasCharged = 0;
  let lastError = '';
  let prevTierKey = '';

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const tier = omxTierForAttempt(attempt, tiers);
      if (prevTierKey && prevTierKey !== tier.key) {
        onEvent({ type: 'escalate', from: prevTierKey, to: tier.key, reason: `tsc 실패 — 상위 티어로 승급` });
      }
      prevTierKey = tier.key;
      onEvent({ type: 'attempt_start', attempt, tier: tier.key, label: tier.label });

      let gen: { text: string; provider: string };
      try {
        gen = await tier.generate(OMX_SYSTEM_PROMPT, messages);
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        onEvent({ type: 'provider_error', attempt, tier: tier.key, error: lastError });
        continue;
      }

      gasCharged += tier.gasPerCall;
      const safeCode = sanitizeGeneratedCode(gen.text); // ① TS1160 백틱/괄호 보정
      fs.writeFileSync(sandboxFile, safeCode, 'utf8'); // ② 샌드박스에만 기록(라이브 미오염)

      const t0 = Date.now();
      const diag = await runLSPDiagnostics(opts.projectRoot, sandboxFile); // ③ 실 tsc(동적 tsconfig)
      const ms = Date.now() - t0;
      onEvent({ type: 'compile', attempt, ok: diag.success, output: diag.stdout, ms });

      if (diag.success) {
        // ④ 통과 시에만 실제 타겟으로 승격(promote)
        fs.mkdirSync(path.dirname(fullTarget), { recursive: true });
        fs.writeFileSync(fullTarget, safeCode, 'utf8');
        onEvent({ type: 'promoted', attempt, tier: tier.key, targetFile: targetRel });
        onEvent({ type: 'success', attempt, tier: tier.key, provider: gen.provider, gasCharged });
        return { success: true, attempts: attempt, finalTier: tier.key, finalProvider: gen.provider, gasCharged, finalCode: safeCode, targetFile: targetRel };
      }

      lastError = diag.stdout;
      messages.push({ role: 'assistant', content: gen.text });
      messages.push({
        role: 'user',
        content: `[컴파일 오류] tsc 진단:\n${diag.stdout}\n위 에러를 고치되 백틱/괄호 마감을 완벽히 확인해 파일 전체를 다시 출력하라.`,
      });
    }

    onEvent({ type: 'exhausted', attempts: maxAttempts, lastError, gasCharged });
    return { success: false, attempts: maxAttempts, gasCharged, targetFile: targetRel, lastError };
  } finally {
    fs.rmSync(sandboxDir, { recursive: true, force: true }); // ⑤ 샌드박스 정리
  }
}
