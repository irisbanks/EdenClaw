import type { GlobalPurchasePreparation, GlobalPurchasePlatform } from '../types/trader';
import { prepareGlobalPurchase, writeKarrotListing } from '../tools';

export type SupplyPlatform = GlobalPurchasePlatform | 'japan_market';

export interface DemandProduct {
  id: string;
  name: string;
  category: string;
  keywords: string[];
  localSellPriceKrw: number;
  expectedSellThrough: number;
  localDemandScore: number;
  condition: 'new' | 'open_box' | 'used_a';
  trendSource: 'mock-daangn' | 'mock-naver';
}

export interface SupplyOffer {
  platform: SupplyPlatform;
  title: string;
  productUrl: string;
  itemPriceUsd: number;
  shippingUsd: number;
  deliveryDays: number;
  sellerRating: number;
  specTokens: string[];
}

export interface SpecVerification {
  passed: boolean;
  score: number;
  model: string;
  apiCostUsd: number;
  reasoning: string;
}

export interface CostBreakdown {
  itemUsd: number;
  shippingUsd: number;
  importTaxUsd: number;
  apiCostUsd: number;
  fxBufferUsd: number;
  delayRiskUsd: number;
  operatingCostUsd: number;
  landedCostUsd: number;
  expectedRevenueUsd: number;
  netProfitUsd: number;
  marginPct: number;
}

export interface ArbitrageOpportunity {
  demand: DemandProduct;
  bestSupply: SupplyOffer;
  verification: SpecVerification;
  costs: CostBreakdown;
  purchasePreparation: GlobalPurchasePreparation;
  listing: Awaited<ReturnType<typeof writeKarrotListing>>;
  decision: 'execute_paper_trade' | 'reject';
  rejectionReason?: string;
}

export interface ArbitrageLoopOptions {
  capitalUsd?: number;
  maxProducts?: number;
  exchangeRateKrwPerUsd?: number;
  importTaxRate?: number;
  platformFeeRate?: number;
  minMarginPct?: number;
  sandbox?: boolean;
  useLiveAiVerification?: boolean;
  prepareLivePurchaseDryRun?: boolean;
}

export interface PaperTradeResult {
  tradeNo: number;
  product: string;
  platform: SupplyPlatform;
  buyCostUsd: number;
  sellRevenueUsd: number;
  netProfitUsd: number;
  marginPct: number;
  capitalAfterUsd: number;
  deliveryDays: number;
  specScore: number;
  status: 'executed' | 'rejected';
  rejectionReason?: string;
}

export interface SandboxSimulationReport {
  mode: 'sandbox-paper-trading';
  startedCapitalUsd: number;
  finalCapitalUsd: number;
  netProfitUsd: number;
  roiPct: number;
  tradesRequested: number;
  tradesExecuted: number;
  assumptions: {
    exchangeRateKrwPerUsd: number;
    importTaxRate: number;
    platformFeeRate: number;
    minMarginPct: number;
    averageApiCostUsd: number;
    safety: string;
  };
  opportunities: ArbitrageOpportunity[];
  trades: PaperTradeResult[];
}

const DEFAULTS = {
  capitalUsd: 10_000,
  maxProducts: 10,
  exchangeRateKrwPerUsd: 1380,
  importTaxRate: 0.15,
  platformFeeRate: 0.035,
  minMarginPct: 7,
  apiCostUsd: 0.014,
  operatingCostUsd: 2.2,
};

