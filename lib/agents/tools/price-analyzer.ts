import { naverShopping } from './naver-shopping';
import { amazonShopping } from './amazon-shopping';
import { prisma } from '@/lib/prisma';

// 환율: 원/달러 (필요 시 업데이트)
const USD_TO_KRW = 1380;

// 관세 + 배송 포함 아마존 실착지 비용 배수 (약 15%)
const AMAZON_IMPORT_RATE = 1.15;

const DEPRECIATION_RATES: Record<string, number> = {
  스니커즈: 0.35,
  운동화: 0.35,
  신발: 0.35,
  스마트폰: 0.55,
  휴대폰: 0.55,
  노트북: 0.50,
  가방: 0.40,
  옷: 0.30,
  의류: 0.30,
  가전: 0.45,
  가구: 0.25,
  도서: 0.40,
  책: 0.40,
  default: 0.40,
};

const CONDITION_MULTIPLIERS: Record<string, number> = {
  S: 1.20,
  A: 1.00,
  B: 0.85,
  C: 0.65,
};

const QUERY_STOPWORDS = new Set([
  '중고',
  '새상품',
  '거의새것',
  '상태양호',
  '판매',
  '구매',
  '협상',
  '가격',
  '상품',
  '세대',
  '팩',
  'ml',
  'mm',
  'gb',
  'the',
]);

type SwarmProduct = {
  title: string;
  description: string;
  category: string;
  tags: string;
  price: number;
};

export interface MarginAnalysis {
  buy_amazon_sell_local: number;   // KRW: 아마존 최저 구매 후 국내 판매 예상 마진
  buy_local_sell_amazon: number;   // KRW: 국내 최저 구매 후 아마존 시세 기준 마진
  amazon_landed_krw: number;       // 아마존 최저가 + 관부가세 (KRW)
  recommendation: 'buy_amazon' | 'buy_local' | 'sell_on_amazon' | 'insufficient_data';
  reason: string;
}

export interface PriceAnalysis {
  query: string;
  category?: string;
  // Naver
  naver_avg_new: number;
  naver_min_new: number;
  naver_max_new: number;
  naver_count: number;
  // Internal DB
  swarm_avg_used: number;
  swarm_count: number;
  // Amazon
  amazon_avg_usd: number;
  amazon_min_usd: number;
  amazon_count: number;
  amazon_avg_krw: number;
  amazon_min_krw: number;
  usd_to_krw: number;
  // Estimate
  estimated_used_price: number;
  price_range: { min: number; max: number };
  confidence: number;
  // Margin
  margin_analysis: MarginAnalysis;
  // Meta
  reasoning: string[];
  warnings: string[];
}

