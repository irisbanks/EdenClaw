// 시장 오케스트레이터 — 500봇 압축 하루 시뮬레이션
'use strict';

import { MarketBot, Listing, BotCapability, BotPersona, getActiveLLMCalls } from './agent';
import { prisma } from '@/lib/prisma';

const CONCURRENT_NEGOTIATIONS = 100; // 동시 협상 수
const GPU_CHECK_INTERVAL_MS   = 5000;

export interface MarketEvent {
  type:     'boot' | 'search' | 'market_open' | 'negotiate' | 'deal' | 'groupbuy' | 'refer' | 'market_close' | 'stats' | 'error' | 'done';
  botId?:   string;
  botName?: string;
  keyword?: string;
  detail?:  string;
  price?:   number;
  count?:   number;
  stats?:   DayReport;
  ts:       number;
}

export interface DayReport {
  totalBots:     number;
  activeBots:    number;
  totalDeals:    number;
  failedDeals:   number;
  totalRevenue:  number;
  marketsFormed: number;
  groupBuys:     number;
  referralCount: number;
  avgLLMMs:      number;
  failRate:      number;
  topMarkets:    { keyword: string; deals: number; revenue: number }[];
  topBots:       { name: string; earnings: number; deals: number }[];
  llmStats:      { calls: number; avgMs: number; p95Ms: number; failRate: number };
}

// LLM 성능 측정
const llmTimings: number[] = [];

export function recordLLMTiming(ms: number) {
  llmTimings.push(ms);
  if (llmTimings.length > 500) llmTimings.shift();
}

export function getLLMStats() {
  if (!llmTimings.length) return { calls: 0, avgMs: 0, p95Ms: 0, failRate: 0 };
  const sorted = llmTimings.slice().sort((a, b) => a - b);
  const avg    = Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length);
  const p95    = sorted[Math.floor(sorted.length * 0.95)] ?? avg;
  const fails  = llmTimings.filter(t => t >= 4900).length;
  return { calls: llmTimings.length, avgMs: avg, p95Ms: p95, failRate: Math.round(fails / llmTimings.length * 100) };
}

const SEARCH_KEYWORDS = [
  '감자', '사과', '노트북', '이어폰', '운동화', '청바지', '비타민', '유아식기', '충전기', '코트',
  '요가매트', '홍삼', '소고기', '맥북', '볼펜', '냉장고', '세탁기', '아이패드', '키보드', '마우스',
  'SSD', '웹캠', '스마트워치', '에어프라이어', '청소기', '감귤', '배추', '쌀', '전복', '고등어',
  '패딩', '오메가', '유산균', '단백질', '콜라겐', '이유식', '물티슈', '블록', '카시트', '색연필',
  '만년필', '포스트잇', '화이트보드', '오리고기', '멸치', '캐시미어', '덤벨', '루테인', '마그네슘', '홍어',
  '옥수수', '전기밥솥', '공기청정기', '에어맥스', '크로스백',
];

export class MarketOrchestrator {
  bots:       MarketBot[] = [];
  report:     DayReport   = { totalBots: 0, activeBots: 0, totalDeals: 0, failedDeals: 0, totalRevenue: 0, marketsFormed: 0, groupBuys: 0, referralCount: 0, avgLLMMs: 0, failRate: 0, topMarkets: [], topBots: [], llmStats: { calls: 0, avgMs: 0, p95Ms: 0, failRate: 0 } };
  private marketStats = new Map<string, { deals: number; revenue: number }>();

  loadBots(bots: MarketBot[]) {
    this.bots = bots;
    this.report.totalBots = bots.length;
  }

  // 24시간 → 30분 압축 시뮬 (5000봇 스케일)
  async *runDayCompressed(): AsyncGenerator<MarketEvent> {
    const scale = this.bots.length >= 3000 ? '5000봇' : '500봇';
    const waves = this.bots.length >= 3000 ? 50 : 30;
    console.log(`[Orchestrator] 압축 하루 시뮬 시작 — ${this.bots.length}봇 (${scale} 모드, ${waves}파동)`);

    // 1. 모닝: 봇 기상
    this.bots.forEach(b => { b.status = 'sleeping'; });
    this.report.activeBots = this.bots.length;
    yield { type: 'boot', count: this.bots.length, detail: `${this.bots.length}봇 기상 완료 (${scale} 모드)`, ts: Date.now() };

    // 2. 검색 파동
    const keywords = [...SEARCH_KEYWORDS].sort(() => Math.random() - 0.5).slice(0, waves);
    for (const kw of keywords) {
      // 실패율 5% 초과 시 자동 중단
      const totalTx = this.report.totalDeals + this.report.failedDeals;
      if (totalTx > 50 && this.report.failedDeals / totalTx > 0.05) {
        yield { type: 'error', detail: `실패율 ${Math.round(this.report.failedDeals / totalTx * 100)}% 초과 — 시뮬 자동 중단`, ts: Date.now() };
        break;
      }
      const buyerCount = this.bots.length >= 3000
        ? 50 + Math.floor(Math.random() * 150)
        : 5  + Math.floor(Math.random() * 45);
      yield* this.triggerSearch(kw, buyerCount);
    }

    // 3. 공동구매 라운드
    yield* this.runGroupBuyRound();

    // 4. 다단계 추천 라운드
    yield* this.runReferralRound();

    // 5. 결산
    this.report.llmStats = getLLMStats();
    this.report.failRate  = this.report.totalDeals + this.report.failedDeals > 0
      ? Math.round(this.report.failedDeals / (this.report.totalDeals + this.report.failedDeals) * 100)
      : 0;

    await this.persistResults();
    this.compileFinalStats();

    yield { type: 'done', stats: this.report, detail: `시뮬 완료: ${this.report.totalDeals}건 거래 / ${this.report.marketsFormed}개 시장`, count: this.report.totalDeals, ts: Date.now() };
    console.log('[Orchestrator] 완료', this.report);
  }

