import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import crypto from 'crypto';

const execFileAsync = promisify(execFile);
const PYTHON = '/NHNHOME/WORKSPACE/0426030063_A/edenclaw/venv/bin/python3';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get('audio') as File;
    if (!audioFile) return NextResponse.json({ error: 'audio file required' }, { status: 400 });

    const uid = crypto.randomUUID();
    const audioPath = path.join(tmpdir(), `stt_${uid}.webm`);
    const buffer = Buffer.from(await audioFile.arrayBuffer());
    await writeFile(audioPath, buffer);

    // Whisper로 STT (GPU 0 사용 방지 위해 CPU 또는 GPU 1 사용)
    const script = `
import whisper, os
os.environ['CUDA_VISIBLE_DEVICES'] = '1'
model = whisper.load_model('small')
result = model.transcribe(${JSON.stringify(audioPath)}, language='ko')
print(result['text'].strip())
`;
    const scriptFile = audioPath.replace('.webm', '.py');
    await writeFile(scriptFile, script);
    const { stdout } = await execFileAsync(PYTHON, [scriptFile], { timeout: 60000 });
    await unlink(audioPath).catch(() => {});
    await unlink(scriptFile).catch(() => {});

    return NextResponse.json({ text: stdout.trim() });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
