export const SELL_FLOW_STEPS = [
  'photo_uploaded',
  'awaiting_price',
  'awaiting_more_photos',
  'awaiting_approval',
  'listed',
  'rejected',
] as const;

export type SellFlowStep = (typeof SELL_FLOW_STEPS)[number];

export const STEP_TO_DRAFT_STATUS: Record<SellFlowStep, string> = {
  photo_uploaded: 'PHOTO_CAPTURED',
  awaiting_price: 'ASK_PRICE',
  awaiting_more_photos: 'ASK_MORE_PHOTOS',
  awaiting_approval: 'DRAFT_CREATED',
  listed: 'LISTED',
  rejected: 'REJECTED_BY_POLICY',
};

export const DRAFT_STATUS_TO_STEP: Record<string, SellFlowStep> = {
  PHOTO_CAPTURED: 'photo_uploaded',
  AI_ANALYZING: 'photo_uploaded',
  ASK_PRICE: 'awaiting_price',
  ASK_MORE_PHOTOS: 'awaiting_more_photos',
  DRAFT_CREATED: 'awaiting_approval',
  PREVIEW_APPROVED: 'awaiting_approval',
  LISTED: 'listed',
  REJECTED_BY_POLICY: 'rejected',
};

interface TransitionResult {
  ok: boolean;
  nextStep: SellFlowStep;
  message: string;
  error?: string;
}

const ALLOWED_TRANSITIONS: Record<SellFlowStep, SellFlowStep[]> = {
  photo_uploaded: ['awaiting_price', 'awaiting_more_photos', 'rejected'],
  awaiting_price: ['awaiting_more_photos', 'awaiting_approval', 'photo_uploaded'],
  awaiting_more_photos: ['awaiting_price', 'awaiting_approval', 'rejected'],
  awaiting_approval: ['listed', 'awaiting_price', 'awaiting_more_photos'],
  listed: [],
  rejected: [],
};

export function transition(current: SellFlowStep, next: SellFlowStep): TransitionResult {
  if (current === next) {
    return { ok: true, nextStep: current, message: `현재 단계(${current})를 유지합니다.` };
  }

  const allowed = ALLOWED_TRANSITIONS[current];
  if (!allowed.includes(next)) {
    return {
      ok: false,
      nextStep: current,
      message: `${current} → ${next} 전이는 허용되지 않습니다.`,
      error: 'INVALID_TRANSITION',
    };
  }

  return { ok: true, nextStep: next, message: stepMessage(next) };
}

export function validate(step: SellFlowStep, context: SellFlowContext): string[] {
  const errors: string[] = [];

  if (step === 'awaiting_price' || step === 'awaiting_approval') {
    if (!context.hasPhotos) errors.push('사진이 없습니다.');
    if (!context.analysisComplete) errors.push('AI 분석이 완료되지 않았습니다.');
  }

  if (step === 'awaiting_approval') {
    if (!context.hasPrice) errors.push('가격이 설정되지 않았습니다.');
  }

  if (step === 'listed') {
    if (!context.hasPrice) errors.push('가격이 없어 등록할 수 없습니다.');
    if (!context.hasTitle) errors.push('제목이 없어 등록할 수 없습니다.');
    if (!context.approved) errors.push('판매자 승인이 필요합니다.');
  }

  return errors;
}

export interface SellFlowContext {
  hasPhotos: boolean;
  analysisComplete: boolean;
  hasPrice: boolean;
  hasTitle: boolean;
  approved: boolean;
  prohibited: boolean;
}

export function buildContext(draft: {
  status: string;
  price?: number | null;
  title?: string | null;
  aiAnalysis?: string;
  approvedAt?: Date | null;
  riskFlags?: string;
  images?: unknown[];
}): SellFlowContext {
  const riskFlags = safeParseArray(draft.riskFlags || '[]');
  const aiAnalysis = safeParseObj(draft.aiAnalysis || '{}');

  return {
    hasPhotos: Array.isArray(draft.images) ? draft.images.length > 0 : false,
    analysisComplete: !!aiAnalysis.productName || !!aiAnalysis.category,
    hasPrice: typeof draft.price === 'number' && draft.price > 0,
    hasTitle: typeof draft.title === 'string' && draft.title.trim().length > 0,
    approved: !!draft.approvedAt,
    prohibited: riskFlags.includes('prohibited_item') || (aiAnalysis as { prohibited?: boolean }).prohibited === true,
  };
}

export function stepMessage(step: SellFlowStep): string {
  const messages: Record<SellFlowStep, string> = {
    photo_uploaded: '사진이 업로드됐습니다. AI가 분석 중입니다.',
    awaiting_price: '분석 완료! 희망 판매 가격을 알려주세요.',
    awaiting_more_photos: '더 명확한 사진이 필요합니다. 추가 사진을 보내주세요.',
    awaiting_approval: '판매 초안이 준비됐습니다. 확인 후 등록을 승인해주세요.',
    listed: '상품이 성공적으로 등록됐습니다!',
    rejected: '이 상품은 판매 정책에 따라 등록할 수 없습니다.',
  };
  return messages[step];
}

function safeParseArray(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function safeParseObj(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
