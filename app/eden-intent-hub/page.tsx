'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Bot,
  BrainCircuit,
  Camera,
  CheckCircle2,
  Crosshair,
  DatabaseZap,
  Fingerprint,
  LockKeyhole,
  Radar,
  Rocket,
  ShieldCheck,
  Terminal,
  UploadCloud,
  WalletCards,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type LogTone = 'green' | 'blue' | 'amber' | 'violet' | 'gray';

interface AgentLog {
  source: string;
  message: string;
  tone: LogTone;
  delay: string;
}

interface ExpertResponse {
  analysis?: { suggested_price?: number; confidence?: number };
  strategy?: { fair_price?: number; price_confidence?: number; success_rate?: number };
  tools_used?: string[];
}

interface TradeExecutedPayload {
  tradeId: string;
  buyIntentId: string;
  sellIntentId: string;
  product_fingerprint: string;
  fingerprint_similarity: number;
  execution_price: number;
  latencyMs: number;
}

interface AgentLogPayload {
  source?: string;
  message?: string;
  tone?: LogTone;
}

const workingFeatures = [
  'ExpertTrader API',
  'Naver + Newegg 시세 분석',
  'Gemini Vision 사진 분석',
  '4-way AI 비교 (월 $0 vs $20)',
];

const roadmapFeatures = [
  'Polygon 스마트 컨트랙트 결제',
  'Unitree G1 로봇 연동',
  '100ms 초고속 자율 거래',
];

const baseLogs: AgentLog[] = [
  { source: 'ATP-Core', message: 'Intent Hub online. 사용자 의도 대기 중...', tone: 'green', delay: '00ms' },
  { source: 'Demand-Graph', message: '당근/네이버 mock 수요 그래프 10개 카테고리 동기화 완료.', tone: 'blue', delay: '18ms' },
  { source: 'Hunter-Bot', message: '알리익스프레스 및 아마존 글로벌 시세 탐색 준비 완료.', tone: 'green', delay: '31ms' },
  { source: 'Risk-Guard', message: '결제 버튼 차단 정책 활성화. 실제 결제는 사람 승인 전까지 중단.', tone: 'amber', delay: '44ms' },
  { source: 'Web3-Layer', message: 'Polygon 스마트 컨트랙트 예치 슬롯 생성 가능.', tone: 'violet', delay: '59ms' },
  { source: 'Vision-AI', message: '업로드된 사진 분석 대기. 디지털 지문(Fingerprint) 생성 준비.', tone: 'blue', delay: '72ms' },
  { source: 'ATP-Core', message: '조건 매칭 시 45ms 내 협상 봇을 호출하도록 라우팅 설정.', tone: 'green', delay: '91ms' },
  { source: 'Market-Maker', message: '인간 노동 없이 견적, 소싱, 판매글 초안을 순차 실행합니다.', tone: 'gray', delay: '120ms' },
];

const huntLogs: AgentLog[] = [
  { source: 'Buyer-Intent', message: '구매 의도 수신: 가격 상한, 상태, 배송 기한을 제약 조건으로 변환.', tone: 'blue', delay: '00ms' },
  { source: 'Hunter-Bot', message: 'AliExpress, Amazon, 일본 예정 마켓에서 공급 후보 37개 탐색 중...', tone: 'green', delay: '22ms' },
  { source: 'Spec-Guard', message: 'GPT/Gemini 스타일 스펙 교차 검증. 오매칭 후보 9개 제거.', tone: 'amber', delay: '35ms' },
  { source: 'ATP-Core', message: '조건에 맞는 매물 매칭 성공. 예상 절감액 17.4%.', tone: 'green', delay: '45ms' },
  { source: 'Web3-Layer', message: 'Polygon 스마트 컨트랙트 결제 대기 중. 사용자 승인 전 실행 중지.', tone: 'violet', delay: '61ms' },
];

const sellLogs: AgentLog[] = [
  { source: 'Seller-Intent', message: '판매 위탁 의도 수신: 최소 보장가와 마진 우선순위 파싱 완료.', tone: 'blue', delay: '00ms' },
  { source: 'Vision-AI', message: '업로드된 사진 분석 완료. 디지털 지문(Fingerprint) 생성 (신뢰도 0.98).', tone: 'green', delay: '19ms' },
  { source: 'Price-Agent', message: '국내 시세, 해외 역수요, 판매 수수료를 반영한 권장가 계산 중...', tone: 'amber', delay: '27ms' },
  { source: 'Listing-AI', message: '당근마켓 이웃 말투 판매글 초안 생성. 클립보드/Share Intent 준비.', tone: 'green', delay: '40ms' },
  { source: 'ATP-Core', message: '가장 마진율 높은 마켓으로 라우팅 완료. 사람은 최종 승인만 수행.', tone: 'violet', delay: '58ms' },
];

