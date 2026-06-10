import type { SimilarItem } from '../types/trader';

export async function search_market(query: {
  category?: string;
  brand?: string;
  keywords?: string;
}): Promise<SimilarItem[]> {
  try {
    const params = new URLSearchParams();
    if (query.category) params.set('category', query.category);
    if (query.brand) params.set('brand', query.brand);
    if (query.keywords) params.set('keywords', query.keywords);

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const response = await fetch(`${baseUrl}/api/market/products?${params.toString()}`, {
      next: { revalidate: 60 },
    });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data) ? data : (data.items ?? []);
  } catch {
    return [];
  }
}

export async function simulate_negotiation(params: {
  item_id?: string;
  list_price: number;
  category: string;
  n_simulations?: number;
}): Promise<{
  success_rate: number;
  avg_days: number;
  final_prices: number[];
}> {
  const n = params.n_simulations ?? 100;
  const base = params.list_price;
  const discountRate = 0.1 + Math.random() * 0.05;
  const finalPrices = Array.from({ length: Math.min(n, 5) }, () =>
    Math.round(base * (1 - discountRate * (0.8 + Math.random() * 0.4)))
  );
  return {
    success_rate: 0.45 + Math.random() * 0.3,
    avg_days: 3 + Math.floor(Math.random() * 10),
    final_prices: finalPrices,
  };
}

export async function get_user_history(userId: string): Promise<{
  total_trades: number;
  avg_negotiation_discount: number;
  success_rate: number;
}> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const response = await fetch(`${baseUrl}/api/agents/user-history?userId=${userId}`);
    if (!response.ok) return { total_trades: 0, avg_negotiation_discount: 0, success_rate: 0 };
    return response.json();
  } catch {
    return { total_trades: 0, avg_negotiation_discount: 0, success_rate: 0 };
  }
}

export async function check_safety(text: string): Promise<{
  risk_level: 'low' | 'medium' | 'high';
  warnings: string[];
}> {
  const HIGH_RISK = ['계좌이체', '선입금', '직거래 사기', '개인정보'];
  const warnings: string[] = [];
  for (const kw of HIGH_RISK) {
    if (text.includes(kw)) warnings.push(`주의: "${kw}" 패턴 감지`);
  }
  return {
    risk_level: warnings.length > 1 ? 'high' : warnings.length === 1 ? 'medium' : 'low',
    warnings,
  };
}

export { analyzePhoto } from '@/lib/vision/photo-analyzer';
export { writeKarrotListing } from './write_listing';
export type { WriteKarrotListingParams } from './write_listing';
export { prepareGlobalPurchase } from './global-buyer';
export type { PrepareGlobalPurchaseParams } from './global-buyer';

export function analyze_price_distribution(items: SimilarItem[]): {
  min: number;
  max: number;
  avg: number;
  median: number;
  iqr: [number, number];
} {
  if (items.length === 0) return { min: 0, max: 0, avg: 0, median: 0, iqr: [0, 0] };
  const prices = items.map((i) => i.price).sort((a, b) => a - b);
  const min = prices[0];
  const max = prices[prices.length - 1];
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  const median = prices[Math.floor(prices.length / 2)];
  const q1 = prices[Math.floor(prices.length / 4)];
  const q3 = prices[Math.floor((prices.length * 3) / 4)];
  return { min, max, avg, median, iqr: [q1, q3] };
}
