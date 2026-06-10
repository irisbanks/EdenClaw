'use client';

import { type ReactNode, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Activity, BadgeDollarSign, Brain, Clock3, Gauge, ShieldCheck, Sparkles } from 'lucide-react';

type AIResult = {
  agent: string;
  model: string;
  recommendation: string;
  platform: string;
  price: number;
  confidence: number;
  fraud_risk: number;
  latency_ms: number;
  cost_usd: number;
  ok: boolean;
  source: string;
  error?: string;
  metrics: Record<string, number>;
  details: string;
};

type CompareResponse = {
  ok: boolean;
  run_id: number;
  task: { scenario: string; message: string; product_name: string; budget?: number };
  candidate_count: number;
  comparison: {
    winner: string;
    results: AIResult[];
  };
  report_path: string;
};

const scenarioPresets = [
  { label: 'Buy', value: 'buy', prompt: 'iPhone 15 Pro Max 256GB 사고 싶어' },
  { label: 'Sell', value: 'sell', prompt: '내가 가진 iPad Pro 팔고 싶어' },
  { label: 'Negotiate', value: 'negotiate', prompt: 'MacBook Pro 16인치 중고 협상해줘' },
  { label: 'Arbitrage', value: 'arbitrage', prompt: '아이폰 15 Pro 256GB 100달러 예산 차익거래' },
];

const agentColors: Record<string, string> = {
  'GPT-5.5': '#2563eb',
  Gemini: '#16a34a',
  Claude: '#9333ea',
  'Edenclaw AI': '#f97316',
};

