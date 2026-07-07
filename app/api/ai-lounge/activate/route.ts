import { activateExternalPremiumBridge } from '@/lib/services/externalPremiumProducts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => controller.enqueue(enc.encode(`${JSON.stringify(event)}\n`));
      try {
        send({
          type: 'init',
          protocol: 'edenclaw-ndjson-v2',
          mode: 'ai-lounge-activation',
          stages: [
            { idx: 0, label: 'Premium Link', agent: 'External AI Subscription Router' },
            { idx: 1, label: 'Enterprise Session', agent: 'Gemini/OpenAI Bridge' },
          ],
        });

        if (!email) {
          send({
            type: 'stage',
            stage: 0,
            label: 'Premium Link',
            agent: 'State Guard',
            status: 'render_crash_prevented',
            note: 'email 이 필요합니다.',
          });
          send({ type: 'done', status: 'render_crash_prevented', active: false, error: 'email 이 필요합니다.' });
          return;
        }

        send({
          type: 'stage',
          stage: 0,
          label: 'Premium Link',
          agent: 'External AI Subscription Router',
          status: 'start',
          note: '외부 프리미엄 AI 정식 활성화 링크와 테넌트 구독 상태를 검증 중입니다.',
        });

        const access = await activateExternalPremiumBridge(email);
        if (!access.ok) {
          send({
            type: 'stage',
            stage: 0,
            label: 'Premium Link',
            agent: 'State Guard',
            status: access.status,
            note: access.message,
            products: access.products,
          });
          send({
            type: 'done',
            status: access.status,
            active: false,
            products: access.products,
            error: access.message,
          });
          return;
        }

        const sessionLabel = 'Active Enterprise Session (Gemini/OpenAI Bridge Connected)';
        send({
          type: 'stage',
          stage: 1,
          label: 'Enterprise Session',
          agent: 'Gemini/OpenAI Bridge',
          status: 'active_enterprise_session',
          note: sessionLabel,
          sessionLabel,
          source: access.source,
          product: access.boundProduct,
          quota: access.quota,
        });
        send({
          type: 'done',
          status: 'active_enterprise_session',
          active: true,
          sessionLabel,
          source: access.source,
          product: access.boundProduct,
          quota: access.quota,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        send({
          type: 'stage',
          stage: 0,
          label: 'Crash Guard',
          agent: 'State Guard',
          status: 'render_crash_prevented',
          note: message,
        });
        send({ type: 'done', status: 'render_crash_prevented', active: false, error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
