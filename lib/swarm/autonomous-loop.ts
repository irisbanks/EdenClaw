// 진짜 자율 크로스모델 개발 루프 (P1)
// - 생성 코드를 격리된 임시 워크스페이스에 실제로 기록
// - 실제 `tsc --noEmit`로 검증 (가짜 휴리스틱 아님)
// - 실패 시 컴파일러 진단을 다음 모델에 피드백하고 티어를 자동 에스컬레이션
//
// 모델 호출 계층은 주입(injection)식이라 라이브 API 없이도 단위 테스트 가능하다.
import { exec } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { sanitizeGeneratedCode } from './omx-sanitize';

export type LoopRole = 'user' | 'assistant';
export type LoopMessage = { role: LoopRole; content: string };
export type GenFile = { path: string; content: string };

/** 하나의 모델 티어. generate는 실제로 실행된 provider 문자열을 정직하게 돌려줘야 한다. */
export interface ModelTier {
  key: string;
  label: string;
  gasPerCall: number;
  generate: (system: string, messages: LoopMessage[]) => Promise<{ text: string; provider: string }>;
}

export type LoopEvent =
  | { type: 'attempt_start'; attempt: number; tier: string; label: string }
  | { type: 'generated'; attempt: number; tier: string; provider: string; files: number }
  | { type: 'file'; attempt: number; path: string; content: string }
  | { type: 'compile'; attempt: number; ok: boolean; output: string; ms: number }
  | { type: 'escalate'; from: string; to: string; reason: string }
  | { type: 'provider_error'; attempt: number; tier: string; error: string }
  | { type: 'success'; attempt: number; tier: string; provider: string; files: GenFile[]; gasCharged: number }
  | { type: 'exhausted'; attempts: number; lastError: string; gasCharged: number };

export interface LoopOptions {
  prompt: string;
  tiers: ModelTier[];
  maxAttempts?: number;
  onEvent?: (e: LoopEvent) => void;
}

export interface LoopResult {
  success: boolean;
  attempts: number;
  finalTier?: string;
  finalProvider?: string;
  files: GenFile[];
  gasCharged: number;
  lastError?: string;
}

const SYSTEM_PROMPT = `너는 자율 코드 엔지니어다. 요청과 (제공된다면) TypeScript 컴파일러(tsc --noEmit) 진단을 분석해, 완전히 컴파일되는 프로젝트 파일들을 생성한다.
반드시 JSON 배열 [{"path": "...", "content": "..."}] 형식으로만 출력하라. 설명/마크다운/코드펜스 금지.
각 파일은 자기완결적이고 외부 패키지 의존 없이 tsc --noEmit(strict)를 통과해야 한다.`;

/** 모델 응답에서 멀티파일 JSON을 추출. 실패 시 단일 파일로 폴백. */
export function parseFiles(raw: string): GenFile[] {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = fence ? fence[1] : raw;
  try {
    const arr: unknown = JSON.parse(jsonText.trim());
    if (Array.isArray(arr)) {
      const files = arr
        .filter((f): f is GenFile => !!f && typeof (f as GenFile).path === 'string' && typeof (f as GenFile).content === 'string')
        .map((f) => ({ path: f.path, content: f.content }));
      if (files.length) return files.slice(0, 16);
    }
  } catch {
    // JSON 아님 → 단일 파일 폴백
  }
  const looksTs = /\b(import |export |const |function |interface |type )/.test(raw);
  return [{ path: looksTs ? 'index.ts' : 'output.txt', content: raw }];
}

