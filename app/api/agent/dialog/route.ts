import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { transition, buildContext, stepMessage, SellFlowStep, STEP_TO_DRAFT_STATUS } from '@/lib/marketplace/sell-flow';
import { callVllmDetailed } from '@/lib/agents/llm';
import { checkQuota, settleUsage } from '@/lib/services/tokenGuard';

// prisma(better-sqlite3) + ioredis 네이티브 모듈 → Edge 불가, 캐시 금지
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// LLM 호출 분기에서의 사전 검증용 보수적 예약치 (dialog 는 maxTokens 120~200)
const DIALOG_LLM_ESTIMATE = 400;

interface DialogBody {
  sessionId: string;
  userText: string;
}

type Intent =
  | 'price_input'
  | 'more_photos'
  | 'approve'
  | 'reject'
  | 'ask_price_range'
  | 'general_question'
  | 'unknown';

function detectIntent(text: string, currentStep: SellFlowStep): Intent {
  const t = text.trim().toLowerCase();

  if (currentStep === 'awaiting_price') {
    if (/^\d{2,9}$/.test(t.replace(/[,원\s]/g, ''))) return 'price_input';
    if (/(\d[\d,]+)\s*(원|만원|천원)/.test(t)) return 'price_input';
  }

  if (/더\s*사진|추가\s*사진|다른\s*각도|앵글|찍/.test(t)) return 'more_photos';
  if (/등록|승인|확인|올려|판매\s*시작|ok|네|맞아|맞습/.test(t)) return 'approve';
  if (/취소|안\s*팔|삭제|그만/.test(t)) return 'reject';
  if (/얼마|시세|가격|가격대|적정/.test(t)) return 'ask_price_range';

  return 'general_question';
}

