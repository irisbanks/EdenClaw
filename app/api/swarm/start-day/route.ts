// 하루 시뮬레이션 SSE 스트림
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { MarketBot, BotCapability, BotPersona } from '@/lib/swarm/agent';
import { MarketOrchestrator } from '@/lib/swarm/market-orchestrator';

export async function POST(_req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      try {
        console.log('[API/swarm/start-day] 봇 로딩 시작...');
        send({ type: 'loading', detail: 'DB에서 봇 로딩 중...' });

        // 배치로 봇 로드 (메모리 효율)
        const BOT_LOAD_LIMIT = 5000;
        const rawBots = await prisma.swarmBot.findMany({
          take: BOT_LOAD_LIMIT,
          orderBy: { reputation: 'desc' },
        });

        const bots: MarketBot[] = rawBots.map(raw => {
          const persona = JSON.parse(raw.persona as string) as BotPersona;
          const capabilities = JSON.parse(raw.capabilities as string) as BotCapability[];
          return new MarketBot({
            id: raw.id,
            ownerId: raw.id,
            persona,
            capabilities,
            reputation: raw.reputation,
          });
        });

        send({ type: 'loaded', count: bots.length, detail: `${bots.length}개 봇 로드 완료` });
        console.log(`[API/swarm/start-day] ${bots.length}개 봇 로드`);

        const orchestrator = new MarketOrchestrator();
        orchestrator.loadBots(bots);

        for await (const event of orchestrator.runDayCompressed()) {
          send(event);
        }

        send({
          type: 'complete',
          stats: orchestrator.report,
          detail: '===== EDENCLAW SWARM ALIVE =====',
        });

        console.log('===== EDENCLAW SWARM ALIVE =====');
      } catch (e) {
        const msg = e instanceof Error ? e.message : '시뮬레이션 오류';
        console.error('[API/swarm/start-day] 에러:', msg);
        send({ type: 'error', detail: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
