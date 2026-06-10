import { maskTrainingData, maskTrainingDataDetailed } from './mask-training-data';

export type SellerSafetyStatus = 'OK' | 'USER_CONFIRM_REQUIRED' | 'REJECTED_BY_POLICY';

export interface SellerSafetyDecision {
  status: SellerSafetyStatus;
  requiresUserConfirmation: boolean;
  reason?: string;
  riskFlags: string[];
  maskedMessage: string;
  detectedOfferPrice?: number;
  safeReply?: string;
}

const PROHIBITED_PATTERNS = [
  /마약|대마|필로폰|코카인/i,
  /총기|권총|소총|실탄|폭발물|폭탄/i,
  /위조|가품|짝퉁|불법복제|해킹툴/i,
  /처방약|전문의약품|수면제|스테로이드/i,
  /주민등록증|여권|운전면허증|개인정보\s*판매/i,
];

const PRIVATE_INFO_REQUEST = /주소|전화번호|연락처|계좌|계좌번호|카톡|카카오톡|오픈채팅|집이\s?어디|어디서\s?만나/i;
const FINAL_TRADE = /거래\s?확정|구매\s?확정|예약|팔렸|판매\s?완료|오늘\s?만나|장소\s?확정|직거래\s?장소/i;

export const SELLER_SAFETY_RULES = [
  '상품 상태를 과장하지 않는다.',
  '사진과 판매글에 없는 사실은 단정하지 않는다.',
  '가격 할인과 가격 변경은 사용자 승인 전 확정하지 않는다.',
  '최종 거래 확정, 예약, 거래 장소 확정은 사용자 승인 전 확정하지 않는다.',
  '주소, 전화번호, 계좌번호, 개인 연락처를 공개하지 않는다.',
  '금지품목 판매를 돕지 않는다.',
  '구매자에게 친절하고 짧게 응답한다.',
];

export function detectSellerRiskFlags(text: string): string[] {
  const flags: string[] = [];
  if (PROHIBITED_PATTERNS.some((pattern) => pattern.test(text))) flags.push('prohibited_item');
  if (PRIVATE_INFO_REQUEST.test(text)) flags.push('private_info_request');
  if (FINAL_TRADE.test(text)) flags.push('final_trade_request');
  if (extractKrwPrice(text) !== null) flags.push('price_change_or_offer');
  if (maskTrainingDataDetailed(text).maskCount > 0) flags.push('sensitive_info');
  return [...new Set(flags)];
}

export function checkSellerMessageSafety(message: string): SellerSafetyDecision {
  const riskFlags = detectSellerRiskFlags(message);
  const maskedMessage = maskTrainingData(message);
  const detectedOfferPrice = extractKrwPrice(message) ?? undefined;

  if (riskFlags.includes('prohibited_item')) {
    return {
      status: 'REJECTED_BY_POLICY',
      requiresUserConfirmation: true,
      reason: 'prohibited_item',
      riskFlags,
      maskedMessage,
      safeReply: '해당 요청은 안전 정책상 도와드릴 수 없습니다. 판매자 확인이 필요합니다.',
    };
  }

  if (riskFlags.includes('private_info_request')) {
    return {
      status: 'USER_CONFIRM_REQUIRED',
      requiresUserConfirmation: true,
      reason: 'private_info_request',
      riskFlags,
      maskedMessage,
      safeReply: '개인 주소, 전화번호, 계좌번호는 제가 임의로 공개할 수 없습니다. 안전한 거래 방식은 판매자 승인 후 안내드리겠습니다.',
    };
  }

  if (riskFlags.includes('sensitive_info')) {
    return {
      status: 'USER_CONFIRM_REQUIRED',
      requiresUserConfirmation: true,
      reason: 'sensitive_info',
      riskFlags,
      maskedMessage,
      safeReply: '개인정보가 포함되어 있어 그대로 공개할 수 없습니다. 필요한 내용은 마스킹 후 판매자 확인을 거치겠습니다.',
    };
  }

  if (riskFlags.includes('price_change_or_offer')) {
    return {
      status: 'USER_CONFIRM_REQUIRED',
      requiresUserConfirmation: true,
      reason: 'price_change_or_offer',
      riskFlags,
      maskedMessage,
      detectedOfferPrice,
      safeReply: `${(detectedOfferPrice || 0).toLocaleString()}원 제안이 들어왔습니다. 판매자 승인 전에는 가격을 확정하지 않겠습니다.`,
    };
  }

  if (riskFlags.includes('final_trade_request')) {
    return {
      status: 'USER_CONFIRM_REQUIRED',
      requiresUserConfirmation: true,
      reason: 'final_trade_request',
      riskFlags,
      maskedMessage,
      safeReply: '예약, 판매 확정, 거래 장소 확정은 판매자 승인 후에만 진행할 수 있습니다.',
    };
  }

  return {
    status: 'OK',
    requiresUserConfirmation: false,
    riskFlags,
    maskedMessage,
  };
}

export function extractKrwPrice(text: string): number | null {
  const man = text.match(/(\d+(?:\.\d+)?)\s*만\s*원/);
  if (man) return Math.round(Number(man[1]) * 10000);
  const won = text.match(/(\d[\d,]*)\s*원/);
  if (won) {
    const n = Number(won[1].replace(/,/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

export function policyWarningText(flags: string[]): string[] {
  const warnings: string[] = [];
  if (flags.includes('prohibited_item')) warnings.push('금지품목 가능성이 있어 등록 전 사용자 확인이 필요합니다.');
  if (flags.includes('private_info') || flags.includes('private_info_request') || flags.includes('sensitive_info')) warnings.push('개인정보가 포함될 수 있어 공개 전 마스킹이 필요합니다.');
  if (flags.includes('price_change_or_offer')) warnings.push('가격 변경 또는 구매 제안은 사용자 승인 후에만 반영됩니다.');
  if (flags.includes('final_trade_request')) warnings.push('최종 거래 확정은 사용자 승인 후에만 가능합니다.');
  return warnings;
}
