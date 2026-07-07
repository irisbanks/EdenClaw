import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LOG_PATH = path.join(process.cwd(), 'public', 'swarm-progress.log');
const MAX_TAIL_BYTES = 64 * 1024;

export async function GET() {
  let text = '';
  try {
    const stat = fs.statSync(LOG_PATH);
    const start = Math.max(0, stat.size - MAX_TAIL_BYTES);
    const fd = fs.openSync(LOG_PATH, 'r');
    try {
      const length = stat.size - start;
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, start);
      text = buffer.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    text = '';
  }

  return new NextResponse(text, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
