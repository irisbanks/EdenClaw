import { exec } from 'node:child_process';
import path from 'node:path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SwarmRunBody = {
  task?: unknown;
  targetPath?: unknown;
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function base64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function normalizeTargetPath(targetPath: string): string {
  const projectRoot = process.cwd();
  const absoluteTarget = path.resolve(projectRoot, targetPath);
  const relativeTarget = path.relative(projectRoot, absoluteTarget).split(path.sep).join('/');

  if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
    throw new Error('targetPath must stay inside the project root.');
  }

  return relativeTarget;
}

export async function POST(req: Request) {
  let body: SwarmRunBody;
  try {
    body = await req.json() as SwarmRunBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const task = asString(body.task);
  const rawTargetPath = asString(body.targetPath);

  if (!task) {
    return NextResponse.json({ ok: false, error: 'task is required' }, { status: 400 });
  }

  if (!rawTargetPath) {
    return NextResponse.json({ ok: false, error: 'targetPath is required' }, { status: 400 });
  }

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
  const scriptPath = path.join(projectRoot, 'scripts', 'swarm-loop.js');
  const command = [
    'node',
    shellQuote(scriptPath),
    '--task-b64',
    shellQuote(base64(task)),
    '--target-b64',
    shellQuote(base64(targetPath)),
  ].join(' ');

  const child = exec(
    command,
    {
      cwd: projectRoot,
      env: { ...process.env, EDENCLAW_SWARM_TRIGGER: 'api' },
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    },
    (error, stdout, stderr) => {
      if (error) {
        console.error('[swarm/run] SWARM_LOOP_FAILED', {
          message: error.message,
          stdout: stdout.slice(-4000),
          stderr: stderr.slice(-4000),
        });
        return;
      }

      console.log('[swarm/run] SWARM_LOOP_COMPLETE', stdout.slice(-4000));
    },
  );

  child.unref();

  return NextResponse.json(
    {
      ok: true,
      status: 'SWARM_LOOP_RUNNING',
      quotaAction: 'SWARM_COMPUTE',
      targetPath,
      pid: child.pid ?? null,
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