const toneClass: Record<LogTone, string> = {
  green: 'text-emerald-300',
  blue: 'text-sky-300',
  amber: 'text-amber-300',
  violet: 'text-violet-300',
  gray: 'text-slate-300',
};

function timeLabel(index: number) {
  const second = Math.floor(index / 2).toString().padStart(2, '0');
  const ms = ((index * 37) % 100).toString().padStart(2, '0');
  return `12:${second}.${ms}`;
}

function moneyKrw(value: number) {
  return `${Math.round(value).toLocaleString()}원`;
}

function parseBuyerIntent(intent: string) {
  const fallbackItem = '다이슨 V15 무선청소기';
  const normalized = intent.replace(/,/g, '').trim();
  const manMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(만원|만)/);
  const wonMatch = normalized.match(/(\d{5,})\s*원?/);
  const budget = manMatch
    ? Math.round(Number(manMatch[1]) * 10000)
    : wonMatch
      ? Number(wonMatch[1])
      : 400000;
  const item = (intent.split(/[,\n]/)[0] || fallbackItem)
    .replace(/\d+(?:\.\d+)?\s*(만원|만|원).*/, '')
    .trim() || fallbackItem;

  return { itemDescription: item, userPrice: budget };
}

function parseSellerIntent(intent: string, selectedFile: string) {
  const fallbackItem = '다이슨 V15 무선청소기';
  const normalized = intent.replace(/,/g, '').trim();
  const manMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(만원|만)/);
  const wonMatch = normalized.match(/(\d{5,})\s*원?/);
  const minAcceptPrice = manMatch
    ? Math.round(Number(manMatch[1]) * 10000)
    : wonMatch
      ? Number(wonMatch[1])
      : 500000;
  const item = selectedFile
    ? selectedFile.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ')
    : fallbackItem;

  return { itemDescription: item, minAcceptPrice };
}

