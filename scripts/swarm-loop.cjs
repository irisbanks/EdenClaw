#!/usr/bin/env node
'use strict';

// Autonomous swarm loop (CommonJS, no build-server interference):
//   node scripts/swarm-loop.cjs "<task>" "<targetPath>"
//
// Generates code via a local OpenAI-compatible LLM endpoint, writes it to
// targetPath (project-root-relative, extension-whitelisted only), validates
// with `npx tsc --noEmit` (never `npm run build` — that would overwrite the
// .next directory a running `next start`/dev server is serving from), and
// retries with the compiler error fed back into the prompt up to 5 times.
// Backs up the original file before the first write and restores it if all
// attempts fail. All progress is appended to public/swarm-progress.log.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const LOG_PATH = path.join(PROJECT_ROOT, 'public', 'swarm-progress.log');

// 이 스크립트는 Next.js 밖에서 plain node로도 실행되므로(직접 CLI 호출), .env/
// .env.local을 직접 읽는다. dotenv는 프로젝트에 선언된 의존성이 아니라(전이
// 의존성으로만 존재) 새 패키지를 추가하는 대신 최소 파서로 처리한다.
// .env.local이 .env보다 우선한다(Next.js와 동일한 우선순위).
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
// loadEnvFile은 이미 process.env에 있는 키를 덮어쓰지 않으므로(first-wins),
// 더 높은 우선순위인 .env.local을 먼저 읽어야 한다.
loadEnvFile(path.join(PROJECT_ROOT, '.env.local'));
loadEnvFile(path.join(PROJECT_ROOT, '.env'));
const MAX_ATTEMPTS = 5;
const ALLOWED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.css']);
const CANDIDATE_LLM_BASES = ['http://127.0.0.1:8080/v1', 'http://127.0.0.1:8000/v1'];
const LLM_TIMEOUT_MS = 120_000;

function log(tag, message) {
  const line = `[${new Date().toISOString()}] [${tag}] ${message}\n`;
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, line, 'utf8');
  } catch (err) {
    // Progress log is best-effort; never let a logging failure kill the loop.
    process.stderr.write(`[swarm-loop] failed to append progress log: ${err.message}\n`);
  }
  // 주의: stdout/stderr에도 쓰지 않는다. app/api/swarm/run/route.ts가 이 자식
  // 프로세스의 stdio를 이 로그 파일과 같은 fd로 리다이렉트하므로, 여기서 또
  // stdout에 쓰면 매 줄이 두 번(appendFileSync 1회 + 리다이렉트된 stdout 1회)
  // 기록된다 — 실측으로 확인함.
}

function validateTargetPath(rawTargetPath) {
  const absoluteTarget = path.resolve(PROJECT_ROOT, rawTargetPath);
  const relativeTarget = path.relative(PROJECT_ROOT, absoluteTarget);
  if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
    throw new Error(`targetPath escapes project root: ${rawTargetPath}`);
  }
  const ext = path.extname(absoluteTarget);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(
      `targetPath extension "${ext}" not allowed (allowed: ${[...ALLOWED_EXTENSIONS].join(', ')})`,
    );
  }
  return absoluteTarget;
}

