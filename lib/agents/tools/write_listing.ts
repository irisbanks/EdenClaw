import type { ListingDraft } from '../types/trader';

export interface WriteKarrotListingParams {
  itemDescription: string;
  price: number;
  recommendedPrice: number;
  floorPrice: number;
  priceConfidence: number;
  priceReason: string;
  neighborhood?: string;
  useLlm?: boolean;
}

type PartialListing = Partial<ListingDraft> & {
  body?: string;
  hashtags?: string[];
  content?: string;
  display_metadata?: Partial<ListingDraft['display_metadata']>;
};

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

interface ListingPriceAnchor {
  tokens: string[];
  price: number;
  confidence: number;
  reason: string;
}

const LISTING_PRICE_ANCHORS: ListingPriceAnchor[] = [
  {
    tokens: ['갤럭시', 's24', 'ultra'],
    price: 900000,
    confidence: 0.58,
    reason: '외부 시세 API가 제한될 때 사용하는 Edenclaw 보수 기준으로, 갤럭시 S24 Ultra 추천 판매가 900,000원에 맞춰 합리적으로 내놓아요.',
  },
];

function formatKrw(value: number): string {
  return `${Math.round(value).toLocaleString()}원`;
}

function clampConfidence(value: number): number {
  const normalized = Number.isFinite(value) && value > 0 ? value : 0.5;
  return Number(Math.max(0, Math.min(1, normalized)).toFixed(2));
}

function clampTitle(value: string, fallback: string): string {
  const title = String(value || fallback).replace(/\s+/g, ' ').trim();
  return title.length > 40 ? title.slice(0, 40).trim() : title;
}

function stripDecorations(value: string): string {
  return String(value || '')
    .replace(/\*\*/g, '')
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
    .replace(/\s+\n/g, '\n')
    .trim();
}

function hasUnverifiedClaims(value: string): boolean {
  const text = String(value || '').toLowerCase();
  return [
    '상태는 아주',
    '상태는 매우',
    '상태는 좋',
    '상태 좋',
    '상태 좋아',
    '사용감 적어요',
    '사용감 거의',
    '깨끗',
    '흡입력',
    '배터리',
    '쌩쌩',
    '짱짱',
    '문제 없',
    '전혀 문제',
    '새 제품',
    '새상품',
  ].some((keyword) => text.includes(keyword));
}

