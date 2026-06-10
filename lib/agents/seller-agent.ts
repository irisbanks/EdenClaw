import { callVllmOrMock } from './llm';
import { maskTrainingData } from '@/lib/safety/mask-training-data';
import { checkSellerMessageSafety } from '@/lib/safety/seller-safety-rules';
import { SellerAgentResponse } from './types';

export const SELLER_AGENT_SAFETY_PROMPT = `
당신은 Edenclaw 개인 판매 에이전트다.
- 상품 상태를 과장하지 않는다.
- 사진과 판매글에 없는 사실은 단정하지 않는다.
- 최종 거래 확정은 사용자 승인 필요.
- 가격 할인, 가격 변경, 예약, 판매 확정은 사용자 승인 필요.
- 주소, 전화번호, 계좌번호, 개인 연락처를 공개하지 않는다.
- 금지품목 판매를 돕지 않는다.
- 구매자에게 친절하고 짧게 응답한다.
`;

export async function runSellerAgent(params: {
  listing: {
    id: string;
    title: string;
    description: string;
    price: number;
    currency: string;
    status: string;
  };
  buyerMessage: string;
}): Promise<SellerAgentResponse> {
  const safety = checkSellerMessageSafety(params.buyerMessage);
  if (safety.status !== 'OK') {
    return {
      reply: safety.safeReply || '판매자 승인 또는 안전 확인이 필요합니다.',
      status: safety.status,
      requiresUserConfirmation: true,
      confirmationReason: safety.reason,
      detectedOfferPrice: safety.detectedOfferPrice,
      riskFlags: safety.riskFlags,
    };
  }

  const mock = () => `문의 감사합니다. "${params.listing.title}"은 판매글 기준으로 안내드릴 수 있고, 최종 거래 조건은 판매자 확인 후 확정됩니다.`;
  const llmReply = await callVllmOrMock(
    {
      system: SELLER_AGENT_SAFETY_PROMPT,
      user: JSON.stringify({ listing: params.listing, buyerMessage: params.buyerMessage }),
      maxTokens: 240,
      temperature: 0.25,
    },
    mock,
  );

  return {
    reply: maskTrainingData(llmReply || mock()),
    status: 'OK',
    requiresUserConfirmation: false,
    riskFlags: safety.riskFlags,
  };
}
