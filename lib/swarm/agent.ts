// 다목적 마켓봇 — 1봇 = 1인 전자상거래 회사
'use strict';

const VLLM_URL   = process.env.LOCAL_AI_URL   || 'http://localhost:8000/v1/chat/completions';
const AI_MODEL   = process.env.LOCAL_AI_MODEL  || 'Qwen/Qwen2.5-72B-Instruct';
const LLM_TIMEOUT = 7000; // 7초 초과 시 스킵 (안전장치)

export type BotCapability = 'design' | 'sell' | 'buy' | 'negotiate' | 'group-buy' | 'recommend';
export type BotStatus     = 'sleeping' | 'searching' | 'negotiating' | 'trading' | 'groupbuying';

export interface BotPersona {
  name: string;
  age: number;
  region: string;
  interests: string[];
  budget: { min: number; max: number };
  sellingItems: string[];
}

export interface BotMemory {
  transactions:     { productName: string; price: number; role: 'buyer' | 'seller'; ts: number }[];
  learnedPatterns:  string[];
  knownBots:        string[];
  preferredKeywords: string[];
}

export interface Listing {
  productName: string;
  category:    string;
  askPrice:    number;
  currency:    string;
  description: string;
  sellerBotId: string;
  sellerName:  string;
}

export interface NegotiationResult {
  agreed:     boolean;
  finalPrice: number;
  status:     'completed' | 'failed';
  log:        string[];
}

// vLLM 동시 호출 제한 (안전장치: 최대 200)
let _activeLLMCalls = 0;
const MAX_CONCURRENT = 1000;

async function callLLM(system: string, user: string, maxTokens = 200): Promise<string> {
  if (_activeLLMCalls >= MAX_CONCURRENT) return ''; // 큐 폭주 방지
  _activeLLMCalls++;
  try {
    const res = await fetch(VLLM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        max_tokens: maxTokens,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT),
    });
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content?.trim() ?? '';
  } catch {
    return ''; // 타임아웃·에러 → 빈 문자열로 폴백
  } finally {
    _activeLLMCalls--;
  }
}

export function getActiveLLMCalls() { return _activeLLMCalls; }

export class MarketBot {
  id:           string;
  ownerId:      string;
  persona:      BotPersona;
  capabilities: BotCapability[];
  memory:       BotMemory;
  reputation:   number;
  totalEarnings: number;
  status:       BotStatus;

  constructor(params: {
    id: string;
    ownerId?: string;
    persona: BotPersona;
    capabilities: BotCapability[];
    reputation?: number;
    totalEarnings?: number;
  }) {
    this.id           = params.id;
    this.ownerId      = params.ownerId ?? params.id;
    this.persona      = params.persona;
    this.capabilities = params.capabilities;
    this.reputation   = params.reputation ?? 50;
    this.totalEarnings = params.totalEarnings ?? 0;
    this.status       = 'sleeping';
    this.memory       = { transactions: [], learnedPatterns: [], knownBots: [], preferredKeywords: [] };
  }

  // 상황 인식 → 다음 행동 결정 (vLLM 호출)
  async think(context: string): Promise<'buy' | 'sell' | 'idle' | 'groupbuy' | 'refer'> {
    const sys = `당신은 ${this.persona.name}(${this.persona.region}). 관심사: ${this.persona.interests.join(',')}. 판매상품: ${this.persona.sellingItems.join(',') || '없음'}. buy/sell/idle/groupbuy/refer 중 하나만 답변.`;
    const res = await callLLM(sys, context, 8);
    const clean = res.toLowerCase().replace(/[^a-z]/g, '');
    for (const act of ['buy', 'sell', 'idle', 'groupbuy', 'refer'] as const) {
      if (clean.includes(act)) return act;
    }
    return this.persona.sellingItems.length > 0 ? 'sell' : 'buy';
  }

  // Qwen으로 한국어 판매 게시글 생성
  async createListing(itemName: string): Promise<Listing> {
    const price = this.persona.budget.min + Math.floor(Math.random() * (this.persona.budget.max - this.persona.budget.min) * 0.4);
    const sys   = `당신은 ${this.persona.name} 판매자. 매력적인 판매글 1~2문장 한국어로.`;
    const desc  = await callLLM(sys, `"${itemName}" 판매 설명`, 80);
    return {
      productName: itemName,
      category:    this.inferCategory(itemName),
      askPrice:    price,
      currency:    'ET',
      description: desc || `${itemName} — ${this.persona.region}에서 직접 판매합니다.`,
      sellerBotId: this.id,
      sellerName:  this.persona.name,
    };
  }

  // 키워드로 시장 검색
  searchAndBrowse(query: string, listings: Listing[]): Listing[] {
    this.status = 'searching';
    if (!this.memory.preferredKeywords.includes(query)) this.memory.preferredKeywords.push(query);
    const results = listings.filter(l =>
      l.productName.includes(query) || l.category.includes(query) || query.includes(l.productName.slice(0, 2))
    ).sort((a, b) => a.askPrice - b.askPrice);
    return results;
  }