function normalizeTags(value: unknown, itemDescription: string): string[] {
  const source = Array.isArray(value) && value.length > 0
    ? value
    : itemDescription.split(/\s+/).filter(Boolean).slice(0, 3);

  const itemTags = source
    .map((tag) => String(tag).trim().replace(/\s+/g, ''))
    .filter(Boolean)
    .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`));

  const defaults = ['#당근', '#중고거래', '#Edenclaw추천'];
  return [...new Set([...itemTags, ...defaults])].slice(0, 7);
}

function buildPriceReason(params: WriteKarrotListingParams): string {
  if (params.priceReason) return params.priceReason;
  if (params.recommendedPrice <= 0) return '시세 데이터가 부족해 판매자가 직접 가격을 확정해야 해요.';

  const diff = params.price > 0
    ? (params.price - params.recommendedPrice) / params.recommendedPrice
    : 0;
  const floorText = params.floorPrice > 0
    ? ` 최저 양보가는 ${formatKrw(params.floorPrice)} 정도로 잡아두면 좋아요.`
    : '';

  if (diff <= -0.05) {
    return `최근 시세보다 ${Math.round(Math.abs(diff) * 100)}% 정도 저렴하게 내놓아요. 추천 판매가는 ${formatKrw(params.recommendedPrice)}입니다.${floorText}`;
  }
  if (diff <= 0.05) {
    return `최근 시세 기준 추천 판매가 ${formatKrw(params.recommendedPrice)}에 맞춰 합리적으로 내놓아요.${floorText}`;
  }
  return `최근 시세 기준 추천 판매가는 ${formatKrw(params.recommendedPrice)}라서, 구성품과 상태 확인 후 네고 여지를 남겨두면 좋아요.${floorText}`;
}

function findListingPriceAnchor(itemDescription: string): ListingPriceAnchor | null {
  const normalized = itemDescription.toLowerCase();
  return LISTING_PRICE_ANCHORS.find((anchor) =>
    anchor.tokens.every((token) => normalized.includes(token.toLowerCase()))
  ) ?? null;
}

function withPriceFallback(params: WriteKarrotListingParams): WriteKarrotListingParams {
  if (params.price > 0 && params.recommendedPrice > 0) return params;

  const anchor = findListingPriceAnchor(params.itemDescription);
  if (!anchor) return params;

  const recommendedPrice = params.recommendedPrice > 0 ? params.recommendedPrice : anchor.price;
  const price = params.price > 0 ? params.price : recommendedPrice;
  const floorPrice = params.floorPrice > 0 ? params.floorPrice : Math.round(recommendedPrice * 0.85);
  const priceConfidence = params.priceConfidence > 0 ? params.priceConfidence : anchor.confidence;
  const priceReason = params.recommendedPrice > 0 && params.priceReason
    ? params.priceReason
    : anchor.reason;

  return {
    ...params,
    price,
    recommendedPrice,
    floorPrice,
    priceConfidence,
    priceReason,
  };
}

function ensureRequiredContent(content: string, priceReason: string, meetup: string): string {
  const lines = String(content || '').trim().split('\n').map((line) => line.trim()).filter(Boolean);
  const hasPriceReason = lines.some((line) => line.includes('추천 판매가') || line.includes('최근 시세') || line.includes('시세보다'));
  const hasNego = lines.some((line) => line.includes('네고 가능 여부'));
  const hasMeetup = lines.some((line) => line.includes('직거래 희망 장소'));
  const hasDirectTrade = lines.some((line) => line.includes('직거래'));

  if (!hasPriceReason) lines.push(priceReason);
  if (!hasDirectTrade) lines.push('직거래 선호해요.');
  if (!hasNego) lines.push('네고 가능 여부: [네고 가능/어려움]');
  if (!hasMeetup) lines.push(`직거래 희망 장소: ${meetup}`);
  if (!lines.some((line) => line.includes('채팅'))) lines.push('궁금한 점 있으면 편하게 채팅 주세요 :)');

  return lines.join('\n');
}

function fallbackKarrotListing(params: WriteKarrotListingParams): ListingDraft {
  const meetup = params.neighborhood || '[동네/역/아파트 단지명]';
  const priceReason = buildPriceReason(params);
  const content = [
    `안녕하세요! ${params.itemDescription} 판매해요.`,
    '사용감은 사진과 실물 기준으로 편하게 확인해 주세요.',
    priceReason,
    '직거래 선호해요.',
    '네고 가능 여부: [네고 가능/어려움]',
    `직거래 희망 장소: ${meetup}`,
    '궁금한 점 있으면 편하게 채팅 주세요 :)',
  ].join('\n');

  return {
    platform: 'daangn',
    title: clampTitle(`${params.itemDescription} 판매해요`, params.itemDescription),
    content,
    price: Math.max(0, Math.round(params.price)),
    tags: normalizeTags(undefined, params.itemDescription),
    display_metadata: {
      confidence_score: clampConfidence(params.priceConfidence),
      price_reasoning: priceReason,
    },
  };
}

function parseJsonObject(text: string): PartialListing | null {
  try {
    const cleaned = text
      .replace(/```json/gi, '```')
      .replace(/```/g, '')
      .trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]) as PartialListing;
  } catch {
    return null;
  }
}

function sanitizeListing(parsed: PartialListing | null, params: WriteKarrotListingParams): ListingDraft {
  const base = fallbackKarrotListing(params);
  if (!parsed) return base;

  const priceReason = String(
    parsed.display_metadata?.price_reasoning ||
    base.display_metadata.price_reasoning
  ).trim();
  const generatedTitle = stripDecorations(String(parsed.title || ''));
  const generatedContent = stripDecorations(String(parsed.content || parsed.body || ''));
  const safeTitle = generatedTitle && !hasUnverifiedClaims(generatedTitle)
    ? generatedTitle
    : base.title;
  const safeContent = generatedContent && !hasUnverifiedClaims(generatedContent)
    ? generatedContent
    : base.content;

  return {
    platform: 'daangn',
    title: clampTitle(safeTitle, base.title),
    content: ensureRequiredContent(safeContent, priceReason, params.neighborhood || '[동네/역/아파트 단지명]'),
    price: Math.max(0, Math.round(params.price)),
    tags: normalizeTags(parsed.tags || parsed.hashtags, params.itemDescription),
    display_metadata: {
      confidence_score: clampConfidence(
        Number(parsed.display_metadata?.confidence_score ?? params.priceConfidence)
      ),
      price_reasoning: priceReason,
    },
  };
}

function chatCompletionsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, '');
  if (base.endsWith('/v1/chat/completions') || base.endsWith('/chat/completions')) return base;
  if (base.endsWith('/v1')) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

async function callLocalLlm(system: string, user: string, fallback: () => string): Promise<string> {
  const baseUrl = process.env.VLLM_BASE_URL || process.env.LOCAL_AI_URL || 'http://localhost:8000/v1';

  try {
    const response = await fetch(chatCompletionsUrl(baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.VLLM_MODEL || 'Qwen/Qwen2.5-72B-Instruct',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: 700,
        temperature: 0.25,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return fallback();
    const data = (await response.json()) as ChatCompletionResponse;
    return data.choices?.[0]?.message?.content?.trim() || fallback();
  } catch {
    return fallback();
  }
}

export async function writeKarrotListing(params: WriteKarrotListingParams): Promise<ListingDraft> {
  params = withPriceFallback(params);
  const meetup = params.neighborhood || '[동네/역/아파트 단지명]';
  const priceReason = buildPriceReason(params);
  const normalizedParams = { ...params, priceReason, neighborhood: meetup };
  const fallback = () => JSON.stringify(fallbackKarrotListing(normalizedParams));

  if (params.useLlm === false) {
    return fallbackKarrotListing(normalizedParams);
  }

  const system = [
    '당신은 Edenclaw 로컬 LLM 기반 당근마켓 판매글 작성 도구입니다.',
    '반드시 순수 JSON 객체만 반환합니다. 마크다운, 설명문, 코드블록은 금지합니다.',
    '말투는 이웃에게 말하듯 신뢰감 있는 한국어를 사용합니다.',
    '당근마켓 빈출 표현을 자연스럽게 씁니다: "판매해요", "직거래 선호해요", "편하게 채팅 주세요".',
    '상태/사용감/성능/배터리는 사진과 실물로 확인 가능한 범위 외에는 단정하지 않습니다.',
  ].join('\n');

  const user = JSON.stringify({
    platform: 'daangn',
    item: params.itemDescription,
    fixed_price: Math.max(0, Math.round(params.price)),
    recommended_price: Math.max(0, Math.round(params.recommendedPrice)),
    floor_price: Math.max(0, Math.round(params.floorPrice)),
    confidence_score: clampConfidence(params.priceConfidence),
    price_reasoning: priceReason,
    required_content: [
      '추천 판매가 근거를 본문에 자연스럽게 포함',
      '직거래 선호해요',
      '네고 가능 여부: [네고 가능/어려움]',
      `직거래 희망 장소: ${meetup}`,
    ],
    required_schema: {
      platform: 'daangn',
      title: '당근마켓용 제목',
      content: '이웃 느낌의 친근한 판매 본문',
      price: Math.max(0, Math.round(params.price)),
      tags: ['#당근', '#중고거래', '#Edenclaw추천'],
      display_metadata: {
        confidence_score: clampConfidence(params.priceConfidence),
        price_reasoning: priceReason,
      },
    },
  });

  const text = await callLocalLlm(system, user, fallback);
  return sanitizeListing(parseJsonObject(text), normalizedParams);
}
