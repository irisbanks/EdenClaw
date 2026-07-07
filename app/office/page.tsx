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
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl px-4 py-6">
        {/* 상단바 */}
        <header className="mb-6 flex flex-col gap-3 border-b border-zinc-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-mono text-2xl font-bold uppercase tracking-tight text-white">EdenClaw · Dual-Shield 마이오피스</h1>
            <p className="font-mono text-sm text-zinc-500">토큰 가드 · 바이너리 정산 실시간 대시보드</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && setUserId(draft.trim())}
              list="demo-users"
              placeholder="userId"
              className="w-44 rounded-none border border-zinc-800 bg-black px-3 py-2 font-mono text-sm text-white focus:border-sapphire focus:outline-none"
            />
            <datalist id="demo-users">
              {DEMO_USERS.map((u) => <option key={u} value={u} />)}
            </datalist>
            <button
              onClick={() => setUserId(draft.trim())}
              className="rounded-none border border-sapphire bg-sapphire/10 px-4 py-2 font-mono text-sm font-semibold uppercase tracking-tight text-sapphire hover:bg-sapphire/20"
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
