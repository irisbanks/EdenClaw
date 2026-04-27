import { NextRequest, NextResponse } from 'next/server';

async function getCandles(symbol: string) {
  const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=100`);
  const data = await r.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data.map((c: any[]) => ({
    open: +c[1], high: +c[2], low: +c[3], close: +c[4], volume: +c[5],
  }));
}

function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - 100 / (1 + rs);
}

function calcEMA(data: number[], p: number): number[] {
  const k = 2 / (p + 1);
  const e = [data[0]];
  for (let i = 1; i < data.length; i++) e.push(data[i] * k + e[i - 1] * (1 - k));
  return e;
}

export async function POST(req: NextRequest) {
  try {
    const { symbol = 'BTCUSDT' } = await req.json();
    const [tickerRes, candles] = await Promise.all([
      fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`).then(r => r.json()),
      getCandles(symbol),
    ]);

    const closes = candles.map((c: { close: number }) => c.close);
    const rsi = calcRSI(closes);
    const ema12 = calcEMA(closes, 12);
    const ema26 = calcEMA(closes, 26);
    const macd = ema12[ema12.length - 1] - ema26[ema26.length - 1];

    let signal = 'HOLD', confidence = 50;
    if (rsi < 35 && macd > 0)      { signal = 'BUY';  confidence = 75; }
    else if (rsi < 30)              { signal = 'BUY';  confidence = 70; }
    else if (rsi > 65 && macd < 0) { signal = 'SELL'; confidence = 75; }
    else if (rsi > 70)              { signal = 'SELL'; confidence = 70; }

    return NextResponse.json({
      symbol,
      price: +tickerRes.lastPrice,
      priceChange24h: +tickerRes.priceChangePercent,
      signal,
      confidence,
      rsi: Math.round(rsi * 100) / 100,
      macd: Math.round(macd * 100) / 100,
      recommendation:
        signal === 'BUY'  ? `매수 추천 (${confidence}%)` :
        signal === 'SELL' ? `매도 추천 (${confidence}%)` : '관망',
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