  // 검색 발화 → 시장 자동 형성
  async *triggerSearch(keyword: string, buyerCount: number): AsyncGenerator<MarketEvent> {
    const buyers  = this.bots.filter(b => b.capabilities.includes('buy') && b.status === 'sleeping')
      .sort(() => Math.random() - 0.5).slice(0, buyerCount);
    const sellers = this.bots.filter(b => b.capabilities.includes('sell')
      && b.persona.sellingItems.some(it =>
        it.includes(keyword) || keyword.includes(it.slice(0, 2)) ||
        (keyword.length >= 2 && it.includes(keyword.slice(0, 2)))
      )
      && b.status === 'sleeping').slice(0, 30);

    if (!sellers.length) return;

    // 시장 세션 DB 생성
    const session = await prisma.swarmMarketSession.create({
      data: { keyword, participatingBots: JSON.stringify([...buyers, ...sellers].map(b => b.id)) },
    }).catch(() => null);
    if (!session) return;

    this.report.marketsFormed++;
    if (!this.marketStats.has(keyword)) this.marketStats.set(keyword, { deals: 0, revenue: 0 });

    yield { type: 'market_open', keyword, count: buyers.length + sellers.length,
      detail: `"${keyword}" 시장 개장 — 구매봇 ${buyers.length} / 판매봇 ${sellers.length}`, ts: Date.now() };

    // 판매봇 리스팅 생성 (알고리즘 우선, LLM 선택적)
    const listings: Listing[] = [];
    for (const s of sellers) {
      for (const item of s.persona.sellingItems.filter(it => it.includes(keyword) || keyword.includes(it.slice(0, 2))).slice(0, 2)) {
        const t0 = Date.now();
        const listing = await s.createListing(item);
        recordLLMTiming(Date.now() - t0);
        listings.push(listing);
      }
    }

    // 구매봇 탐색 & 협상 (배치)
    const pairs = this.matchPairs(buyers, sellers, listings);
    const batches: typeof pairs[] = [];
    for (let i = 0; i < pairs.length; i += CONCURRENT_NEGOTIATIONS) {
      batches.push(pairs.slice(i, i + CONCURRENT_NEGOTIATIONS));
    }

    for (const batch of batches) {
      const results = await Promise.allSettled(
        batch.map(({ buyer, seller, listing }) => {
          const t0 = Date.now();
          return buyer.negotiate(seller, listing).then(r => {
            recordLLMTiming(Date.now() - t0);
            return { buyer, seller, listing, result: r };
          });
        })
      );

      for (const r of results) {
        if (r.status !== 'fulfilled') continue;
        const { buyer, seller, listing, result } = r.value;
        if (result.agreed) {
          this.report.totalDeals++;
          this.report.totalRevenue += result.finalPrice;
          this.marketStats.get(keyword)!.deals++;
          this.marketStats.get(keyword)!.revenue += result.finalPrice;

          await prisma.swarmTransaction.create({
            data: {
              buyerId:        buyer.id, sellerId: seller.id,
              productInfo:    JSON.stringify({ name: listing.productName, category: listing.category }),
              finalPrice:     result.finalPrice,
              negotiationLog: JSON.stringify(result.log),
              marketKeyword:  keyword, sessionId: session.id, status: 'completed',
            },
          }).catch(() => null);

          yield { type: 'deal', botId: buyer.id, botName: `${buyer.persona.name} → ${seller.persona.name}`, keyword,
            detail: `"${listing.productName}" ${result.finalPrice.toLocaleString()} ET`, price: result.finalPrice, ts: Date.now() };
        } else {
          this.report.failedDeals++;
          yield { type: 'negotiate', botId: buyer.id, botName: buyer.persona.name, keyword,
            detail: result.log[result.log.length - 1], ts: Date.now() };
        }
      }
    }

    // 시장 해체
    const mkt = this.marketStats.get(keyword)!;
    await prisma.swarmMarketSession.update({
      where: { id: session.id },
      data: { endedAt: new Date(), totalTransactions: mkt.deals, totalRevenue: mkt.revenue },
    }).catch(() => null);

    yield { type: 'market_close', keyword, count: mkt.deals, detail: `"${keyword}" 시장 해체 — ${mkt.deals}건`, ts: Date.now() };

    // 봇 상태 초기화
    [...buyers, ...sellers].forEach(b => { if (b.status !== 'groupbuying') b.status = 'sleeping'; });
  }

