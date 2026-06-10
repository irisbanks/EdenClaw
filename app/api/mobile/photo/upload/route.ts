import { NextRequest, NextResponse } from 'next/server';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { detectPrivateInfo } from '@/lib/vision/detect-private-info';

export const runtime = 'nodejs';

function extensionFromMime(mime: string) {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  return 'jpg';
}

async function readUpload(req: NextRequest) {
  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('image') || form.get('file');
    if (!(file instanceof File)) throw new Error('image 파일이 필요합니다.');
    return {
      buffer: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type || 'image/jpeg',
      userId: String(form.get('userId') || ''),
      originalName: file.name,
    };
  }

  const body = await req.json();
  const base64 = String(body.imageBase64 || body.base64 || '');
  if (!base64) throw new Error('imageBase64 또는 multipart image가 필요합니다.');
  const mimeMatch = base64.match(/^data:(.*?);base64,/);
  const mimeType = mimeMatch?.[1] || body.mimeType || 'image/jpeg';
  const payload = base64.replace(/^data:.*?;base64,/, '');
  return {
    buffer: Buffer.from(payload, 'base64'),
    mimeType,
    userId: String(body.userId || ''),
    originalName: String(body.fileName || `eden-upload.${extensionFromMime(mimeType)}`),
  };
}

export async function POST(req: NextRequest) {
  try {
    const upload = await readUpload(req);
    if (!upload.buffer.length) return NextResponse.json({ error: '빈 이미지입니다.' }, { status: 400 });

    const ext = extensionFromMime(upload.mimeType);
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    await mkdir(uploadDir, { recursive: true });
    const storagePath = path.join(uploadDir, fileName);
    await writeFile(storagePath, upload.buffer);

    const url = `/uploads/${fileName}`;
    const privateInfo = await detectPrivateInfo({ imageUrl: url });
    const draft = await prisma.productDraft.create({
      data: {
        userId: upload.userId || null,
        status: 'PHOTO_CAPTURED',
        source: 'mobile_photo',
        riskFlags: JSON.stringify(privateInfo.flags),
      },
    });

    const image = await prisma.productImage.create({
      data: {
        draftId: draft.id,
        url,
        storagePath,
        mimeType: upload.mimeType,
        sizeBytes: upload.buffer.length,
        isPrimary: true,
        privateInfo: JSON.stringify(privateInfo.flags),
      },
    });

    await prisma.agentActionLog.create({
      data: {
        draftId: draft.id,
        action: 'photo_upload',
        input: JSON.stringify({ originalName: upload.originalName, mimeType: upload.mimeType }),
        output: JSON.stringify({ imageId: image.id, url, privateInfo }),
      },
    });

    return NextResponse.json({ draft, image, nextStatus: 'AI_ANALYZING' }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '업로드 실패' }, { status: 400 });
  }
}
