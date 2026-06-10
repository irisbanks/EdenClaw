import {
  ATP_CHANNELS,
  createAtpBroker,
  type AtpBroker,
} from './atp-broker';
import {
  AtpMatchEngine,
  type BuyIntent,
  type SellIntent,
} from './match-core';

export interface AgentActivityEvent {
  type: 'AGENT_LOG';
  source: string;
  message: string;
  tone: 'green' | 'blue' | 'amber' | 'violet' | 'gray';
  intentId?: string;
  timestampMs: number;
}

export type EngineIntent = BuyIntent | SellIntent;

interface EngineRuntime {
  broker: AtpBroker;
  engine: AtpMatchEngine;
  started: Promise<void>;
}

declare global {
  // eslint-disable-next-line no-var
  var __edenclawAtpRuntime: EngineRuntime | undefined;
}

function nowMs(): number {
  if (typeof performance !== 'undefined') return performance.now();
  return Date.now();
}

export async function getAtpRuntime(): Promise<EngineRuntime> {
  if (!globalThis.__edenclawAtpRuntime) {
    const broker = createAtpBroker({
      backend: process.env.ATP_BROKER_BACKEND === 'redis' ? 'redis' : 'memory',
      redisUrl: process.env.REDIS_URL,
      namespace: process.env.ATP_REDIS_NAMESPACE || 'edenclaw',
    });
    const engine = new AtpMatchEngine(broker, {
      minFingerprintSimilarity: Number(process.env.ATP_MIN_FINGERPRINT_SIMILARITY || 0.98),
      maxIntentAgeMs: Number(process.env.ATP_MAX_INTENT_AGE_MS || 30_000),
    });

    globalThis.__edenclawAtpRuntime = {
      broker,
      engine,
      started: engine.start(),
    };
  }

  await globalThis.__edenclawAtpRuntime.started;
  return globalThis.__edenclawAtpRuntime;
}

export async function publishIntent(intent: EngineIntent): Promise<void> {
  const runtime = await getAtpRuntime();
  await runtime.broker.publish(
    intent.type === 'BUY_INTENT' ? ATP_CHANNELS.BUY_INTENT : ATP_CHANNELS.SELL_INTENT,
    intent,
  );
}

export async function publishAgentLog(event: Omit<AgentActivityEvent, 'type' | 'timestampMs'> & { timestampMs?: number }): Promise<void> {
  const runtime = await getAtpRuntime();
  await runtime.broker.publish(ATP_CHANNELS.AGENT_LOG, {
    type: 'AGENT_LOG',
    timestampMs: event.timestampMs ?? nowMs(),
    ...event,
  } satisfies AgentActivityEvent);
}
