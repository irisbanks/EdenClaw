import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const VLLM_URL = process.env.LOCAL_AI_URL || 'http://localhost:8000/v1/chat/completions';
const AI_MODEL = process.env.LOCAL_AI_MODEL || 'Qwen/Qwen2.5-72B-Instruct';

interface ParsedIntent {
  keywords: string[];
  category: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  intent: string;
  pitch: string;
}

async function parseQueryWithAI(query: string): Promise<ParsedIntent> {
  const prompt = `당신은 AI 마켓의 판매 에이전트입니다. 사용자의 검색어를 분석하고 JSON으로 답변하세요.

사용자 검색어: "${query}"

가능한 카테고리: electronics, fashion, food, beauty, sports, books, digital, home, etc

다음 JSON 형식으로만 답변하세요 (다른 텍스트 없이):
{
  "keywords": ["핵심 키워드들"],
  "category": "카테고리 또는 null",
  "minPrice": 최소가격(숫자) 또는 null,
  "maxPrice": 최대가격(숫자) 또는 null,
  "intent": "purchase|browse|compare|gift|이 중 하나",
  "pitch": "사용자에게 건넬 짧은 판매 멘트 (1~2문장, 한국어)"
}`;

  try {
    const res = await fetch(VLLM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as ParsedIntent;
  } catch { /* fallback below */ }

  // Fallback: simple keyword extraction
  return {
    keywords: query.split(/\s+/).filter(w => w.length > 1),
    category: null,
    minPrice: null,
    maxPrice: null,
    intent: 'browse',
    pitch: `"${query}" 관련 상품을 찾아드렸어요!`,
  };
}

async function rankWithAI(
  query: string,
  products: { id: string; title: string; description: string; price: number; currency: string }[]
): Promise<{ id: string; reason: string }[]> {
  if (products.length === 0) return [];

  const list = products.slice(0, 20).map((p, i) => `${i + 1}. [${p.id}] ${p.title} (${p.price} ${p.currency}): ${p.description.slice(0, 80)}`).join('\n');

  const prompt = `당신은 AI 마켓 판매 에이전트입니다. 사용자 검색어에 가장 맞는 상품을 추천하고, 각 상품에 짧은 추천 이유를 붙여주세요.

검색어: "${query}"
상품 목록:
${list}

상위 최대 10개를 골라 JSON 배열로 답변하세요:
[{"id":"상품ID","reason":"추천 이유 한 문장"}]`;

  try {
    const res = await fetch(VLLM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 600,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content || '';
    const match = text.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]) as { id: string; reason: string }[];
  } catch { /* fallback */ }

  return products.slice(0, 10).map(p => ({ id: p.id, reason: '검색어와 관련된 상품입니다.' }));
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get('q') || '';
  const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 20);

  if (!query.trim()) {
    return NextResponse.json({ error: '검색어를 입력하세요' }, { status: 400 });
  }

  // 1. AI로 검색 의도 분석
  const intent = await parseQueryWithAI(query);

  // 2. DB에서 후보 상품 조회
  const where: Record<string, unknown> = { status: 'active' };
  if (intent.category) where.category = intent.category;
  if (intent.minPrice !== null || intent.maxPrice !== null) {
    where.price = {
      ...(intent.minPrice !== null ? { gte: intent.minPrice } : {}),
      ...(intent.maxPrice !== null ? { lte: intent.maxPrice } : {}),
    };
  }

  // 키워드로 OR 검색
  const keywordWhere = intent.keywords.length > 0
    ? intent.keywords.map(kw => ({
        OR: [
          { title: { contains: kw } },
          { description: { contains: kw } },
          { tags: { contains: kw } },
        ],
      }))
    : [{ OR: [
        { title: { contains: query } },
        { description: { contains: query } },
      ]}];

  const candidates = await prisma.product.findMany({
    where: {
      ...where,
      AND: [{ OR: keywordWhere.flatMap(w => w.OR) }],
    },
    orderBy: [{ verifyScore: 'desc' }, { buyCount: 'desc' }],
    take: 30,
    select: {
      id: true, title: true, description: true, price: true, currency: true,
      category: true, sellerName: true, stock: true, verifyScore: true,
      verifyComment: true, buyCount: true, viewCount: true, images: true, tags: true,
    },
  });

  // 후보 없으면 전체 상위 상품 fallback
  const pool = candidates.length >= 3 ? candidates : await prisma.product.findMany({
    where: { status: 'active' },
    orderBy: [{ buyCount: 'desc' }, { verifyScore: 'desc' }],
    take: 20,
    select: {
      id: true, title: true, description: true, price: true, currency: true,
      category: true, sellerName: true, stock: true, verifyScore: true,
      verifyComment: true, buyCount: true, viewCount: true, images: true, tags: true,
    },
  });

  // 3. AI 랭킹 + 추천 이유
  const ranked = await rankWithAI(query, pool);

  // 4. 랭킹 순서대로 상품 조립
  const productMap = new Map(pool.map(p => [p.id, p]));
  const results = ranked
    .filter(r => productMap.has(r.id))
    .slice(0, limit)
    .map(r => ({ ...productMap.get(r.id)!, aiReason: r.reason }));

  // 랭킹에 없는 상품도 뒤에 붙이기 (최대 limit까지)
  const rankedIds = new Set(results.map(r => r.id));
  for (const p of pool) {
    if (results.length >= limit) break;
    if (!rankedIds.has(p.id)) {
      results.push({ ...p, aiReason: '' });
    }
  }

  // 조회수 비동기 증가
  if (pool.length > 0) {
    prisma.product.updateMany({
      where: { id: { in: results.map(r => r.id) } },
      data: { viewCount: { increment: 1 } },
    }).catch(() => {});
  }

  return NextResponse.json({
    query,
    intent,
    results,
    total: results.length,
  });
}

export async function POST(req: NextRequest) {
  return GET(new NextRequest(req.url + '?' + new URLSearchParams(await req.json()).toString()));
}