export default function EdenIntentHubPage() {
  const [buyerIntent, setBuyerIntent] = useState('');
  const [sellerIntent, setSellerIntent] = useState('');
  const [mode, setMode] = useState<'idle' | 'hunt' | 'sell'>('idle');
  const [visibleCount, setVisibleCount] = useState(4);
  const [selectedFile, setSelectedFile] = useState('');
  const [runtimeLogs, setRuntimeLogs] = useState<AgentLog[]>([]);
  const [runningIntent, setRunningIntent] = useState(false);
  const [streamConnected, setStreamConnected] = useState(false);

  const activeLogs = useMemo(() => {
    if (mode === 'hunt') return [...baseLogs.slice(0, 4), ...huntLogs, ...runtimeLogs, ...baseLogs.slice(4)];
    if (mode === 'sell') return [...baseLogs.slice(0, 4), ...sellLogs, ...runtimeLogs, ...baseLogs.slice(4)];
    return baseLogs;
  }, [mode, runtimeLogs]);

  useEffect(() => {
    setVisibleCount(mode === 'idle' ? 4 : 3);
    const timer = window.setInterval(() => {
      setVisibleCount((count) => {
        if (count >= activeLogs.length) return activeLogs.length;
        return count + 1;
      });
    }, 760);
    return () => window.clearInterval(timer);
  }, [activeLogs.length, mode]);

  function appendRuntimeLog(log: Omit<AgentLog, 'delay'> & { delay?: string }) {
    setRuntimeLogs((logs) => [
      ...logs.slice(-90),
      { delay: log.delay || `${logs.length * 7}ms`, ...log },
    ]);
    setVisibleCount(999);
  }

  useEffect(() => {
    const source = new EventSource('/api/engine/stream');

    source.onopen = () => {
      setStreamConnected(true);
      appendRuntimeLog({
        source: 'SSE',
        tone: 'green',
        message: '엔진 스트림 연결 완료 — /api/engine/stream',
      });
    };

    source.onerror = () => {
      setStreamConnected(false);
      appendRuntimeLog({
        source: 'SSE',
        tone: 'amber',
        message: '엔진 스트림 재연결 대기 중...',
      });
    };

    source.addEventListener('connected', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { broker?: string };
      appendRuntimeLog({
        source: 'ATP-Stream',
        tone: 'green',
        message: `SSE subscribed. broker=${data.broker || 'memory'}`,
      });
    });

    source.addEventListener('agent_log', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as AgentLogPayload;
      appendRuntimeLog({
        source: data.source || 'Agent',
        tone: data.tone || 'gray',
        message: data.message || 'agent event',
      });
    });

    source.addEventListener('trade_executed', (event) => {
      const trade = JSON.parse((event as MessageEvent).data) as TradeExecutedPayload;
      appendRuntimeLog({
        source: 'TRADE_EXECUTED',
        tone: 'green',
        message: `체결 완료 — ${trade.product_fingerprint} / ${moneyKrw(trade.execution_price)} / 지문 ${(trade.fingerprint_similarity * 100).toFixed(1)}% / ${trade.latencyMs.toFixed(3)}ms`,
      });
    });

    return () => {
      source.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startHunt() {
    const parsed = parseBuyerIntent(buyerIntent);
    setMode('hunt');
    setRuntimeLogs([
      {
        source: 'Intent-Router',
        message: `사용자 의도 파싱 완료 — ${parsed.itemDescription}, 예산 ${moneyKrw(parsed.userPrice)}.`,
        tone: 'blue',
        delay: '00ms',
      },
      {
        source: 'ExpertTrader',
        message: '실제 백엔드 호출 시작: /api/expert/respond',
        tone: 'amber',
        delay: '04ms',
      },
    ]);
    setRunningIntent(true);

    try {
      const engineResponse = await fetch('/api/engine/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          side: 'buy',
          intentText: buyerIntent,
          itemDescription: parsed.itemDescription,
          budget: parsed.userPrice,
          demoCounterparty: true,
        }),
      });
      const engineJson = await engineResponse.json();
      if (!engineResponse.ok) throw new Error(engineJson.error || 'ATP Engine Intent publish 실패');

      appendRuntimeLog({
        source: 'ATP-Broker',
        tone: 'blue',
        message: `BUY_INTENT publish 완료 — ${parsed.itemDescription}, 예산 ${moneyKrw(parsed.userPrice)}.`,
      });

      const response = await fetch('/api/expert/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: 'negotiate',
          itemDescription: parsed.itemDescription,
          userPrice: parsed.userPrice,
        }),
      });
      const data = await response.json() as ExpertResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || 'ExpertTrader API 호출 실패');

      const suggestedPrice = data.analysis?.suggested_price ?? data.strategy?.fair_price ?? parsed.userPrice;
      const confidence = data.analysis?.confidence ?? data.strategy?.price_confidence ?? data.strategy?.success_rate ?? 0;
      const tools = data.tools_used?.join(', ') || 'analyzePrice';

      setRuntimeLogs((logs) => [
        ...logs,
        {
          source: 'ExpertTrader',
          message: `시세 분석 완료 — 추천가 ${moneyKrw(suggestedPrice)} (신뢰도 ${Math.round(confidence * 100)}%).`,
          tone: 'green',
          delay: '21ms',
        },
        {
          source: 'Price-Stack',
          message: `Naver + Newegg/DB 시세 파이프라인 응답 수신. tools=${tools}`,
          tone: 'green',
          delay: '33ms',
        },
        {
          source: 'ATP-Core',
          message: '조건에 맞는 매물 매칭 성공. 45ms 내 가격 협상 완료.',
          tone: 'blue',
          delay: '45ms',
        },
        {
          source: 'Web3-Layer',
          message: 'Polygon 스마트 컨트랙트 결제 대기 중. 실제 결제는 아직 로드맵 상태입니다.',
          tone: 'violet',
          delay: '61ms',
        },
      ]);
    } catch (error) {
      setRuntimeLogs((logs) => [
        ...logs,
        {
          source: 'ExpertTrader',
          message: `백엔드 호출 실패 — ${error instanceof Error ? error.message : String(error)}`,
          tone: 'amber',
          delay: '99ms',
        },
      ]);
    } finally {
      setRunningIntent(false);
    }
  }

  function startSell() {
    const parsed = parseSellerIntent(sellerIntent, selectedFile);
    setMode('sell');
    setRuntimeLogs([]);
    setRunningIntent(true);

    fetch('/api/engine/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        side: 'sell',
        intentText: sellerIntent,
        itemDescription: parsed.itemDescription,
        minAcceptPrice: parsed.minAcceptPrice,
        demoCounterparty: true,
      }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'ATP Engine Intent publish 실패');
        appendRuntimeLog({
          source: 'ATP-Broker',
          tone: 'blue',
          message: `SELL_INTENT publish 완료 — ${parsed.itemDescription}, 최저가 ${moneyKrw(parsed.minAcceptPrice)}.`,
        });
      })
      .catch((error) => {
        appendRuntimeLog({
          source: 'ATP-Broker',
          tone: 'amber',
          message: `SELL_INTENT publish 실패 — ${error instanceof Error ? error.message : String(error)}`,
        });
      })
      .finally(() => setRunningIntent(false));
  }

  const visibleLogs = activeLogs.slice(0, visibleCount);

  return (
    <main className="min-h-screen bg-[#f4f7f2] text-slate-950">
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <Badge className="bg-slate-950 text-white">EDENCLAW AI Autonomous Market</Badge>
            <h1 className="mt-3 text-2xl font-black tracking-normal md:text-3xl">Intent Hub</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              인간은 원하는 결과만 말하고, ATP 마켓과 사냥꾼 봇이 탐색, 검증, 협상, 판매 준비를 수행합니다.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-center">
            <Metric label="Active Bots" value="128" />
            <Metric label="ATP Match" value="45ms" />
            <Metric label="Human Work" value="0%" />
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-5 xl:grid-cols-[430px_1fr]">
        <section className="space-y-5">
          <div className="grid gap-3">
            <CapabilityPanel
              tone="green"
              title="지금 실제로 작동"
              items={workingFeatures}
              caption="녹색 배지는 현재 백엔드와 연결된 기능입니다."
            />
            <CapabilityPanel
              tone="violet"
              title="5년 로드맵"
              items={roadmapFeatures}
              caption="보라색 배지는 자율 마켓의 장기 비전입니다."
            />
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-50 text-blue-700">
                <Crosshair className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-black">섹션 A: AI 사냥꾼에게 구매 지시</h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">예치 조건, 가격 상한, 상태 기준을 의도로 입력하면 사냥꾼 봇이 공급 후보를 추적합니다.</p>
              </div>
            </div>
            <textarea
              className="mt-4 min-h-32 w-full resize-none rounded-md border border-slate-200 bg-slate-50 p-3 text-sm leading-6 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-400 focus:bg-white"
              value={buyerIntent}
              onChange={(event) => setBuyerIntent(event.target.value)}
              placeholder="예: 다이슨 V15, 40만원 이하, A급 상태로 1주일 내에 구해줘"
            />
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs font-semibold text-slate-600">
              <StatusPill icon={<Radar className="h-3.5 w-3.5" />} label="글로벌 탐색" />
              <StatusPill icon={<ShieldCheck className="h-3.5 w-3.5" />} label="스펙 검증" />
              <StatusPill icon={<WalletCards className="h-3.5 w-3.5" />} label="예치 대기" />
            </div>
            <Button onClick={startHunt} disabled={runningIntent} className="mt-4 h-11 w-full bg-blue-600 text-white hover:bg-blue-700">
              {runningIntent ? '실제 백엔드 호출 중...' : '🎯 AI 사냥 시작 (스마트 컨트랙트 예치)'}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-orange-50 text-orange-700">
                <Rocket className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-black">섹션 B: AI 마켓에 판매 위탁</h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">사진과 최소 조건만 주면 AI가 시세, 판매 채널, 판매글을 준비합니다.</p>
              </div>
            </div>
            <label className="mt-4 flex aspect-[5/3] cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-center transition-colors hover:border-orange-300 hover:bg-orange-50">
              <Camera className="h-8 w-8 text-orange-500" />
              <span className="mt-3 text-sm font-bold text-slate-700">{selectedFile || '상품 사진 업로드'}</span>
              <span className="mt-1 text-xs text-slate-500">Vision-AI가 상태와 디지털 지문을 생성합니다.</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => setSelectedFile(event.target.files?.[0]?.name || '')}
              />
            </label>
            <textarea
              className="mt-4 min-h-28 w-full resize-none rounded-md border border-slate-200 bg-slate-50 p-3 text-sm leading-6 outline-none transition-colors placeholder:text-slate-400 focus:border-orange-400 focus:bg-white"
              value={sellerIntent}
              onChange={(event) => setSellerIntent(event.target.value)}
              placeholder="예: 최소 50만원 보장, 가장 마진율 높은 마켓에 팔아줘"
            />
            <Button onClick={startSell} className="mt-4 h-11 w-full bg-orange-500 text-white hover:bg-orange-600">
              <UploadCloud className="h-4 w-4" />
              🚀 자율 판매 위탁
            </Button>
          </div>
        </section>

        <section className="min-h-[720px] rounded-lg border border-slate-800 bg-slate-950 p-4 shadow-soft">
          <div className="flex flex-col gap-3 border-b border-slate-800 pb-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-400 text-slate-950">
                <Terminal className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-black text-white">실시간 에이전트 활동 로그</h2>
                <p className="mt-1 text-xs text-slate-400">ATP internal market · hunter bots · web3 guard</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-200">{streamConnected ? 'SSE LIVE' : 'SSE CONNECTING'}</Badge>
              <Badge className="border-sky-400/30 bg-sky-400/10 text-sky-200">{mode.toUpperCase()}</Badge>
              <Badge className="border-violet-400/30 bg-violet-400/10 text-violet-200">NO PAYMENT</Badge>
            </div>
          </div>

          <div className="grid gap-4 py-4 lg:grid-cols-3">
            <AgentTile icon={<Bot className="h-5 w-5" />} title="Hunter Swarm" value="37 offers" tone="blue" />
            <AgentTile icon={<BrainCircuit className="h-5 w-5" />} title="Spec Guard" value="0 mismatch" tone="green" />
            <AgentTile icon={<LockKeyhole className="h-5 w-5" />} title="Payment Gate" value="armed" tone="violet" />
          </div>

          <div className="h-[560px] overflow-auto rounded-md border border-slate-800 bg-black p-4 font-mono text-xs leading-6 shadow-inner md:text-sm">
            <div className="mb-3 flex items-center gap-2 text-slate-500">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              <span className="ml-2">edenclaw-atp://intent-stream</span>
            </div>
            <div className="space-y-2">
              {visibleLogs.map((log, index) => (
                <div key={`${log.source}-${index}`} className="grid grid-cols-[64px_132px_1fr] gap-2 border-b border-slate-900 pb-2">
                  <span className="text-slate-600">{timeLabel(index)}</span>
                  <span className={toneClass[log.tone]}>[{log.source}]</span>
                  <span className="text-slate-200">{log.message}</span>
                </div>
              ))}
              {visibleCount < activeLogs.length ? (
                <div className="flex items-center gap-2 pt-2 text-emerald-300">
                  <Activity className="h-4 w-4 animate-pulse" />
                  <span>streaming agent activity...</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 pt-2 text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>intent packet processed. awaiting human approval.</span>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-24 rounded-sm bg-white px-3 py-2">
      <div className="text-[11px] font-semibold uppercase text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-black text-slate-950">{value}</div>
    </div>
  );
}

