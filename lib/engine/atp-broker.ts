import { EventEmitter } from 'events';
import Redis from 'ioredis';

export const ATP_CHANNELS = {
  BUY_INTENT: 'atp:intent:buy',
  SELL_INTENT: 'atp:intent:sell',
  TRADE_EXECUTED: 'atp:trade:executed',
  AGENT_LOG: 'atp:agent:log',
  CALLBACK_PREFIX: 'atp:agent:callback:',
} as const;

export type AtpChannel = typeof ATP_CHANNELS[keyof typeof ATP_CHANNELS] | `${typeof ATP_CHANNELS.CALLBACK_PREFIX}${string}`;

export interface BrokerEnvelope<T = unknown> {
  channel: AtpChannel;
  payload: T;
  publishedAtMs: number;
}

export type BrokerHandler<T = unknown> = (envelope: BrokerEnvelope<T>) => void | Promise<void>;

export interface AtpBroker {
  publish<T>(channel: AtpChannel, payload: T): Promise<void>;
  subscribe<T>(channel: AtpChannel, handler: BrokerHandler<T>): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

export interface BrokerOptions {
  backend?: 'memory' | 'redis';
  redisUrl?: string;
  namespace?: string;
}

function nowMs(): number {
  if (typeof performance !== 'undefined') return performance.now();
  return Date.now();
}

function namespaced(namespace: string | undefined, channel: AtpChannel): string {
  return namespace ? `${namespace}:${channel}` : channel;
}

function denamespace(namespace: string | undefined, channel: string): AtpChannel {
  if (namespace && channel.startsWith(`${namespace}:`)) {
    return channel.slice(namespace.length + 1) as AtpChannel;
  }
  return channel as AtpChannel;
}

export class InMemoryAtpBroker implements AtpBroker {
  private bus = new EventEmitter();
  private closed = false;

  constructor() {
    this.bus.setMaxListeners(100_000);
  }

  async publish<T>(channel: AtpChannel, payload: T): Promise<void> {
    if (this.closed) throw new Error('ATP broker is closed');
    const envelope: BrokerEnvelope<T> = { channel, payload, publishedAtMs: nowMs() };
    queueMicrotask(() => {
      if (!this.closed) this.bus.emit(channel, envelope);
    });
  }

  async subscribe<T>(channel: AtpChannel, handler: BrokerHandler<T>): Promise<() => Promise<void>> {
    if (this.closed) throw new Error('ATP broker is closed');
    const wrapped = (envelope: BrokerEnvelope<T>) => {
      void handler(envelope);
    };
    this.bus.on(channel, wrapped);
    return async () => {
      this.bus.off(channel, wrapped);
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.bus.removeAllListeners();
  }
}

export class RedisAtpBroker implements AtpBroker {
  private publisher: Redis;
  private subscriber: Redis;
  private handlers = new Map<string, Set<BrokerHandler>>();
  private namespace?: string;

  constructor(options: BrokerOptions = {}) {
    const redisUrl = options.redisUrl || process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    this.namespace = options.namespace || process.env.ATP_REDIS_NAMESPACE;
    this.publisher = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });
    this.subscriber = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });
    this.subscriber.on('message', (rawChannel, rawPayload) => {
      const channel = denamespace(this.namespace, rawChannel);
      const handlers = this.handlers.get(rawChannel);
      if (!handlers || handlers.size === 0) return;
      try {
        const parsed = JSON.parse(rawPayload) as BrokerEnvelope;
        const envelope = { ...parsed, channel };
        for (const handler of handlers) void handler(envelope);
      } catch {
        // Drop malformed messages. The broker should not stall the matching loop.
      }
    });
  }

  async publish<T>(channel: AtpChannel, payload: T): Promise<void> {
    if (this.publisher.status === 'wait') await this.publisher.connect();
    const envelope: BrokerEnvelope<T> = { channel, payload, publishedAtMs: nowMs() };
    await this.publisher.publish(namespaced(this.namespace, channel), JSON.stringify(envelope));
  }

  async subscribe<T>(channel: AtpChannel, handler: BrokerHandler<T>): Promise<() => Promise<void>> {
    if (this.subscriber.status === 'wait') await this.subscriber.connect();
    const redisChannel = namespaced(this.namespace, channel);
    let handlers = this.handlers.get(redisChannel);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(redisChannel, handlers);
      await this.subscriber.subscribe(redisChannel);
    }
    handlers.add(handler as BrokerHandler);

    return async () => {
      const current = this.handlers.get(redisChannel);
      if (!current) return;
      current.delete(handler as BrokerHandler);
      if (current.size === 0) {
        this.handlers.delete(redisChannel);
        await this.subscriber.unsubscribe(redisChannel);
      }
    };
  }

  async close(): Promise<void> {
    this.handlers.clear();
    await Promise.allSettled([
      this.publisher.quit(),
      this.subscriber.quit(),
    ]);
  }
}

export function createAtpBroker(options: BrokerOptions = {}): AtpBroker {
  if (options.backend === 'redis') return new RedisAtpBroker(options);
  return new InMemoryAtpBroker();
}

export function agentCallbackChannel(agentId: string): AtpChannel {
  return `${ATP_CHANNELS.CALLBACK_PREFIX}${agentId}` as AtpChannel;
}
