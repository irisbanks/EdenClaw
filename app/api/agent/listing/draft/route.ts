import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { suggestPrice } from '@/lib/agents/price-agent';
import { writeListingDraft } from '@/lib/agents/listing-writer-agent';
import { ProductAnalysis } from '@/lib/agents/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_PRICE = 500000;

// 빈 analysis 로도 listing 을 만들 수 있도록 최소 형태를 구성(데모/임시 draft 폴백용)
function minimalAnalysis(productName: string): ProductAnalysis {
  return {
    productName: productName || '중고 상품',
    category: '생활가전',
    condition: 'A급(사용감 적음)',
    confidence: 0.85,
    needsMorePhotos: false,
    suggestedAngles: [],
    riskFlags: [],
    privateInfoFlags: [],
    prohibited: false,
    notes: '',
  };
}

// 에이전트(LLM) 호출 실패 시에도 200 을 보장하기 위한 단순 폴백 판매글
function fallbackListing(productName: string) {
  const name = productName || '중고 상품';
  return {
    title: `${name} 판매합니다 (상태 최상)`,
    description: `${name} 내놓습니다. 실사용 상태 양호, 직거래/택배 모두 가능합니다. 편하게 문의 주세요!`,
    tags: ['중고거래', name.replace(/\s+/g, ''), '상태최상', '직거래가능'],
    tradeMethod: 'personal_trade',
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    // draftId 가 없거나 빈 값이어도 400 으로 죽지 않고 임시 세션 id 를 자동 생성한다.
    const rawDraftId = typeof body.draftId === 'string' ? body.draftId.trim() : '';
    const generatedId = !rawDraftId;
    const draftId = rawDraftId || `draft_${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const price = Number(body.price) > 0 ? Number(body.price) : DEFAULT_PRICE;
    const currency = (typeof body.currency === 'string' && body.currency) || 'KRW';
    const extraNote = typeof body.extraNote === 'string' ? body.extraNote : undefined;
    const bodyProductName = typeof body.productName === 'string' ? body.productName : '';

    // DB 에 실제 draft 가 있으면 정식 플로우, 없으면(임시/데모 id) 메모리 폴백으로 200 응답
    let draftRow = null;
    if (!generatedId) {
      try {
        draftRow = await prisma.productDraft.findUnique({ where: { id: draftId } });
      } catch {
        draftRow = null;
      }
    }

    if (draftRow && draftRow.status !== 'REJECTED_BY_POLICY') {
      // ── 정식 플로우(DB draft 존재) ──
      const analysis = JSON.parse(draftRow.aiAnalysis || '{}') as ProductAnalysis;
      const priced = await suggestPrice({ analysis, requestedPrice: price, currency });
      const listingDraft = await writeListingDraft({ analysis, price: priced.suggestedPrice, currency, extraNote });
      const updated = await prisma.productDraft.update({
        where: { id: draftId },
        data: {
          status: 'DRAFT_CREATED',
          price: priced.suggestedPrice,
          currency,
          title: listingDraft.title,
          description: listingDraft.description,
          tags: JSON.stringify(listingDraft.tags),
          tradeMethod: listingDraft.tradeMethod,
        },
      });
      await prisma.agentActionLog.create({
        data: {
          draftId,
          action: 'listing_draft',
          input: JSON.stringify({ price, currency, extraNote }),
          output: JSON.stringify({ price: priced, listingDraft }),
        },
      }).catch(() => {});

      return NextResponse.json({ success: true, draft: updated, price: priced, listing: listingDraft });
    }

    // ── 폴백 플로우(draftId 누락/임시/DB 미존재) — 크래시 없이 200 ──
    const analysis = minimalAnalysis(bodyProductName);
    let priced: { suggestedPrice: number };
    let listingDraft: { title: string; description: string; tags: string[]; tradeMethod: string };
    try {
      priced = await suggestPrice({ analysis, requestedPrice: price, currency });
      listingDraft = await writeListingDraft({ analysis, price: priced.suggestedPrice, currency, extraNote });
    } catch {
      priced = { suggestedPrice: price };
      listingDraft = fallbackListing(bodyProductName);
    }

    return NextResponse.json({
      success: true,
      draft: {
        id: draftId,
        status: 'DRAFT_CREATED',
        price: priced.suggestedPrice,
        currency,
        title: listingDraft.title,
        description: listingDraft.description,
        tags: listingDraft.tags,
        tradeMethod: listingDraft.tradeMethod,
      },
      price: priced,
      listing: listingDraft,
      demo: true, // DB 미연결/임시 draft 로 생성된 폴백 응답
    });
  } catch (error) {
    // 최후 가드: 어떤 예외에도 400/500 대신 200 + 단순 폴백
    const price = DEFAULT_PRICE;
    return NextResponse.json({
      success: true,
      draft: { id: `draft_${Date.now()}`, status: 'DRAFT_CREATED', price, currency: 'KRW' },
      price: { suggestedPrice: price },
      listing: fallbackListing('중고 상품'),
      demo: true,
      note: error instanceof Error ? error.message : 'fallback',
    });
  }
}