  // 공동구매 라운드
  async *runGroupBuyRound(): AsyncGenerator<MarketEvent> {
    const gbLimit  = this.bots.length >= 3000 ? 200 : 20;
    const initiators = this.bots.filter(b => b.capabilities.includes('group-buy') && b.persona.sellingItems.length > 0).slice(0, gbLimit);
    const pool       = this.bots.filter(b => b.status === 'sleeping');

    for (const bot of initiators) {
      const item: Listing = {
        productName: bot.persona.sellingItems[0],
        category:    'general',
        askPrice:    bot.persona.budget.min + 5000,
        currency:    'ET',
        description: `공동구매 — ${bot.persona.sellingItems[0]}`,
        sellerBotId: bot.id,
        sellerName:  bot.persona.name,
      };

      const res = await bot.formGroupBuy(item, 5, pool);
      if (res.formed) {
        this.report.groupBuys++;
        const totalRev = res.discountedPrice * res.participants.length;
        this.report.totalDeals  += res.participants.length;
        this.report.totalRevenue += totalRev;

        await prisma.swarmTransaction.create({
          data: {
            buyerId: res.participants[0], sellerId: bot.id,
            productInfo:    JSON.stringify({ name: item.productName, groupBuy: true, count: res.participants.length }),
            finalPrice:     totalRev,
            negotiationLog: JSON.stringify([`공동구매 ${res.participants.length}명 @ ${res.discountedPrice.toLocaleString()} ET`]),
            marketKeyword:  'group-buy', status: 'completed',
          },
        }).catch(() => null);

        yield { type: 'groupbuy', botId: bot.id, botName: bot.persona.name,
          detail: `"${item.productName}" 공동구매 ${res.participants.length}명 / ${res.discountedPrice.toLocaleString()} ET`,
          count: res.participants.length, price: res.discountedPrice, ts: Date.now() };
      }
    }
  }

  // 다단계 추천 라운드
  async *runReferralRound(): AsyncGenerator<MarketEvent> {
    const refLimit  = this.bots.length >= 3000 ? 500 : 50;
    const chainLimit = this.bots.length >= 3000 ? 2000 : 200;
    const referrers = this.bots.filter(b => b.capabilities.includes('recommend')).slice(0, refLimit);
    const chains    = await prisma.botReferralChain.findMany({ take: chainLimit });

    for (const ref of referrers) {
      const myChains = chains.filter(c => c.parentBotId === ref.id).slice(0, 3);
      for (const chain of myChains) {
        const child = this.bots.find(b => b.id === chain.childBotId);
        if (!child) continue;

        const sampleAmt  = 10000 + Math.floor(Math.random() * 90000);
        const commission = ref.refer(child, sampleAmt, chain.level);

        if (commission > 0) {
          this.report.referralCount++;
          await prisma.botReferralChain.update({
            where: { id: chain.id },
            data:  { earnings: { increment: commission } },
          }).catch(() => null);

          yield { type: 'refer', botId: ref.id, botName: ref.persona.name,
            detail: `L${chain.level} 추천 → ${child.persona.name} | 커미션 ${commission.toLocaleString()} ET`,
            price: commission, ts: Date.now() };
        }
      }
    }
  }

  private matchPairs(buyers: MarketBot[], sellers: MarketBot[], listings: Listing[]) {
    const pairs: { buyer: MarketBot; seller: MarketBot; listing: Listing }[] = [];
    const usedSellers = new Set<string>();
    for (const buyer of buyers) {
      const listing = listings.find(l =>
        l.askPrice <= buyer.persona.budget.max && !usedSellers.has(l.sellerBotId)
      );
      if (!listing) continue;
      const seller = sellers.find(s => s.id === listing.sellerBotId);
      if (!seller) continue;
      pairs.push({ buyer, seller, listing });
      usedSellers.add(listing.sellerBotId);
    }
    return pairs;
  }

  private compileFinalStats() {
    this.report.topMarkets = [...this.marketStats.entries()]
      .sort((a, b) => b[1].deals - a[1].deals).slice(0, 10)
      .map(([keyword, s]) => ({ keyword, ...s }));

    this.report.topBots = this.bots
      .filter(b => b.totalEarnings > 0)
      .sort((a, b) => b.totalEarnings - a.totalEarnings).slice(0, 10)
      .map(b => ({ name: b.persona.name, earnings: b.totalEarnings, deals: b.memory.transactions.length }));
  }

  private async persistResults() {
    const changed = this.bots.filter(b => b.totalEarnings > 0 || b.memory.transactions.length > 0);
    await Promise.allSettled(changed.map(b =>
      prisma.swarmBot.update({
        where: { id: b.id },
        data: {
          status: 'sleeping',
          totalEarnings: { increment: b.totalEarnings },
          memory: JSON.stringify(b.memory),
          reputation: { increment: Math.min(b.memory.transactions.length * 0.2, 5) },
        },
      }).catch(() => null)
    ));
  }
}