const DEMAND_PRODUCTS: DemandProduct[] = [
  {
    id: 'demand-s24-ultra',
    name: '갤럭시 S24 Ultra 256GB',
    category: 'smartphone',
    keywords: ['galaxy', 's24', 'ultra', '256gb'],
    localSellPriceKrw: 1_250_000,
    expectedSellThrough: 0.9,
    localDemandScore: 96,
    condition: 'new',
    trendSource: 'mock-daangn',
  },
  {
    id: 'demand-dyson-v15',
    name: '다이슨 V15 무선청소기',
    category: 'home_appliance',
    keywords: ['dyson', 'v15', 'vacuum'],
    localSellPriceKrw: 890_000,
    expectedSellThrough: 0.86,
    localDemandScore: 91,
    condition: 'open_box',
    trendSource: 'mock-naver',
  },
  {
    id: 'demand-airpods-pro-2',
    name: '에어팟 프로 2세대 USB-C',
    category: 'audio',
    keywords: ['airpods', 'pro', '2', 'usb-c'],
    localSellPriceKrw: 310_000,
    expectedSellThrough: 0.88,
    localDemandScore: 93,
    condition: 'new',
    trendSource: 'mock-daangn',
  },
  {
    id: 'demand-ps5-slim',
    name: '플레이스테이션 5 슬림 디스크',
    category: 'game_console',
    keywords: ['playstation', '5', 'slim', 'disc'],
    localSellPriceKrw: 760_000,
    expectedSellThrough: 0.84,
    localDemandScore: 88,
    condition: 'new',
    trendSource: 'mock-naver',
  },
  {
    id: 'demand-galaxy-tab-s6-lite',
    name: '갤럭시 탭 S6 Lite',
    category: 'tablet',
    keywords: ['galaxy', 'tab', 's6', 'lite'],
    localSellPriceKrw: 380_000,
    expectedSellThrough: 0.82,
    localDemandScore: 82,
    condition: 'new',
    trendSource: 'mock-daangn',
  },
  {
    id: 'demand-lancome-genifique',
    name: '랑콤 제니피크 50ml',
    category: 'beauty',
    keywords: ['lancome', 'genifique', '50ml'],
    localSellPriceKrw: 125_000,
    expectedSellThrough: 0.8,
    localDemandScore: 79,
    condition: 'new',
    trendSource: 'mock-naver',
  },
  {
    id: 'demand-roomba-j7-plus',
    name: '룸바 J7+ 로봇청소기',
    category: 'home_appliance',
    keywords: ['roomba', 'j7+'],
    localSellPriceKrw: 930_000,
    expectedSellThrough: 0.77,
    localDemandScore: 76,
    condition: 'open_box',
    trendSource: 'mock-daangn',
  },
  {
    id: 'demand-titleist-tsi3',
    name: '타이틀리스트 TSi3 드라이버',
    category: 'sports',
    keywords: ['titleist', 'tsi3', 'driver'],
    localSellPriceKrw: 410_000,
    expectedSellThrough: 0.74,
    localDemandScore: 73,
    condition: 'used_a',
    trendSource: 'mock-daangn',
  },
  {
    id: 'demand-lego-city-850',
    name: '레고 시티 850피스',
    category: 'toy',
    keywords: ['lego', 'city', '850'],
    localSellPriceKrw: 118_000,
    expectedSellThrough: 0.78,
    localDemandScore: 72,
    condition: 'new',
    trendSource: 'mock-naver',
  },
  {
    id: 'demand-gucci-ace',
    name: '구찌 에이스 스니커즈',
    category: 'fashion',
    keywords: ['gucci', 'ace', 'sneakers'],
    localSellPriceKrw: 520_000,
    expectedSellThrough: 0.7,
    localDemandScore: 70,
    condition: 'used_a',
    trendSource: 'mock-daangn',
  },
];