function money(value: number) {
  if (!value) return '$0.00';
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function score(value: number | undefined) {
  return typeof value === 'number' ? value.toFixed(1) : '-';
}

export default function AIComparePage() {
  const [message, setMessage] = useState('iPhone 15 Pro Max 256GB 사고 싶어');
  const [scenario, setScenario] = useState('buy');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<CompareResponse | null>(null);
  const [error, setError] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const results = data?.comparison?.results ?? [];
  const winner = useMemo(() => results.find((r) => r.agent === data?.comparison.winner), [data?.comparison.winner, results]);

  const costData = useMemo(() => results.map((item) => ({
    name: item.agent.replace(' AI', ''),
    cost: Number((item.cost_usd * 1000).toFixed(4)),
    color: agentColors[item.agent] ?? '#64748b',
  })), [results]);

  const latencyData = useMemo(() => results.map((item) => ({
    name: item.agent.replace(' AI', ''),
    latency: Math.round(item.latency_ms),
    score: item.metrics.total ?? 0,
  })), [results]);

  async function runCompare(nextScenario = scenario, nextMessage = message) {
    setLoading(true);
    setError('');
    setData(null);
    try {
      const budget = nextScenario === 'arbitrage' ? 100 : undefined;
      const res = await fetch('/api/ai-compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: nextMessage, scenario: nextScenario, budget }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.error || '비교 실행 실패');
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : '비교 실행 실패');
    } finally {
      setLoading(false);
    }
  }

  function applyPreset(value: string) {
    const preset = scenarioPresets.find((item) => item.value === value);
    if (!preset) return;
    setScenario(preset.value);
    setMessage(preset.prompt);
  }

  return (
    <main className="min-h-screen bg-[#f7f8fb] text-slate-950">
      <nav className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-5 px-4">
          <Link href="/market" className="text-sm font-black tracking-normal">EDENCLAW Market</Link>
          <Link href="/market" className="text-sm text-slate-600">홈</Link>
          <Link href="/market/products" className="text-sm text-slate-600">상품</Link>
          <Link href="/market/ai-compare" className="text-sm font-bold text-blue-700">AI 비교</Link>
          <Link href="/demo" className="ml-auto text-sm font-semibold text-slate-700">라이브 데모</Link>
        </div>
      </nav>

      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        <header className="grid gap-4 lg:grid-cols-[1fr_380px]">
          <Card className="border-slate-200 bg-white">
            <CardHeader>
              <Badge className="w-fit bg-blue-50 text-blue-700">4-way AI Router</Badge>
              <CardTitle className="text-2xl">멀티 AI 매매 비교 대시보드</CardTitle>
              <CardDescription>GPT, Gemini, Claude, Edenclaw AI의 추천을 같은 기준에서 비교합니다.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                className="min-h-24 w-full rounded-md border border-slate-300 bg-white p-3 text-sm outline-none focus:border-blue-500"
              />
              <div className="flex flex-wrap items-center gap-2">
                {scenarioPresets.map((preset) => (
                  <Button
                    key={preset.value}
                    type="button"
                    variant={scenario === preset.value ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => applyPreset(preset.value)}
                  >
                    {preset.label}
                  </Button>
                ))}
                <Button onClick={() => runCompare()} disabled={loading || !message.trim()} className="ml-auto">
                  <Sparkles className="h-4 w-4" />
                  {loading ? '비교 중' : '4개 AI 실행'}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-slate-950 text-white">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Brain className="h-5 w-5 text-orange-300" />
                Winner
              </CardTitle>
              <CardDescription className="text-slate-300">속도/비용보다 시장 근접성과 논리성을 더 크게 반영합니다.</CardDescription>
            </CardHeader>
            <CardContent>
              {data ? (
                <div>
                  <div className="text-3xl font-black tracking-normal">{data.comparison.winner}</div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-md bg-white/10 p-3">
                      <div className="text-slate-300">후보</div>
                      <div className="text-xl font-bold">{data.candidate_count}개</div>
                    </div>
                    <div className="rounded-md bg-white/10 p-3">
                      <div className="text-slate-300">점수</div>
                      <div className="text-xl font-bold">{score(winner?.metrics.total)}</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-sm leading-6 text-slate-300">프리셋을 선택하고 실행하면 우승 AI와 비용/속도 지표가 표시됩니다.</div>
              )}
            </CardContent>
          </Card>
        </header>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}

        {data && (
          <>
            <section className="grid gap-4 xl:grid-cols-4">
              {results.map((result) => {
                const isWinner = result.agent === data.comparison.winner;
                return (
                  <Card key={result.agent} className={`border-slate-200 bg-white ${isWinner ? 'ring-2 ring-orange-400' : ''}`}>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <CardTitle className="text-lg">{result.agent}</CardTitle>
                          <CardDescription className="line-clamp-1">{result.model}</CardDescription>
                        </div>
                        {isWinner && <Badge className="bg-orange-50 text-orange-700">WIN</Badge>}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-2">
                        <Metric icon={<BadgeDollarSign className="h-4 w-4" />} label="가격" value={result.price > 0 ? money(result.price) : 'N/A'} />
                        <Metric icon={<Clock3 className="h-4 w-4" />} label="응답" value={`${Math.round(result.latency_ms)}ms`} />
                        <Metric icon={<Gauge className="h-4 w-4" />} label="종합" value={score(result.metrics.total)} />
                        <Metric icon={<ShieldCheck className="h-4 w-4" />} label="회피" value={score(result.metrics.fraud_avoidance)} />
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase text-slate-500">플랫폼</div>
                        <div className="mt-1 min-h-10 text-sm font-semibold text-slate-900">{result.platform || '검증 필요'}</div>
                      </div>
                      <p className="line-clamp-4 text-sm leading-6 text-slate-600">{result.recommendation}</p>
                      {result.error && <div className="rounded-md bg-red-50 p-2 text-xs text-red-700">{result.error}</div>}
                    </CardContent>
                  </Card>
                );
              })}
            </section>

            <section className="grid gap-5 lg:grid-cols-2">
              <Card className="border-slate-200 bg-white">
                <CardHeader>
                  <CardTitle>비용 비교</CardTitle>
                  <CardDescription>1,000회 실행 기준 추정 API 비용입니다. Edenclaw는 자체 vLLM이라 토큰 과금 0원입니다.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-72 min-h-72">
                    {mounted ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={costData}>
                        <CartesianGrid strokeDasharray="4 4" vertical={false} />
                        <XAxis dataKey="name" tickLine={false} axisLine={false} />
                        <YAxis tickFormatter={(value) => `$${value}`} width={46} />
                        <Tooltip formatter={(value) => [`$${Number(value).toFixed(4)}`, '1,000회 비용']} />
                        <Bar dataKey="cost" radius={[6, 6, 0, 0]}>
                          {costData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-slate-500">차트 준비 중</div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-slate-200 bg-white">
                <CardHeader>
                  <CardTitle>응답 시간 비교</CardTitle>
                  <CardDescription>점선은 응답 지연 시간, 실선은 종합 점수입니다.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-72 min-h-72">
                    {mounted ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={latencyData}>
                        <CartesianGrid strokeDasharray="4 4" vertical={false} />
                        <XAxis dataKey="name" tickLine={false} axisLine={false} />
                        <YAxis yAxisId="left" tickFormatter={(value) => `${value}ms`} width={58} />
                        <YAxis yAxisId="right" orientation="right" domain={[0, 100]} width={38} />
                        <Tooltip />
                        <Line yAxisId="left" type="monotone" dataKey="latency" stroke="#64748b" strokeDasharray="6 5" strokeWidth={2} dot={{ r: 4 }} />
                        <Line yAxisId="right" type="monotone" dataKey="score" stroke="#2563eb" strokeWidth={3} dot={{ r: 4 }} />
                      </LineChart>
                    </ResponsiveContainer>
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-slate-500">차트 준비 중</div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </section>

            <Card className="border-slate-200 bg-white">
              <CardHeader>
                <CardTitle>추천 근거 상세</CardTitle>
                <CardDescription>AI별 원문 요약과 리스크 판단을 나란히 검토합니다.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 lg:grid-cols-2">
                {results.map((result) => (
                  <article key={`${result.agent}-details`} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <Activity className="h-4 w-4 text-blue-600" />
                      <strong>{result.agent}</strong>
                      <Badge className="ml-auto bg-white text-slate-600">{result.source}</Badge>
                    </div>
                    <p className="text-sm leading-6 text-slate-700">{result.details}</p>
                  </article>
                ))}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </main>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase text-slate-500">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-base font-black text-slate-950">{value}</div>
    </div>
  );
}
