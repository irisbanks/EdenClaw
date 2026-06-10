export interface NaverItem {
  title: string;
  link: string;
  image: string;
  lprice: number;
  hprice: number;
  mallName: string;
  productId: string;
  productType: string;
  brand: string;
  maker: string;
  category1: string;
  category2: string;
  category3: string;
  category4: string;
}

export interface NaverSearchResult {
  total: number;
  items: NaverItem[];
  source: 'naver';
  cached: boolean;
}

class NaverShoppingClient {
  private readonly baseUrl = 'https://openapi.naver.com/v1/search/shop.json';
  private readonly cache = new Map<string, { data: NaverSearchResult; timestamp: number }>();
  private readonly cacheTTL = 5 * 60 * 1000;

  async search(
    query: string,
    options?: {
      display?: number;
      start?: number;
      sort?: 'sim' | 'date' | 'asc' | 'dsc';
    }
  ): Promise<NaverSearchResult> {
    const cacheKey = JSON.stringify({ query, options });
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return { ...cached.data, cached: true };
    }

    const params = new URLSearchParams({
      query,
      display: String(options?.display ?? 20),
      start: String(options?.start ?? 1),
      sort: options?.sort ?? 'sim',
    });

    const res = await fetch(`${this.baseUrl}?${params}`, {
      headers: {
        'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID!,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET!,
      },
    });

    if (!res.ok) {
      const errorBody = await res.text();
      if (errorBody.includes('024')) {
        throw new Error('NAVER_SCOPE_PENDING: API scope not yet active. Retry in 5-60 min.');
      }
      throw new Error(`Naver API ${res.status}: ${errorBody}`);
    }

    const data = await res.json();

    const items: NaverItem[] = (data.items ?? []).map((item: Record<string, string>) => ({
      ...item,
      title: item.title.replace(/<\/?b>/g, ''),
      lprice: parseInt(item.lprice) || 0,
      hprice: parseInt(item.hprice) || 0,
    }));

    const result: NaverSearchResult = {
      total: data.total ?? 0,
      items,
      source: 'naver',
      cached: false,
    };
    this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  }
}

export const naverShopping = new NaverShoppingClient();