const SUPPLY_BOOK: Record<string, SupplyOffer[]> = {
  'demand-s24-ultra': [
    offer('amazon', 'Samsung Galaxy S24 Ultra 256GB Titanium Gray Factory Unlocked', 650, 24, 6, 4.8, ['galaxy', 's24', 'ultra', '256gb']),
    offer('aliexpress', 'Galaxy S24 Ultra 256GB Global Version Smartphone', 620, 32, 12, 4.6, ['galaxy', 's24', 'ultra', '256gb']),
    offer('japan_market', 'Galaxy S24 Ultra 256GB SIM Free', 670, 18, 5, 4.7, ['galaxy', 's24', 'ultra', '256gb']),
  ],
  'demand-dyson-v15': [
    offer('amazon', 'Dyson V15 Detect Cordless Vacuum Cleaner', 420, 58, 8, 4.7, ['dyson', 'v15', 'vacuum']),
    offer('aliexpress', 'Dyson V15 Cordless Vacuum Compatible Global Package', 390, 68, 16, 4.4, ['dyson', 'v15', 'vacuum']),
    offer('japan_market', 'Dyson V15 Detect Complete', 445, 42, 6, 4.8, ['dyson', 'v15', 'vacuum']),
  ],
  'demand-airpods-pro-2': [
    offer('amazon', 'Apple AirPods Pro 2nd Generation USB-C', 158, 10, 5, 4.9, ['airpods', 'pro', '2', 'usb-c']),
    offer('aliexpress', 'AirPods Pro 2 USB-C Wireless Earbuds Original', 142, 12, 14, 4.2, ['airpods', 'pro', '2', 'usb-c']),
    offer('japan_market', 'AirPods Pro 2 USB-C Japan Retail', 166, 9, 4, 4.8, ['airpods', 'pro', '2', 'usb-c']),
  ],
  'demand-ps5-slim': [
    offer('amazon', 'PlayStation 5 Slim Disc Console', 358, 45, 7, 4.8, ['playstation', '5', 'slim', 'disc']),
    offer('japan_market', 'Sony PlayStation 5 Slim Disc Edition', 372, 35, 4, 4.9, ['playstation', '5', 'slim', 'disc']),
    offer('aliexpress', 'Game Console PS5 Slim Disc Global Version', 336, 58, 18, 4.1, ['playstation', '5', 'slim', 'disc']),
  ],
  'demand-galaxy-tab-s6-lite': [
    offer('amazon', 'Samsung Galaxy Tab S6 Lite 64GB Wi-Fi', 185, 18, 6, 4.7, ['galaxy', 'tab', 's6', 'lite']),
    offer('aliexpress', 'Samsung Galaxy Tab S6 Lite Wi-Fi Tablet', 171, 24, 15, 4.5, ['galaxy', 'tab', 's6', 'lite']),
    offer('japan_market', 'Galaxy Tab S6 Lite Wi-Fi', 196, 14, 5, 4.6, ['galaxy', 'tab', 's6', 'lite']),
  ],
  'demand-lancome-genifique': [
    offer('amazon', 'Lancome Advanced Genifique Serum 50ml', 58, 9, 6, 4.6, ['lancome', 'genifique', '50ml']),
    offer('aliexpress', 'Lancome Genifique 50ml Serum', 49, 11, 13, 4.1, ['lancome', 'genifique', '50ml']),
    offer('japan_market', 'Lancome Genifique 50ml', 61, 8, 4, 4.7, ['lancome', 'genifique', '50ml']),
  ],
  'demand-roomba-j7-plus': [
    offer('amazon', 'iRobot Roomba j7+ Self-Emptying Robot Vacuum', 445, 62, 9, 4.7, ['roomba', 'j7+']),
    offer('japan_market', 'iRobot Roomba J7 Plus', 462, 44, 5, 4.8, ['roomba', 'j7+']),
    offer('aliexpress', 'Roomba J7+ Robot Vacuum Cleaner Global', 415, 72, 19, 4.2, ['roomba', 'j7+']),
  ],
  'demand-titleist-tsi3': [
    offer('japan_market', 'Titleist TSi3 Driver 10.0 Degree', 205, 25, 5, 4.7, ['titleist', 'tsi3', 'driver']),
    offer('amazon', 'Titleist TSi3 Driver Golf Club', 225, 22, 7, 4.6, ['titleist', 'tsi3', 'driver']),
    offer('aliexpress', 'Titleist TSi3 Golf Driver Head', 190, 28, 16, 4.0, ['titleist', 'tsi3', 'driver']),
  ],
  'demand-lego-city-850': [
    offer('amazon', 'LEGO City 850 Pieces Building Set', 54, 11, 6, 4.8, ['lego', 'city', '850']),
    offer('aliexpress', 'LEGO City Compatible 850 Pieces Building Blocks', 38, 16, 14, 4.0, ['lego', 'city', '850']),
    offer('japan_market', 'LEGO City 850 Pieces Set', 59, 9, 5, 4.7, ['lego', 'city', '850']),
  ],
  'demand-gucci-ace': [
    offer('japan_market', 'Gucci Ace Sneakers Used A Rank', 245, 25, 5, 4.6, ['gucci', 'ace', 'sneakers']),
    offer('amazon', 'Gucci Ace Leather Sneakers', 282, 18, 8, 4.4, ['gucci', 'ace', 'sneakers']),
    offer('aliexpress', 'Gucci Ace Style Sneakers', 130, 22, 16, 3.6, ['gucci', 'ace', 'style']),
  ],
};

