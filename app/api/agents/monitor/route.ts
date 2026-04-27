import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

const VLLM_URL = process.env.LOCAL_AI_URL || 'http://localhost:8000/v1/chat/completions';
const AI_MODEL = process.env.LOCAL_AI_MODEL || 'Qwen/Qwen2.5-72B-Instruct';

// 모니터 등록
export async function POST(req: NextRequest) {
  const { agentSlug, userId, condition, prompt } = await req.json();
  if (!agentSlug || !userId || !condition || !prompt)
    return NextResponse.json({ error: 'agentSlug, userId, condition, prompt required' }, { status: 400 });

  const monitor = await prisma.monitor.create({
    data: { agentSlug, userId, condition, prompt, isActive: true },
  });
  return NextResponse.json({ monitor });
}

// 모니터 목록 조회
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');
  const monitors = await prisma.monitor.findMany({
    where: { ...(userId ? { userId } : {}), isActive: true },
    include: { agent: { select: { name: true, icon: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ monitors });
}

// 모니터 체크 실행 (내부 cron에서 호출)
export async function PATCH(req: NextRequest) {
  const { secret } = await req.json();
  if (secret !== process.env.ADMIN_SECRET)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const monitors = await prisma.monitor.findMany({ where: { isActive: true, triggered: false } });
  const results: string[] = [];

  for (const m of monitors) {
    try {
      // BTC 가격 조건 예시: "BTC > 80000"
      let conditionMet = false;
      if (m.condition.includes('BTC')) {
        const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
        const d = await r.json();
        const price = parseFloat(d.price);
        if (m.condition.includes('>')) {
          const threshold = parseFloat(m.condition.split('>')[1].trim());
          conditionMet = price > threshold;
        } else if (m.condition.includes('<')) {
          const threshold = parseFloat(m.condition.split('<')[1].trim());
          conditionMet = price < threshold;
        }
      }

      if (conditionMet) {
        // AI 분석 실행
        const aiRes = await fetch(VLLM_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: AI_MODEL,
            messages: [{ role: 'user', content: m.prompt }],
            max_tokens: 1024,
          }),
        });
        const aiData = await aiRes.json();
        const analysis = aiData.choices?.[0]?.message?.content || '';

        await prisma.monitor.update({ where: { id: m.id }, data: { triggered: true, lastCheck: new Date() } });
        results.push(`[TRIGGERED] ${m.id}: ${analysis.slice(0, 100)}`);
      } else {
        await prisma.monitor.update({ where: { id: m.id }, data: { lastCheck: new Date() } });
        results.push(`[OK] ${m.id}: condition not met`);
      }
    } catch (e) {
      results.push(`[ERROR] ${m.id}: ${String(e)}`);
    }
  }

  return NextResponse.json({ checked: monitors.length, results });
}