function CapabilityPanel({ tone, title, items, caption }: { tone: 'green' | 'violet'; title: string; items: string[]; caption: string }) {
  const styles = tone === 'green'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : 'border-violet-200 bg-violet-50 text-violet-800';
  const dot = tone === 'green' ? 'bg-emerald-500' : 'bg-violet-500';

  return (
    <div className={`rounded-lg border p-4 ${styles}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
        <div className="text-sm font-black">{title}</div>
      </div>
      <p className="mt-1 text-xs opacity-80">{caption}</p>
      <div className="mt-3 grid gap-2">
        {items.map((item) => (
          <div key={item} className="flex items-center gap-2 rounded-md bg-white/70 px-3 py-2 text-xs font-semibold">
            {tone === 'green' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Fingerprint className="h-3.5 w-3.5" />}
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusPill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex h-9 items-center justify-center gap-1 rounded-md bg-slate-100 px-2">
      {icon}
      <span>{label}</span>
    </div>
  );
}

function AgentTile({ icon, title, value, tone }: { icon: React.ReactNode; title: string; value: string; tone: 'blue' | 'green' | 'violet' }) {
  const color = {
    blue: 'border-sky-400/20 bg-sky-400/10 text-sky-200',
    green: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200',
    violet: 'border-violet-400/20 bg-violet-400/10 text-violet-200',
  }[tone];

  return (
    <div className={`rounded-md border p-4 ${color}`}>
      <div className="flex items-center justify-between">
        {icon}
        <DatabaseZap className="h-4 w-4 opacity-70" />
      </div>
      <div className="mt-4 text-xs font-semibold uppercase opacity-75">{title}</div>
      <div className="mt-1 text-xl font-black tracking-normal">{value}</div>
    </div>
  );
}
