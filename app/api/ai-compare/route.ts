import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const execFileAsync = promisify(execFile);

export async function POST(req: NextRequest) {
  const payload = await req.json().catch(() => ({}));
  const fastApiUrl = process.env.MULTI_AI_FASTAPI_URL || 'http://127.0.0.1:8091';

  if (process.env.MULTI_AI_FASTAPI_FIRST === '1') {
    try {
      const res = await fetch(`${fastApiUrl.replace(/\/$/, '')}/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(45000),
      });
      if (res.ok) {
        return NextResponse.json(await res.json());
      }
    } catch {
      // Fall back to direct Python execution below.
    }
  }

  const python = process.env.MULTI_AI_PYTHON || '/NHNHOME/WORKSPACE/0426030063_A/.bootstrap_uv/bin/python';
  const script = path.join(process.cwd(), 'ai_router.py');
  const args = [
    script,
    '--json',
    '--message',
    String(payload.message || payload.text || 'iPhone 15 Pro 사고 싶어, 예산 1500달러'),
  ];
  if (payload.scenario) args.push('--scenario', String(payload.scenario));
  if (payload.product_name || payload.productName) args.push('--product', String(payload.product_name || payload.productName));
  if (payload.budget) args.push('--budget', String(payload.budget));
  if (payload.userPrice || payload.user_price) args.push('--user-price', String(payload.userPrice || payload.user_price));
  if (payload.start_price || payload.startPrice) args.push('--start-price', String(payload.start_price || payload.startPrice));
  if (payload.category) args.push('--category', String(payload.category));

  try {
    const { stdout, stderr } = await execFileAsync(python, args, {
      cwd: process.cwd(),
      timeout: 60000,
      maxBuffer: 8 * 1024 * 1024,
      env: {
        ...process.env,
        CUDA_VISIBLE_DEVICES: process.env.MULTI_AI_CUDA_VISIBLE_DEVICES || '2,3',
      },
    });
    const data = JSON.parse(stdout.trim());
    return NextResponse.json({ ...data, python_stderr: stderr || undefined });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'AI comparison failed' },
      { status: 500 },
    );
  }
}