function offer(
  platform: SupplyPlatform,
  title: string,
  itemPriceUsd: number,
  shippingUsd: number,
  deliveryDays: number,
  sellerRating: number,
  specTokens: string[],
): SupplyOffer {
  const host = platform === 'amazon'
    ? 'https://www.amazon.com/dp/mock'
    : platform === 'aliexpress'
      ? 'https://www.aliexpress.com/item/mock'
      : 'https://example.jp/item/mock';
  return {
    platform,
    title,
    productUrl: `${host}-${encodeURIComponent(title.toLowerCase().replace(/\s+/g, '-'))}`,
    itemPriceUsd,
    shippingUsd,
    deliveryDays,
    sellerRating,
    specTokens,
  };
}

export async function discoverHighDemandProducts(limit = DEFAULTS.maxProducts): Promise<DemandProduct[]> {
  return [...DEMAND_PRODUCTS]
    .sort((a, b) => b.localDemandScore - a.localDemandScore)
    .slice(0, limit);
}

export async function findGlobalSupply(product: DemandProduct): Promise<SupplyOffer[]> {
  return SUPPLY_BOOK[product.id] ?? [];
}

function deterministicSpecScore(product: DemandProduct, offer: SupplyOffer): number {
  const required = product.keywords.map((token) => token.toLowerCase());
  const supplied = new Set([
    ...offer.specTokens.map((token) => token.toLowerCase()),
    ...offer.title.toLowerCase().split(/[^a-z0-9+]+/).filter(Boolean),
  ]);
  const matched = required.filter((token) => supplied.has(token) || [...supplied].some((candidate) => candidate.includes(token)));
  const base = matched.length / Math.max(required.length, 1);
  const sellerBoost = Math.max(0, Math.min(0.08, (offer.sellerRating - 4.0) * 0.04));
  return Number(Math.min(0.99, base * 0.92 + sellerBoost).toFixed(2));
}

export async function crossVerifySpec(
  product: DemandProduct,
  offer: SupplyOffer,
  useLiveAiVerification = false,
): Promise<SpecVerification> {
  const deterministic = deterministicSpecScore(product, offer);

  if (!useLiveAiVerification || !process.env.GEMINI_API_KEY) {
    return {
      passed: deterministic >= 0.78,
      score: deterministic,
      model: 'sandbox-gemini-2.5-spec-guard',
      apiCostUsd: DEFAULTS.apiCostUsd,
      reasoning: deterministic >= 0.78
        ? '핵심 키워드와 용량/모델 토큰이 일치합니다.'
        : '핵심 스펙 토큰 일부가 누락되어 오매칭 위험이 있습니다.',
    };
  }

  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = gemini.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent([
      '두 상품이 중고/리셀 차익거래 관점에서 같은 스펙인지 JSON으로만 판단하세요.',
      JSON.stringify({ demand: product, supply: offer, requiredScoreFloor: 0.78 }),
      '{"score":0.0,"passed":false,"reasoning":"..."}',
    ].join('\n'));
    const match = result.response.text().match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) as Partial<SpecVerification> : {};
    const score = Number(parsed.score ?? deterministic);
    return {
      passed: Boolean(parsed.passed ?? score >= 0.78),
      score: Number(Math.max(0, Math.min(1, score)).toFixed(2)),
      model: 'gemini-2.5-flash',
      apiCostUsd: DEFAULTS.apiCostUsd,
      reasoning: String(parsed.reasoning || 'Gemini 스펙 교차 검증 완료'),
    };
  } catch {
    return {
      passed: deterministic >= 0.78,
      score: deterministic,
      model: 'sandbox-gemini-2.5-spec-guard-fallback',
      apiCostUsd: DEFAULTS.apiCostUsd,
      reasoning: 'Gemini 호출 실패로 결정론적 스펙 검증을 사용했습니다.',
    };
  }
}

