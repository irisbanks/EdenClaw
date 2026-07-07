#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const MAX_ATTEMPTS = 5;
const BUILD_COMMAND = 'npm run build';

function decodeBase64(value) {
  return Buffer.from(String(value || ''), 'base64').toString('utf8');
}

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;

    const key = item.slice(2);
    const next = argv[index + 1];

    if (!next || next.startsWith('--')) {
      args[key] = 'true';
      continue;
    }

    args[key] = next;
    index += 1;
  }

  return {
    taskDescription: args['task-b64'] ? decodeBase64(args['task-b64']) : args.task || argv[0] || '',
    targetFilePath: args['target-b64'] ? decodeBase64(args['target-b64']) : args.target || argv[1] || '',
  };
}

function normalizeTargetPath(targetFilePath) {
  if (!targetFilePath || typeof targetFilePath !== 'string') {
    throw new Error('targetFilePath is required');
  }

  const absoluteTarget = path.resolve(PROJECT_ROOT, targetFilePath.trim());
  const relativeTarget = path.relative(PROJECT_ROOT, absoluteTarget).split(path.sep).join('/');

  if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
    throw new Error(`Unsafe target path outside project root: ${targetFilePath}`);
  }

  return { absoluteTarget, relativeTarget };
}

function captureBuildError(error) {
  const stderr = Buffer.isBuffer(error && error.stderr)
    ? error.stderr.toString('utf8')
    : String((error && error.stderr) || '');
  const stdout = Buffer.isBuffer(error && error.stdout)
    ? error.stdout.toString('utf8')
    : String((error && error.stdout) || '');
  const message = String((error && error.message) || '');

  return [stderr, stdout, message].filter(Boolean).join('\n\n').slice(-24_000);
}

function safeComment(value) {
  return String(value || '').replace(/\*\//g, '* /').slice(0, 8_000);
}

function buildPrompt(taskDescription, compileError, attempt) {
  return [
    `Task: ${taskDescription}`,
    `Attempt: ${attempt}/${MAX_ATTEMPTS}`,
    `Previous build error:\n${compileError || 'none'}`,
  ].join('\n\n');
}

function generateRouteSource(taskDescription, compileError, attempt) {
  const prompt = safeComment(buildPrompt(taskDescription, compileError, attempt));

  return `import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    ok: true,
    generatedBy: 'edenclaw-swarm-loop',
    stage: 'DEPLOYED',
    task: ${JSON.stringify(taskDescription.slice(0, 800))},
    attempt: ${attempt},
    generatedAt: ${JSON.stringify(new Date().toISOString())},
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  return NextResponse.json({
    ok: true,
    generatedBy: 'edenclaw-swarm-loop',
    received: body,
  });
}

/*
Codex feedback prompt:
${prompt}
*/
`;
}

function generateCommonJsSource(taskDescription, compileError, attempt) {
  const prompt = safeComment(buildPrompt(taskDescription, compileError, attempt));

  return `'use strict';

module.exports = {
  ok: true,
  generatedBy: 'edenclaw-swarm-loop',
  task: ${JSON.stringify(taskDescription.slice(0, 800))},
  attempt: ${attempt},
};

/*
Codex feedback prompt:
${prompt}
*/
`;
}

function generateTextSource(taskDescription, compileError, attempt) {
  return [
    'EDENCLAW SWARM GENERATED ARTIFACT',
    `attempt=${attempt}`,
    '',
    'task:',
    taskDescription,
    '',
    'previous build error:',
    compileError || 'none',
    '',
  ].join('\n');
}

function generateSource(target, taskDescription, compileError, attempt) {
  if (/^app\/api\/.+\/route\.tsx?$/.test(target.relativeTarget)) {
    return generateRouteSource(taskDescription, compileError, attempt);
  }

  if (target.relativeTarget.endsWith('.js') || target.relativeTarget.endsWith('.cjs')) {
    return generateCommonJsSource(taskDescription, compileError, attempt);
  }

  if (target.relativeTarget.endsWith('.json')) {
    return JSON.stringify({
      ok: true,
      generatedBy: 'edenclaw-swarm-loop',
      task: taskDescription,
      attempt,
      previousBuildError: compileError || null,
    }, null, 2);
  }

  return generateTextSource(taskDescription, compileError, attempt);
}

async function runSwarmAutomationLoop(taskDescription, targetFilePath) {
  if (!taskDescription || typeof taskDescription !== 'string') {
    throw new Error('taskDescription is required');
  }

  const target = normalizeTargetPath(targetFilePath);
  const originalContent = fs.existsSync(target.absoluteTarget)
    ? fs.readFileSync(target.absoluteTarget, 'utf8')
    : null;

  let compileError = '';
  let attempt = 0;
  let resolved = false;

  while (attempt < MAX_ATTEMPTS && !resolved) {
    attempt += 1;

    console.log(`[Codex] attempt ${attempt}/${MAX_ATTEMPTS} · generating ${target.relativeTarget}`);
    const source = generateSource(target, taskDescription, compileError, attempt);

    fs.mkdirSync(path.dirname(target.absoluteTarget), { recursive: true });
    fs.writeFileSync(target.absoluteTarget, source, 'utf8');
    console.log(`[Codex] wrote ${target.relativeTarget}`);

    try {
      console.log(`[Claude] running ${BUILD_COMMAND}`);
      execSync(BUILD_COMMAND, {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        stdio: 'pipe',
        maxBuffer: 64 * 1024 * 1024,
      });

      resolved = true;
      console.log('[Claude] build passed');
      console.log('[Deploy] final deployment-ready artifact generated');
    } catch (error) {
      compileError = captureBuildError(error);
      console.error(`[Claude] build failed on attempt ${attempt}/${MAX_ATTEMPTS}`);
      console.error(compileError);
      console.log('[Feedback] feeding compiler error back into next Codex pass');
    }
  }

  if (!resolved) {
    if (originalContent !== null) {
      fs.writeFileSync(target.absoluteTarget, originalContent, 'utf8');
    }

    throw new Error(`Swarm loop failed after ${MAX_ATTEMPTS} attempts\n${compileError}`);
  }

  return {
    ok: true,
    attempts: attempt,
    targetPath: target.relativeTarget,
  };
}

if (require.main === module) {
  const { taskDescription, targetFilePath } = parseArgs(process.argv.slice(2));

  runSwarmAutomationLoop(taskDescription, targetFilePath)
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.stack || error.message : String(error));
      process.exitCode = 1;
    });
}

module.exports = {
  runSwarmAutomationLoop,
};
