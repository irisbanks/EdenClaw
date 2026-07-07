'use client';

import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import type React from 'react';
import {
  Activity,
  BrainCircuit,
  Calculator,
  Code2,
  Database,
  Gauge,
  Loader2,
  LogIn,
  RefreshCw,
  Send,
  ShieldCheck,
  UserPlus,
  WalletCards,
  Zap,
  type LucideProps,
} from 'lucide-react';
import { useUser, type Quota } from '@/components/UserProvider';

type EngineKey = 'gemini-pro' | 'chatgpt-codex' | 'claude-cursor' | 'kimi-moonshot';
type Tone = {
  border: string;
  active: string;
  text: string;
  bg: string;
  bar: string;
};
type EngineOption = {
  key: EngineKey;
  name: string;
  lane: string;
  gas: number;
  pvValue: number;
  bvValue: number;
  icon: ComponentType<LucideProps>;
  tone: Tone;
};
type StreamEvent = Record<string, unknown> & { type?: string; status?: string };
type Message = { id: number; role: 'user' | 'ai'; text: string; model?: string; tokens?: number; status?: string };
type EventLog = { id: number; stage: string; status: string; text: string; tone: 'info' | 'ok' | 'warn' | 'danger' };
type PremiumPack = {
  id: string;
  title: string;
  price: number;
  pvValue: number;
  bvValue: number;
};

const ENGINES: EngineOption[] = [
  {
    key: 'gemini-pro',
    name: 'Gemini 3.1 / 3.5 Pro',
    lane: 'Curated analytics and smart commerce',
    gas: 12_000,
    pvValue: 1_800,
    bvValue: 1_800,
    icon: BrainCircuit,
    tone: {
      border: 'border-emerald-500/50',
      active: 'bg-emerald-500/15 shadow-[0_0_22px_rgba(16,185,129,0.28)]',
      text: 'text-emerald-300',
      bg: 'bg-emerald-500/10',
      bar: 'bg-emerald-400',
    },
  },
  {
    key: 'chatgpt-codex',
    name: 'ChatGPT & OpenAI Codex',
    lane: 'Arithmetic and training simulation',
    gas: 15_000,
    pvValue: 2_250,
    bvValue: 2_250,
    icon: Calculator,
    tone: {
      border: 'border-cyan-500/50',
      active: 'bg-cyan-500/15 shadow-[0_0_22px_rgba(34,211,238,0.28)]',
      text: 'text-cyan-300',
      bg: 'bg-cyan-500/10',
      bar: 'bg-cyan-400',
    },
  },
  {
    key: 'claude-cursor',
    name: 'Claude Code & Cursor Loop',
    lane: 'Premium implementation optimization',
    gas: 25_000,
    pvValue: 3_750,
    bvValue: 3_750,
    icon: Code2,
    tone: {
      border: 'border-rose-500/50',
      active: 'bg-rose-500/15 shadow-[0_0_22px_rgba(244,63,94,0.28)]',
      text: 'text-rose-300',
      bg: 'bg-rose-500/10',
      bar: 'bg-rose-400',
    },
  },
  {
    key: 'kimi-moonshot',
    name: 'Kimi / Moonshot AI',
    lane: 'Batch mining and background planning',
    gas: 0,
    pvValue: 0,
    bvValue: 0,
    icon: Database,
    tone: {
      border: 'border-amber-500/50',
      active: 'bg-amber-500/15 shadow-[0_0_22px_rgba(245,158,11,0.25)]',
      text: 'text-amber-300',
      bg: 'bg-amber-500/10',
      bar: 'bg-amber-400',
    },
  },
];

const LOG_TONE: Record<EventLog['tone'], string> = {
  info: 'border-slate-700 bg-slate-900/70 text-slate-300',
  ok: 'border-emerald-700/70 bg-emerald-950/35 text-emerald-200',
  warn: 'border-amber-700/70 bg-amber-950/35 text-amber-200',
  danger: 'border-rose-700/70 bg-rose-950/35 text-rose-200',
};

const PREMIUM_PACKS: PremiumPack[] = [
  {
    id: 'external-ai-gemini-pro-18m',
    title: 'Gemini Pro 18-Month',
    price: 59_800,
    pvValue: 45,
    bvValue: 36,
  },
  {
    id: 'external-ai-youtube-premium-12m',
    title: 'YouTube Premium 12-Month',
    price: 64_800,
    pvValue: 50,
    bvValue: 40,
  },
  {
    id: 'external-ai-youtube-gemini-infra-pack',
    title: 'YouTube + Gemini Total Infra',
    price: 118_900,
    pvValue: 95,
    bvValue: 76,
  },
];