function calculateCosts(product: DemandProduct, offer: SupplyOffer, verification: SpecVerification, options: Required<Pick<ArbitrageLoopOptions, 'exchangeRateKrwPerUsd' | 'importTaxRate' | 'platformFeeRate'>>): CostBreakdown {
  const expectedRevenueUsd = product.localSellPriceKrw / options.exchangeRateKrwPerUsd;
  const importTaxUsd = (offer.itemPriceUsd + offer.shippingUsd) * options.importTaxRate;
  const fxBufferUsd = (offer.itemPriceUsd + offer.shippingUsd) * 0.018;
  const delayRiskUsd = Math.max(0, offer.deliveryDays - 4) * expectedRevenueUsd * 0.0025;
  const operatingCostUsd = DEFAULTS.operatingCostUsd + expectedRevenueUsd * options.platformFeeRate;
  const landedCostUsd = offer.itemPriceUsd + offer.shippingUsd + importTaxUsd + fxBufferUsd + delayRiskUsd + operatingCostUsd + verification.apiCostUsd;
  const netProfitUsd = expectedRevenueUsd - landedCostUsd;
  const marginPct = landedCostUsd > 0 ? (netProfitUsd / landedCostUsd) * 100 : 0;

  return {
    itemUsd: round2(offer.itemPriceUsd),
    shippingUsd: round2(offer.shippingUsd),
    importTaxUsd: round2(importTaxUsd),
    apiCostUsd: round2(verification.apiCostUsd),
    fxBufferUsd: round2(fxBufferUsd),
    delayRiskUsd: round2(delayRiskUsd),
    operatingCostUsd: round2(operatingCostUsd),
    landedCostUsd: round2(landedCostUsd),
    expectedRevenueUsd: round2(expectedRevenueUsd),
    netProfitUsd: round2(netProfitUsd),
    marginPct: round2(marginPct),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

async function sandboxPurchasePreparation(offer: SupplyOffer): Promise<GlobalPurchasePreparation> {
  return {
    status: 'selector_ready',
    platform: offer.platform === 'japan_market' ? 'unknown' : offer.platform,
    url: offer.productUrl,
    action: 'add_to_cart',
    dry_run: true,
    product_title: offer.title,
    selector_used: offer.platform === 'amazon' ? '#add-to-cart-button' : '[data-pl="addtocart"]',
    checkout_guard_selectors: ['button:has-text("Checkout")', 'button:has-text("Pay Now")', 'button:has-text("결제")'],
    message: 'Sandbox: 구매 버튼 탐지와 장바구니 준비만 가정했습니다. 실제 사이트 접속/결제는 수행하지 않았습니다.',
    warnings: offer.platform === 'japan_market' ? ['일본 마켓 실연동은 예정 상태입니다.'] : [],
  };
}

export async function evaluateDemandFirstOpportunity(
  product: DemandProduct,
  options: ArbitrageLoopOptions = {},
): Promise<ArbitrageOpportunity> {
  const merged = {
    exchangeRateKrwPerUsd: options.exchangeRateKrwPerUsd ?? DEFAULTS.exchangeRateKrwPerUsd,
    importTaxRate: options.importTaxRate ?? DEFAULTS.importTaxRate,
    platformFeeRate: options.platformFeeRate ?? DEFAULTS.platformFeeRate,
    minMarginPct: options.minMarginPct ?? DEFAULTS.minMarginPct,
    sandbox: options.sandbox ?? true,
  };

  const supplies = await findGlobalSupply(product);
  const verified = await Promise.all(supplies.map(async (supply) => ({
    supply,
    verification: await crossVerifySpec(product, supply, options.useLiveAiVerification),
  })));
  const candidates = verified
    .map(({ supply, verification }) => ({
      supply,
      verification,
      costs: calculateCosts(product, supply, verification, merged),
    }))
    .filter((candidate) => candidate.verification.passed)
    .sort((a, b) => b.costs.netProfitUsd - a.costs.netProfitUsd);

  const best = candidates[0] ?? verified
    .map(({ supply, verification }) => ({ supply, verification, costs: calculateCosts(product, supply, verification, merged) }))
    .sort((a, b) => b.costs.netProfitUsd - a.costs.netProfitUsd)[0];

  if (!best) {
    throw new Error(`No supply offers for ${product.name}`);
  }

  const decision = best.verification.passed && best.costs.marginPct >= merged.minMarginPct
    ? 'execute_paper_trade'
    : 'reject';
  const rejectionReason = decision === 'reject'
    ? !best.verification.passed
      ? '스펙 교차 검증 실패'
      : `마진율 ${best.costs.marginPct}%가 최소 기준 ${merged.minMarginPct}% 미만`
    : undefined;

  const purchasePreparation = merged.sandbox || !options.prepareLivePurchaseDryRun || best.supply.platform === 'japan_market'
    ? await sandboxPurchasePreparation(best.supply)
    : await prepareGlobalPurchase({
      productUrl: best.supply.productUrl,
      platform: best.supply.platform,
      action: 'add_to_cart',
      dryRun: true,
      sessionId: 'demand-first-arbitrage',
      headless: true,
    });

  const listing = await writeKarrotListing({
    itemDescription: product.name,
    price: product.localSellPriceKrw,
    recommendedPrice: product.localSellPriceKrw,
    floorPrice: Math.round(product.localSellPriceKrw * 0.9),
    priceConfidence: product.expectedSellThrough,
    priceReason: `국내 수요 점수 ${product.localDemandScore}점 상품이라 최근 시세 기준 ${product.localSellPriceKrw.toLocaleString()}원에 맞춰 내놓아요.`,
    neighborhood: '[동네/역/아파트 단지명]',
    useLlm: false,
  });

  return {
    demand: product,
    bestSupply: best.supply,
    verification: best.verification,
    costs: best.costs,
    purchasePreparation,
    listing,
    decision,
    rejectionReason,
  };
}

export async function runDemandFirstArbitrageLoop(options: ArbitrageLoopOptions = {}): Promise<ArbitrageOpportunity[]> {
  const products = await discoverHighDemandProducts(options.maxProducts ?? DEFAULTS.maxProducts);
  return Promise.all(products.map((product) => evaluateDemandFirstOpportunity(product, options)));
}

export async function runSandboxPaperTrading(options: ArbitrageLoopOptions = {}): Promise<SandboxSimulationReport> {
  const startedCapitalUsd = options.capitalUsd ?? DEFAULTS.capitalUsd;
  const exchangeRateKrwPerUsd = options.exchangeRateKrwPerUsd ?? DEFAULTS.exchangeRateKrwPerUsd;
  const importTaxRate = options.importTaxRate ?? DEFAULTS.importTaxRate;
  const platformFeeRate = options.platformFeeRate ?? DEFAULTS.platformFeeRate;
  const minMarginPct = options.minMarginPct ?? DEFAULTS.minMarginPct;
  const opportunities = await runDemandFirstArbitrageLoop({
    ...options,
    sandbox: true,
    maxProducts: options.maxProducts ?? DEFAULTS.maxProducts,
    exchangeRateKrwPerUsd,
    importTaxRate,
    platformFeeRate,
    minMarginPct,
  });

  let capital = startedCapitalUsd;
  const trades: PaperTradeResult[] = opportunities.map((opportunity, index) => {
    if (opportunity.decision === 'reject' || opportunity.costs.landedCostUsd > capital) {
      const rejected: PaperTradeResult = {
        tradeNo: index + 1,
        product: opportunity.demand.name,
        platform: opportunity.bestSupply.platform,
        buyCostUsd: opportunity.costs.landedCostUsd,
        sellRevenueUsd: opportunity.costs.expectedRevenueUsd,
        netProfitUsd: 0,
        marginPct: opportunity.costs.marginPct,
        capitalAfterUsd: round2(capital),
        deliveryDays: opportunity.bestSupply.deliveryDays,
        specScore: opportunity.verification.score,
        status: 'rejected',
        rejectionReason: opportunity.rejectionReason || '가상 자본금 부족',
      };
      return rejected;
    }

    capital = capital - opportunity.costs.landedCostUsd + opportunity.costs.expectedRevenueUsd;
    return {
      tradeNo: index + 1,
      product: opportunity.demand.name,
      platform: opportunity.bestSupply.platform,
      buyCostUsd: opportunity.costs.landedCostUsd,
      sellRevenueUsd: opportunity.costs.expectedRevenueUsd,
      netProfitUsd: opportunity.costs.netProfitUsd,
      marginPct: opportunity.costs.marginPct,
      capitalAfterUsd: round2(capital),
      deliveryDays: opportunity.bestSupply.deliveryDays,
      specScore: opportunity.verification.score,
      status: 'executed',
    };
  });

  const tradesExecuted = trades.filter((trade) => trade.status === 'executed').length;
  const finalCapitalUsd = round2(capital);
  const netProfitUsd = round2(finalCapitalUsd - startedCapitalUsd);

  return {
    mode: 'sandbox-paper-trading',
    startedCapitalUsd,
    finalCapitalUsd,
    netProfitUsd,
    roiPct: round2((netProfitUsd / startedCapitalUsd) * 100),
    tradesRequested: opportunities.length,
    tradesExecuted,
    assumptions: {
      exchangeRateKrwPerUsd,
      importTaxRate,
      platformFeeRate,
      minMarginPct,
      averageApiCostUsd: DEFAULTS.apiCostUsd,
      safety: 'Sandbox only: no real payment, no real listing publish, no live cart click.',
    },
    opportunities,
    trades,
  };
}
