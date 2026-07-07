'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useUser } from '@/components/UserProvider';

export default function HomeAccountPanel() {
  const { email, quota, loading, error, loadUser, registerUser, logout } = useUser();
  const [inputEmail, setInputEmail] = useState('');
  const [inputName, setInputName] = useState('');

  // 이미 전역에 유저가 세팅된 경우: 요약 + 바로가기
  if (email && quota) {
    return (
      <div className="rounded-2xl border border-emerald-800/60 bg-emerald-950/20 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs text-emerald-400">로그인됨</div>
            <div className="text-lg font-semibold text-white">{email}</div>
          </div>
          <button onClick={logout} className="text-xs text-slate-400 hover:text-red-400">로그아웃</button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
          <Stat label="잔여 가스" value={quota.remaining.toLocaleString()} accent />
          <Stat label="소진" value={quota.consumed.toLocaleString()} />
          <Stat label="사용률" value={`${quota.percentUsed.toFixed(1)}%`} />
        </div>
        <div className="mt-4 flex gap-2">
          <Link href="/dashboard" className="flex-1 rounded-lg bg-sky-600 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-sky-500">정산 대시보드</Link>
          <Link href="/trading" className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-emerald-500">AI 개발 콘솔 →</Link>
        </div>
      </div>
    );
  }

  // 미로그인: 조회/가입
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <h2 className="mb-1 text-lg font-semibold text-white">시작하기</h2>
      <p className="mb-3 text-sm text-slate-400">이메일로 조회하거나 신규 가입하면 모든 페이지에 자동 연동됩니다.</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={inputEmail}
          onChange={(e) => setInputEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && loadUser(inputEmail)}
          type="email"
          placeholder="email"
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none sm:w-64"
        />
        <input
          value={inputName}
          onChange={(e) => setInputName(e.target.value)}
          placeholder="이름 (가입 시, 선택)"
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none sm:w-40"
        />
        <button onClick={() => loadUser(inputEmail)} disabled={loading}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">조회</button>
        <button onClick={() => registerUser(inputEmail, inputName)} disabled={loading}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">가입</button>
      </div>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-800/60 px-2 py-2">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${accent ? 'text-amber-400' : 'text-white'}`}>{value}</div>
    </div>
  );
}
