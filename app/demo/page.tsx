'use client';

import { type ReactNode, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowRight, BrainCircuit, CheckCircle2, Clock3, DollarSign, Play, ShieldCheck, Sparkles } from 'lucide-react';

type Scenario = {
  id: number;
  intent: 'negotiate' | 'analyze_item';
  userPrice: number;
  itemDescription: string;
  category: string;
};

type ExpertResponse = {
  message?: string;
  intent_detected?: string;
  analysis?: { suggested_price?: number; confidence?: number; reasoning?: string };
  strategy?: { fair_price?: number; price_confidence?: number; success_rate?: number; expected_days?: number };
  tools_used?: string[];
};

type AIResult = {
  agent: string;
  model: string;
  recommendation: string;
  platform: string;
  price: number;
  confidence: number;
  latency_ms: number;
  cost_usd: number;
  metrics: Record<string, number>;
  details: string;
  source: string;
};

type CompareResponse = {
  ok: boolean;
  candidate_count: number;
  comparison: { winner: string; results: AIResult[] };
  expert_price_hint?: { ok?: boolean; price_usd?: number };
};

const scenarios: Scenario[] = [
  { id: 1, intent: 'negotiate', userPrice: 1100000, itemDescription: '갤럭시 S24 Ultra 256GB', category: '전자' },
  { id: 2, intent: 'negotiate', userPrice: 250000, itemDescription: '갤럭시 탭 S6 Lite', category: '전자' },
  { id: 3, intent: 'negotiate', userPrice: 220000, itemDescription: '에어팟 프로 2세대', category: '전자' },
  { id: 4, intent: 'negotiate', userPrice: 1500000, itemDescription: '루이비통 네버풀 MM', category: '명품' },
  { id: 5, intent: 'negotiate', userPrice: 30000, itemDescription: '유니클로 다운 점퍼', category: '의류' },
  { id: 6, intent: 'negotiate', userPrice: 350000, itemDescription: '구찌 에이스 스니커즈', category: '패션' },
  { id: 7, intent: 'negotiate', userPrice: 65000, itemDescription: '랑콤 제니피크 50ml', category: '뷰티' },
  { id: 8, intent: 'negotiate', userPrice: 25000, itemDescription: '아이배냇 이유식 10팩', category: '식품' },
  { id: 9, intent: 'negotiate', userPrice: 80000, itemDescription: '레고 시티 850피스', category: '완구' },
  { id: 10, intent: 'negotiate', userPrice: 120000, itemDescription: '한솔수북 한글이 야호', category: '도서' },
  { id: 11, intent: 'negotiate', userPrice: 800000, itemDescription: '자이언트 로드 자전거', category: '레저' },
  { id: 12, intent: 'negotiate', userPrice: 350000, itemDescription: '타이틀리스트 TSi3 드라이버', category: '스포츠' },
  { id: 13, intent: 'negotiate', userPrice: 700000, itemDescription: '룸바 J7+ 로봇청소기', category: '가전' },
  { id: 14, intent: 'negotiate', userPrice: 600000, itemDescription: '다이슨 V15 무선청소기', category: '가전' },
  { id: 15, intent: 'analyze_item', userPrice: 1300000, itemDescription: '아이폰 15 Pro 256GB', category: '전자' },
  { id: 16, intent: 'analyze_item', userPrice: 700000, itemDescription: '플레이스테이션 5 슬림', category: '게임' },
];

const agentColors: Record<string, string> = {
  'GPT-5.5': '#2563eb',
  Gemini: '#16a34a',
  Claude: '#9333ea',
  'Edenclaw AI': '#f97316',
};

function won(value: number) {
  return `${Math.round(value).toLocaleString()}원`;
}