const ACTIVE_SESSION_LABEL = 'Active Enterprise Session (Gemini/OpenAI Bridge Connected)';

function eventText(value: unknown, fallback = '') {
  try {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value == null) return fallback;
    return JSON.stringify(value) ?? fallback;
  } catch {
    return fallback;
  }
}

function eventNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function progressStyle(percent: number) {
  return { width: `${Math.max(0, Math.min(100, percent))}%` };
}

export default function AiLoungePage() {
  const { email, quota, loading, error, loadUser, registerUser, setQuota, refresh } = useUser();
  const [inputEmail, setInputEmail] = useState('');
  const [inputName, setInputName] = useState('');
  const [engine, setEngine] = useState<EngineKey>('gemini-pro');
  const [prompt, setPrompt] = useState('');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [events, setEvents] = useState<EventLog[]>([]);
  const [sessionPv, setSessionPv] = useState(0);
  const [localError, setLocalError] = useState('');
  const [sessionState, setSessionState] = useState('No active session');
  const [activating, setActivating] = useState(false);
  const [buyingProduct, setBuyingProduct] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const idRef = useRef(0);
  const activeAiId = useRef(0);

  const activeEngine = useMemo(() => ENGINES.find((item) => item.key === engine) ?? ENGINES[0], [engine]);
  const ActiveIcon = activeEngine.icon;
  const usedPercent = quota?.percentUsed ?? 0;
  const remainingPercent = Math.max(0, 100 - usedPercent);
  const ledgerLegs = quota?.ledger?.legs;
  const ledgerPv = (ledgerLegs?.leftPV ?? 0) + (ledgerLegs?.rightPV ?? 0);
  const pvBadge = sessionPv + ledgerPv;
  const hasSpendableGas = (quota?.remaining ?? 0) > 0;
  const liveSession = hasSpendableGas || sessionState.startsWith('Active Enterprise Session');

  function pushEvent(log: Omit<EventLog, 'id'>) {
    setEvents((prev) => [{ ...log, id: ++idRef.current }, ...prev].slice(0, 28));
  }

  useEffect(() => {
    if (!email || !quota || quota.remaining <= 0) return;
    if (sessionState.startsWith('Active Enterprise Session')) return;
    setSessionState(ACTIVE_SESSION_LABEL);
    setStatus('active_enterprise_session');
    pushEvent({
      stage: 'Runtime State',
      status: 'active_enterprise_session',
      text: `${quota.remaining.toLocaleString()} GAS available · bridge unlocked`,
      tone: 'ok',
    });
  }, [email, quota?.remaining]);

  function updateAiMessage(updater: (message: Message) => Message) {
    const id = activeAiId.current || ++idRef.current;
    activeAiId.current = id;
    setMessages((prev) => {
      const seeded = prev.some((item) => item.id === id)
        ? prev
        : [{ id, role: 'ai' as const, text: '', model: activeEngine.name, status: 'streaming' }, ...prev];
      return seeded.map((item) => (item.id === id ? updater(item) : item));
    });
  }

  function handleStage(ev: StreamEvent) {
    const statusText = eventText(ev.status, 'stage');
    const note = eventText(ev.note || ev.content || ev.error, statusText);
    if (statusText === 'chunk') {
      const delta = eventText(ev.delta);
      if (delta) updateAiMessage((msg) => ({ ...msg, text: `${msg.text}${delta}`, status: 'streaming' }));
      return;
    }
    if (ev.quota) setQuota(ev.quota as Quota);
    if (statusText === 'active_enterprise_session') {
      setSessionState(eventText(ev.sessionLabel, eventText(ev.note, ACTIVE_SESSION_LABEL)));
      setStatus('active_enterprise_session');
      if (activeAiId.current) updateAiMessage((msg) => ({ ...msg, model: eventText(ev.agent, activeEngine.name), status: 'streaming' }));
      pushEvent({ stage: eventText(ev.label, 'AI Lounge'), status: statusText, text: note, tone: 'ok' });
      return;
    }
    if (statusText === 'paywall_blocked') {
      setStatus('paywall_blocked');
      setSessionState('No active session');
      updateAiMessage((msg) => ({
        ...msg,
        text: note,
        model: 'Overdraft Ledger',
        status: 'paywall_blocked',
      }));
      pushEvent({ stage: eventText(ev.label, 'Gas Audit'), status: statusText, text: note, tone: 'warn' });
      return;
    }
    if (statusText === 'render_crash_prevented') {
      setStatus('render_crash_prevented');
      setSessionState('No active session');
      setLocalError(note);
      updateAiMessage((msg) => ({ ...msg, text: note, model: 'State Guard', status: 'protected' }));
      pushEvent({ stage: eventText(ev.label, 'Crash Guard'), status: statusText, text: note, tone: 'danger' });
      return;
    }
    const tone: EventLog['tone'] = statusText === 'done' ? 'ok' : statusText === 'start' ? 'info' : 'warn';
    pushEvent({ stage: eventText(ev.label, 'AI Lounge'), status: statusText, text: note, tone });
  }

  function handleDone(ev: StreamEvent) {
    if (ev.quota) setQuota(ev.quota as Quota);
    const doneStatus = eventText(ev.status, 'done');
    if (doneStatus === 'done') {
      const content = eventText(ev.content);
      const accumulatedPV = eventNumber(ev.accumulatedPV);
      const contributionPV = eventNumber((ev.contribution as { pvValue?: unknown } | undefined)?.pvValue);
      const pv = accumulatedPV > 0 ? accumulatedPV : contributionPV;
      if (pv > 0) setSessionPv((value) => value + pv);
      updateAiMessage((msg) => ({
        ...msg,
        text: msg.text || content,
        model: eventText(ev.provider, activeEngine.name),
        tokens: eventNumber(ev.totalTokens),
        status: 'done',
      }));
      setStatus(`done:${eventNumber(ev.gasCharged).toLocaleString()}`);
      pushEvent({
        stage: 'Dual-Shield',
        status: 'done',
        text: `PV ${pv.toLocaleString()} · GAS ${eventNumber(ev.gasCharged).toLocaleString()}`,
        tone: 'ok',
      });
      return;
    }
    if (doneStatus === 'active_enterprise_session') {
      setSessionState(eventText(ev.sessionLabel, ACTIVE_SESSION_LABEL));
      setStatus('active_enterprise_session');
      pushEvent({ stage: 'Enterprise Session', status: doneStatus, text: eventText(ev.sessionLabel, ACTIVE_SESSION_LABEL), tone: 'ok' });
      return;
    }
    if (doneStatus === 'paywall_blocked') { setStatus('paywall_blocked'); setSessionState('No active session'); }
    if (doneStatus === 'render_crash_prevented') { setStatus('render_crash_prevented'); setSessionState('No active session'); }
  }

  function handleJsonSuccess(json: StreamEvent) {
    const events = (json.events ?? json.packets) as unknown;
    if (Array.isArray(events)) {
      events.forEach((item) => handleStreamEvent(item as StreamEvent));
      return;
    }
    handleStage({ ...json, type: 'stage', status: eventText(json.status, 'done') });
    handleDone({ ...json, type: 'done', status: eventText(json.status, 'done') });
  }

  async function consumeSwarmExecuteResponse(res: Response) {
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const json = (await res.json().catch(() => ({}))) as StreamEvent;
      if (!res.ok) throw new Error(eventText(json.error, `Request failed (${res.status})`));
      handleJsonSuccess(json);
      return;
    }
    await consumeNdjson(res);
  }

  function handleStreamEvent(ev: StreamEvent) {
    try {
      const type = eventText(ev.type);
      if (type === 'init') {
        pushEvent({ stage: 'Session', status: 'init', text: eventText((ev.engine as { label?: unknown } | undefined)?.label, activeEngine.name), tone: 'info' });
        return;
      }
      if (type === 'stage') { handleStage(ev); return; }
      if (type === 'done') { handleDone(ev); return; }
      pushEvent({ stage: 'Stream', status: 'render_crash_prevented', text: 'Unknown stream packet was isolated.', tone: 'danger' });
    } catch (streamError) {
      setLocalError(streamError instanceof Error ? streamError.message : 'Stream packet was isolated.');
      setStatus('render_crash_prevented');
    }
  }

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = prompt.trim();
    if (!email || !text || running) return;
    setPrompt('');
    setLocalError('');
    setStatus('starting');
    const userId = ++idRef.current;
    const aiId = ++idRef.current;
    activeAiId.current = aiId;
    setMessages((prev) => [
      { id: aiId, role: 'ai' as const, text: '', model: activeEngine.name, status: 'queued' },
      { id: userId, role: 'user' as const, text },
      ...prev,
    ].slice(0, 60));

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    try {
      const res = await fetch('/api/swarm/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          userPrompt: text,
          selectedModel: engine,
          email,
        }),
      });
      await consumeSwarmExecuteResponse(res);
    } catch (requestError) {
      if ((requestError as Error).name !== 'AbortError') {
        const message = requestError instanceof Error ? requestError.message : 'Network failure';
        setLocalError(message);
        setStatus('render_crash_prevented');
        updateAiMessage((msg) => ({ ...msg, text: message, model: 'State Guard', status: 'protected' }));
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  async function overdraft() {
    if (!email) return;
    setLocalError('');
    try {
      const res = await fetch('/api/trading/quota', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, action: 'overdraft' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(eventText(json.error, 'Overdraft failed'));
      setQuota(json as Quota);
      setStatus('overdraft_ready');
      pushEvent({ stage: 'Overdraft', status: 'done', text: `GAS ${eventNumber(json.swapped).toLocaleString()} recharged`, tone: 'ok' });
    } catch (overdraftError) {
      setLocalError(overdraftError instanceof Error ? overdraftError.message : 'Overdraft failed');
    }
  }

  async function consumeNdjson(res: Response) {
    if (!res.body) {
      const json = await res.json().catch(() => ({}));
      throw new Error(eventText(json.error, `Request failed (${res.status})`));
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const processLine = (line: string) => {
      const raw = line.trim();
      if (!raw) return;
      try {
        handleStreamEvent(JSON.parse(raw) as StreamEvent);
      } catch {
        setStatus('render_crash_prevented');
        setLocalError('Malformed stream line was isolated.');
      }
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) processLine(line);
    }
    if (buffer.trim()) processLine(buffer);
  }

  async function activateExternalPremiumLink() {
    if (!email || activating) return;
    setActivating(true);
    setLocalError('');
    setStatus('activating');
    try {
      const res = await fetch('/api/ai-lounge/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      await consumeNdjson(res);
    } catch (activationError) {
      const message = activationError instanceof Error ? activationError.message : 'Activation failed';
      setLocalError(message);
      setStatus('render_crash_prevented');
      setSessionState('No active session');
      pushEvent({ stage: 'Premium Link', status: 'render_crash_prevented', text: message, tone: 'danger' });
    } finally {
      setActivating(false);
    }
  }

  async function buyPack(pack: PremiumPack) {
    if (!email || buyingProduct) return;
    setBuyingProduct(pack.id);
    setLocalError('');
    try {
      const res = await fetch('/api/commerce/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, productId: pack.id }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(eventText(json.error, 'Purchase failed'));
      if (json.quota) setQuota(json.quota as Quota);
      setSessionState(ACTIVE_SESSION_LABEL);
      pushEvent({
        stage: 'Commerce',
        status: 'done',
        text: `${pack.title} bound · PV ${pack.pvValue} / BV ${pack.bvValue} · ${eventNumber(json.rollup?.depth).toLocaleString()} uplines`,
        tone: 'ok',
      });
    } catch (purchaseError) {
      const message = purchaseError instanceof Error ? purchaseError.message : 'Purchase failed';
      setLocalError(message);
      pushEvent({ stage: 'Commerce', status: 'render_crash_prevented', text: message, tone: 'danger' });
    } finally {
      setBuyingProduct('');
    }
  }

  if (!email || !quota) {
    return (
      <main className="min-h-[calc(100dvh-46px)] bg-[#070a12] text-slate-100">
        <div className="mx-auto flex min-h-[calc(100dvh-46px)] w-full max-w-md flex-col justify-center px-4">
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-5">
            <div className="mb-4 flex items-center gap-2">
              <WalletCards className="h-5 w-5 text-emerald-300" />
              <h1 className="text-lg font-semibold text-white">EdenClaw AI Lounge</h1>
            </div>
            <div className="space-y-2">
              <input
                value={inputEmail}
                onChange={(event) => setInputEmail(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && void loadUser(inputEmail)}
                type="email"
                placeholder="email"
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400"
              />
              <input
                value={inputName}
                onChange={(event) => setInputName(event.target.value)}
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
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="grid h-[calc(100dvh-46px)] grid-cols-1 overflow-hidden bg-[#070a12] text-slate-100 xl:grid-cols-[390px_1fr]">
      <section className="flex min-h-0 flex-col border-r border-slate-800 bg-[#090d18]">
        <div className="shrink-0 border-b border-slate-800 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h1 className="text-base font-semibold text-white">AI Lounge</h1>
              <p className="text-xs text-slate-400">{email}</p>
            </div>
            <button onClick={() => void refresh()} disabled={loading || running} className="grid h-9 w-9 place-items-center rounded-md border border-slate-700 text-slate-300 hover:border-cyan-400 hover:text-cyan-200 disabled:opacity-50" aria-label="Refresh quota">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-slate-400"><Gauge className="h-3.5 w-3.5" /> Consumed Token Quota</span>
                <span className="font-mono text-slate-300">{usedPercent.toFixed(1)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                <div className={`h-full ${activeEngine.tone.bar} transition-[width] duration-500`} style={progressStyle(usedPercent)} />
              </div>
              <div className="mt-2 text-[11px] text-slate-500">
                {quota.consumed.toLocaleString()} / {quota.allocated.toLocaleString()}
              </div>
            </div>
            <div className="rounded-lg border border-emerald-500/50 bg-emerald-950/25 p-3 shadow-[0_0_20px_rgba(16,185,129,0.16)]">
              <div className="mb-2 flex items-center gap-1.5 text-xs text-emerald-300">
                <ShieldCheck className="h-3.5 w-3.5" /> Accumulated PV Contribution
              </div>
              <div className="font-mono text-xl font-semibold text-white">{pvBadge.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
              <div className="mt-1 text-[11px] text-emerald-200/70">session {sessionPv.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <Metric label="Remaining" value={quota.remaining.toLocaleString()} icon={Zap} />
            <Metric label="Monthly" value={`${remainingPercent.toFixed(1)}%`} icon={Activity} />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="grid gap-2">
            {ENGINES.map((item) => {
              const Icon = item.icon;
              const active = item.key === engine;
              return (
                <button
                  key={item.key}
                  onClick={() => !running && setEngine(item.key)}
                  disabled={running}
                  className={`rounded-lg border p-3 text-left transition ${active ? `${item.tone.border} ${item.tone.active}` : 'border-slate-800 bg-slate-950 hover:border-slate-600'} disabled:opacity-60`}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className={`flex items-center gap-2 text-sm font-semibold ${active ? item.tone.text : 'text-slate-200'}`}>
                      <Icon className="h-4 w-4" /> {item.name}
                    </span>
                    <span className={`rounded-md px-2 py-0.5 font-mono text-[10px] ${item.tone.bg} ${item.tone.text}`}>
                      {item.gas.toLocaleString()} GAS
                    </span>
                  </div>
                  <div className="text-xs text-slate-400">{item.lane}</div>
                  <div className="mt-2 flex gap-2 text-[11px] text-slate-500">
                    <span>PV {item.pvValue}</span>
                    <span>BV {item.bvValue}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {status === 'paywall_blocked' && (
          <div className="shrink-0 border-t border-amber-700 bg-amber-950/30 p-3">
            <button onClick={() => void overdraft()} className="flex w-full items-center justify-center gap-2 rounded-md bg-amber-500 px-3 py-2 text-sm font-bold text-slate-950 hover:bg-amber-400">
              <Zap className="h-4 w-4" /> Activate Overdraft Ledger Swap
            </button>
          </div>
        )}
      </section>

      <section className="grid min-h-0 grid-rows-[1fr_auto]">
        <div className="grid min-h-0 grid-cols-1 lg:grid-cols-[1fr_320px]">
          <div className="min-h-0 overflow-y-auto p-4">
            {localError && <div className="mb-3 rounded-lg border border-rose-700 bg-rose-950/35 px-3 py-2 text-sm text-rose-200">{localError}</div>}
            {messages.length === 0 ? (
              <div className="grid h-full place-items-center">
                <div className="w-full max-w-xl rounded-lg border border-slate-800 bg-slate-950 p-5 text-center">
                  <div className={`mx-auto mb-3 grid h-12 w-12 place-items-center rounded-lg ${activeEngine.tone.bg} ${activeEngine.tone.text}`}>
                    <ActiveIcon className="h-6 w-6" />
                  </div>
                  <div className="text-sm font-semibold text-white">{activeEngine.name}</div>
                  <div className="mt-1 text-xs text-slate-400">{activeEngine.lane}</div>
                </div>
              </div>
            ) : (
              <div className="mx-auto flex max-w-4xl flex-col gap-3">
                {messages.map((message) => (
                  <div key={message.id} className={`rounded-lg border px-3 py-2 ${message.role === 'user' ? 'ml-auto max-w-[82%] border-cyan-700/60 bg-cyan-950/25 text-cyan-50' : 'mr-auto max-w-[92%] border-slate-800 bg-slate-950 text-slate-100'}`}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-[11px]">
                      <span className={message.role === 'user' ? 'text-cyan-300' : activeEngine.tone.text}>{message.role === 'user' ? 'YOU' : message.model}</span>
                      {message.status === 'streaming' && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
                    </div>
                    <div className="whitespace-pre-wrap text-sm leading-relaxed">{message.text || (message.role === 'ai' ? 'Generating...' : '')}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <aside className="hidden min-h-0 flex-col border-l border-slate-800 bg-[#090d18] lg:flex">
            <div className="shrink-0 border-b border-slate-800 px-3 py-2">
              <div className="mb-1 text-xs font-semibold text-slate-400">Runtime State</div>
              <div className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${liveSession ? 'border-emerald-500/60 bg-emerald-950/35 text-emerald-200' : 'border-slate-800 bg-slate-950 text-slate-500'}`}>
                {sessionState}
              </div>
              <button
                onClick={() => void activateExternalPremiumLink()}
                disabled={activating || running}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-cyan-400/50 bg-[linear-gradient(135deg,rgba(226,232,240,0.16),rgba(34,211,238,0.16),rgba(15,23,42,0.94))] px-2 py-2 text-[11px] font-bold text-cyan-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] hover:border-cyan-300 disabled:opacity-50"
              >
                {activating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                🔗 외부 프리미엄 AI 정식 활성화 링크 연동
              </button>
              <div className="mt-3 space-y-1.5">
                <div className="text-[11px] font-semibold text-slate-500">Prekart external packs</div>
                {PREMIUM_PACKS.map((pack) => (
                  <button
                    key={pack.id}
                    onClick={() => void buyPack(pack)}
                    disabled={Boolean(buyingProduct) || running}
                    className="w-full rounded-md border border-slate-800 bg-slate-950 px-2 py-2 text-left text-[11px] text-slate-300 hover:border-emerald-500/50 disabled:opacity-50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-100">{pack.title}</span>
                      {buyingProduct === pack.id ? <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-300" /> : <span className="font-mono text-emerald-300">₩{pack.price.toLocaleString()}</span>}
                    </div>
                    <div className="mt-1 text-slate-500">PV {pack.pvValue.toFixed(2)} · BV {pack.bvValue.toFixed(2)}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
              {events.length === 0 ? <div className="text-xs text-slate-600">{sessionState}</div> : events.map((event) => (
                <div key={event.id} className={`rounded-lg border px-2.5 py-2 text-xs ${LOG_TONE[event.tone]}`}>
                  <div className="mb-0.5 flex items-center justify-between gap-2">
                    <span className="font-semibold">{event.stage}</span>
                    <span className="font-mono text-[10px] opacity-75">{event.status}</span>
                  </div>
                  <div className="line-clamp-3 text-[11px] leading-snug opacity-90">{event.text}</div>
                </div>
              ))}
            </div>
          </aside>
        </div>

        <div className="shrink-0 border-t border-slate-800 bg-[#090d18] p-3">
          {running && (
            <div className="mb-2 flex items-center gap-2 rounded-md border border-cyan-600/50 bg-cyan-950/35 px-3 py-2 text-xs text-cyan-200">
              <Loader2 className="h-4 w-4 animate-spin" /> {activeEngine.name} is generating
            </div>
          )}
          <form onSubmit={handleSubmit} className="flex gap-2">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              disabled={running}
              rows={2}
              placeholder={liveSession ? `${activeEngine.name} prompt` : `${activeEngine.name} prompt · GAS 충전 또는 활성화 필요`}
              className="min-h-[48px] flex-1 resize-none rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400 disabled:opacity-60"
            />
            <button
              type={running ? 'button' : 'submit'}
              onClick={running ? () => abortRef.current?.abort() : undefined}
              disabled={!running && !prompt.trim()}
              className={`grid h-[48px] w-14 place-items-center rounded-lg text-white disabled:opacity-50 ${running ? 'bg-rose-600 hover:bg-rose-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}
              aria-label={running ? 'Stop' : 'Send'}
            >
              {running ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value, icon: Icon }: { label: string; value: string; icon: ComponentType<LucideProps> }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950 p-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-slate-500">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="font-mono text-sm font-semibold text-slate-100">{value}</div>
    </div>
  );
}
