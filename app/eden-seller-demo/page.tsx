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
import { Camera, CheckCircle2, Copy, ExternalLink, ImagePlus, Loader2, MessageSquareText, ScanLine, Send, Sparkles, Upload, X } from 'lucide-react';

type AnyRecord = Record<string, unknown>;

interface UploadState {
  draft?: AnyRecord;
  image?: { url?: string };
}

type ChatMsg = { id: number; role: 'buyer' | 'agent'; text: string };

type DaangnModal = {
  title: string;
  priceValue: number;
  content: string;
  tags: string[];
  priceReasoning: string;
  webUrl: string;
  deepLink: string;
} | null;

const steps = ['Camera', 'Analyze', 'Price', 'Preview', 'Publish', 'Agent'];
const DEMO_PRODUCT_NAME = '유아용 밸런스 바이크';
const DEMO_PRICE = 450_000;

// 판매 에이전트 페르소나에 노출할 판매자 호칭(시연용)
const SELLER_NAME = '서희 대표';

// "4만원", "4만5천", "45000", "4.5만" 등 한국어 가격 표현 → 숫자(원)
function parseKoreanPrice(text: string, fallback: number): number {
  const t = (text || '').replace(/[,\s]/g, '');
  const man = t.match(/([\d.]+)만(?:([\d.]+)천)?/);
  if (man) {
    let v = parseFloat(man[1]) * 10000;
    if (man[2]) v += parseFloat(man[2]) * 1000;
    return Math.round(v);
  }
  const cheon = t.match(/([\d.]+)천/);
  if (cheon) return Math.round(parseFloat(cheon[1]) * 1000);
  const num = t.match(/(\d{3,})원?/);
  if (num) return parseInt(num[1], 10);
  return fallback;
}

// 백엔드(/api/expert/respond) 미응답 시 클라이언트에서 즉시 만드는 폴백 판매글
function composeFallbackListing(name: string, price: number) {
  return {
    title: `${name} 판매합니다 (상태 최상)`,
    price,
    content:
      `${name} 내놓습니다.\n` +
      `- 실사용 후기: 성능/상태 모두 만족스러워 깔끔하게 사용했습니다.\n` +
      `- 구성: 본품 + 기본 구성품\n` +
      `- 직거래/택배 모두 가능합니다. 편하게 문의 주세요!`,
    tags: ['#중고거래', `#${name.replace(/\s+/g, '')}`, '#상태최상', '#직거래가능'],
    display_metadata: { price_reasoning: `최근 시세 대비 합리적인 ${price.toLocaleString()}원으로 책정했습니다.` },
  };
}

// 데모용 당근마켓 연결 URL(상품명/가격을 쿼리스트링으로 동봉)
function buildKarrotUrl(title: string, price: number, content: string) {
  const qs = new URLSearchParams({
    title,
    price: String(price),
    content: content.slice(0, 300),
    src: 'eden-seller-demo',
  });
  return `https://www.daangn.com/search/${encodeURIComponent(title)}?${qs.toString()}`;
}

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

function recordOrJson(value: unknown): AnyRecord | null {
  const direct = recordOf(value);
  if (direct) return direct;
  if (typeof value !== 'string' || !value.trim()) return null;
  try { return recordOf(JSON.parse(value)); } catch { return null; }
}

// API 버전별 wrapper({analysis}, {listing}, {message:{listing}}, JSON string)를 모두 평탄화한다.
function responseRecords(value: unknown, depth = 0, seen = new Set<AnyRecord>()): AnyRecord[] {
  if (depth > 4) return [];
  const current = recordOrJson(value);
  if (!current || seen.has(current)) return [];
  seen.add(current);

  const nestedKeys = ['analysis', 'listing', 'message', 'data', 'result', 'product', 'draft'] as const;
  return [
    current,
    ...nestedKeys.flatMap((key) => responseRecords(current[key], depth + 1, seen)),
  ];
}

function firstResponseText(records: AnyRecord[], keys: string[], fallback: string): string {
  for (const key of keys) {
    for (const record of records) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return fallback;
}

function positivePrice(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value);
  if (typeof value !== 'string' || !value.trim()) return null;
  const compact = value.replace(/[₩원,\s]/g, '');
  const numeric = Number(compact);
  if (Number.isFinite(numeric) && numeric > 0) return Math.round(numeric);
  const korean = parseKoreanPrice(value, 0);
  return korean > 0 ? korean : null;
}

