import { NextRequest, NextResponse } from 'next/server';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { put } from '@vercel/blob';
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

    // 저장 우선순위:
    // 1) Vercel Blob (BLOB_READ_WRITE_TOKEN 있으면) — 서버리스에서도 영구 저장, 대량 사용자 규모에 맞는 유일한 옵션.
    // 2) 로컬 디스크 (개발용 next start/dev — Vercel 서버리스는 읽기 전용 FS라 여기서 항상 실패한다).
    // 3) Base64 data URL — 위 둘 다 안 될 때만 쓰는 최후 폴백. Postgres row 에 이미지 전체가
    //    박히므로 실사용 규모에서는 DB 비대화/응답 지연의 원인이 된다 — 반드시 1)을 설정할 것.
    let url: string;
    let storagePath = '';
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const blob = await put(`product-photos/${fileName}`, upload.buffer, {
        access: 'public',
        contentType: upload.mimeType,
      });
      url = blob.url;
      storagePath = blob.pathname;
    } else {
      url = `/uploads/${fileName}`;
      storagePath = path.join(process.cwd(), 'public', 'uploads', fileName);
      try {
        const uploadDir = path.join(process.cwd(), 'public', 'uploads');
        await mkdir(uploadDir, { recursive: true });
        await writeFile(storagePath, upload.buffer);
      } catch {
        console.warn(
          '[photo/upload] BLOB_READ_WRITE_TOKEN 미설정 + 디스크 쓰기 실패 → base64 data URL 폴백 ' +
            '(프로덕션 규모에서는 Vercel Blob storage 를 반드시 연결할 것)',
        );
        url = `data:${upload.mimeType};base64,${upload.buffer.toString('base64')}`;
        storagePath = '';
      }
    }

    // data URL 폴백 시 외부 패치를 시도하는 탐지기가 던질 수 있어 가드(실패해도 업로드는 진행)
    const privateInfo = await detectPrivateInfo({ imageUrl: url }).catch(() => ({ flags: [] as unknown[] }));
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
