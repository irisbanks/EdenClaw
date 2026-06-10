// 검색 발화 트리거 — 시장 자동 형성
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { MarketBot, BotCapability, BotPersona } from '@/lib/swarm/agent';
import { MarketOrchestrator } from '@/lib/swarm/market-orchestrator';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { keyword?: string; buyerCount?: number };
  const { keyword = '감자', buyerCount = 50 } = body;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      try {
        send({ type: 'start', keyword, buyerCount });

        const rawBots = await prisma.swarmBot.findMany({
          take: Math.min(buyerCount * 4, 1000),
          orderBy: { reputation: 'desc' },
        });

        const bots: MarketBot[] = rawBots.map(raw => new MarketBot({
          id: raw.id,
          ownerId: raw.id,
          persona: JSON.parse(raw.persona as string) as BotPersona,
          capabilities: JSON.parse(raw.capabilities as string) as BotCapability[],
          reputation: raw.reputation,
        }));

        const orchestrator = new MarketOrchestrator();
        orchestrator.loadBots(bots);

        for await (const event of orchestrator.triggerSearch(keyword, Math.min(buyerCount, bots.length))) {
          send(event);
        }

        send({ type: 'done', keyword, deals: orchestrator.report.totalDeals });
      } catch (e) {
        send({ type: 'error', detail: e instanceof Error ? e.message : '오류' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
}
