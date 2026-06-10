import { PreviewCard } from './types';

export async function createListingPreview(params: {
  title: string;
  price: number;
  currency?: string;
  imageUrl?: string;
  condition?: string;
  riskFlags?: string[];
}): Promise<PreviewCard> {
  const currency = params.currency || 'KRW';
  const priceLabel = currency === 'KRW'
    ? `${params.price.toLocaleString()}원`
    : `${params.price.toLocaleString()} ${currency}`;

  return {
    headline: params.title,
    subheadline: params.condition ? `상태: ${params.condition}` : '사진 기반 개인 거래 상품',
    priceLabel,
    badge: params.riskFlags?.length ? '확인 필요' : 'AI 초안',
    imageUrl: params.imageUrl,
    trustNotes: [
      '사진에 보이는 정보 기준',
      '가격 변경 및 최종 거래는 사용자 승인 필요',
      '개인정보 공개 금지',
    ],
    ctaLabel: '마켓에서 보기',
    layout: 'mobile-card',
  };
}
