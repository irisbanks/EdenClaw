import {
  agentCallbackChannel,
  ATP_CHANNELS,
  type AtpBroker,
  type AtpChannel,
} from './atp-broker';

export type IntentSide = 'buy' | 'sell';

export interface ProductSpec {
  title?: string;
  brand?: string;
  model?: string;
  condition?: string;
  attributes?: Record<string, string | number | boolean>;
}

export interface BuyIntent {
  type: 'BUY_INTENT';
  intentId: string;
  agentId: string;
  product_fingerprint: string;
  fingerprint_vector?: number[];
  budget: number;
  required_margin_pct?: number;
  desiredSpec?: ProductSpec;
  callbackChannel?: string;
  createdAtMs: number;
}

export interface SellIntent {
  type: 'SELL_INTENT';
  intentId: string;
  agentId: string;
  product_fingerprint: string;
  fingerprint_vector?: number[];
  min_accept_price: number;
  productSpec?: ProductSpec;
  callbackChannel?: string;
  createdAtMs: number;
}

export interface TradeExecutedEvent {
  type: 'TRADE_EXECUTED';
  tradeId: string;
  buyIntentId: string;
  sellIntentId: string;
  buyerAgentId: string;
  sellerAgentId: string;
  product_fingerprint: string;
  fingerprint_similarity: number;
  execution_price: number;
  buyer_budget: number;
  seller_min_accept_price: number;
  latencyMs: number;
  executedAtMs: number;
}

export interface MatchEngineStats {
  buyIntentsReceived: number;
  sellIntentsReceived: number;
  tradesExecuted: number;
  openBuyIntents: number;
  openSellIntents: number;
  avgLatencyMs: number;
}

export interface MatchEngineOptions {
  minFingerprintSimilarity?: number;
  maxIntentAgeMs?: number;
}

interface IndexedIntent<T extends BuyIntent | SellIntent> {
  value: T;
  bucket: string;
}

