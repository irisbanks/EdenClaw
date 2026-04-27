import { NextRequest, NextResponse } from 'next/server';
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
        max_tokens: 400,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } catch {
    return '';
  }
}

// 선형 회귀로 7일 예측
function linearForecast(prices: number[], days = 7): number[] {
  const n = prices.length;
  if (n < 2) return Array(days).fill(prices[0] || 0);

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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: productId } = await params;

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, title: true, price: true, currency: true, category: true },
  });
  if (!product) return NextResponse.json({ error: '상품을 찾을 수 없습니다' }, { status: 404 });

  // 최근 30일 가격 이력
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
  const history = await prisma.priceHistory.findMany({
    where: { productId, date: { gte: thirtyDaysAgo } },
    orderBy: { date: 'asc' },
    select: { price: true, date: true },
  });

  // 이력이 없으면 현재 가격 1개만
  const priceData = history.length > 0
    ? history
    : [{ price: product.price, date: new Date() }];

  const prices = priceData.map(h => h.price);
  const labels = priceData.map(h => new Date(h.date).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }));

  // 통계
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const avgPrice = Math.round(prices.reduce((s, v) => s + v, 0) / prices.length);
  const currentPrice = prices[prices.length - 1];
  const firstPrice = prices[0];
  const changeRate = firstPrice > 0 ? Math.round((currentPrice - firstPrice) / firstPrice * 100) : 0;

  // 7일 예측
  const forecast = linearForecast(prices, 7);
  const forecastLabels = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() + (i + 1) * 86400000);
    return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
  });

  const forecastMin = Math.min(...forecast);
  const forecastTrend = forecast[forecast.length - 1] > currentPrice ? 'up' : 'down';

  // AI 분석 및 구매 추천
  const aiPrompt = `다음 상품의 가격 트렌드를 분석하고 구매 시점을 추천하세요.

상품: ${product.title}
현재 가격: ${currentPrice} ${product.currency}
30일 최저: ${minPrice} ${product.currency}
30일 최고: ${maxPrice} ${product.currency}
30일 평균: ${avgPrice} ${product.currency}
가격 변동: ${changeRate > 0 ? '+' : ''}${changeRate}%
7일 예측 트렌드: ${forecastTrend === 'up' ? '상승' : '하락'}
예측 최저가: ${forecastMin} ${product.currency}

다음 JSON 형식으로만 답변하세요:
{
  "recommendation": "buy_now" | "wait" | "neutral",
  "confidence": 0~100,
  "analysis": "가격 트렌드 분석 2~3문장",
  "buyAdvice": "지금 사야 할까? 에 대한 구체적 조언 1~2문장",
  "bestTimeToBy": "최적 구매 시점 (예: 3~5일 후, 지금 바로)"
}`;

  let aiAnalysis = {
    recommendation: 'neutral' as 'buy_now' | 'wait' | 'neutral',
    confidence: 50,
    analysis: '가격 분석 중...',
    buyAdvice: '현재 시장 평균가에 근접해 있습니다.',
    bestTimeToBy: '지금',
  };

  const aiResp = await callAI(aiPrompt);
  try {
    const m = aiResp.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      aiAnalysis = {
        recommendation: parsed.recommendation || 'neutral',
        confidence: Math.max(0, Math.min(100, parseInt(parsed.confidence) || 50)),
        analysis: String(parsed.analysis || ''),
        buyAdvice: String(parsed.buyAdvice || ''),
        bestTimeToBy: String(parsed.bestTimeToBy || '지금'),
      };
    }
  } catch { /* use default */ }

  const recommendIcon =
    aiAnalysis.recommendation === 'buy_now' ? '🟢 지금 구매 추천' :
    aiAnalysis.recommendation === 'wait' ? '🔴 잠시 기다리세요' : '🟡 중립';

  return NextResponse.json({
    productId,
    productTitle: product.title,
    currency: product.currency,
    chart: {
      labels,
      prices,
      forecastLabels,
      forecast,
    },
    stats: {
      current: currentPrice,
      min: minPrice,
      max: maxPrice,
      avg: avgPrice,
      changeRate,
      dataPoints: prices.length,
    },
    forecast: {
      prices: forecast,
      labels: forecastLabels,
      trend: forecastTrend,
      minForecast: forecastMin,
    },
    aiAnalysis: {
      ...aiAnalysis,
      recommendIcon,
    },
    generatedAt: new Date().toISOString(),
  });
}