function execAsync(
  cmd: string,
  opts: { cwd: string; timeout: number; maxBuffer: number }
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    exec(cmd, opts, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** 생성 파일을 워크스페이스 안에 안전하게 기록 (경로 이탈 차단). */
async function writeFiles(workspace: string, files: GenFile[]): Promise<GenFile[]> {
  const written: GenFile[] = [];
  for (const f of files) {
    const clean = f.path.replace(/[\0\r\n]/g, '').trim();
    if (!clean) continue;
    const abs = path.resolve(workspace, clean);
    const rel = path.relative(workspace, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue; // 워크스페이스 밖이면 스킵
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, f.content, 'utf8');
    written.push({ path: clean, content: f.content });
  }
  return written;
}

/** 워크스페이스 전체를 실제 tsc --noEmit(strict)로 컴파일 검증. */
async function runTsc(workspace: string): Promise<{ ok: boolean; output: string; ms: number }> {
  const tsconfig = {
    compilerOptions: {
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      target: 'ES2020',
      module: 'ESNext',
      moduleResolution: 'bundler',
      esModuleInterop: true,
      allowJs: true,
      jsx: 'react-jsx',
      forceConsistentCasingInFileNames: true,
    },
    include: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
  };
  const tsconfigPath = path.join(workspace, 'tsconfig.json');
  await fs.writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2), 'utf8');

  const localTsc = path.join(process.cwd(), 'node_modules', '.bin', 'tsc');
  const tscCmd = (await fileExists(localTsc)) ? JSON.stringify(localTsc) : 'npx tsc';
  const cmd = `${tscCmd} -p ${JSON.stringify(tsconfigPath)}`;

  const t0 = Date.now();
  const { code, stdout, stderr } = await execAsync(cmd, { cwd: workspace, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });
  const ms = Date.now() - t0;
  const output = `${stdout}${stderr}`.trim();
  return { ok: code === 0, output: output || (code === 0 ? 'COMPILATION_SUCCESS' : 'tsc 실패(출력 없음)'), ms };
}

/**
 * 자율 루프: 생성 → 워크스페이스 기록 → 실제 tsc → 실패 시 진단 피드백 + 티어 에스컬레이션.
 * tier 순서대로 에스컬레이션하며, maxAttempts 까지 마지막 티어를 반복 시도한다.
 */
export async function runAutonomousLoop(opts: LoopOptions): Promise<LoopResult> {
  const { prompt, tiers } = opts;
  const onEvent = opts.onEvent ?? (() => {});
  const maxAttempts = Math.max(opts.maxAttempts ?? 5, tiers.length);
  if (tiers.length === 0) throw new Error('모델 티어가 비어 있습니다.');

  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'edenclaw-loop-'));
  const messages: LoopMessage[] = [{ role: 'user', content: prompt }];
  let gasCharged = 0;
  let lastError = '';
  let tierIndex = 0;

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const tier = tiers[Math.min(tierIndex, tiers.length - 1)];
      onEvent({ type: 'attempt_start', attempt, tier: tier.key, label: tier.label });

      let gen: { text: string; provider: string };
      try {
        gen = await tier.generate(SYSTEM_PROMPT, messages);
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        lastError = error;
        onEvent({ type: 'provider_error', attempt, tier: tier.key, error });
        if (tierIndex < tiers.length - 1) {
          const next = tiers[tierIndex + 1];
          onEvent({ type: 'escalate', from: tier.key, to: next.key, reason: `provider 오류: ${error}` });
          tierIndex += 1;
        }
        continue;
      }

      gasCharged += tier.gasPerCall;
      // OMX 패리티: 각 파일 콘텐츠에 TS1160 백틱/괄호 보정 적용 후 기록
      const files = parseFiles(gen.text).map((f) => ({ path: f.path, content: sanitizeGeneratedCode(f.content) }));
      const written = await writeFiles(workspace, files);
      onEvent({ type: 'generated', attempt, tier: tier.key, provider: gen.provider, files: written.length });
      for (const f of written) onEvent({ type: 'file', attempt, path: f.path, content: f.content });

      const { ok, output, ms } = await runTsc(workspace);
      onEvent({ type: 'compile', attempt, ok, output, ms });

      if (ok) {
        onEvent({ type: 'success', attempt, tier: tier.key, provider: gen.provider, files: written, gasCharged });
        return { success: true, attempts: attempt, finalTier: tier.key, finalProvider: gen.provider, files: written, gasCharged };
      }

      lastError = output;
      messages.push({ role: 'assistant', content: gen.text });
      messages.push({
        role: 'user',
        content: `[tsc 컴파일러 에러] 아래 진단을 정밀 분석해, 모든 파일을 다시 "JSON 배열 [{"path","content"}]" 형식으로 완전히 컴파일되도록 고쳐서 출력하라:\n${output}`,
      });

      if (tierIndex < tiers.length - 1) {
        const next = tiers[tierIndex + 1];
        onEvent({ type: 'escalate', from: tier.key, to: next.key, reason: `tsc 실패 (${ms}ms)` });
        tierIndex += 1;
      }
    }

    onEvent({ type: 'exhausted', attempts: maxAttempts, lastError, gasCharged });
    return { success: false, attempts: maxAttempts, files: [], gasCharged, lastError };
  } finally {
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
}