function money(value: number) {
  return value > 0 ? `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : 'N/A';
}

export default function DemoPage() {
  const [selected, setSelected] = useState<Scenario>(scenarios[0]);
  const [expert, setExpert] = useState<ExpertResponse | null>(null);
  const [compare, setCompare] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const compareResults = compare?.comparison?.results ?? [];
  const chartData = useMemo(() => compareResults.map((item) => ({
    name: item.agent.replace(' AI', ''),
    score: item.metrics.total ?? 0,
    latency: Math.round(item.latency_ms),
    color: agentColors[item.agent] ?? '#64748b',
  })), [compareResults]);

  async function runScenario(item = selected) {
    setSelected(item);
    setLoading(true);
    setError('');
    setExpert(null);
    setCompare(null);
    try {
      const comparePayload = item.intent === 'negotiate'
        ? {
            message: `${item.itemDescription} ${item.userPrice.toLocaleString()}원 협상해줘`,
            scenario: 'negotiate',
            userPrice: item.userPrice,
          }
        : {
            message: `${item.itemDescription} 사고 싶어`,
            scenario: 'buy',
            budget: Math.round(item.userPrice / 1000),
          };
      const [expertRes, compareRes] = await Promise.all([
        fetch('/api/expert/respond', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            intent: item.intent,
            userPrice: item.userPrice,
            itemDescription: item.itemDescription,
          }),
        }),
        fetch('/api/ai-compare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(comparePayload),
        }),
      ]);
      const expertJson = await expertRes.json();
      const compareJson = await compareRes.json();
      if (!expertRes.ok) throw new Error(expertJson.error || 'Expert 실행 실패');
      if (!compareRes.ok || compareJson.ok === false) throw new Error(compareJson.error || '4-way 비교 실패');
      setExpert(expertJson);
      setCompare(compareJson);
    } catch (err) {
      setError(err instanceof Error ? err.message : '시나리오 실행 실패');
    } finally {
      setLoading(false);
    }
  }

  const expertPrice = expert?.analysis?.suggested_price ?? expert?.strategy?.fair_price ?? selected.userPrice;
  const expertConfidence = expert?.analysis?.confidence ?? expert?.strategy?.price_confidence ?? 0;

  return (
    <main className="min-h-screen bg-[#f6f7f4] text-slate-950">
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <Badge className="bg-slate-950 text-white">EDENCLAW AI Engine</Badge>
            <h1 className="mt-3 text-3xl font-black tracking-normal">Investor Live Demo Console</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">16개 준비 시나리오를 원클릭으로 실행하고, ExpertTrader와 4-way AI 비교 결과를 즉시 확인합니다.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/eden-seller-demo"><Button variant="outline">판매자 데모</Button></Link>
            <Link href="/market/ai-compare"><Button variant="outline">AI 비교</Button></Link>
            <Button onClick={() => runScenario()} disabled={loading}>
              <Play className="h-4 w-4" />
              {loading ? '실행 중' : '선택 실행'}
            </Button>
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 xl:grid-cols-[360px_1fr]">
        <aside className="space-y-4">
          <Card className="border-slate-200 bg-white">
            <CardHeader>
              <CardTitle>16개 시나리오</CardTitle>
              <CardDescription>버튼을 누르면 Expert와 4-way 비교를 동시에 실행합니다.</CardDescription>
            </CardHeader>
            <CardContent className="grid max-h-[680px] gap-2 overflow-auto pr-1">
              {scenarios.map((item) => (
                <button
                  key={item.id}
                  onClick={() => runScenario(item)}
                  className={`rounded-md border p-3 text-left transition-colors ${selected.id === item.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-black text-slate-500">#{item.id}</span>
                    <Badge className="bg-slate-100 text-slate-600">{item.category}</Badge>
                  </div>
                  <div className="mt-2 text-sm font-bold">{item.itemDescription}</div>
                  <div className="mt-1 text-xs text-slate-500">{item.intent} · {won(item.userPrice)}</div>
                </button>
              ))}
            </CardContent>
          </Card>
        </aside>

        <section className="space-y-5">
          <Card className="border-slate-200 bg-slate-950 text-white">
            <CardHeader>
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <CardTitle className="text-2xl">{selected.itemDescription}</CardTitle>
                  <CardDescription className="mt-2 text-slate-300">입력가 {won(selected.userPrice)} · {selected.intent}</CardDescription>
                </div>
                {compare && <Badge className="bg-orange-400 text-slate-950">Winner: {compare.comparison.winner}</Badge>}
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-4">
              <HeroMetric icon={<DollarSign className="h-4 w-4" />} label="Expert 기준가" value={won(expertPrice)} />
              <HeroMetric icon={<ShieldCheck className="h-4 w-4" />} label="신뢰도" value={`${Math.round(expertConfidence * 100)}%`} />
              <HeroMetric icon={<BrainCircuit className="h-4 w-4" />} label="AI 후보" value={`${compare?.candidate_count ?? 0}개`} />
              <HeroMetric icon={<Clock3 className="h-4 w-4" />} label="상태" value={loading ? 'RUNNING' : 'READY'} />
            </CardContent>
          </Card>

          {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}

          <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
            <Card className="border-slate-200 bg-white">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-blue-600" />
                  ExpertTrader
                </CardTitle>
                <CardDescription>한국 중고거래 협상/시세 엔진 결과</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {expert ? (
                  <>
                    <div className="rounded-md bg-slate-50 p-4">
                      <div className="text-xs font-semibold uppercase text-slate-500">Tools</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(expert.tools_used ?? []).map((tool) => <Badge key={tool} className="bg-blue-50 text-blue-700">{tool}</Badge>)}
                      </div>
                    </div>
                    <p className="whitespace-pre-line text-sm leading-6 text-slate-700">{expert.message}</p>
                  </>
                ) : (
                  <div className="text-sm leading-6 text-slate-500">시나리오를 실행하면 가격 분석과 협상 전략이 표시됩니다.</div>
                )}
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white">
              <CardHeader>
                <CardTitle>4-way AI Scoreboard</CardTitle>
                <CardDescription>종합 점수와 응답 시간을 함께 확인합니다.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-72 min-h-72">
                  {mounted ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="4 4" vertical={false} />
                      <XAxis dataKey="name" tickLine={false} axisLine={false} />
                      <YAxis domain={[0, 100]} width={38} />
                      <Tooltip />
                      <Bar dataKey="score" radius={[6, 6, 0, 0]}>
                        {chartData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-slate-500">차트 준비 중</div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {compare && (
            <section className="grid gap-4 xl:grid-cols-4">
              {compareResults.map((result) => (
                <Card key={result.agent} className={`border-slate-200 bg-white ${result.agent === compare.comparison.winner ? 'ring-2 ring-orange-400' : ''}`}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle>{result.agent}</CardTitle>
                        <CardDescription className="line-clamp-1">{result.model}</CardDescription>
                      </div>
                      {result.agent === compare.comparison.winner && <CheckCircle2 className="h-5 w-5 text-orange-500" />}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="rounded-md bg-slate-50 p-3">
                        <div className="text-xs text-slate-500">가격</div>
                        <div className="font-black">{money(result.price)}</div>
                      </div>
                      <div className="rounded-md bg-slate-50 p-3">
                        <div className="text-xs text-slate-500">응답</div>
                        <div className="font-black">{Math.round(result.latency_ms)}ms</div>
                      </div>
                    </div>
                    <div className="text-sm font-semibold text-slate-900">{result.platform || '검증 필요'}</div>
                    <p className="line-clamp-5 text-sm leading-6 text-slate-600">{result.recommendation}</p>
                    <div className="flex items-center gap-2 text-xs font-semibold text-blue-700">
                      자세히 보기
                      <ArrowRight className="h-3 w-3" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </section>
          )}
        </section>
      </div>
    </main>
  );
}

function HeroMetric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md bg-white/10 p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-300">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-xl font-black tracking-normal">{value}</div>
    </div>
  );
}
