import { NextRequest } from 'next/server';
import { ATP_CHANNELS } from '@/lib/engine/atp-broker';
import { getAtpRuntime } from '@/lib/engine/runtime';
import type { AgentActivityEvent } from '@/lib/engine/runtime';
import type { TradeExecutedEvent } from '@/lib/engine/match-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function encodeSse(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function GET(req: NextRequest) {
  const runtimeState = await getAtpRuntime();
  let unsubscribeLog: (() => Promise<void>) | null = null;
  let unsubscribeTrade: (() => Promise<void>) | null = null;
  let heartbeat: NodeJS.Timeout | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encodeSse(event, data));
        } catch {
          // The client has likely disconnected.
        }
      };

      send('connected', {
        ok: true,
        broker: process.env.ATP_BROKER_BACKEND === 'redis' ? 'redis' : 'memory',
        stats: runtimeState.engine.getStats(),
        connectedAt: Date.now(),
      });

      unsubscribeLog = await runtimeState.broker.subscribe<AgentActivityEvent>(
        ATP_CHANNELS.AGENT_LOG,
        ({ payload }) => send('agent_log', payload),
      );
      unsubscribeTrade = await runtimeState.broker.subscribe<TradeExecutedEvent>(
        ATP_CHANNELS.TRADE_EXECUTED,
        ({ payload }) => send('trade_executed', payload),
      );

      heartbeat = setInterval(() => {
        send('heartbeat', { ts: Date.now(), stats: runtimeState.engine.getStats() });
      }, 15_000);

      req.signal.addEventListener('abort', () => {
        void cleanup().finally(() => {
          try {
            controller.close();
          } catch {}
        });
      });
    },
    async cancel() {
      await cleanup();
    },
  });

  async function cleanup() {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    await Promise.allSettled([
      unsubscribeLog?.(),
      unsubscribeTrade?.(),
    ]);
    unsubscribeLog = null;
    unsubscribeTrade = null;
  }

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
