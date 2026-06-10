'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
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
import { Camera, CheckCircle2, ImagePlus, Loader2, MessageSquareText, ScanLine, Send, Sparkles, Upload } from 'lucide-react';

type AnyRecord = Record<string, unknown>;

interface UploadState {
  draft?: AnyRecord;
  image?: { url?: string };
}

const steps = ['Camera', 'Analyze', 'Price', 'Preview', 'Publish', 'Agent'];

function pickId(obj?: AnyRecord | null) {
  return typeof obj?.id === 'string' ? obj.id : '';
}

function textOf(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function numberOf(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function recordOf(value: unknown): AnyRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as AnyRecord : null;
}

function jsonBlock(data: unknown) {
  return (
    <pre className="max-h-64 overflow-auto rounded-md bg-slate-950 p-3 text-xs leading-relaxed text-slate-200">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

export default function EdenSellerDemoPage() {
  const [file, setFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [analysis, setAnalysis] = useState<AnyRecord | null>(null);
  const [productName, setProductName] = useState('다이슨 V15 무선청소기');
  const [price, setPrice] = useState('50000');
  const [draft, setDraft] = useState<AnyRecord | null>(null);
  const [preview, setPreview] = useState<AnyRecord | null>(null);
  const [listing, setListing] = useState<AnyRecord | null>(null);
  const [session, setSession] = useState<AnyRecord | null>(null);
  const [buyerMessage, setBuyerMessage] = useState('4만원에 가능할까요?');
  const [sellerReply, setSellerReply] = useState<AnyRecord | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // analysis 완료 또는 임시 데이터 세팅 시 AI 초안 자동 생성 트리거
  useEffect(() => {
    if (!analysis || draft || busy) return;
    const extractedName = textOf(
      (analysis as AnyRecord).product_name ?? (analysis as AnyRecord).productName,
      productName || '테스트 상품',
    );
    const extractedPrice = numberOf(
      (analysis as AnyRecord).suggestedPrice ?? (analysis as AnyRecord).suggested_price,
      Number(price) || 10000,
    );
    void generateKarrotDraft(extractedName, extractedPrice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis]);

  const draftId = pickId(upload?.draft);
  const listingId = pickId(listing);
  const imageUrl = upload?.image?.url;
  const suggested = numberOf(analysis?.suggestedPrice ?? analysis?.suggested_price, Number(price) || 50000);

  const priceChart = useMemo(() => {
    const base = suggested || Number(price) || 50000;
    return [
      { name: '저가', value: Math.round(base * 0.82), fill: '#93c5fd' },
      { name: '권장', value: Math.round(base), fill: '#2563eb' },
      { name: '상한', value: Math.round(base * 1.16), fill: '#14b8a6' },
    ];
  }, [price, suggested]);

  const confidenceTrend = useMemo(() => [
    { name: '사진', score: analysis ? 72 : 38 },
    { name: '시세', score: analysis ? 84 : 44 },
    { name: '문구', score: draft ? 91 : 52 },
    { name: '등록', score: listing ? 96 : 58 },
  ], [analysis, draft, listing]);

  async function requestJson(url: string, body: AnyRecord) {
    setBusy(url);
    setError('');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setBusy('');
    if (!res.ok) {
      setError(String(data.error || '요청 실패'));
      throw new Error(String(data.error || '요청 실패'));
    }
    return data;
  }

  async function uploadPhoto() {
    if (!file) return setError('사진을 선택하세요.');
    setBusy('upload');
    setError('');
    const form = new FormData();
    form.append('image', file);
    form.append('userId', 'demo-user');
    const res = await fetch('/api/mobile/photo/upload', { method: 'POST', body: form });
    const data = await res.json();
    setBusy('');
    if (!res.ok) return setError(String(data.error || '업로드 실패'));
    setUpload(data);
    setAnalysis(null);
    setDraft(null);
    setPreview(null);
    setListing(null);
    setSession(null);
    setSellerReply(null);
  }

  async function analyze() {
    const data = await requestJson('/api/agent/product/analyze', { draftId, userHint: '스마트폰 사진 속 개인 거래 상품' });
    setAnalysis(data.analysis as AnyRecord);
  }

  async function makeDraft() {
    const data = await requestJson('/api/agent/listing/draft', { draftId, price: Number(price), currency: 'KRW' });
    setDraft(data.listing as AnyRecord);
  }

  async function makePreview() {
    const data = await requestJson('/api/agent/listing/preview', { draftId });
    setPreview(data.previewCard as AnyRecord);
  }

  async function publish() {
    const data = await requestJson('/api/listings/publish', { draftId, approved: true, agentEnabled: false, sellerName: '데모 판매자' });
    setListing(data.listing as AnyRecord);
  }

  async function startAgent() {
    const data = await requestJson('/api/agent/seller/start', { listingId });
    setSession(data.session as AnyRecord);
  }

  async function sendBuyerMessage() {
    const data = await requestJson('/api/agent/seller/message', { listingId, buyerMessage, buyerName: '테스트 구매자' });
    setSellerReply(data as AnyRecord);
  }

  async function generateKarrotDraft(productNameArg: string, priceArg: number) {
    console.log("🚀 AI 에이전트 호출 시작...");
    setBusy('karrot-draft');
    setError('');
    try {
      const res = await fetch('/api/expert/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: 'write_listing',
          itemDescription: productNameArg,
          userPrice: priceArg,
        }),
      });
      const data = await res.json();
      console.log("📥 AI 응답 수신 완료:", data);
      if (!res.ok) throw new Error(String(data.error || '당근마켓 판매글 생성 실패'));

      let parsedDraft: AnyRecord | null = null;
      if (typeof data.message === 'string') {
        try { parsedDraft = recordOf(JSON.parse(data.message)); } catch { parsedDraft = null; }
      }
      const karrotDraft = parsedDraft || recordOf(data.listing) || recordOf(data);
      if (karrotDraft) {
        setDraft(karrotDraft);
        setUpload((prev) => ({ ...(prev ?? {}), draft: karrotDraft }));
      }
      return karrotDraft;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy('');
    }
  }

  async function handleDaangnUpload() {
    const parsedPrice = Number(price);
    if (!productName.trim()) return setError('상품명을 입력하세요.');
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) return setError('희망 가격을 입력하세요.');

    setBusy('daangn-upload');
    setError('');

    try {
      const res = await fetch('/api/expert/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: 'write_listing',
          itemDescription: productName.trim(),
          userPrice: parsedPrice,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(String(data.error || '당근마켓 판매글 생성 실패'));

      let parsedMessage: AnyRecord | null = null;
      if (typeof data.message === 'string') {
        try {
          parsedMessage = recordOf(JSON.parse(data.message));
        } catch {
          parsedMessage = null;
        }
      }

      const daangnListing = parsedMessage || recordOf(data.listing);
      if (!daangnListing) throw new Error('판매글 JSON 파싱 실패');

      const metadata = recordOf(daangnListing.display_metadata);
      const title = textOf(daangnListing.title, productName.trim());
      const content = textOf(daangnListing.content, textOf(daangnListing.body));
      const priceValue = numberOf(daangnListing.price, parsedPrice);
      const priceReasoning = textOf(metadata?.price_reasoning, textOf(daangnListing.price_reason));
      const tags = Array.isArray(daangnListing.tags)
        ? daangnListing.tags.map(String)
        : Array.isArray(daangnListing.hashtags)
          ? daangnListing.hashtags.map(String)
          : [];

      const clipboardText = [
        `[제목]\n${title}`,
        `[가격]\n${priceValue.toLocaleString()}원`,
        `[본문]\n${content}`,
        priceReasoning ? `[가격 근거]\n${priceReasoning}` : '',
        tags.length > 0 ? `[태그]\n${tags.join(' ')}` : '',
      ].filter(Boolean).join('\n\n');

      await navigator.clipboard.writeText(clipboardText);
      alert('판매글이 복사되었습니다. 당근마켓 앱을 엽니다.');
      window.location.href = 'daangn://';
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[390px_1fr]">
        <section className="mx-auto w-full max-w-[390px] rounded-[34px] border border-slate-200 bg-slate-950 p-3 shadow-soft">
          <div className="rounded-[28px] bg-slate-100">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <div className="text-xs font-semibold text-blue-600">EDEN SELLER</div>
                <h1 className="text-lg font-bold tracking-normal">사진 한 장으로 판매 시작</h1>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-950 text-white">
                <Camera className="h-5 w-5" />
              </div>
            </div>

            <div className="p-4">
              <label className="relative flex aspect-[4/5] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-3xl border border-dashed border-slate-300 bg-slate-900 text-white">
                {imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imageUrl} alt="uploaded product" className="h-full w-full object-cover" />
                ) : (
                  <>
                    <div className="absolute inset-x-10 top-8 h-1 rounded-full bg-white/40" />
                    <ScanLine className="mb-4 h-12 w-12 text-blue-300" />
                    <div className="text-sm font-semibold">모바일 카메라 활성화</div>
                    <div className="mt-2 max-w-48 text-center text-xs text-slate-300">상품을 프레임 안에 맞추면 AI가 카테고리와 상태를 추정합니다.</div>
                  </>
                )}
                <input className="hidden" type="file" accept="image/*" capture="environment" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              </label>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button onClick={uploadPhoto} disabled={busy === 'upload'} className="h-11">
                  <Upload className="h-4 w-4" />
                  업로드
                </Button>
                <Button variant="outline" onClick={analyze} disabled={!draftId || Boolean(busy)} className="h-11 bg-white">
                  <Sparkles className="h-4 w-4" />
                  분석
                </Button>
              </div>
            </div>

            <div className="rounded-t-[28px] border-t border-slate-200 bg-white p-5 shadow-[0_-18px_45px_rgba(15,23,42,.12)]">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase text-slate-500">Bottom Sheet</div>
                  <div className="text-base font-bold">AI 판매 플로우</div>
                </div>
                <Badge className="bg-blue-50 text-blue-700">{busy ? 'RUNNING' : 'READY'}</Badge>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {steps.map((step, index) => (
                  <div key={step} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-2 text-center text-xs font-semibold text-slate-600">
                    {index + 1}. {step}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-5">
          <header className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm md:flex-row md:items-end md:justify-between">
            <div>
              <Badge className="bg-slate-900 text-white">Investor Demo</Badge>
              <h2 className="mt-3 text-2xl font-bold tracking-normal">Eden Seller Native App Flow</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">사진 등록, AI 분석, 판매글 작성, 판매 에이전트 응답까지 한 화면에서 보여주는 모바일 네이티브형 시연 화면입니다.</p>
            </div>
            <Button variant="outline" onClick={makePreview} disabled={!draft || Boolean(busy)}>
              <ImagePlus className="h-4 w-4" />
              판매 카드 보기
            </Button>
          </header>

          {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}

          <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
            <div className="space-y-5">
              <div className="grid gap-5 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>시세 분석 차트</CardTitle>
                    <CardDescription>AI 권장가와 예상 가격대를 시각화합니다.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-56 min-h-56">
                      {mounted ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={priceChart}>
                          <CartesianGrid strokeDasharray="4 4" vertical={false} />
                          <XAxis dataKey="name" tickLine={false} axisLine={false} />
                          <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 10000)}만`} width={48} />
                          <Tooltip formatter={(value) => [`${Number(value).toLocaleString()}원`, '가격']} />
                          <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                            {priceChart.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                      ) : (
                        <div className="flex h-full items-center justify-center text-sm text-slate-500">차트 준비 중</div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>신뢰도 진행률</CardTitle>
                    <CardDescription>등록 플로우가 진행될수록 판단 근거가 쌓입니다.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-56 min-h-56">
                      {mounted ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={confidenceTrend}>
                          <CartesianGrid strokeDasharray="4 4" vertical={false} />
                          <XAxis dataKey="name" tickLine={false} axisLine={false} />
                          <YAxis domain={[0, 100]} width={36} />
                          <Tooltip formatter={(value) => [`${Number(value)}점`, '신뢰']} />
                          <Area type="monotone" dataKey="score" stroke="#2563eb" fill="#bfdbfe" strokeWidth={2} />
                        </AreaChart>
                      </ResponsiveContainer>
                      ) : (
                        <div className="flex h-full items-center justify-center text-sm text-slate-500">차트 준비 중</div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>가격과 판매글 생성</CardTitle>
                  <CardDescription>판매자가 원하는 가격을 입력하면 AI가 판매 문구와 카드 미리보기를 만듭니다.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-[1.5fr_1fr]">
                    <input
                      className="h-10 rounded-md border border-input bg-white px-3 text-sm"
                      value={productName}
                      onChange={(e) => setProductName(e.target.value)}
                      placeholder="상품명 예: 다이슨 V15 무선청소기"
                    />
                    <input
                      className="h-10 rounded-md border border-input bg-white px-3 text-sm"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      inputMode="numeric"
                      placeholder="희망 가격"
                    />
                  </div>
                  <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
                    <Button
                      onClick={handleDaangnUpload}
                      disabled={busy === 'daangn-upload' || Boolean(busy && busy !== 'daangn-upload') || !productName.trim() || Number(price) <= 0}
                      className="h-11 bg-orange-500 text-white hover:bg-orange-600"
                    >
                      {busy === 'daangn-upload' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      {busy === 'daangn-upload' ? '판매글 복사 중...' : '🥕 당근마켓에 AI 판매글 올리기'}
                    </Button>
                    <Button onClick={makeDraft} disabled={!analysis || Boolean(busy)}>
                      <Sparkles className="h-4 w-4" />
                      판매글 만들기
                    </Button>
                    <Button variant="secondary" onClick={publish} disabled={!preview || Boolean(busy)}>
                      <CheckCircle2 className="h-4 w-4" />
                      등록
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-5 lg:grid-cols-2">
                <Card>
                  <CardHeader><CardTitle>AI 분석 JSON</CardTitle></CardHeader>
                  <CardContent>{analysis ? jsonBlock(analysis) : <div className="text-sm text-slate-500">사진 업로드 후 분석을 실행하세요.</div>}</CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle>판매글 초안</CardTitle></CardHeader>
                  <CardContent>{draft ? jsonBlock(draft) : <div className="text-sm text-slate-500">판매글 만들기를 실행하세요.</div>}</CardContent>
                </Card>
              </div>
            </div>

            <aside className="space-y-5">
              <Card className="overflow-hidden">
                <CardHeader>
                  <CardTitle>판매 카드 미리보기</CardTitle>
                </CardHeader>
                {preview ? (
                  <CardContent>
                    {textOf(preview.imageUrl) && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={textOf(preview.imageUrl)} alt="preview" className="mb-4 aspect-[4/3] w-full rounded-md object-cover" />
                    )}
                    <Badge className="bg-blue-50 text-blue-700">{textOf(preview.badge, 'AI 초안')}</Badge>
                    <h3 className="mt-3 text-xl font-bold">{textOf(preview.headline)}</h3>
                    <div className="mt-2 text-2xl font-black text-blue-700">{textOf(preview.priceLabel)}</div>
                    <p className="mt-3 text-sm leading-6 text-slate-600">{textOf(preview.subheadline)}</p>
                  </CardContent>
                ) : (
                  <CardContent className="text-sm text-slate-500">판매 카드 보기를 눌러 미리보기를 생성하세요.</CardContent>
                )}
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>판매 에이전트</CardTitle>
                  <CardDescription>구매자 문의에 대한 자동 응답을 테스트합니다.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Button variant="outline" onClick={startAgent} disabled={!listingId || Boolean(busy)} className="w-full">
                    <MessageSquareText className="h-4 w-4" />
                    판매 에이전트 켜기
                  </Button>
                  {session && <Badge className="bg-emerald-50 text-emerald-700">ACTIVE SESSION</Badge>}
                  <textarea className="min-h-24 w-full rounded-md border border-input bg-white p-3 text-sm" value={buyerMessage} onChange={(e) => setBuyerMessage(e.target.value)} />
                  <Button onClick={sendBuyerMessage} disabled={!session || Boolean(busy)} className="w-full">
                    <Send className="h-4 w-4" />
                    구매자 문의 테스트
                  </Button>
                  {sellerReply && jsonBlock(sellerReply)}
                </CardContent>
              </Card>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
