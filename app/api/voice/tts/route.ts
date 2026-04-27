import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import crypto from 'crypto';

const execFileAsync = promisify(execFile);
const PYTHON = '/NHNHOME/WORKSPACE/0426030063_A/edenclaw/venv/bin/python3';

export async function POST(req: NextRequest) {
  try {
    const { text, voice = 'ko-KR-SunHiNeural' } = await req.json();
    if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 });

    const outFile = path.join(tmpdir(), `tts_${crypto.randomUUID()}.mp3`);

    // edge-tts로 TTS 생성 (한국어 음성)
    const script = `
import asyncio, edge_tts
async def run():
    c = edge_tts.Communicate(${JSON.stringify(text)}, ${JSON.stringify(voice)})
    await c.save(${JSON.stringify(outFile)})
asyncio.run(run())
`;
    const scriptFile = outFile.replace('.mp3', '.py');
    await writeFile(scriptFile, script);
    await execFileAsync(PYTHON, [scriptFile], { timeout: 30000 });
    await unlink(scriptFile);

    const audioBuffer = await readFile(outFile);
    await unlink(outFile);

    return new Response(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.length.toString(),
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