function computeMargin(p: {
  estimated_used_price: number;
  swarm_avg_used: number;
  amazon_min_krw: number;
  amazon_avg_krw: number;
}): MarginAnalysis {
  const amazon_landed_krw = Math.round(p.amazon_min_krw * AMAZON_IMPORT_RATE);

  // 전략 1: 아마존 최저가 직구 후 국내 판매
  const buy_amazon_sell_local =
    p.estimated_used_price > 0 && amazon_landed_krw > 0
      ? p.estimated_used_price - amazon_landed_krw
      : 0;

  // 전략 2: 국내 시세로 구매, 아마존 기준 환산가로 판매
  const buy_local_sell_amazon =
    p.amazon_avg_krw > 0 && p.swarm_avg_used > 0
      ? Math.round(p.amazon_avg_krw / AMAZON_IMPORT_RATE) - p.swarm_avg_used
      : 0;

  const MIN_MARGIN = 30000; // 의미 있는 마진 최소치 (3만원)

  let recommendation: MarginAnalysis['recommendation'];
  let reason: string;

  if (amazon_landed_krw === 0 && p.estimated_used_price === 0) {
    recommendation = 'insufficient_data';
    reason = '가격 데이터 부족으로 추천 불가';
  } else if (
    buy_amazon_sell_local > MIN_MARGIN &&
    buy_amazon_sell_local >= buy_local_sell_amazon
  ) {
    recommendation = 'buy_amazon';
    const margin_str = (buy_amazon_sell_local / 10000).toFixed(1);
    const landed_str = (amazon_landed_krw / 10000).toFixed(1);
    reason =
      `아마존 직구(관부가세 포함 약 ${landed_str}만원) 후 국내 판매 시 ` +
      `약 ${margin_str}만원 마진 예상 — 아마존 구매 유리`;
  } else if (
    buy_local_sell_amazon > MIN_MARGIN &&
    buy_local_sell_amazon > buy_amazon_sell_local
  ) {
    recommendation = 'sell_on_amazon';
    const margin_str = (buy_local_sell_amazon / 10000).toFixed(1);
    reason =
      `국내 시세 대비 아마존 환산가가 높아 해외 판매 시 ` +
      `약 ${margin_str}만원 마진 예상 — 국내 구매 후 해외 판매 유리`;
  } else if (
    amazon_landed_krw > 0 &&
    p.estimated_used_price > 0 &&
    amazon_landed_krw < p.estimated_used_price * 0.8
  ) {
    recommendation = 'buy_amazon';
    const savings_str = ((p.estimated_used_price - amazon_landed_krw) / 10000).toFixed(1);
    reason =
      `아마존이 국내보다 약 ${savings_str}만원 저렴 — ` +
      `협상 시 아마존 시세를 근거로 가격 인하 요구 가능`;
  } else {
    recommendation = 'buy_local';
    reason = '국내 직거래가 가장 편리하고 가격 차이도 미미 — 국내 구매 추천';
  }

  return { buy_amazon_sell_local, buy_local_sell_amazon, amazon_landed_krw, recommendation, reason };
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function queryTokens(query: string): string[] {
  const normalized = normalizeText(query);
  const raw = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const tokens = raw.filter((token) => {
    if (QUERY_STOPWORDS.has(token)) return false;
    if (/^\d+$/.test(token) && token.length < 3) return false;
    return token.length >= 2;
  });
  return [...new Set(tokens)];
}

function isUsefulCategory(category: string | undefined): boolean {
  const normalized = normalizeText(category);
  return normalized.length >= 2 && !['general', '기타', '상품', '전자제품'].includes(normalized);
}

function scoreSwarmItem(item: SwarmProduct, tokens: string[], query: string, category?: string): number {
  if (tokens.length === 0) return 0;

  const normalizedQuery = normalizeText(query);
  const title = normalizeText(item.title);
  const body = normalizeText(`${item.description} ${item.tags}`);
  const itemCategory = normalizeText(item.category);
  const categoryText = normalizeText(category);

  const titleMatches = tokens.filter((token) => title.includes(token)).length;
  const bodyMatches = tokens.filter((token) => body.includes(token)).length;
  const exactPhrase = normalizedQuery.length >= 4 && title.includes(normalizedQuery) ? 1 : 0;
  const requiredMatches = Math.min(tokens.length, 2);
  const totalMatches = tokens.filter((token) => `${title} ${body}`.includes(token)).length;

  // Category alone is not enough. At least one product-name token must match
  // so a blank or broad category cannot pull the latest 50 global listings.
  if (!exactPhrase && titleMatches === 0) return 0;
  if (!exactPhrase && totalMatches < requiredMatches) return 0;

  let score = exactPhrase ? 6 : 0;
  score += titleMatches * 3;
  score += bodyMatches;
  if (categoryText && itemCategory.includes(categoryText)) score += 1;
  return score;
}

function trimmedAverage(prices: number[]): number {
  if (prices.length === 0) return 0;
  const sorted = [...prices].sort((a, b) => a - b);
  const trim = sorted.length >= 8 ? Math.floor(sorted.length * 0.1) : 0;
  const kept = sorted.slice(trim, sorted.length - trim);
  return Math.round(kept.reduce((a, b) => a + b, 0) / kept.length);
}

export async function analyzePrice(params: {
  query: string;
  category?: string;
  condition?: 'S' | 'A' | 'B' | 'C';
}): Promise<PriceAnalysis> {
  const reasoning: string[] = [];
  const warnings: string[] = [];

  // ── 1. Naver + Amazon 병렬 조회 ───────────────────────────────
  let naverItems: { lprice: number }[] = [];
  let naver_avg_new = 0, naver_min_new = 0, naver_max_new = 0;

  let amazon_avg_usd = 0, amazon_min_usd = 0, amazon_count = 0;
  let amazon_avg_krw = 0, amazon_min_krw = 0;

  const [naverResult, amazonResult] = await Promise.allSettled([
    naverShopping.search(params.query, { display: 20 }),
    amazonShopping.search(params.query),
  ]);

  // Naver 처리
  if (naverResult.status === 'fulfilled') {
    naverItems = naverResult.value.items;
    const prices = naverItems.map((i) => i.lprice).filter((p) => p > 0);
    if (prices.length > 0) {
      prices.sort((a, b) => a - b);
      naver_avg_new = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
      naver_min_new = prices[0];
      naver_max_new = prices[prices.length - 1];
      reasoning.push(
        `Naver 신상: ${prices.length}개 (avg ${naver_avg_new.toLocaleString()}원, min ${naver_min_new.toLocaleString()}원)`
      );
    }
  } else {
    const msg = String(naverResult.reason);
    warnings.push(
      msg.includes('NAVER_SCOPE_PENDING')
        ? 'Naver API scope pending (5-60분). 내부 DB만 사용.'
        : `Naver 검색 실패: ${msg}`
    );
    reasoning.push('Naver search skipped');
  }

  // Amazon 처리 (이상치 필터: 중앙값의 25% 미만 가격 제외)
  if (amazonResult.status === 'fulfilled') {
    const items = amazonResult.value.items;
    const rawPrices = items.map((i) => i.price_usd).filter((p) => p > 0);
    if (rawPrices.length > 0) {
      rawPrices.sort((a, b) => a - b);
      const median = rawPrices[Math.floor(rawPrices.length / 2)];
      const prices = rawPrices.filter((p) => p >= median * 0.25);

      if (prices.length > 0) {
        amazon_min_usd = prices[0];
        amazon_avg_usd = parseFloat(
          (prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2)
        );
        amazon_count = prices.length;
        amazon_min_krw = Math.round(amazon_min_usd * USD_TO_KRW);
        amazon_avg_krw = Math.round(amazon_avg_usd * USD_TO_KRW);
        reasoning.push(
          `Amazon: ${amazon_count}개 (avg $${amazon_avg_usd} / ${amazon_avg_krw.toLocaleString()}원, ` +
          `min $${amazon_min_usd} / ${amazon_min_krw.toLocaleString()}원)`
        );
      }
    }
  } else {
    warnings.push(`Amazon 검색 실패: ${String(amazonResult.reason)}`);
    reasoning.push('Amazon search skipped');
  }

  // ── 2. 내부 DB 조회 ───────────────────────────────────────────
  let swarm_avg_used = 0;
  let swarm_count = 0;
  let swarm_avg_score = 0;

  try {
    const tokens = queryTokens(params.query);
    const whereOr = [
      { title: { contains: params.query } },
      ...tokens.flatMap((token) => [
        { title: { contains: token } },
        { description: { contains: token } },
        { tags: { contains: token } },
      ]),
      ...(isUsefulCategory(params.category) ? [{ category: { contains: params.category! } }] : []),
    ];

    const swarmItems = whereOr.length > 0 ? await prisma.product.findMany({
      where: {
        OR: whereOr as never,
        status: 'active',
      },
      select: {
        title: true,
        description: true,
        category: true,
        tags: true,
        price: true,
      },
      take: 200,
      orderBy: { createdAt: 'desc' },
    }) : [];

    const scored = swarmItems
      .map((item) => ({ item, score: scoreSwarmItem(item, tokens, params.query, params.category) }))
      .filter((row) => row.score > 0 && row.item.price > 0)
      .sort((a, b) => b.score - a.score || a.item.price - b.item.price)
      .slice(0, 50);

    const prices = scored.map((row) => row.item.price).filter((p) => p > 0);
    if (prices.length > 0) {
      swarm_avg_used = trimmedAverage(prices);
      swarm_count = prices.length;
      swarm_avg_score = scored.reduce((sum, row) => sum + row.score, 0) / scored.length;
      reasoning.push(
        `내부 DB 정확 매칭: ${swarm_count}개 ` +
        `(avg ${swarm_avg_used.toLocaleString()}원, match ${swarm_avg_score.toFixed(1)})`
      );
    } else {
      reasoning.push('내부 DB: 정확 매칭 없음');
    }
  } catch (e: unknown) {
    warnings.push(`내부 DB 조회 실패: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── 3. 중고 시세 추정 ─────────────────────────────────────────
  let estimated_used_price = 0;
  let confidence = 0;

  if (swarm_count >= 5) {
    estimated_used_price = swarm_avg_used;
    confidence = Math.min(0.9, 0.45 + Math.min(swarm_count, 20) * 0.015 + Math.min(swarm_avg_score, 10) * 0.035);
    reasoning.push(
      `내부 DB 기준 추천가 (신뢰도 ${(confidence * 100).toFixed(0)}%)`
    );
  } else if (naver_avg_new > 0) {
    const categoryKey = params.category ?? 'default';
    const depRate = DEPRECIATION_RATES[categoryKey] ?? DEPRECIATION_RATES.default;
    estimated_used_price = Math.round(naver_avg_new * depRate);
    confidence = 0.6;
    reasoning.push(
      `Naver 평균 ${naver_avg_new.toLocaleString()}원 × 감가율 ${(depRate * 100).toFixed(0)}% = ${estimated_used_price.toLocaleString()}원`
    );
  } else if (amazon_avg_krw > 0) {
    const categoryKey = params.category ?? 'default';
    const depRate = DEPRECIATION_RATES[categoryKey] ?? DEPRECIATION_RATES.default;
    estimated_used_price = Math.round(amazon_avg_krw * depRate);
    confidence = 0.45;
    reasoning.push(
      `Amazon 환산가 ${amazon_avg_krw.toLocaleString()}원 × 감가율 ${(depRate * 100).toFixed(0)}% = ${estimated_used_price.toLocaleString()}원`
    );
  } else if (swarm_count > 0) {
    estimated_used_price = swarm_avg_used;
    confidence = Math.min(0.55, 0.3 + Math.min(swarm_avg_score, 8) * 0.03);
    reasoning.push(`내부 DB 정확 매칭 소량(${swarm_count}개), 낮은 신뢰도`);
  } else {
    warnings.push('가격 데이터 부족');
    confidence = warnings.some((warning) => warning.includes('Naver API scope pending')) ? 0.25 : 0.2;
  }

  // ── 4. 컨디션 보정 ────────────────────────────────────────────
  if (params.condition && estimated_used_price > 0) {
    const mult = CONDITION_MULTIPLIERS[params.condition] ?? 1.0;
    estimated_used_price = Math.round(estimated_used_price * mult);
    reasoning.push(`컨디션 ${params.condition} 보정 × ${mult}`);
  }

  const price_range = {
    min: Math.round(estimated_used_price * 0.85),
    max: Math.round(estimated_used_price * 1.15),
  };

  // ── 5. 마진 분석 ──────────────────────────────────────────────
  const margin_analysis = computeMargin({
    estimated_used_price,
    swarm_avg_used,
    amazon_min_krw,
    amazon_avg_krw,
  });
  reasoning.push(
    `마진 분석: ${margin_analysis.recommendation} — ${margin_analysis.reason}`
  );

  return {
    query: params.query,
    category: params.category,
    naver_avg_new,
    naver_min_new,
    naver_max_new,
    naver_count: naverItems.length,
    swarm_avg_used,
    swarm_count,
    amazon_avg_usd,
    amazon_min_usd,
    amazon_count,
    amazon_avg_krw,
    amazon_min_krw,
    usd_to_krw: USD_TO_KRW,
    estimated_used_price,
    price_range,
    confidence,
    margin_analysis,
    reasoning,
    warnings,
  };
}
