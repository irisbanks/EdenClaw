import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';

const VLLM_URL = process.env.LOCAL_AI_URL || 'http://localhost:8000/v1/chat/completions';
const AI_MODEL = process.env.LOCAL_AI_MODEL || 'Qwen/Qwen2.5-72B-Instruct';

function sse(data: object) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

async function callAI(prompt: string, maxTokens = 400): Promise<string> {
  try {
    const res = await fetch(VLLM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(12000),
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } catch {
    return '';
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get('q') || '';
  const limit = Math.min(parseInt(searchParams.get('limit') || '8'), 20);

  if (!query.trim()) {
    return new Response('data: {"type":"error","message":"검색어를 입력하세요"}\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(encoder.encode(sse(data)));
      }

      try {
        // Phase 1: 에이전트 등장
        send({ type: 'agent', message: `"${query}" 검색을 시작합니다...` });
        await new Promise(r => setTimeout(r, 300));

        // Phase 2: AI로 검색 의도 분석
        send({ type: 'thinking', message: '구매 의도를 분석하는 중...' });

        const intentPrompt = `사용자 검색어: "${query}"
카테고리 목록: electronics, fashion, food, beauty, sports, books, digital, home, etc
다음 JSON 형식으로만 답변하세요:
{"keywords":["키워드들"],"category":"카테고리 또는 null","minPrice":최소가격또는null,"maxPrice":최대가격또는null,"intent":"purchase|browse|compare|gift","pitch":"판매 에이전트가 고객에게 건네는 1~2문장 한국어 멘트"}`;

        const intentText = await callAI(intentPrompt, 300);
        let intent = { keywords: query.split(' '), category: null as string | null, minPrice: null as number | null, maxPrice: null as number | null, intent: 'browse', pitch: `"${query}" 관련 상품을 찾아드렸어요!` };

        const intentMatch = intentText.match(/\{[\s\S]*\}/);
        if (intentMatch) {
          try { intent = { ...intent, ...JSON.parse(intentMatch[0]) }; } catch {}
        }

        send({ type: 'intent', data: intent });
        send({ type: 'agent', message: intent.pitch });
        await new Promise(r => setTimeout(r, 200));

        // Phase 3: DB 검색
        send({ type: 'thinking', message: '상품 데이터베이스를 검색하는 중...' });

        const where: Record<string, unknown> = { status: 'active' };
        if (intent.category) where.category = intent.category;
        if (intent.minPrice !== null || intent.maxPrice !== null) {
          where.price = {
            ...(intent.minPrice !== null ? { gte: intent.minPrice } : {}),
            ...(intent.maxPrice !== null ? { lte: intent.maxPrice } : {}),
          };
        }

        const kws = intent.keywords.length > 0 ? intent.keywords : [query];
        const orClauses = kws.flatMap(kw => [
          { title: { contains: kw } },
          { description: { contains: kw } },
          { tags: { contains: kw } },
        ]);

        let candidates = await prisma.product.findMany({
          where: { ...where, OR: orClauses },
          orderBy: [{ verifyScore: 'desc' }, { buyCount: 'desc' }],
          take: 30,
          select: {
            id: true, title: true, description: true, price: true, currency: true,
            category: true, sellerName: true, stock: true, verifyScore: true,
            verifyComment: true, buyCount: true, viewCount: true, images: true, tags: true,
          },
        });

        if (candidates.length < 3) {
          candidates = await prisma.product.findMany({
            where: { status: 'active' },
            orderBy: [{ buyCount: 'desc' }],
            take: 20,
            select: {
              id: true, title: true, description: true, price: true, currency: true,
              category: true, sellerName: true, stock: true, verifyScore: true,
              verifyComment: true, buyCount: true, viewCount: true, images: true, tags: true,
            },
          });
        }

        send({ type: 'found', count: candidates.length, message: `${candidates.length}개 후보 상품을 발견했습니다` });
        await new Promise(r => setTimeout(r, 200));

        // Phase 4: AI 랭킹 + 추천 이유 생성
        send({ type: 'thinking', message: 'AI가 최적 상품을 선별하는 중...' });

        const rankPrompt = `검색어: "${query}"
상품 목록:
${candidates.slice(0, 20).map((p, i) => `${i + 1}. [${p.id}] ${p.title} (${p.price}${p.currency}): ${p.description.slice(0, 60)}`).join('\n')}

상위 ${Math.min(limit, candidates.length)}개를 선택하여 JSON 배열로 답변하세요:
[{"id":"상품ID","reason":"추천 이유 한 문장 (왜 이 검색어에 맞는지)","score":90}]`;

        const rankText = await callAI(rankPrompt, 600);
        let ranked: { id: string; reason: string; score: number }[] = [];
        const rankMatch = rankText.match(/\[[\s\S]*\]/);
        if (rankMatch) {
          try { ranked = JSON.parse(rankMatch[0]); } catch {}
        }
        if (ranked.length === 0) {
          ranked = candidates.slice(0, limit).map(p => ({ id: p.id, reason: '검색어와 관련된 상품입니다', score: 70 }));
        }

        // Phase 5: 상품을 하나씩 스트리밍
        const productMap = new Map(candidates.map(p => [p.id, p]));
        let delivered = 0;

        for (const r of ranked) {
          const product = productMap.get(r.id);
          if (!product || delivered >= limit) break;

          await new Promise(res => setTimeout(res, 180));
          send({
            type: 'product',
            product: { ...product, aiReason: r.reason, aiScore: r.score },
            index: delivered,
          });
          delivered++;
        }

        // 랭킹에 없는 것도 채우기
        for (const p of candidates) {
          if (delivered >= limit) break;
          if (!ranked.find(r => r.id === p.id)) {
            await new Promise(res => setTimeout(res, 100));
            send({ type: 'product', product: { ...p, aiReason: '', aiScore: 50 }, index: delivered });
            delivered++;
          }
        }

        // 조회수 증가
        if (delivered > 0) {
          const ids = ranked.slice(0, delivered).map(r => r.id).filter(id => productMap.has(id));
          prisma.product.updateMany({ where: { id: { in: ids } }, data: { viewCount: { increment: 1 } } }).catch(() => {});
        }

        send({ type: 'done', total: delivered, message: `총 ${delivered}개 상품을 찾았습니다` });
      } catch (err) {
        send({ type: 'error', message: String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