  // 3턴 가격 협상 (양쪽 봇이 각자 vLLM 호출)
  async negotiate(otherBot: MarketBot, item: Listing): Promise<NegotiationResult> {
    this.status      = 'negotiating';
    otherBot.status  = 'negotiating';

    const sellerMin  = Math.floor(item.askPrice * 0.80);
    const myMax      = this.persona.budget.max;
    const log: string[] = [`[협상시작] ${this.persona.name} ↔ ${otherBot.persona.name}: "${item.productName}" (${item.askPrice.toLocaleString()} ET)`];

    let buyerOffer  = Math.floor(Math.min(myMax, item.askPrice * 0.82));
    let sellerPrice = item.askPrice;

    for (let turn = 1; turn <= 3; turn++) {
      // 구매봇 발언 (vLLM, 타임아웃 시 알고리즘 폴백)
      const buySys  = `당신은 구매자 ${this.persona.name}(예산 ${myMax.toLocaleString()} ET). 간단히 가격 협상 (1문장+제시가).`;
      const buyText = await callLLM(buySys, `현재 판매가 ${sellerPrice} ET. ${turn}턴 제시.`, 60);
      const buyNum  = extractLastPrice(buyText) ?? Math.min(myMax, Math.floor(buyerOffer * 1.05));
      buyerOffer    = Math.max(buyerOffer, Math.min(buyNum, myMax));

      // 판매봇 발언
      const selSys  = `당신은 판매자 ${otherBot.persona.name}(최소가 ${sellerMin.toLocaleString()} ET). 간단히 협상 (1문장+제시가).`;
      const selText = await callLLM(selSys, `구매자가 ${buyerOffer} ET 제시. ${turn}턴 응답.`, 60);
      const selNum  = extractLastPrice(selText) ?? Math.max(sellerMin, Math.floor(sellerPrice * 0.96));
      sellerPrice   = Math.max(sellerMin, Math.min(selNum, sellerPrice));

      log.push(`  턴${turn}: ${this.persona.name} ${buyerOffer.toLocaleString()} ET ↔ ${otherBot.persona.name} ${sellerPrice.toLocaleString()} ET`);

      if (buyerOffer >= sellerPrice) break;
    }

    const agreed     = buyerOffer >= sellerMin && buyerOffer <= myMax;
    const finalPrice = agreed ? Math.round((buyerOffer + sellerPrice) / 2) : 0;

    if (agreed) {
      const discount = Math.round((1 - finalPrice / item.askPrice) * 100);
      log.push(`  [합의] ${finalPrice.toLocaleString()} ET (${discount}% 할인)`);
      this.recordTx(item.productName, finalPrice, 'buyer');
      otherBot.recordTx(item.productName, finalPrice, 'seller');
      otherBot.totalEarnings += finalPrice;
      this.status     = 'trading';
      otherBot.status = 'trading';
    } else {
      log.push(`  [결렬] 가격 차이 미해소`);
      this.status     = 'sleeping';
      otherBot.status = 'sleeping';
    }

    return { agreed, finalPrice, status: agreed ? 'completed' : 'failed', log };
  }

  // 공동구매 모집 (같은 상품 원하는 구매봇 수집)
  async formGroupBuy(item: Listing, targetCount: number, pool: MarketBot[]): Promise<{
    formed: boolean; participants: string[]; discountedPrice: number; groupId: string;
  }> {
    this.status = 'groupbuying';
    const interested = pool
      .filter(b => b.id !== this.id && b.capabilities.includes('buy') && b.persona.budget.max >= item.askPrice * 0.75 && b.status === 'sleeping')
      .slice(0, targetCount - 1);

    const participants    = [this.id, ...interested.map(b => b.id)];
    const discountRate    = Math.min(0.05 + participants.length * 0.025, 0.30);
    const discountedPrice = Math.round(item.askPrice * (1 - discountRate));
    const formed          = participants.length >= Math.max(2, Math.floor(targetCount * 0.5));

    interested.forEach(b => { b.status = 'groupbuying'; });
    if (formed) {
      participants.forEach(pid => {
        const bot = pool.find(b => b.id === pid);
        if (bot) { bot.recordTx(item.productName, discountedPrice, 'buyer'); bot.status = 'sleeping'; }
      });
    }

    return { formed, participants, discountedPrice, groupId: `gb_${Date.now()}` };
  }

  // 다단계 추천 (Level 1~4 커미션)
  refer(downstream: MarketBot, txAmount: number, level: number): number {
    const RATES = [0.10, 0.05, 0.03, 0.01];
    const commission = Math.round(txAmount * (RATES[Math.min(level - 1, 3)]));
    this.totalEarnings += commission;
    if (!this.memory.knownBots.includes(downstream.id)) this.memory.knownBots.push(downstream.id);
    return commission;
  }

  recordTx(productName: string, price: number, role: 'buyer' | 'seller') {
    this.memory.transactions.push({ productName, price, role, ts: Date.now() });
    if (this.memory.transactions.length > 30) this.memory.transactions.shift();
  }

  private inferCategory(item: string): string {
    const map: [RegExp, string][] = [
      [/감자|사과|배추|소고기|고등어|쌀|감귤|멸치|전복/, 'food'],
      [/TV|냉장고|세탁기|청소기|밥솥|에어프라이어|로봇/, 'electronics'],
      [/맥북|아이패드|키보드|마우스|SSD|웹캠|이어폰|충전기|스마트워치/, 'IT'],
      [/운동화|패딩|코트|셔츠|재킷|레깅스|가방|지갑/, 'fashion'],
      [/유아|아기|이유식|물티슈|블록|카시트/, 'baby'],
      [/비타민|오메가|홍삼|단백질|유산균|콜라겐|요가매트|덤벨/, 'health'],
      [/노트|볼펜|샤프|색연필|포스트잇|화이트보드/, 'stationery'],
    ];
    for (const [re, cat] of map) if (re.test(item)) return cat;
    return 'general';
  }
}

function extractLastPrice(text: string): number | null {
  if (!text) return null;
  const matches = [...text.matchAll(/(\d[\d,]*)\s*(ET|원|토큰)?/g)];
  if (!matches.length) return null;
  const last = matches[matches.length - 1];
  const n    = parseInt(last[1].replace(/,/g, ''));
  return n > 100 && n < 100_000_000 ? n : null;
}
