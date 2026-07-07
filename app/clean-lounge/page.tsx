'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, LogIn, Send, UserPlus, Zap } from 'lucide-react';
import { useUser, type Quota } from '@/components/UserProvider';

// 클린 AI 라운지 — 다단계 패키지 재판매/PV 적립/허위 세션 라벨을 일절 제외한 순수 크레딧 소모형 UI.
// 엔진 단가/라벨은 바이너리(ai-lounge) 장부와 분리된 클린 전용 카탈로그(cleanLoungeEngines)와 1:1 동기화한다.
type EngineKey = 'b200-beauty-lora' | 'gpt4o-premium' | 'gemini-2-ultra' | 'gemini-2-pro';
type Engine = { key: EngineKey; name: string; gas: number };
type ChatMessage = {
  id: number;
  role: 'user' | 'ai';
  text: string;
  pending?: boolean;
  engine?: EngineKey;
  gasCharged?: number;
};

// 2026 최신 프론티어 라인업 (최상위 → 프리미엄 → 기본형). 구버전 저사양 레거시는 제거.
// 표시 GAS 는 /api/clean-ai/execute 가 실제 차감하는 단가와 일치한다(정직한 영수증).
const ENGINES: Engine[] = [
  { key: 'b200-beauty-lora', name: 'EdenClaw B200 Beauty LoRA (Gemma 27B)', gas: 25_000 },
  { key: 'gpt4o-premium', name: 'GPT-4o Premium', gas: 20_000 },
  { key: 'gemini-2-ultra', name: 'Gemini 2.0 Ultra', gas: 15_000 },
  { key: 'gemini-2-pro', name: 'Gemini 2.0 Pro', gas: 5_000 },
];

const DEFAULT_ENGINE: EngineKey = 'gemini-2-pro';

const MESSAGE_STORAGE_PREFIX = 'edenclaw_clean_lounge_messages_v1:';
const SESSION_STORAGE_KEY = 'edenclaw_email'; // UserProvider 와 동일한 세션 키 (게스트 폴백 판정용)
const GUEST_SESSION_EMAIL = 'guest@clean-lounge.local';
const GUEST_GAS_ALLOWANCE = 50_000;

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

function messageStorageKey(email: string): string {
  return `${MESSAGE_STORAGE_PREFIX}${encodeURIComponent(normalizedEmail(email))}`;
}

function isEngineKey(value: unknown): value is EngineKey {
  return ENGINES.some((item) => item.key === value);
}

// 순수 GAS 소비형 테스트 게스트 세션.
// ledger 를 null 로 명시 차단하여 바이너리/PV·BV 회계를 일절 바인딩하지 않는다(클린 회계 경계 유지).
function buildGuestQuota(): Quota {
  return {
    email: GUEST_SESSION_EMAIL,
    allocated: GUEST_GAS_ALLOWANCE,
    consumed: 0,
    remaining: GUEST_GAS_ALLOWANCE,
    percentUsed: 0,
    depleted: false,
    ledger: null,
  };
}

function isStoredMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<ChatMessage>;
  return (
    typeof message.id === 'number' &&
    Number.isFinite(message.id) &&
    (message.role === 'user' || message.role === 'ai') &&
    typeof message.text === 'string' &&
    (message.engine === undefined || isEngineKey(message.engine)) &&
    (message.gasCharged === undefined ||
      (typeof message.gasCharged === 'number' && Number.isFinite(message.gasCharged) && message.gasCharged >= 0))
  );
}

function engineName(key: EngineKey): string {
  return ENGINES.find((item) => item.key === key)?.name ?? key;
}

function TypingIndicator() {
  return (
    <div className="flex h-5 items-center gap-1" role="status" aria-label="AI가 답변을 생성하고 있습니다">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-300" style={{ animationDelay: '-300ms' }} />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-300" style={{ animationDelay: '-150ms' }} />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-300" />
      <span className="sr-only">답변 생성 중</span>
    </div>
  );
}

