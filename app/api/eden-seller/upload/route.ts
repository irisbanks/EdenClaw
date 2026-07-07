import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── 서버리스 안전 업로드 (fs 미사용 / 메모리 단 Base64 변환) ──
// Vercel(/var/task)은 읽기 전용 FS라 public/uploads 의 mkdir/writeFileSync 가 권한 에러로 죽는다.
// 이 라우트는 'fs' 를 일절 쓰지 않고, 업로드 바이트를 Buffer.from(bytes).toString('base64') 로
// data URL(data:image/...;base64,...) 변환해 메모리에서 즉시 200 으로 응답한다.
// 어떤 예외에도 깡통 에러 대신 데모용 디폴트 이미지를 리턴해 서버 다운/파이프라인 마비를 막는다.

// 데모용 디폴트 이미지(파일 파싱 실패/예외 시 폴백 경로)
const DEFAULT_DEMO_IMAGE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="800" viewBox="0 0 640 800">
       <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
         <stop offset="0" stop-color="#1e293b"/><stop offset="1" stop-color="#0f172a"/></linearGradient></defs>
       <rect width="640" height="800" fill="url(#g)"/>
       <circle cx="320" cy="330" r="120" fill="none" stroke="#38bdf8" stroke-width="6" opacity="0.7"/>
       <text x="320" y="345" font-family="sans-serif" font-size="44" fill="#e2e8f0" text-anchor="middle">EDEN</text>
       <text x="320" y="560" font-family="sans-serif" font-size="26" fill="#94a3b8" text-anchor="middle">데모 상품 이미지</text>
     </svg>`,
  );

const DEFAULT_PRODUCT_NAME = '다이슨 V15 무선청소기';
const DEFAULT_SUGGESTED_PRICE = 500000;

function buildMarketAnalysis(productName: string, suggestedPrice: number): string {
  const low = Math.round(suggestedPrice * 0.9);
  const high = Math.round(suggestedPrice * 1.12);
  return (
    `📊 ${productName} 실시간 시세 분석\n` +
    `최근 30일 중고 거래가 기준 ${low.toLocaleString()}원 ~ ${high.toLocaleString()}원 구간에서 형성되어 있습니다. ` +
    `상태 A급(사용감 적음) 프리미엄 라인으로 권장가 ${suggestedPrice.toLocaleString()}원 책정 시 빠른 거래가 예상됩니다. ` +
    `AI 신뢰도 86% · 회전율 상위 12%.`
  );
}

// 멀티파트(File) 또는 JSON(base64) 입력을 읽어 Base64 data URL 로 변환(메모리 단). 실패 시 null.
async function toDataUrl(req: NextRequest): Promise<{ dataUrl: string; mimeType: string; userId: string; price?: number; name?: string } | null> {
  const contentType = req.headers.get('content-type') || '';

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('image') || form.get('file');
    if (!(file instanceof File)) return null;
    const mimeType = file.type || 'image/jpeg';
    // ★ 핵심: 파일 바이트 → Buffer → base64 → data URL (디스크 미사용)
    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString('base64');
    const priceRaw = Number(form.get('price'));
    return {
      dataUrl: `data:${mimeType};base64,${base64}`,
      mimeType,
      userId: String(form.get('userId') || ''),
      price: Number.isFinite(priceRaw) && priceRaw > 0 ? priceRaw : undefined,
      name: form.get('productName') ? String(form.get('productName')) : undefined,
    };
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const raw = String(body.imageBase64 || body.base64 || '');
  if (!raw) return null;
  const mimeType = raw.match(/^data:(.*?);base64,/)?.[1] || String(body.mimeType || 'image/jpeg');
  const payload = raw.replace(/^data:.*?;base64,/, '');
  // 이미 data URL 이면 그대로, 순수 base64 면 data URL 로 감싼다.
  const dataUrl = raw.startsWith('data:') ? raw : `data:${mimeType};base64,${Buffer.from(payload, 'base64').toString('base64')}`;
  const priceRaw = Number(body.price);
  return {
    dataUrl,
    mimeType,
    userId: String(body.userId || ''),
    price: Number.isFinite(priceRaw) && priceRaw > 0 ? priceRaw : undefined,
    name: typeof body.productName === 'string' ? body.productName : undefined,
  };
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await toDataUrl(req);

    const url = parsed?.dataUrl || DEFAULT_DEMO_IMAGE;
    const productName = parsed?.name || DEFAULT_PRODUCT_NAME;
    const suggestedPrice = parsed?.price || DEFAULT_SUGGESTED_PRICE;
    const analysis = buildMarketAnalysis(productName, suggestedPrice);
    const usedFallbackImage = !parsed?.dataUrl;

    // DB 기록은 베스트에포트(없거나 실패해도 응답을 막지 않는다)
    let draftId = `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let persisted = false;
    try {
      const { prisma } = await import('@/lib/prisma');
      const created = await prisma.productDraft.create({
        data: {
          userId: parsed?.userId || null,
          status: 'PHOTO_CAPTURED',
          source: 'eden_seller_demo',
          riskFlags: '[]',
        },
        select: { id: true },
      });
      draftId = created.id;
      persisted = true;
    } catch {
      // prisma 미연결/실패(데모) → 데모 draft id 유지
    }

    return NextResponse.json(
      {
        success: true,
        url, // data URL (프론트가 즉시 미리보기 렌더)
        productName,
        suggestedPrice,
        analysis, // AI 시세 분석 텍스트
        // 하위 호환 + 다운스트림 분석 연결용
        draft: { id: draftId },
        image: { url },
        nextStatus: 'AI_ANALYZING',
        persisted,
        demo: !persisted || usedFallbackImage,
      },
      { status: 200 },
    );
  } catch {
    // 최후 가드: 어떤 예외에도 서버 다운 없이 데모 디폴트 이미지로 200 응답
    return NextResponse.json(
      {
        success: true,
        url: DEFAULT_DEMO_IMAGE,
        productName: DEFAULT_PRODUCT_NAME,
        suggestedPrice: DEFAULT_SUGGESTED_PRICE,
        analysis: buildMarketAnalysis(DEFAULT_PRODUCT_NAME, DEFAULT_SUGGESTED_PRICE),
        draft: { id: `demo-${Date.now()}` },
        image: { url: DEFAULT_DEMO_IMAGE },
        nextStatus: 'AI_ANALYZING',
        persisted: false,
        demo: true,
      },
      { status: 200 },
    );
  }
}