function extractPrice(text: string): number | null {
  const normalized = text.replace(/,/g, '').replace(/\s/g, '');
  const matchWon = normalized.match(/(\d+)만원/);
  if (matchWon) return parseInt(matchWon[1], 10) * 10000;
  const matchRaw = normalized.match(/\d+/);
  if (matchRaw) {
    const n = parseInt(matchRaw[0], 10);
    if (n >= 100) return n;
    if (n >= 1) return n * 10000;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as DialogBody;
  const { sessionId, userText } = body;

  if (!sessionId || !userText?.trim()) {
    return NextResponse.json({ error: 'sessionId와 userText가 필요합니다.' }, { status: 400 });
  }

  const session = await prisma.sellSession.findUnique({ where: { id: sessionId } });
  if (!session) {
    return NextResponse.json({ error: 'SellSession을 찾을 수 없습니다.' }, { status: 404 });
  }

  const draft = await prisma.productDraft.findUnique({
    where: { id: session.draftId || '' },
    include: { images: true },
  });

  if (!draft) {
    return NextResponse.json({ error: 'ProductDraft를 찾을 수 없습니다.' }, { status: 404 });
  }

  const currentStep = session.step as SellFlowStep;
  const intent = detectIntent(userText, currentStep);
  const context = buildContext(draft);

  // ── 토큰 가드: 세션 소유자 기준. LLM 분기에서만 미터링 ──
  //    dialog 는 대부분 intent 라우팅(LLM 미사용)이고, 일부 분기에서만 LLM 을 호출한다.
  //    잔액 고갈(LOCKED) 시엔 하드 402 대신 mock 폴백으로 안내해 판매 플로우를 끊지 않는다.
  const sessionUserId = session.userId || null;
  let metered = false;
  let quotaBlocked = false;
  let llmTokens = 0; // 실제 LLM 호출(mock 제외) 누적 토큰
  if (sessionUserId) {
    const check = await checkQuota(sessionUserId, DIALOG_LLM_ESTIMATE);
    if (check.status === 'ALLOWED') metered = true;
    else if (check.status === 'LOCKED') quotaBlocked = true; // 실 LLM 차단 → mock 사용
    // NO_QUOTA: 미구독 → 미터링 없이 통과
  }

  // LLM 호출 래퍼: 잔액 부족이면 mock, 실제 LLM 응답일 때만 토큰 누적
  const runLLM = async (
    options: { system: string; user: string; maxTokens?: number; temperature?: number },
    mock: () => string
  ): Promise<string> => {
    if (quotaBlocked) return mock();
    const r = await callVllmDetailed(options, mock);
    if (r.source === 'llm') llmTokens += r.totalTokens;
    return r.content;
  };

  let nextStep: SellFlowStep = currentStep;
  let replyText = '';
  let draftUpdate: Record<string, unknown> = {};

  switch (intent) {
    case 'price_input': {
      const price = extractPrice(userText);
      if (price && price > 0) {
        nextStep = 'awaiting_approval';
        draftUpdate = { price, status: STEP_TO_DRAFT_STATUS['awaiting_approval'] };
        replyText = `${price.toLocaleString()}원으로 설정했습니다. ${stepMessage('awaiting_approval')}`;
      } else {
        replyText = '정확한 가격을 입력해주세요. (예: 15000원, 3만원)';
      }
      break;
    }

    case 'more_photos': {
      const result = transition(currentStep, 'awaiting_more_photos');
      if (result.ok) {
        nextStep = 'awaiting_more_photos';
        draftUpdate = { status: STEP_TO_DRAFT_STATUS['awaiting_more_photos'] };
        replyText = `추가 사진을 보내주세요. 권장 각도: ${context.hasPhotos ? '정면, 측면, 하자 부위' : '정면, 뒷면, 측면, 세부 사진'}`;
      } else {
        replyText = result.message;
      }
      break;
    }

    case 'approve': {
      const result = transition(currentStep, 'awaiting_approval');
      if (result.ok && context.hasPrice && context.hasTitle) {
        await prisma.productDraft.update({
          where: { id: draft.id },
          data: { approvedAt: new Date(), status: STEP_TO_DRAFT_STATUS['listed'] },
        });
        nextStep = 'listed';
        replyText = stepMessage('listed');
      } else if (!context.hasPrice) {
        replyText = '먼저 판매 가격을 입력해주세요.';
      } else {
        replyText = result.ok ? result.message : result.message;
      }
      break;
    }

    case 'reject': {
      draftUpdate = { status: 'DELETED' };
      nextStep = 'rejected';
      replyText = '판매 등록을 취소했습니다. 언제든 다시 시작할 수 있습니다.';
      break;
    }

    case 'ask_price_range': {
      const analysisRaw = draft.aiAnalysis || '{}';
      let analysis: { suggestedPrice?: number; minPrice?: number; maxPrice?: number } = {};
      try { analysis = JSON.parse(analysisRaw); } catch { /* empty */ }

      if (analysis.suggestedPrice) {
        replyText = `AI 분석 기준 권장가는 ${analysis.suggestedPrice.toLocaleString()}원입니다. (범위: ${(analysis.minPrice || 0).toLocaleString()}~${(analysis.maxPrice || 0).toLocaleString()}원)`;
      } else {
        replyText = await runLLM(
          {
            system: '당신은 중고거래 가격 전문가입니다. 짧고 친절하게 안내하세요.',
            user: `상품: ${draft.title || '미상'}, 상태: ${draft.condition || '미상'}. 적정 가격 범위를 알려주세요.`,
            maxTokens: 120,
            temperature: 0.2,
          },
          () => '현재 시세 정보를 가져오는 중입니다. 비슷한 상품의 최근 거래가를 확인 후 가격을 입력해주세요.',
        );
      }
      break;
    }

    default: {
      replyText = await runLLM(
        {
          system: `당신은 Eden 중고거래 판매 도우미입니다. 현재 판매 등록 단계: ${currentStep}. 간결하고 친절하게 도와주세요.`,
          user: `상품: ${draft.title || '분석 중'}, 상태: ${draft.condition || '미상'}. 사용자 메시지: "${userText}"`,
          maxTokens: 200,
          temperature: 0.3,
        },
        () => `현재 단계(${stepMessage(currentStep)}) 진행 중입니다. 궁금한 점이 있으시면 말씀해주세요.`,
      );
      break;
    }
  }

  if (Object.keys(draftUpdate).length > 0) {
    await prisma.productDraft.update({ where: { id: draft.id }, data: draftUpdate });
  }

  if (nextStep !== currentStep) {
    await prisma.sellSession.update({
      where: { id: sessionId },
      data: { step: nextStep, lastMessage: replyText },
    });
  } else {
    await prisma.sellSession.update({
      where: { id: sessionId },
      data: { lastMessage: replyText },
    });
  }

  await prisma.agentActionLog.create({
    data: {
      draftId: draft.id,
      action: 'dialog',
      status: 'ok',
      input: JSON.stringify({ userText, intent, currentStep }),
      output: JSON.stringify({ reply: replyText, nextStep }),
    },
  });

  // ── 실제 LLM 사용분만 토큰 정산(차감). mock 응답은 0 토큰이라 과금되지 않음 ──
  let remaining: number | undefined;
  if (metered && sessionUserId && llmTokens > 0) {
    try {
      remaining = await settleUsage(sessionUserId, llmTokens);
    } catch (e) {
      console.error('[agent/dialog] 토큰 정산 실패(응답은 정상):', e);
    }
  }

  return NextResponse.json({
    sessionId,
    reply: replyText,
    intent,
    currentStep,
    nextStep,
    tokensUsed: llmTokens,
    remaining,
    draft: {
      id: draft.id,
      status: draft.status,
      title: draft.title,
      price: draft.price,
      condition: draft.condition,
    },
  });
}