function nowMs(): number {
  if (typeof performance !== 'undefined') return performance.now();
  return Date.now();
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function fingerprintBucket(fingerprint: string): string {
  return fingerprint.trim().toLowerCase().replace(/\s+/g, ':').slice(0, 64);
}

function stringSimilarity(a: string, b: string): number {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  if (!left || !right) return 0;
  if (left === right) return 1;

  const leftTokens = new Set(left.split(/[^a-z0-9가-힣]+/i).filter(Boolean));
  const rightTokens = new Set(right.split(/[^a-z0-9가-힣]+/i).filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  return (2 * intersection) / (leftTokens.size + rightTokens.size);
}

function cosineSimilarity(a?: number[], b?: number[]): number | null {
  if (!a || !b || a.length === 0 || a.length !== b.length) return null;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return null;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function fingerprintSimilarity(buy: BuyIntent, sell: SellIntent): number {
  const vectorScore = cosineSimilarity(buy.fingerprint_vector, sell.fingerprint_vector);
  const textScore = stringSimilarity(buy.product_fingerprint, sell.product_fingerprint);
  return round4(Math.max(vectorScore ?? 0, textScore));
}

export class AtpMatchEngine {
  private broker: AtpBroker;
  private minFingerprintSimilarity: number;
  private maxIntentAgeMs: number;
  private unsubscribeFns: Array<() => Promise<void>> = [];
  private buyIntents = new Map<string, IndexedIntent<BuyIntent>>();
  private sellIntents = new Map<string, IndexedIntent<SellIntent>>();
  private buysByBucket = new Map<string, Set<string>>();
  private sellsByBucket = new Map<string, Set<string>>();
  private stats = {
    buyIntentsReceived: 0,
    sellIntentsReceived: 0,
    tradesExecuted: 0,
    totalLatencyMs: 0,
  };

  constructor(broker: AtpBroker, options: MatchEngineOptions = {}) {
    this.broker = broker;
    this.minFingerprintSimilarity = options.minFingerprintSimilarity ?? 0.98;
    this.maxIntentAgeMs = options.maxIntentAgeMs ?? 15_000;
  }

  async start(): Promise<void> {
    this.unsubscribeFns.push(
      await this.broker.subscribe<BuyIntent>(ATP_CHANNELS.BUY_INTENT, async ({ payload }) => {
        await this.acceptBuyIntent(payload);
      }),
    );
    this.unsubscribeFns.push(
      await this.broker.subscribe<SellIntent>(ATP_CHANNELS.SELL_INTENT, async ({ payload }) => {
        await this.acceptSellIntent(payload);
      }),
    );
  }

  async stop(): Promise<void> {
    await Promise.allSettled(this.unsubscribeFns.map((unsubscribe) => unsubscribe()));
    this.unsubscribeFns = [];
    this.buyIntents.clear();
    this.sellIntents.clear();
    this.buysByBucket.clear();
    this.sellsByBucket.clear();
  }

  async acceptBuyIntent(intent: BuyIntent): Promise<void> {
    this.stats.buyIntentsReceived += 1;
    this.pruneExpired();
    const match = this.findBestSell(intent);
    if (match) {
      await this.executeTrade(intent, match.sell, match.similarity);
      return;
    }
    this.addBuy(intent);
  }

  async acceptSellIntent(intent: SellIntent): Promise<void> {
    this.stats.sellIntentsReceived += 1;
    this.pruneExpired();
    const match = this.findBestBuy(intent);
    if (match) {
      await this.executeTrade(match.buy, intent, match.similarity);
      return;
    }
    this.addSell(intent);
  }

  getStats(): MatchEngineStats {
    return {
      buyIntentsReceived: this.stats.buyIntentsReceived,
      sellIntentsReceived: this.stats.sellIntentsReceived,
      tradesExecuted: this.stats.tradesExecuted,
      openBuyIntents: this.buyIntents.size,
      openSellIntents: this.sellIntents.size,
      avgLatencyMs: this.stats.tradesExecuted > 0
        ? round3(this.stats.totalLatencyMs / this.stats.tradesExecuted)
        : 0,
    };
  }

  private addBuy(intent: BuyIntent): void {
    const bucket = fingerprintBucket(intent.product_fingerprint);
    this.buyIntents.set(intent.intentId, { value: intent, bucket });
    this.addToIndex(this.buysByBucket, bucket, intent.intentId);
  }

  private addSell(intent: SellIntent): void {
    const bucket = fingerprintBucket(intent.product_fingerprint);
    this.sellIntents.set(intent.intentId, { value: intent, bucket });
    this.addToIndex(this.sellsByBucket, bucket, intent.intentId);
  }

  private addToIndex(index: Map<string, Set<string>>, bucket: string, id: string): void {
    let set = index.get(bucket);
    if (!set) {
      set = new Set();
      index.set(bucket, set);
    }
    set.add(id);
  }

  private removeBuy(intentId: string): void {
    const indexed = this.buyIntents.get(intentId);
    if (!indexed) return;
    this.buyIntents.delete(intentId);
    this.buysByBucket.get(indexed.bucket)?.delete(intentId);
  }

  private removeSell(intentId: string): void {
    const indexed = this.sellIntents.get(intentId);
    if (!indexed) return;
    this.sellIntents.delete(intentId);
    this.sellsByBucket.get(indexed.bucket)?.delete(intentId);
  }

  private findBestSell(buy: BuyIntent): { sell: SellIntent; similarity: number } | null {
    const candidates = this.intentCandidates(this.sellIntents, this.sellsByBucket, buy.product_fingerprint);
    let best: { sell: SellIntent; similarity: number; spread: number } | null = null;
    for (const sell of candidates) {
      if (buy.budget < sell.min_accept_price) continue;
      const similarity = fingerprintSimilarity(buy, sell);
      if (similarity < this.minFingerprintSimilarity) continue;
      const spread = buy.budget - sell.min_accept_price;
      if (!best || similarity > best.similarity || (similarity === best.similarity && spread > best.spread)) {
        best = { sell, similarity, spread };
      }
    }
    return best ? { sell: best.sell, similarity: best.similarity } : null;
  }

  private findBestBuy(sell: SellIntent): { buy: BuyIntent; similarity: number } | null {
    const candidates = this.intentCandidates(this.buyIntents, this.buysByBucket, sell.product_fingerprint);
    let best: { buy: BuyIntent; similarity: number; spread: number } | null = null;
    for (const buy of candidates) {
      if (buy.budget < sell.min_accept_price) continue;
      const similarity = fingerprintSimilarity(buy, sell);
      if (similarity < this.minFingerprintSimilarity) continue;
      const spread = buy.budget - sell.min_accept_price;
      if (!best || similarity > best.similarity || (similarity === best.similarity && spread > best.spread)) {
        best = { buy, similarity, spread };
      }
    }
    return best ? { buy: best.buy, similarity: best.similarity } : null;
  }

  private intentCandidates<T extends BuyIntent | SellIntent>(
    store: Map<string, IndexedIntent<T>>,
    index: Map<string, Set<string>>,
    fingerprint: string,
  ): T[] {
    const exactBucket = fingerprintBucket(fingerprint);
    const exactIds = index.get(exactBucket);
    if (exactIds && exactIds.size > 0) {
      return [...exactIds].map((id) => store.get(id)?.value).filter(Boolean) as T[];
    }
    return [...store.values()].map((entry) => entry.value);
  }

  private async executeTrade(buy: BuyIntent, sell: SellIntent, similarity: number): Promise<void> {
    this.removeBuy(buy.intentId);
    this.removeSell(sell.intentId);

    const executedAtMs = nowMs();
    const latencyMs = Math.max(0, executedAtMs - Math.max(buy.createdAtMs, sell.createdAtMs));
    const event: TradeExecutedEvent = {
      type: 'TRADE_EXECUTED',
      tradeId: `trade_${buy.intentId}_${sell.intentId}`,
      buyIntentId: buy.intentId,
      sellIntentId: sell.intentId,
      buyerAgentId: buy.agentId,
      sellerAgentId: sell.agentId,
      product_fingerprint: buy.product_fingerprint,
      fingerprint_similarity: similarity,
      execution_price: sell.min_accept_price,
      buyer_budget: buy.budget,
      seller_min_accept_price: sell.min_accept_price,
      latencyMs: round3(latencyMs),
      executedAtMs,
    };

    this.stats.tradesExecuted += 1;
    this.stats.totalLatencyMs += event.latencyMs;

    await this.broker.publish(ATP_CHANNELS.TRADE_EXECUTED, event);
    await Promise.all([
      this.broker.publish((buy.callbackChannel || agentCallbackChannel(buy.agentId)) as AtpChannel, event),
      this.broker.publish((sell.callbackChannel || agentCallbackChannel(sell.agentId)) as AtpChannel, event),
    ]);
  }

  private pruneExpired(): void {
    const cutoff = nowMs() - this.maxIntentAgeMs;
    for (const [intentId, indexed] of this.buyIntents.entries()) {
      if (indexed.value.createdAtMs < cutoff) this.removeBuy(intentId);
    }
    for (const [intentId, indexed] of this.sellIntents.entries()) {
      if (indexed.value.createdAtMs < cutoff) this.removeSell(intentId);
    }
  }
}