function firstResponsePrice(records: AnyRecord[], fallback: number): number {
  const keys = ['suggestedPrice', 'suggested_price', 'recommendedPrice', 'recommended_price', 'marketPrice', 'askingPrice', 'price', 'amount'];
  for (const key of keys) {
    for (const record of records) {
      const value = positivePrice(record[key]);
      if (value) return value;
    }
  }
  return fallback;
}

function normalizeAnalysisResponse(payload: unknown, fallbackName: string, fallbackPrice: number): AnyRecord {
  const records = responseRecords(payload);
  const root = records[0] ?? {};
  const detailed = records.find((record) =>
    ['productName', 'product_name', 'suggestedPrice', 'suggested_price', 'confidence', 'condition', 'category']
      .some((key) => record[key] !== undefined)
  ) ?? root;
  const productName = firstResponseText(
    records,
    ['productName', 'product_name', 'itemName', 'item_name', 'name', 'title'],
    fallbackName,
  );
  const suggestedPrice = firstResponsePrice(records, fallbackPrice);

  return {
    ...root,
    ...detailed,
    productName,
    product_name: productName,
    suggestedPrice,
    suggested_price: suggestedPrice,
    responseMapped: true,
  };
}

function listingFromResponse(payload: unknown): AnyRecord | null {
  return responseRecords(payload).find((record) =>
    ['title', 'content', 'body', 'tags', 'hashtags'].some((key) => record[key] !== undefined)
  ) ?? null;
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
  const [productName, setProductName] = useState(DEMO_PRODUCT_NAME);
  const [price, setPrice] = useState(String(DEMO_PRICE));
  const [draft, setDraft] = useState<AnyRecord | null>(null);
  const [preview, setPreview] = useState<AnyRecord | null>(null);
  const [listing, setListing] = useState<AnyRecord | null>(null);
  const [session, setSession] = useState<AnyRecord | null>(null);
  const [buyerMessage, setBuyerMessage] = useState('4만원에 가능할까요?');
  // draftId 를 별도 상태로 고정 — 업로드 응답의 id(없으면 임시 'draft_<ts>')를 바인딩하고,
  // 이후 AI 판매글(generateKarrotDraft)이 upload.draft 를 덮어써도 id 가 유실되지 않게 한다.
  const [draftId, setDraftId] = useState('');
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [agentTyping, setAgentTyping] = useState(false);
  const [daangnModal, setDaangnModal] = useState<DaangnModal>(null);
  const [copied, setCopied] = useState(false);
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

  const listingId = pickId(listing);
  const imageUrl = upload?.image?.url;

  // draftId 가 비어 있으면 임시 세션 id 를 즉시 생성·바인딩하여 절대 undefined/null/'' 로 전송되지 않게 한다.
  function ensureDraftId(): string {
    if (draftId) return draftId;
    const tmp = `draft_${Date.now()}`;
    setDraftId(tmp);
    return tmp;
  }
  const suggested = numberOf(analysis?.suggestedPrice ?? analysis?.suggested_price, Number(price) || DEMO_PRICE);

  const priceChart = useMemo(() => {
    const base = suggested || Number(price) || DEMO_PRICE;
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
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const raw = await res.text();
      let data: AnyRecord;
      try {
        data = recordOf(JSON.parse(raw)) ?? { message: raw };
      } catch {
        data = { message: raw };
      }
      if (!res.ok) {
        const message = textOf(data.error, textOf(data.message, `요청 실패 (${res.status})`));
        throw new Error(message);
      }
      return data;
    } finally {
      // fetch/JSON 파싱/HTTP 오류 어느 경로에서도 버튼 잠금이 남지 않는다.
      setBusy((current) => current === url ? '' : current);
    }
  }

  async function uploadPhoto() {
    if (!file) return setError('사진을 선택하세요.');
    setBusy('upload');
    setError('');
    // 서버리스 안전 업로드(디스크 미사용, base64/데모이미지 폴백) — ENOENT 로 막히지 않는다.
    const form = new FormData();
    form.append('image', file);
    form.append('userId', 'demo-user');
    form.append('productName', productName);
    form.append('price', String(Number(price) || ''));
    let data: AnyRecord;
    try {
      const res = await fetch('/api/eden-seller/upload', { method: 'POST', body: form });
      data = await res.json();
      if (!res.ok || !(data as AnyRecord).success) throw new Error(String((data as AnyRecord).error || '업로드 실패'));
    } catch {
      // 업로드 API 자체가 막혀도 시연이 끊기지 않도록: 선택 이미지를 클라에서 직접 data URL 로 폴백
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => resolve('');
        reader.readAsDataURL(file);
      });
      data = { success: true, url: dataUrl, draft: { id: `demo-${Date.now()}` }, image: { url: dataUrl }, demo: true };
    }
    setBusy('');

    // 새 응답 스펙: { success, url, productName, suggestedPrice, analysis, ... }
    const url = textOf((data as AnyRecord).url, textOf(recordOf((data as AnyRecord).image)?.url));
    // draftId 확정 바인딩: 응답 draft.id → 없으면 임시 'draft_<ts>' (절대 누락 없이)
    const respDraftId = textOf(recordOf((data as AnyRecord).draft)?.id) || `draft_${Date.now()}`;
    setDraftId(respDraftId);
    setUpload({ draft: recordOf((data as AnyRecord).draft) ?? { id: respDraftId }, image: { url } });
    setDraft(null);
    setPreview(null);
    setListing(null);
    setSession(null);
    setChatMsgs([]);

    // 응답에 담긴 상품명/제안가를 반영(비어있으면 기존 입력 유지)
    const respName = textOf((data as AnyRecord).productName);
    const respPrice = numberOf((data as AnyRecord).suggestedPrice);
    if (respName) setProductName(respName);
    if (respPrice > 0) setPrice(String(respPrice));

    // 업로드 즉시 시세 분석 차트 / 신뢰도 진행률을 활성화(응답의 분석 텍스트를 시드)
    const analysisText = textOf((data as AnyRecord).analysis);
    setAnalysis({
      product_name: respName || productName || DEMO_PRODUCT_NAME,
      suggestedPrice: respPrice || Number(price) || DEMO_PRICE,
      condition: 'A급(사용감 적음)',
      category: '생활가전',
      confidence: 0.86,
      analysisText: analysisText || undefined,
      source: (data as AnyRecord).demo ? 'demo_seed' : 'eden_seller_upload',
    });
  }

  async function handleAnalyze() {
    const fallbackName = productName.trim() || DEMO_PRODUCT_NAME;
    const fallbackPrice = positivePrice(price) ?? DEMO_PRICE;
    let data: AnyRecord = {
      productName: fallbackName,
      suggestedPrice: fallbackPrice,
      source: 'demo_fallback',
    };
    try {
      data = await requestJson('/api/agent/product/analyze', { draftId: ensureDraftId(), userHint: '스마트폰 사진 속 개인 거래 상품' });
    } catch (requestError) {
      // 백엔드가 잠시 끊겨도 분석 JSON/차트/신뢰도는 데모 데이터로 즉시 활성화한다.
      data = {
        ...data,
        condition: '상태 양호',
        category: '유아동/스포츠',
        confidence: 0.72,
        fallbackReason: requestError instanceof Error ? requestError.message : String(requestError),
      };
    }

    // res.productName / res.listing / res.message.listing / JSON string을 한 경로로 정규화한다.
    const mapped = normalizeAnalysisResponse(data, fallbackName, fallbackPrice);
    const mappedName = textOf(mapped.productName, fallbackName);
    const mappedPrice = positivePrice(mapped.suggestedPrice) ?? fallbackPrice;
    setProductName(mappedName);
    setPrice(String(mappedPrice));
    setAnalysis({
      ...mapped,
      productName: mappedName,
      product_name: mappedName,
      suggestedPrice: mappedPrice,
      confidence: numberOf(mapped.confidence, 0.86),
      activatedAt: new Date().toISOString(),
    });
  }

  async function makeDraft() {
    const safeName = productName.trim() || DEMO_PRODUCT_NAME;
    const safePrice = positivePrice(price) ?? DEMO_PRICE;
    setProductName(safeName);
    setPrice(String(safePrice));
    try {
      const data = await requestJson('/api/agent/listing/draft', {
        draftId: ensureDraftId(), price: safePrice, currency: 'KRW', productName: safeName,
      });
      setDraft(listingFromResponse(data) ?? composeFallbackListing(safeName, safePrice));
    } catch {
      setDraft(composeFallbackListing(safeName, safePrice));
    }
  }

  async function makePreview() {
    const safeName = productName.trim() || DEMO_PRODUCT_NAME;
    const safePrice = positivePrice(price) ?? DEMO_PRICE;
    try {
      const data = await requestJson('/api/agent/listing/preview', { draftId: ensureDraftId() });
      setPreview(recordOf(data.previewCard) ?? {
        badge: 'AI 초안', headline: safeName, priceLabel: `${safePrice.toLocaleString()}원`, subheadline: '데모 판매 카드',
      });
    } catch {
      setPreview({ badge: 'DEMO', headline: safeName, priceLabel: `${safePrice.toLocaleString()}원`, subheadline: '즉시 생성된 데모 판매 카드' });
    }
  }

  async function publish() {
    const safeName = productName.trim() || DEMO_PRODUCT_NAME;
    const safePrice = positivePrice(price) ?? DEMO_PRICE;
    try {
      const data = await requestJson('/api/listings/publish', { draftId: ensureDraftId(), approved: true, agentEnabled: false, sellerName: '데모 판매자' });
      setListing(recordOf(data.listing) ?? { id: `demo-listing-${Date.now()}`, title: safeName, price: safePrice, status: 'PUBLISHED' });
    } catch {
      setListing({ id: `demo-listing-${Date.now()}`, title: safeName, price: safePrice, status: 'DEMO_PUBLISHED' });
    }
  }

  async function startAgent() {
    const data = await requestJson('/api/agent/seller/start', { listingId });
    setSession(data.session as AnyRecord);
  }

  async function sendBuyerMessage() {
    const text = buyerMessage.trim();
    if (!text) return setError('구매자 문의를 입력하세요.');
    setError('');
    setBusy('buyer-message');

    // 1) 구매자 말풍선 즉시 렌더
    const buyerId = Date.now();
    setChatMsgs((prev) => [...prev, { id: buyerId, role: 'buyer', text }]);
    setAgentTyping(true);

    // 2) 협상가 파싱(예: "4만원" → 40000) 및 스마트 피드백 생성
    const currentPrice = Number(price) || numberOf(suggested, DEMO_PRICE);
    const offered = parseKoreanPrice(text, currentPrice);

    // 가이드 챗 피드백(고정 헤드라인) + 케이스별 절충 디테일
    const headline = `💬 ${SELLER_NAME}님 세션 확인 완료. 절충가를 실시간 반영합니다.`;
    let detail = '';
    // 백엔드 세션이 활성화돼 있으면 실제 에이전트 응답을 디테일로 우선 사용, 실패/부재 시 스마트 폴백.
    if (listingId && session) {
      try {
        const data = await requestJson('/api/agent/seller/message', { listingId, buyerMessage: text, buyerName: '테스트 구매자' });
        detail = textOf((data as AnyRecord).reply, textOf((data as AnyRecord).message));
      } catch {
        detail = '';
      }
    }
    if (!detail) {
      if (offered >= currentPrice) {
        detail = `제안하신 ${offered.toLocaleString()}원은 희망가 이상이라 바로 거래 가능합니다. 당근마켓 채팅으로 직거래 일정을 잡아드릴게요!`;
      } else if (offered < currentPrice * 0.6) {
        detail = `다만 ${offered.toLocaleString()}원은 시세 대비 다소 낮아, ${Math.round((currentPrice + offered) / 2).toLocaleString()}원선으로 절충 제안드립니다.`;
      } else {
        detail = `${currentPrice.toLocaleString()}원 → ${offered.toLocaleString()}원으로 절충하여 당근마켓 제안을 업데이트했습니다. 바로 거래 도와드릴게요!`;
      }
    }
    const fullReply = `${headline}\n${detail}`;

    // 3) 타이핑 인디케이터 → 에이전트 말풍선에 스트리밍 스트링으로 한 글자씩 출력
    await new Promise((r) => setTimeout(r, 350));
    setAgentTyping(false);
    const agentMsgId = buyerId + 1;
    setChatMsgs((prev) => [...prev, { id: agentMsgId, role: 'agent', text: '' }]);
    for (let i = 2; i <= fullReply.length; i += 2) {
      await new Promise((r) => setTimeout(r, 16));
      const slice = fullReply.slice(0, i);
      setChatMsgs((prev) => prev.map((m) => (m.id === agentMsgId ? { ...m, text: slice } : m)));
    }
    setChatMsgs((prev) => prev.map((m) => (m.id === agentMsgId ? { ...m, text: fullReply } : m)));
    setBusy('');
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

      const karrotDraft = listingFromResponse(data) ?? recordOf(data);
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
    const safeName = productName.trim() || DEMO_PRODUCT_NAME;
    const parsedPrice = positivePrice(price) ?? DEMO_PRICE;
    setProductName(safeName);
    setPrice(String(parsedPrice));

    setBusy('daangn-upload');
    setError('');

    // 팝업 차단 방지: 사용자 클릭 제스처 동안 먼저 빈 새 창을 확보(이후 URL 주입)
    let popup: Window | null = null;
    try {
      popup = typeof window !== 'undefined' ? window.open('about:blank', '_blank') : null;
    } catch {
      popup = null;
    }

    // AI 판매글 생성(실패해도 폴백 판매글로 모달을 즉시 띄워 시연이 끊기지 않게 함)
    let daangnListing: AnyRecord;
    try {
      const res = await fetch('/api/expert/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: 'write_listing',
          itemDescription: safeName,
          userPrice: parsedPrice,
        }),
      });
      const data = await res.json();
      daangnListing = (res.ok && listingFromResponse(data)) || composeFallbackListing(safeName, parsedPrice);
    } catch {
      daangnListing = composeFallbackListing(safeName, parsedPrice);
    }

    const metadata = recordOf(daangnListing.display_metadata);
    const title = textOf(daangnListing.title, safeName);
    const content = textOf(daangnListing.content, textOf(daangnListing.body));
    const priceValue = numberOf(daangnListing.price, parsedPrice);
    const priceReasoning = textOf(metadata?.price_reasoning, textOf(daangnListing.price_reason));
    const tags = Array.isArray(daangnListing.tags)
      ? daangnListing.tags.map(String)
      : Array.isArray(daangnListing.hashtags)
        ? daangnListing.hashtags.map(String)
        : [];

    // 실제 당근마켓 조회 탭을 새 창으로 실시간 연동(상품명 + AI 판매 문구를 쿼리스트링으로 조합)
    const karrotUrl = buildKarrotUrl(title, priceValue, content);
    try {
      if (popup && !popup.closed) {
        popup.location.href = karrotUrl; // 미리 확보한 창에 URL 주입(차단 회피)
      } else if (typeof window !== 'undefined') {
        window.open(karrotUrl, '_blank', 'noopener,noreferrer'); // 폴백 재시도
      }
    } catch {
      // 확장 프로그램/팝업 정책이 새 창을 차단해도 아래 인앱 모달은 정상적으로 열린다.
    }

    // 판매글을 state(draft)에도 반영 + 웹뷰 데모 모달로 미리보기/복사 제공
    setDraft(daangnListing);
    setDaangnModal({
      title,
      priceValue,
      content,
      tags,
      priceReasoning,
      webUrl: karrotUrl,
      deepLink: 'daangn://',
    });
    setCopied(false);
    setBusy('');
  }

  // 모달 내 '판매글 복사' — 클립보드 차단 환경도 안전하게 폴백
  async function copyDaangnText() {
    if (!daangnModal) return;
    const clipboardText = [
      `[제목]\n${daangnModal.title}`,
      `[가격]\n${daangnModal.priceValue.toLocaleString()}원`,
      `[본문]\n${daangnModal.content}`,
      daangnModal.priceReasoning ? `[가격 근거]\n${daangnModal.priceReasoning}` : '',
      daangnModal.tags.length > 0 ? `[태그]\n${daangnModal.tags.join(' ')}` : '',
    ].filter(Boolean).join('\n\n');
    try {
      await navigator.clipboard.writeText(clipboardText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError('클립보드 접근이 차단되어 복사하지 못했습니다. 본문을 직접 선택해 복사하세요.');
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
                <Button variant="outline" onClick={handleAnalyze} aria-busy={busy === '/api/agent/product/analyze'} className="h-11 bg-white">
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
            <Button variant="outline" onClick={makePreview} aria-busy={busy === '/api/agent/listing/preview'}>
              <ImagePlus className="h-4 w-4" />
              판매 카드 보기
            </Button>
          </header>

          {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 space-y-5">
              <div className="grid gap-5 md:grid-cols-2">
                <Card className="min-w-0">
                  <CardHeader>
                    <CardTitle>시세 분석 차트</CardTitle>
                    <CardDescription>AI 권장가와 예상 가격대를 시각화합니다.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-56 w-full min-w-0">
                      {mounted ? (
                      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
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

                <Card className="min-w-0">
                  <CardHeader>
                    <CardTitle>신뢰도 진행률</CardTitle>
                    <CardDescription>등록 플로우가 진행될수록 판단 근거가 쌓입니다.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-56 w-full min-w-0">
                      {mounted ? (
                      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
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
                      placeholder={`상품명 예: ${DEMO_PRODUCT_NAME}`}
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
                      aria-busy={busy === 'daangn-upload'}
                      className="h-11 bg-orange-500 text-white hover:bg-orange-600"
                    >
                      {busy === 'daangn-upload' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      {busy === 'daangn-upload' ? '판매글 복사 중...' : '🥕 당근마켓에 AI 판매글 올리기'}
                    </Button>
                    <Button onClick={makeDraft} aria-busy={busy === '/api/agent/listing/draft'}>
                      <Sparkles className="h-4 w-4" />
                      판매글 만들기
                    </Button>
                    <Button variant="secondary" onClick={publish} aria-busy={busy === '/api/listings/publish'}>
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
                  <div className="flex items-center justify-between">
                    <Button variant="outline" onClick={startAgent} disabled={!listingId || Boolean(busy)} className="flex-1 bg-white">
                      <MessageSquareText className="h-4 w-4" />
                      판매 에이전트 켜기
                    </Button>
                    <Badge className="ml-2 bg-emerald-50 text-emerald-700">{session ? 'ACTIVE SESSION' : 'DEMO SESSION'}</Badge>
                  </div>

                  {/* 실시간 채팅 UI — 구매자/에이전트 말풍선 */}
                  <div className="flex max-h-72 min-h-32 flex-col gap-2 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-3">
                    {chatMsgs.length === 0 && !agentTyping ? (
                      <div className="m-auto text-center text-xs text-slate-400">
                        구매자 문의를 입력하고 [구매자 문의 테스트]를 누르면<br />판매 에이전트가 실시간으로 협상 응답합니다.
                      </div>
                    ) : (
                      chatMsgs.map((m) => (
                        <div key={m.id} className={`flex ${m.role === 'buyer' ? 'justify-end' : 'justify-start'}`}>
                          <div
                            className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-6 ${
                              m.role === 'buyer'
                                ? 'rounded-br-sm bg-blue-600 text-white'
                                : 'rounded-bl-sm border border-slate-200 bg-white text-slate-800'
                            }`}
                          >
                            {m.role === 'agent' && <div className="mb-0.5 text-[11px] font-semibold text-emerald-600">EDEN 판매 에이전트</div>}
                            {m.text}
                          </div>
                        </div>
                      ))
                    )}
                    {agentTyping && (
                      <div className="flex justify-start">
                        <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-3 py-2 text-slate-400">
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.2s]" />
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.1s]" />
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
                        </div>
                      </div>
                    )}
                  </div>

                  <textarea
                    className="min-h-20 w-full rounded-md border border-input bg-white p-3 text-sm"
                    value={buyerMessage}
                    onChange={(e) => setBuyerMessage(e.target.value)}
                    placeholder="예: 4만원에 가능할까요?"
                  />
                  <Button onClick={sendBuyerMessage} disabled={busy === 'buyer-message' || !buyerMessage.trim()} className="w-full">
                    {busy === 'buyer-message' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    구매자 문의 테스트
                  </Button>
                </CardContent>
              </Card>
            </aside>
          </div>
        </section>
      </div>

      {/* 당근마켓 웹뷰 데모 모달 — 창/팝업 차단 없이 즉시 연동, 실제 링크는 사용자 클릭으로 새 탭 */}
      {daangnModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          onClick={() => setDaangnModal(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div className="flex items-center gap-2 text-orange-600">
                <span className="text-xl">🥕</span>
                <span className="font-bold">당근마켓 판매글 미리보기</span>
              </div>
              <button onClick={() => setDaangnModal(null)} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <div>
                <div className="text-xs font-semibold uppercase text-slate-400">제목</div>
                <div className="text-base font-bold text-slate-900">{daangnModal.title}</div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase text-slate-400">가격</div>
                <div className="text-2xl font-black text-orange-600">{daangnModal.priceValue.toLocaleString()}원</div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase text-slate-400">본문</div>
                <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{daangnModal.content}</p>
              </div>
              {daangnModal.priceReasoning && (
                <div className="rounded-md bg-orange-50 p-3 text-xs leading-5 text-orange-700">💡 {daangnModal.priceReasoning}</div>
              )}
              {daangnModal.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {daangnModal.tags.map((t) => (
                    <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{t}</span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2 border-t border-slate-100 px-5 py-4">
              <a
                href={daangnModal.webUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-orange-500 font-bold text-white hover:bg-orange-600"
              >
                <ExternalLink className="h-4 w-4" />
                당근마켓에서 열기
              </a>
              <Button variant="outline" onClick={copyDaangnText} className="h-11 bg-white">
                {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                {copied ? '복사 완료!' : '판매글 전체 복사'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
