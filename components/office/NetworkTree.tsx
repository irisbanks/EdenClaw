'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchJson } from '@/lib/fetch-json';

interface TreeNode {
  id: string;
  position: 'LEFT' | 'RIGHT' | 'ROOT';
  epBalance: number;
  subscriptionStatus: string;
  ownPV: number;
  rollupPV: number;
  leftPV: number;
  rightPV: number;
  childCount: number;
  left: TreeNode | null;
  right: TreeNode | null;
  truncated?: boolean;
}

const fmt = (n: number) => n.toLocaleString('ko-KR', { maximumFractionDigits: 1 });
const shortId = (id: string) => (id.length > 16 ? id.slice(0, 14) + '…' : id);

function NodeBox({ node }: { node: TreeNode }) {
  const active = node.subscriptionStatus === 'ACTIVE';
  const posColor =
    node.position === 'LEFT' ? 'border-sky-500/50 from-sky-500/10'
    : node.position === 'RIGHT' ? 'border-amber-500/50 from-amber-500/10'
    : 'border-emerald-500/50 from-emerald-500/10';

  return (
    <div className={`w-[150px] rounded-lg border bg-gradient-to-b to-slate-800/80 px-3 py-2 text-center shadow ${posColor}`}>
      <div className="flex items-center justify-center gap-1">
        <span className={`h-2 w-2 rounded-full ${active ? 'bg-emerald-400' : 'bg-slate-500'}`} />
        <span className="truncate text-xs font-bold text-white">{shortId(node.id)}</span>
      </div>
      <div className="mt-1 text-[10px] font-semibold tracking-wide text-slate-400">
        {node.position === 'ROOT' ? '나 (ROOT)' : node.position}
      </div>
      <div className="mt-1 rounded bg-slate-900/50 py-1 text-[11px] text-slate-300">
        롤업 <b className="text-emerald-300">{fmt(node.rollupPV)}</b> PV
      </div>
      <div className="mt-0.5 text-[10px] text-slate-500">본인 {fmt(node.ownPV)} · EP ${fmt(node.epBalance)}</div>
      {node.truncated && <div className="mt-0.5 text-[10px] text-slate-500">▾ 하위 {node.childCount} (생략)</div>}
    </div>
  );
}

/** 빈 다리 자리 표시 */
function EmptyLeg({ side }: { side: 'LEFT' | 'RIGHT' }) {
  return (
    <div className="flex w-[150px] items-center justify-center rounded-lg border border-dashed border-slate-700 px-3 py-2 text-[10px] text-slate-600">
      {side} 공석
    </div>
  );
}

function TreeBranch({ node }: { node: TreeNode }) {
  const hasChildren = !node.truncated && (node.left || node.right);
  return (
    <div className="flex flex-col items-center">
      <NodeBox node={node} />
      {hasChildren && (
        <>
          {/* 세로 커넥터 */}
          <div className="h-4 w-px bg-slate-600" />
          {/* 가로 커넥터 */}
          <div className="flex items-start gap-6">
            <div className="flex flex-col items-center">
              <div className="h-4 w-px bg-slate-600" />
              {node.left ? <TreeBranch node={node.left} /> : <EmptyLeg side="LEFT" />}
            </div>
            <div className="flex flex-col items-center">
              <div className="h-4 w-px bg-slate-600" />
              {node.right ? <TreeBranch node={node.right} /> : <EmptyLeg side="RIGHT" />}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function NetworkTree({ userId, refreshMs = 6000 }: { userId: string; refreshMs?: number }) {
  const [root, setRoot] = useState<TreeNode | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { ok, data } = await fetchJson<{ root: TreeNode; error?: string }>(
        `/api/office/${encodeURIComponent(userId)}/tree`,
        { cache: 'no-store' }
      );
      if (!ok || !data) { setErr(data?.error || '조회 실패'); return; }
      setRoot(data.root); setErr(null);
    } catch { setErr('네트워크 오류'); }
  }, [userId]);

  useEffect(() => {
    load();
    const t = setInterval(load, refreshMs);
    return () => clearInterval(t);
  }, [load, refreshMs]);

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">🌳 네트워킹 계보도</h2>
        <div className="flex gap-3 text-[11px]">
          <span className="text-sky-300">● LEFT</span>
          <span className="text-amber-300">● RIGHT</span>
          <span className="text-emerald-300">● 활성</span>
        </div>
      </div>
      {err ? (
        <div className="p-6 text-red-300">⚠ {err}</div>
      ) : !root ? (
        <div className="p-6 text-slate-400 animate-pulse">계보도 불러오는 중…</div>
      ) : (
        <div className="overflow-x-auto pb-4">
          <div className="flex min-w-max justify-center px-4 pt-2">
            <TreeBranch node={root} />
          </div>
        </div>
      )}
    </div>
  );
}
