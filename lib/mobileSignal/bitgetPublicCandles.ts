// Public Bitget candle reader for the mobile-signal historical view.
//
// SAFETY: this module only ever calls Bitget's *public* market-data endpoint.
// It never sends an API key/secret/passphrase, never touches a private/order
// endpoint, and cannot place, modify, or cancel an order. It returns read-only
// OHLC candles used purely for display on the manual-order signal screen.

export interface PublicCandle {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  price: number;
  bid: number | null;
  ask: number | null;
  mid: number;
  timestampMs: number;
}

const BITGET_PUBLIC_BASE = 'https://api.bitget.com';

// Granularities Bitget's public mix-market candle endpoint understands that we
// expose on the mobile screen. Anything else falls back to 15m.
const GRANULARITY_MAP: Record<string, string> = {
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
};

const REQUEST_TIMEOUT_MS = 6_000;
const CACHE_TTL_MS = 20_000;
const MAX_CANDLES = 1_000;

type CacheEntry = { expiresAt: number; candles: PublicCandle[] };
// Short-lived process cache so 5s client polling does not hammer the public API.
const candleCache = new Map<string, CacheEntry>();

export interface FetchCandleOptions {
  symbol?: string;
  timeframe: string;
  limit: number;
}

export async function fetchBitgetPublicCandles(
  options: FetchCandleOptions,
): Promise<PublicCandle[]> {
  const symbol = options.symbol?.trim() || 'BTCUSDT';
  const granularity = GRANULARITY_MAP[options.timeframe] ?? '15m';
  const limit = Math.min(MAX_CANDLES, Math.max(1, Math.round(options.limit)));
  const cacheKey = `${symbol}:${granularity}:${limit}`;
  const now = Date.now();

  const cached = candleCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.candles;

  const url =
    `${BITGET_PUBLIC_BASE}/api/v2/mix/market/candles` +
    `?symbol=${encodeURIComponent(symbol)}` +
    `&productType=usdt-futures` +
    `&granularity=${granularity}` +
    `&limit=${limit}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return cached?.candles ?? [];

    const body = (await response.json()) as { code?: string; data?: unknown };
    if (body.code !== '00000' || !Array.isArray(body.data)) return cached?.candles ?? [];

    const candles = body.data
      .map((row): PublicCandle | null => {
        if (!Array.isArray(row)) return null;
        const timestampMs = Number(row[0]);
        const open = Number(row[1]);
        const high = Number(row[2]);
        const low = Number(row[3]);
        const close = Number(row[4]);
        if (![timestampMs, open, high, low, close].every((n) => Number.isFinite(n))) {
          return null;
        }
        return {
          ts: new Date(timestampMs).toISOString(),
          open,
          high,
          low,
          close,
          price: close,
          bid: null,
          ask: null,
          mid: close,
          timestampMs,
        };
      })
      .filter((candle): candle is PublicCandle => candle !== null)
      .sort((a, b) => a.timestampMs - b.timestampMs);

    candleCache.set(cacheKey, { expiresAt: now + CACHE_TTL_MS, candles });
    return candles;
  } catch {
    return cached?.candles ?? [];
  } finally {
    clearTimeout(timer);
  }
}
