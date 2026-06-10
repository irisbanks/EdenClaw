import { callVllmOrMock, safeJsonParse } from './llm';
import { PriceSuggestion, ProductAnalysis } from './types';

export async function suggestPrice(params: {
  analysis: ProductAnalysis;
  requestedPrice?: number;
  currency?: string;
}): Promise<PriceSuggestion> {
  const currency = params.currency || 'KRW';
  if (params.requestedPrice && params.requestedPrice > 0) {
    const price = Math.round(params.requestedPrice);
    return {
      suggestedPrice: price,
      minPrice: Math.round(price * 0.85),
      maxPrice: Math.round(price * 1.1),
      currency,
      rationale: '사용자가 직접 지정한 가격입니다. 가격 변경은 사용자 승인 후에만 반영합니다.',
      requiresUserPrice: false,
    };
  }

  const mock = (): string => JSON.stringify({
    suggestedPrice: 50000,
    minPrice: 42000,
    maxPrice: 55000,
    currency,
    rationale: 'mock 가격입니다. 정확한 시세 엔진 연결 전에는 사용자가 최종 가격을 승인해야 합니다.',
    requiresUserPrice: true,
  });

  const text = await callVllmOrMock(
    {
      system: '개인 거래 상품의 안전한 가격 제안을 JSON만으로 반환한다. 가격 확정은 반드시 사용자 승인 필요.',
      user: JSON.stringify(params.analysis),
      maxTokens: 300,
      temperature: 0.1,
    },
    mock,
  );

  const parsed = safeJsonParse<PriceSuggestion>(text, JSON.parse(mock()) as PriceSuggestion);
  return {
    suggestedPrice: Math.max(0, Math.round(Number(parsed.suggestedPrice) || 0)),
    minPrice: Math.max(0, Math.round(Number(parsed.minPrice) || 0)),
    maxPrice: Math.max(0, Math.round(Number(parsed.maxPrice) || 0)),
    currency: parsed.currency || currency,
    rationale: parsed.rationale || '가격 제안 근거가 없습니다.',
    requiresUserPrice: parsed.requiresUserPrice ?? true,
  };
}
