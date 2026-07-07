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
  displayName?: string;
}

const fmt = (n: number) => n.toLocaleString('ko-KR', { maximumFractionDigits: 1 });
const shortId = (id: string) => (id.length > 16 ? id.slice(0, 14) + '…' : id);

// 비어있거나(demo-sponsor 미존재 등) 노드 일부가 비정상이어도 프론트가 크래시 나지 않도록 쓰는 기본 뼈대 노드.
const FALLBACK_ROOT: TreeNode = {
  id: 'root',
  displayName: '가상 루트',
  position: 'ROOT',
  epBalance: 0,
  subscriptionStatus: 'INACTIVE',
  ownPV: 0,
  rollupPV: 0,
  leftPV: 0,
  rightPV: 0,
  childCount: 0,
  left: null,
  right: null,
};

// API 응답 노드를 재귀적으로 정규화한다. id 누락/잘못된 타입/null 필드 접근으로
// NodeBox 의 toLocaleString 등이 터지지 않도록 모든 필드를 안전한 기본값으로 채운다.
function sanitizeNode(raw: unknown): TreeNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const n = raw as Partial<TreeNode>;
  if (typeof n.id !== 'string' || n.id.trim() === '') return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    id: n.id,
    position: n.position === 'LEFT' || n.position === 'RIGHT' ? n.position : 'ROOT',
    epBalance: num(n.epBalance),
    subscriptionStatus: typeof n.subscriptionStatus === 'string' ? n.subscriptionStatus : 'INACTIVE',
    ownPV: num(n.ownPV),
    rollupPV: num(n.rollupPV),
    leftPV: num(n.leftPV),
    rightPV: num(n.rightPV),
    childCount: num(n.childCount),
    left: sanitizeNode(n.left),
    right: sanitizeNode(n.right),
    truncated: Boolean(n.truncated),
    displayName: typeof n.displayName === 'string' ? n.displayName : undefined,
  };
}

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
        <span className="truncate text-xs font-bold text-white">{shortId(node.displayName ?? node.id)}</span>
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
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { ok, data } = await fetchJson<{ root: TreeNode | null; error?: string }>(
        `/api/office/${encodeURIComponent(userId)}/tree`,
        { cache: 'no-store' }
      );
      if (!ok) { setErr(data?.error || '조회 실패'); return; }
      // ok 응답이어도 root 가 null/누락/비정상일 수 있다 → 정규화 후 빈 트리로 안전 처리.
      setRoot(sanitizeNode(data?.root)); setErr(null);
    } catch {
      setErr('네트워크 오류');
    } finally {
      // 성공/실패와 무관하게 로딩 패널을 반드시 걷어내 무한 대기를 차단한다.
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    setLoading(true);
    setRoot(null);
    setErr(null);
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
      ) : loading && !root ? (
        <div className="p-6 text-slate-400 animate-pulse">계보도 불러오는 중…</div>
      ) : !root ? (
        // 무한 대기 패널을 걷어내고, 안내 메시지 + 기본 뼈대 노드로 섀도우 렌더링한다.
        <div className="space-y-3">
          <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-4 text-sm text-slate-400">
            조회된 계보 데이터가 없습니다. <span className="text-slate-500">({userId})</span>
          </div>
          <div className="overflow-x-auto pb-4 opacity-60">
            <div className="flex min-w-max justify-center px-4 pt-2">
              <TreeBranch node={FALLBACK_ROOT} />
            </div>
          </div>
        </div>
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
