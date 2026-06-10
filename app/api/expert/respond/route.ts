import { NextRequest, NextResponse } from 'next/server';
import { ExpertTrader } from '@/lib/agents/expert/expert-trader';
import type { TradeContext } from '@/lib/agents/types/trader';

export async function POST(req: NextRequest) {
  try {
    const context: TradeContext = await req.json();

    if (!context.intent) {
      return NextResponse.json({ error: 'intent is required' }, { status: 400 });
    }

    const trader = new ExpertTrader();
    const response = await trader.respond(context);
    return NextResponse.json(response);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json({ error: message, stack }, { status: 500 });
  }
}
