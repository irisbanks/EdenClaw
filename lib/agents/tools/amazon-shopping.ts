export interface AmazonItem {
  asin: string;
  title: string;
  price_usd: number;
  min_offer_usd: number;
  currency: string;
  rating: number;
  ratings_total: number;
  url: string;
  is_prime: boolean;
  is_best_seller: boolean;
}

export interface AmazonSearchResult {
  total: number;
  items: AmazonItem[];
  source: 'amazon';
  cached: boolean;
}

class AmazonShoppingClient {
  private readonly baseUrl = 'https://real-time-amazon-data.p.rapidapi.com';
  private readonly cache = new Map<string, { data: AmazonSearchResult; timestamp: number }>();
  private readonly cacheTTL = 5 * 60 * 1000;

  async search(
    query: string,
    options?: { limit?: number; country?: string }
  ): Promise<AmazonSearchResult> {
    const cacheKey = JSON.stringify({ query, options });
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return { ...cached.data, cached: true };
    }

    const params = new URLSearchParams({
      query,
      country: options?.country ?? 'US',
      category_id: 'aps',
    });

    const res = await fetch(`${this.baseUrl}/search?${params}`, {
      headers: {
        'x-rapidapi-key': process.env.RAPIDAPI_KEY!,
        'x-rapidapi-host':
          process.env.RAPIDAPI_AMAZON_HOST ?? 'real-time-amazon-data.p.rapidapi.com',
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Amazon API ${res.status}: ${body}`);
    }

    const data = await res.json();
    const products: Record<string, string>[] = data.data?.products ?? [];

    const items: AmazonItem[] = products
      .map((p) => ({
        asin: p.asin ?? '',
        title: (p.product_title ?? '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&'),
        price_usd: parseFloat((p.product_price ?? '0').replace(/[^0-9.]/g, '')) || 0,
        min_offer_usd:
          parseFloat((p.product_minimum_offer_price ?? '0').replace(/[^0-9.]/g, '')) || 0,
        currency: p.currency ?? 'USD',
        rating: parseFloat(p.product_star_rating ?? '0') || 0,
        ratings_total: parseInt(p.product_num_ratings ?? '0') || 0,
        url: p.product_url ?? '',
        is_prime: p.is_prime === 'true' || (p.is_prime as unknown) === true,
        is_best_seller: p.is_best_seller === 'true' || (p.is_best_seller as unknown) === true,
      }))
      .filter((i) => i.price_usd > 0);

    const result: AmazonSearchResult = {
      total: data.data?.total_products ?? items.length,
      items,
      source: 'amazon',
      cached: false,
    };
    this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  }
}

export const amazonShopping = new AmazonShoppingClient();
