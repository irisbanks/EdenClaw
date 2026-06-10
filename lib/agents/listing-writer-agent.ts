import { callVllmOrMock, safeJsonParse } from './llm';
import { detectPolicyFlags, policyWarningText, stripPrivateInfo } from './safety';
import { ListingDraftResult, ProductAnalysis } from './types';

export async function writeListingDraft(params: {
  analysis: ProductAnalysis;
  price: number;
  currency?: string;
  extraNote?: string;
}): Promise<ListingDraftResult> {
  const currency = params.currency || 'KRW';
  const base: ListingDraftResult = {
    title: `${params.analysis.productName} 개인 거래`,
    description: [
      `${params.analysis.productName} 판매합니다.`,
      `사진 기준 상태: ${params.analysis.condition}.`,
      `희망 가격은 ${params.price.toLocaleString()} ${currency}입니다.`,
      '사진에 보이는 범위 기준으로 안내하며, 최종 거래 조건은 판매자 승인 후 확정됩니다.',
    ].join('\n'),
    tags: [params.analysis.category, '개인거래', '에덴판매'].filter(Boolean),
    tradeMethod: 'personal_trade',
    policyWarnings: policyWarningText([...params.analysis.riskFlags, ...params.analysis.privateInfoFlags]),
  };

  const mock = (): string => JSON.stringify(base);
  const text = await callVllmOrMock(
    {
      system: '개인 거래 판매글을 JSON으로 작성한다. 사진에 없는 사실 단정, 과장, 개인정보 공개, 최종 거래 확정 표현을 금지한다.',
      user: JSON.stringify({ analysis: params.analysis, price: params.price, currency, extraNote: params.extraNote || '' }),
      maxTokens: 700,
      temperature: 0.25,
    },
    mock,
  );
  const parsed = safeJsonParse<ListingDraftResult>(text, base);
  const rawDescription = stripPrivateInfo(String(parsed.description || base.description));
  const flags = detectPolicyFlags(`${parsed.title || ''} ${rawDescription}`);

  return {
    title: stripPrivateInfo(String(parsed.title || base.title)).slice(0, 80),
    description: rawDescription,
    tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).slice(0, 8) : base.tags,
    tradeMethod: parsed.tradeMethod || 'personal_trade',
    policyWarnings: [...new Set([...(parsed.policyWarnings || []), ...policyWarningText(flags)])],
  };
}
