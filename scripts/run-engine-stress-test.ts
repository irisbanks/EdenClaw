import { performance } from 'perf_hooks';
import {
  agentCallbackChannel,
  ATP_CHANNELS,
  createAtpBroker,
} from '../lib/engine/atp-broker';
import {
  AtpMatchEngine,
  type BuyIntent,
  type SellIntent,
  type TradeExecutedEvent,
} from '../lib/engine/match-core';

function numberArg(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nowMs(): number {
  return performance.now();
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor((i * 9301 + 49297) % 233280 / 233280 * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function percentile(values: number[], pct: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[index];
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<void> {
  const start = nowMs();
  while (!condition()) {
    if (nowMs() - start > timeoutMs) throw new Error(`Stress test timeout after ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

async function main() {
  const pairs = numberArg('pairs', 100);
  const broker = createAtpBroker({ backend: 'memory' });
  const engine = new AtpMatchEngine(broker, {
    minFingerprintSimilarity: 0.98,
    maxIntentAgeMs: 30_000,
  });

  const trades: TradeExecutedEvent[] = [];
  let callbackEvents = 0;
  const unsubscribeFns: Array<() => Promise<void>> = [];

  unsubscribeFns.push(
    await broker.subscribe<TradeExecutedEvent>(ATP_CHANNELS.TRADE_EXECUTED, ({ payload }) => {
      trades.push(payload);
    }),
  );

  for (let i = 0; i < pairs; i += 1) {
    unsubscribeFns.push(
      await broker.subscribe<TradeExecutedEvent>(agentCallbackChannel(`buyer-${i}`), () => {
        callbackEvents += 1;
      }),
    );
    unsubscribeFns.push(
      await broker.subscribe<TradeExecutedEvent>(agentCallbackChannel(`seller-${i}`), () => {
        callbackEvents += 1;
      }),
    );
  }

  await engine.start();

  const events: Array<{ channel: typeof ATP_CHANNELS.BUY_INTENT; payload: BuyIntent } | { channel: typeof ATP_CHANNELS.SELL_INTENT; payload: SellIntent }> = [];
  for (let i = 0; i < pairs; i += 1) {
    const fingerprint = `sku:edenclaw:stress:${i.toString().padStart(4, '0')}`;
    const minAcceptPrice = 120_000 + (i % 17) * 1500;
    const budget = minAcceptPrice + 18_000 + (i % 11) * 700;
    events.push({
      channel: ATP_CHANNELS.BUY_INTENT,
      payload: {
        type: 'BUY_INTENT',
        intentId: `buy-${i}`,
        agentId: `buyer-${i}`,
        product_fingerprint: fingerprint,
        budget,
        required_margin_pct: 5,
        desiredSpec: { title: `Stress SKU ${i}`, condition: 'A' },
        createdAtMs: nowMs(),
      },
    });
    events.push({
      channel: ATP_CHANNELS.SELL_INTENT,
      payload: {
        type: 'SELL_INTENT',
        intentId: `sell-${i}`,
        agentId: `seller-${i}`,
        product_fingerprint: fingerprint,
        min_accept_price: minAcceptPrice,
        productSpec: { title: `Stress SKU ${i}`, condition: 'A' },
        createdAtMs: nowMs(),
      },
    });
  }

  const startedAt = nowMs();
  await Promise.all(shuffle(events).map((event) => broker.publish(event.channel, event.payload)));
  try {
    await waitFor(() => trades.length >= pairs && callbackEvents >= pairs * 2, 5000);
  } catch (error) {
    console.error(JSON.stringify({ trades: trades.length, callbackEvents, engineStats: engine.getStats() }, null, 2));
    throw error;
  }
  const finishedAt = nowMs();

  const durationMs = finishedAt - startedAt;
  const latencies = trades.map((trade) => trade.latencyMs);
  const avgLatencyMs = latencies.reduce((sum, value) => sum + value, 0) / Math.max(latencies.length, 1);
  const summary = {
    mode: 'in-memory-atp-broker',
    buyerAgents: pairs,
    sellerAgents: pairs,
    intentsPublished: pairs * 2,
    tradesExecuted: trades.length,
    callbackEvents,
    durationMs: round3(durationMs),
    tps: round3(trades.length / (durationMs / 1000)),
    avgLatencyMs: round3(avgLatencyMs),
    p50LatencyMs: round3(percentile(latencies, 50)),
    p95LatencyMs: round3(percentile(latencies, 95)),
    maxLatencyMs: round3(Math.max(...latencies)),
    engineStats: engine.getStats(),
  };

  console.log('\n===== EDENCLAW ATP ENGINE STRESS TEST =====');
  console.table([
    { metric: 'Buyer Agents', value: summary.buyerAgents },
    { metric: 'Seller Agents', value: summary.sellerAgents },
    { metric: 'Trades Executed', value: summary.tradesExecuted },
    { metric: 'Callback Events', value: summary.callbackEvents },
    { metric: 'Duration', value: `${summary.durationMs}ms` },
    { metric: 'TPS', value: summary.tps },
    { metric: 'Avg Latency', value: `${summary.avgLatencyMs}ms` },
    { metric: 'P95 Latency', value: `${summary.p95LatencyMs}ms` },
  ]);
  console.log('\nJSON');
  console.log(JSON.stringify(summary, null, 2));

  await Promise.allSettled(unsubscribeFns.map((unsubscribe) => unsubscribe()));
  await engine.stop();
  await broker.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
