'use client';

import { useState } from 'react';
import MyOfficeDashboard from '@/components/office/MyOfficeDashboard';
import NetworkTree from '@/components/office/NetworkTree';
import FloatingChatWidget from '@/components/office/FloatingChatWidget';

const DEMO_USERS = ['demo-sponsor', 'demo-left', 'demo-right', 'demo-grandchild', 'demo-chat'];

export default function OfficePage() {
  const [userId, setUserId] = useState('demo-sponsor');
  const [draft, setDraft] = useState('demo-sponsor');

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-6">
        {/* 상단바 */}
        <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">EdenClaw · Dual-Shield 마이오피스</h1>
            <p className="text-sm text-slate-400">토큰 가드 · 바이너리 정산 실시간 대시보드</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && setUserId(draft.trim())}
              list="demo-users"
              placeholder="userId"
              className="w-44 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
            />
            <datalist id="demo-users">
              {DEMO_USERS.map((u) => <option key={u} value={u} />)}
            </datalist>
            <button
              onClick={() => setUserId(draft.trim())}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500"
            >
              조회
            </button>
          </div>
        </header>

        {/* 본문: 좌 대시보드 / 우 계보도 */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <MyOfficeDashboard userId={userId} />
          <NetworkTree userId={userId} />
        </div>
      </div>

      {/* 상시 플로팅 AI 채팅 위젯 */}
      <FloatingChatWidget userId={userId} />
    </main>
  );
}
