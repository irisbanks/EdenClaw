// 가격 트렌드 엔진: 시계열 분석 + Qwen 다음주 예측
'use strict';

import { prisma } from '@/lib/prisma';

const VLLM_URL = process.env.LOCAL_AI_URL || 'http://localhost:8000/v1/chat/completions';
const AI_MODEL = process.env.LOCAL_AI_MODEL || 'Qwen/Qwen2.5-72B-Instruct';

async function callAI(prompt: string): Promise<string> {
  try {
    const res = await fetch(VLLM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.25,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content || '';
  } catch {
    return '';
  }
}

// 선형 회귀 예측
function linearForecast(prices: number[], days = 7): number[] {
  const n = prices.length;
  if (n < 2) return Array(days).fill(prices[0] ?? 0);

  const xMean = (n - 1) / 2;
  const yMean = prices.reduce((s, v) => s + v, 0) / n;
  let num = 0, den = 0;
  prices.forEach((y, x) => {
    num += (x - xMean) * (y - yMean);
    den += (x - xMean) ** 2;
  });
  const slope = den !== 0 ? num / den : 0;
  const intercept = yMean - slope * xMean;

  return Array.from({ length: days }, (_, i) =>
    Math.max(0, Math.round(intercept + slope * (n + i)))
  );
}

// 가격 변동성 계산 (표준편차 / 평균)
function volatility(prices: number[]): number {
  if (prices.length < 2) return 0;
  const mean = prices.reduce((s, v) => s + v, 0) / prices.length;
  const variance = prices.reduce((s, v) => s + (v - mean) ** 2, 0) / prices.length;
  return mean > 0 ? Math.sqrt(variance) / mean : 0;
}

export interface PriceTrendResult {
  productId: string;
  title: string;
  currentPrice: number;
  currency: string;
  history: { date: string; price: number }[];
  stats: { min: number; max: number; avg: number; change7d: number; volatility: number };
  forecast: { date: string; price: number }[];
  aiAnalysis: string;
  buyAdvice: '지금구매' | '대기' | '좋은시기';
}

export async function analyzePriceTrend(productId: string): Promise<PriceTrendResult> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, title: true, price: true, currency: true, category: true },
  });
  if (!product) throw new Error('상품을 찾을 수 없습니다');

  // 최근 30일 가격 이력 (date 또는 recordedAt 기준)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
  const history = await prisma.priceHistory.findMany({
    where: { productId, date: { gte: thirtyDaysAgo } },
    orderBy: { date: 'asc' },
    select: { price: true, date: true },
  });

  const priceData = history.length > 0
    ? history
    : [{ price: product.price, date: new Date() }];

  const prices = priceData.map(h => h.price);
  const historyFormatted = priceData.map(h => ({
    date: new Date(h.date).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }),
    price: h.price,
  }));

  // 통계
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const avgPrice = Math.round(prices.reduce((s, v) => s + v, 0) / prices.length);
  const currentPrice = prices[prices.length - 1];
  const firstPrice = prices[0];
  const change7d = prices.length >= 7
    ? Math.round(((currentPrice - prices[prices.length - 7]) / prices[prices.length - 7]) * 100)
    : Math.round(((currentPrice - firstPrice) / firstPrice) * 100);
  const vol = Math.round(volatility(prices) * 100);

  // 7일 선형 예측
  const forecastPrices = linearForecast(prices, 7);
  const today = new Date();
  const forecast = forecastPrices.map((price, i) => {
    const d = new Date(today.getTime() + (i + 1) * 86400000);
    return { date: d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }), price };
  });

  // Qwen AI 분석 + 구매 조언
  const aiPrompt = `다음 상품의 가격 트렌드를 분석하고 구매 시점을 조언하세요.

상품: ${product.title} (${product.category})
현재가: ${currentPrice} ${product.currency}
최근 30일: 최저 ${minPrice}, 최고 ${maxPrice}, 평균 ${avgPrice}
7일 변화율: ${change7d > 0 ? '+' : ''}${change7d}%
변동성: ${vol}%
예측가(7일): ${forecastPrices[6]} ${product.currency}

다음 JSON으로만 답변:
{
  "analysis": "2~3문장 트렌드 분석",
  "advice": "지금구매|대기|좋은시기",
  "reason": "조언 이유 한 문장"
}`;

  let aiAnalysis = `현재가 ${currentPrice.toLocaleString()} ${product.currency}. 7일 변화: ${change7d > 0 ? '+' : ''}${change7d}%.`;
  let buyAdvice: PriceTrendResult['buyAdvice'] = '대기';

  const aiResp = await callAI(aiPrompt);
  try {
    const m = aiResp.match(/\{[\s\S]*\}/);
    if (m) {
      const p = JSON.parse(m[0]);
      aiAnalysis = `${p.analysis || ''} ${p.reason || ''}`.trim() || aiAnalysis;
      if (['지금구매', '대기', '좋은시기'].includes(p.advice)) {
        buyAdvice = p.advice as PriceTrendResult['buyAdvice'];
      }
    }
  } catch { /* fallback */ }

  // 알고리즘 폴백 조언
  if (!aiResp) {
    if (currentPrice <= minPrice * 1.05) buyAdvice = '지금구매';
    else if (change7d < -5) buyAdvice = '좋은시기';
    else buyAdvice = '대기';
  }

  console.log(`[PriceTrendEngine] ${product.title}: ${change7d}% 변화, 예측 ${forecastPrices[6]} → ${buyAdvice}`);

  return {
    productId, title: product.title, currentPrice, currency: product.currency,
    history: historyFormatted,
    stats: { min: minPrice, max: maxPrice, avg: avgPrice, change7d, volatility: vol },
    forecast, aiAnalysis, buyAdvice,
  };
}

// 새 가격 이력 기록 (판매가 변경 시 호출)
export async function recordPrice(productId: string, price: number): Promise<void> {
  await prisma.priceHistory.create({
    data: { productId, price, date: new Date(), recordedAt: new Date() },
  });
  console.log(`[PriceTrendEngine] 가격 기록: ${productId} → ${price}`);
}