export default function CleanLoungePage() {
  const { email, quota, loading, error, loadUser, registerUser, setQuota } = useUser();
  const [inputEmail, setInputEmail] = useState('');
  const [inputName, setInputName] = useState('');
  const [engine, setEngine] = useState<EngineKey>(DEFAULT_ENGINE);
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [localError, setLocalError] = useState('');
  const [storageOwner, setStorageOwner] = useState<string | null>(null);
  const [guest, setGuest] = useState<{ email: string; quota: Quota } | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const idRef = useRef(0);

  // 세션 먹통 서킷 브레이커 + 게스트 쉐도우 바인딩.
  // localStorage 세션 읽기를 try-catch 로 감싸고(확장 프로그램 충돌·프라이버시 모드 대비),
  // 저장된 세션이 없거나 복원이 에러로 끝나면 무한 대기 대신 테스트 게스트 세션 + 기본 가스 한도를 즉시 바인딩한다.
  useEffect(() => {
    if (email) {
      setGuest(null); // 실제 로그인 세션이 항상 우선한다.
      setShowLogin(false);
      return;
    }
    if (loading) return; // UserProvider 복원 진행 중 — 짧게만 대기.

    let hasStoredSession = false;
    try {
      hasStoredSession = Boolean(localStorage.getItem(SESSION_STORAGE_KEY));
    } catch {
      hasStoredSession = false; // localStorage 접근 자체가 막히면 게스트로 폴백.
    }

    if (!hasStoredSession || error) {
      setGuest((prev) => prev ?? { email: GUEST_SESSION_EMAIL, quota: buildGuestQuota() });
    }
  }, [email, loading, error]);

  // 실제 로그인 세션을 우선하고, 없으면 게스트 쉐도우 세션을 사용한다.
  const activeEmail = email ?? guest?.email ?? null;
  const activeQuota = quota ?? guest?.quota ?? null;
  const isGuest = !email && Boolean(guest);

  // 활성 세션별로 저장된 대화만 복원한다. 진행 중이던 빈 응답은 새로고침 후 제거한다.
  useEffect(() => {
    if (!activeEmail) {
      setMessages([]);
      setStorageOwner(null);
      idRef.current = 0;
      return;
    }

    const owner = normalizedEmail(activeEmail);
    let restoredMessages: ChatMessage[] = [];
    try {
      const saved = localStorage.getItem(messageStorageKey(activeEmail));
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          restoredMessages = parsed.filter(isStoredMessage).filter((message) => !message.pending);
        }
      }
    } catch {
      // 손상되었거나 접근할 수 없는 저장소는 빈 대화로 안전하게 시작한다.
    }

    idRef.current = restoredMessages.reduce((max, message) => Math.max(max, message.id), 0);
    setMessages(restoredMessages);
    setStorageOwner(owner);
  }, [activeEmail]);

  // 복원이 끝난 뒤부터 새 메시지와 완료된 AI 응답을 해당 세션 저장소에 동기화한다.
  useEffect(() => {
    if (!activeEmail || storageOwner !== normalizedEmail(activeEmail)) return;
    try {
      localStorage.setItem(messageStorageKey(activeEmail), JSON.stringify(messages));
    } catch {
      // 브라우저 저장소 제한이 대화 자체를 막지 않도록 한다.
    }
  }, [activeEmail, messages, storageOwner]);

  // ② form onSubmit + e.preventDefault() 정석 전송 핸들러
  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    await send();
  }

  async function send() {
    const text = prompt.trim();
    if (!activeEmail || !text || running) return;

    // 게스트(쉐도우) 세션은 실제 외부 호출/GAS 차감/장부 기록을 하지 않는다 — 순수 회계 경계 유지.
    if (isGuest) {
      const guestUserId = ++idRef.current;
      const guestAiId = ++idRef.current;
      setMessages((prev) => [
        ...prev,
        { id: guestUserId, role: 'user', text },
        {
          id: guestAiId,
          role: 'ai',
          text: '게스트(테스트) 세션입니다. 실제 모델 실행과 GAS 차감은 로그인 후 이용할 수 있습니다.',
        },
      ]);
      setPrompt('');
      setLocalError('');
      return;
    }

    const requestedEngine = engine;

    // ③ 유저 메시지를 즉시 대화 배열에 추가하고 입력창을 비운다
    const userId = ++idRef.current;
    const aiId = ++idRef.current;
    setMessages((prev) => [
      ...prev,
      { id: userId, role: 'user', text },
      { id: aiId, role: 'ai', text: '', pending: true },
    ]);
    setPrompt('');
    setLocalError('');
    setRunning(true);

    try {
      // '/api/clean-ai/execute' 로 POST
      const res = await fetch('/api/clean-ai/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: activeEmail, engine: requestedEngine, prompt: text }),
      });
      const json = await res.json();
      if (!res.ok || json.status !== 'success') {
        throw new Error(json.error ?? `요청 실패 (${res.status})`);
      }

      // API가 확정한 엔진/실차감량을 답변과 함께 보관해 영수증과 전역 잔액이 같은 장부를 가리키게 한다.
      const billedEngine = isEngineKey(json.engine) ? json.engine : requestedEngine;
      const gasCharged =
        typeof json.gasCharged === 'number' && Number.isFinite(json.gasCharged) && json.gasCharged >= 0
          ? json.gasCharged
          : ENGINES.find((item) => item.key === billedEngine)?.gas ?? 0;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiId
            ? { ...m, text: json.reply, pending: false, engine: billedEngine, gasCharged }
            : m
        )
      );

      // ④ remainingGas 기반으로 setQuota 호출 → 전역 가스 잔액 실시간 동기화
      if (quota && typeof json.remainingGas === 'number') {
        const allocated = typeof json.allocated === 'number' ? json.allocated : quota.allocated;
        const consumed = typeof json.consumed === 'number' ? json.consumed : allocated - json.remainingGas;
        const next: Quota = {
          ...quota,
          allocated,
          consumed,
          remaining: json.remainingGas,
          percentUsed: allocated > 0 ? Math.min(100, (consumed / allocated) * 100) : 0,
          depleted: json.remainingGas <= 0,
        };
        setQuota(next);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '네트워크 오류';
      setLocalError(message);
      setMessages((prev) => prev.map((m) => (m.id === aiId ? { ...m, text: message, pending: false } : m)));
    } finally {
      setRunning(false);
    }
  }

  // 복원 진행 중에는 짧은 로딩만 — 무한 대기/먹통 방지
  if (loading && !activeEmail) {
    return (
      <main className="grid min-h-[calc(100dvh-46px)] place-items-center bg-[#070a12] text-slate-100">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> 세션을 불러오는 중…
        </div>
      </main>
    );
  }

  // 로그인/가입 게이트: 세션 바인딩 전이거나, 게스트가 명시적으로 로그인 폼을 열었을 때만 표시.
  if (!activeEmail || !activeQuota || (showLogin && !email)) {
    return (
      <main className="min-h-[calc(100dvh-46px)] bg-[#070a12] text-slate-100">
        <div className="mx-auto flex min-h-[calc(100dvh-46px)] w-full max-w-md flex-col justify-center px-4">
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-5">
            <h1 className="mb-4 text-lg font-semibold text-white">Clean AI Lounge</h1>
            <div className="space-y-2">
              <input
                value={inputEmail}
                onChange={(e) => setInputEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void loadUser(inputEmail)}
                type="email"
                placeholder="email"
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400"
              />
              <input
                value={inputName}
                onChange={(e) => setInputName(e.target.value)}
                placeholder="name"
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400"
              />
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => void loadUser(inputEmail)} disabled={loading} className="flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
                  <LogIn className="h-4 w-4" /> Load
                </button>
                <button onClick={() => void registerUser(inputEmail, inputName)} disabled={loading} className="flex items-center justify-center gap-2 rounded-md bg-cyan-600 px-3 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50">
                  <UserPlus className="h-4 w-4" /> Join
                </button>
              </div>
              {error && <p className="text-xs text-rose-300">{error}</p>}
              {showLogin && guest && (
                <button onClick={() => setShowLogin(false)} className="w-full pt-1 text-center text-xs text-slate-500 hover:text-slate-300">
                  ← 게스트(테스트) 세션으로 돌아가기
                </button>
              )}
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-[calc(100dvh-46px)] flex-col bg-[#070a12] text-slate-100">
      {/* ① 상단 바: 활성 세션 + 정직한 잔여 가스 수치만 렌더링 */}
      <header className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-[#090d18] px-4 py-3">
        <div>
          <h1 className="text-base font-semibold text-white">Clean AI Lounge</h1>
          <p className="text-xs text-slate-400">{isGuest ? '게스트(테스트) 세션' : activeEmail}</p>
        </div>
        <div className="flex items-center gap-2">
          {isGuest && (
            <button
              onClick={() => setShowLogin(true)}
              className="flex items-center gap-1.5 rounded-md border border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:border-emerald-400 hover:text-emerald-200"
            >
              <LogIn className="h-3.5 w-3.5" /> 로그인
            </button>
          )}
          <div className="flex items-center gap-2 rounded-md border border-emerald-500/50 bg-emerald-950/25 px-3 py-1.5">
            <Zap className="h-4 w-4 text-emerald-300" />
            <span className="text-xs text-slate-400">잔여 가스</span>
            <span className="font-mono text-sm font-semibold text-white">{activeQuota.remaining.toLocaleString()}</span>
          </div>
        </div>
      </header>

      {/* 엔진 선택 (재판매/PV/BV 라벨 없음) */}
      <div className="flex shrink-0 flex-wrap gap-2 border-b border-slate-800 px-4 py-2">
        {ENGINES.map((item) => (
          <button
            key={item.key}
            onClick={() => !running && setEngine(item.key)}
            disabled={running}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${engine === item.key ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200' : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-600'}`}
          >
            {item.name} · {item.gas.toLocaleString()} GAS
          </button>
        ))}
      </div>

      {/* 챗 피드 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {localError && <div className="mb-3 rounded-lg border border-rose-700 bg-rose-950/35 px-3 py-2 text-sm text-rose-200">{localError}</div>}
        {messages.length === 0 ? (
          <div className="grid h-full place-items-center text-sm text-slate-500">메시지를 입력해 클린 AI와 대화를 시작하세요.</div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`rounded-lg border px-3 py-2 ${message.role === 'user' ? 'ml-auto max-w-[82%] border-cyan-700/60 bg-cyan-950/25 text-cyan-50' : 'mr-auto max-w-[92%] border-slate-800 bg-slate-950 text-slate-100'}`}
              >
                <div className="mb-1 flex items-center gap-2 text-[11px] text-slate-400">
                  {message.role === 'user' ? 'YOU' : 'AI'}
                  {message.pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                </div>
                {message.pending ? (
                  <TypingIndicator />
                ) : (
                  <div className="whitespace-pre-wrap text-sm leading-relaxed">{message.text}</div>
                )}
                {message.role === 'ai' && !message.pending && message.engine && message.gasCharged !== undefined && (
                  <p className="mt-2 border-t border-slate-800/80 pt-1.5 text-[11px] text-slate-500">
                    [영수증: {engineName(message.engine)} 모델 이용 / 소모: {message.gasCharged.toLocaleString()} GAS]
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ② 하단 입력창: form onSubmit + e.preventDefault() */}
      <form onSubmit={handleSubmit} className="shrink-0 border-t border-slate-800 bg-[#090d18] p-3">
        <div className="mx-auto flex max-w-3xl gap-2">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            disabled={running}
            rows={2}
            placeholder="메시지를 입력하세요"
            className="min-h-[48px] flex-1 resize-none rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={running || !prompt.trim()}
            className="grid h-[48px] w-14 place-items-center rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50"
            aria-label="Send"
          >
            {running ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </button>
        </div>
      </form>
    </main>
  );
}
