import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.css']);

type SwarmRunBody = {
  task?: unknown;
  targetPath?: unknown;
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTargetPath(targetPath: string): string {
  const projectRoot = process.cwd();
  const absoluteTarget = path.resolve(projectRoot, targetPath);
  const relativeTarget = path.relative(projectRoot, absoluteTarget).split(path.sep).join('/');

  if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
    throw new Error('targetPath must stay inside the project root.');
  }
  const ext = path.extname(absoluteTarget);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`targetPath extension "${ext}" not allowed (allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}).`);
  }

  return relativeTarget;
}

/**
 * Vercel(서버리스)에는 detached child_process spawn이나 이 루프가 쓰는 로컬
 * 파일시스템 로그가 없다 — self-host 환경(예: PORT=3100 npm run dev) 전용.
 */
export async function POST(req: Request) {
  if (process.env.VERCEL === '1') {
    return NextResponse.json(
      { ok: false, error: 'swarm loop is disabled on Vercel — self-host only' },
      { status: 501 },
    );
  }

  let body: SwarmRunBody;
  try {
    body = (await req.json()) as SwarmRunBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const task = asString(body.task);
  const rawTargetPath = asString(body.targetPath);

  if (!task) return NextResponse.json({ ok: false, error: 'task is required' }, { status: 400 });
  if (!rawTargetPath) return NextResponse.json({ ok: false, error: 'targetPath is required' }, { status: 400 });

  let targetPath: string;
  try {
    targetPath = normalizeTargetPath(rawTargetPath);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'invalid_targetPath' },
      { status: 400 },
    );
  }

  const projectRoot = process.cwd();
  const scriptPath = path.join(projectRoot, 'scripts', 'swarm-loop.cjs');
  const logPath = path.join(projectRoot, 'public', 'swarm-progress.log');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const logFd = fs.openSync(logPath, 'a');

  const child = spawn(process.execPath, [scriptPath, task, targetPath], {
    cwd: projectRoot,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  fs.closeSync(logFd);

  return NextResponse.json(
    { ok: true, status: 'SWARM_LOOP_RUNNING', targetPath, pid: child.pid ?? null },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