async function probeModel(base) {
  try {
    const res = await fetch(`${base}/models`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const data = await res.json();
    const first = Array.isArray(data && data.data) ? data.data[0] : null;
    return first && typeof first.id === 'string' ? first.id : null;
  } catch {
    return null;
  }
}

async function detectLlmEndpoint() {
  // SWARM_LLM_URL/SWARM_LLM_MODEL(.env.local)이 있으면 자동탐지보다 우선한다.
  const envUrl = process.env.SWARM_LLM_URL;
  if (envUrl) {
    const base = envUrl.replace(/\/chat\/completions\/?$/, '');
    const model = process.env.SWARM_LLM_MODEL || (await probeModel(base));
    if (model) return { base, model };
  }

  for (const base of CANDIDATE_LLM_BASES) {
    const model = await probeModel(base);
    if (model) return { base, model };
  }
  return null;
}

function stripMarkdownFences(text) {
  const trimmed = String(text).trim();
  const wholeFence = trimmed.match(/^```[a-zA-Z0-9_-]*\n?([\s\S]*?)\n?```$/);
  if (wholeFence) return wholeFence[1];
  const anyFence = trimmed.match(/```[a-zA-Z0-9_-]*\n?([\s\S]*?)```/);
  if (anyFence) return anyFence[1];
  return trimmed;
}

async function callLlm(base, model, messages) {
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 4000 }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`LLM HTTP ${res.status}: ${bodyText.slice(0, 500)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('LLM response missing choices[0].message.content');
  return content;
}

function runTsc() {
  const result = spawnSync('npx', ['tsc', '--noEmit', '--pretty', 'false'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  return { ok: result.status === 0, output };
}

function systemPrompt(targetPath) {
  return (
    'You are an expert TypeScript/JavaScript code generator working inside a Next.js project. ' +
    `You are writing the complete contents of a single file at "${targetPath}". ` +
    'Output ONLY the file content — no explanations, no commentary. ' +
    'If you use a markdown code fence, use exactly one triple-backtick block containing the whole file.'
  );
}

async function main() {
  const [, , task, rawTargetPath] = process.argv;
  if (!task || !rawTargetPath) {
    log('FATAL', 'usage: node swarm-loop.cjs "<task>" "<targetPath>"');
    process.exitCode = 1;
    return;
  }

  let absTarget;
  try {
    absTarget = validateTargetPath(rawTargetPath);
  } catch (err) {
    log('FATAL', `invalid targetPath: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  log('START', `task="${task}" target="${rawTargetPath}"`);

  const endpoint = await detectLlmEndpoint();
  if (!endpoint) {
    log(
      'FATAL',
      `no reachable OpenAI-compatible LLM endpoint on ${CANDIDATE_LLM_BASES.join(' or ')} (checked /models)`,
    );
    log('FAIL', 'swarm loop aborted — LLM endpoint unavailable');
    process.exitCode = 1;
    return;
  }
  log('INFO', `LLM endpoint=${endpoint.base} model=${endpoint.model}`);

  const hadOriginal = fs.existsSync(absTarget);
  const backupPath = `${absTarget}.swarm-backup`;
  if (hadOriginal) {
    fs.copyFileSync(absTarget, backupPath);
    log('INFO', `backed up existing file to ${path.relative(PROJECT_ROOT, backupPath)}`);
  } else {
    fs.mkdirSync(path.dirname(absTarget), { recursive: true });
  }

  const prompt = systemPrompt(rawTargetPath);
  let messages = [
    { role: 'system', content: prompt },
    {
      role: 'user',
      content: `Task: ${task}\nTarget file: ${rawTargetPath}\n\nOutput ONLY the complete file content.`,
    },
  ];

  let success = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    log('ATTEMPT', `#${attempt}/${MAX_ATTEMPTS}`);

    let raw;
    try {
      raw = await callLlm(endpoint.base, endpoint.model, messages);
    } catch (err) {
      log('FAIL', `LLM call failed on attempt ${attempt}: ${err.message}`);
      break;
    }

    const code = stripMarkdownFences(raw);
    fs.writeFileSync(absTarget, code, 'utf8');
    log('WRITE', `wrote ${code.length} bytes to ${rawTargetPath}`);

    const tsc = runTsc();
    if (tsc.ok) {
      log('TSC_OK', 'npx tsc --noEmit passed');
      success = true;
      break;
    }

    log('TSC_FAIL', tsc.output.slice(0, 4000));
    messages = [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content:
          `Task: ${task}\nTarget file: ${rawTargetPath}\n\n` +
          `Your previous attempt failed TypeScript compilation with these errors:\n\n${tsc.output.slice(0, 4000)}\n\n` +
          `Previous code:\n\n${code}\n\n` +
          'Fix the code and output ONLY the corrected complete file content.',
      },
    ];
  }

  if (success) {
    if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
    log('DONE', 'deployment-ready');
    process.exitCode = 0;
    return;
  }

  if (hadOriginal) {
    fs.copyFileSync(backupPath, absTarget);
    fs.unlinkSync(backupPath);
    log('RESTORE', `restored original file after failed attempts (${path.relative(PROJECT_ROOT, absTarget)})`);
  } else {
    try {
      fs.unlinkSync(absTarget);
    } catch {
      // nothing to clean up
    }
    log('RESTORE', 'removed generated file (no original existed before this run)');
  }
  log('FAIL', `swarm loop failed after ${MAX_ATTEMPTS} attempts`);
  process.exitCode = 1;
}

main().catch((err) => {
  log('FATAL', err && err.stack ? err.stack : String(err));
  process.exitCode = 1;
});
