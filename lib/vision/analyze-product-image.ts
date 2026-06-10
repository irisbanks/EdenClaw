import { callVllmOrMock, safeJsonParse } from '@/lib/agents/llm';
import { ProductAnalysis, ProductImageInput } from '@/lib/agents/types';
import { detectPolicyFlags } from '@/lib/agents/safety';
import { detectPrivateInfo } from './detect-private-info';

const DEFAULT_ANALYSIS: ProductAnalysis = {
  productName: '사진 속 개인 거래 상품',
  category: 'personal',
  condition: '상태 확인 필요',
  confidence: 0.62,
  needsMorePhotos: true,
  suggestedAngles: ['정면', '뒷면', '하자 부위 근접 사진'],
  riskFlags: [],
  privateInfoFlags: [],
  prohibited: false,
  notes: '초기 mock 분석입니다. 실제 멀티모달 모델 연결 시 상품명/상태를 더 정확히 판단합니다.',
};

export async function analyzeProductImage(images: ProductImageInput[], hint = ''): Promise<ProductAnalysis> {
  const imageText = images.map((img) => img.url).join('\n');
  const mock = (): string => JSON.stringify({
    ...DEFAULT_ANALYSIS,
    productName: hint || DEFAULT_ANALYSIS.productName,
  });

  const text = await callVllmOrMock(
    {
      system: '스마트폰 상품 사진을 분석해 개인 거래 판매 초안을 위한 JSON만 반환한다. 사진에 없는 사실은 단정하지 않는다.',
      user: `이미지 URL:\n${imageText}\n사용자 힌트: ${hint || '없음'}\n필드: productName, category, condition, confidence, needsMorePhotos, suggestedAngles, riskFlags, prohibited, notes`,
      maxTokens: 500,
      temperature: 0.1,
    },
    mock,
  );

  const parsed = safeJsonParse<Partial<ProductAnalysis>>(text, DEFAULT_ANALYSIS);
  const privateInfo = await detectPrivateInfo({ imageUrl: imageText });
  const riskFlags = [...new Set([...(parsed.riskFlags || []), ...detectPolicyFlags(`${parsed.productName || ''} ${parsed.notes || ''}`)])];

  return {
    ...DEFAULT_ANALYSIS,
    ...parsed,
    productName: String(parsed.productName || DEFAULT_ANALYSIS.productName),
    category: String(parsed.category || DEFAULT_ANALYSIS.category),
    condition: String(parsed.condition || DEFAULT_ANALYSIS.condition),
    confidence: Number(parsed.confidence ?? DEFAULT_ANALYSIS.confidence),
    needsMorePhotos: Boolean(parsed.needsMorePhotos ?? DEFAULT_ANALYSIS.needsMorePhotos),
    suggestedAngles: Array.isArray(parsed.suggestedAngles) ? parsed.suggestedAngles.map(String) : DEFAULT_ANALYSIS.suggestedAngles,
    riskFlags,
    privateInfoFlags: privateInfo.flags,
    prohibited: Boolean(parsed.prohibited || riskFlags.includes('prohibited_item')),
    notes: String(parsed.notes || DEFAULT_ANALYSIS.notes),
  };
}
