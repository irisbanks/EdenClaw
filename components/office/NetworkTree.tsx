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

  return (
    <div className="w-[150px] border border-zinc-800 bg-black px-3 py-2 text-center">
      <div className="flex items-center justify-center gap-1.5">
        <span className={`h-1.5 w-1.5 shrink-0 ${active ? 'bg-sapphire' : 'bg-zinc-700'}`} />
        <span className="truncate font-mono text-xs font-bold tracking-tight text-white">{shortId(node.displayName ?? node.id)}</span>
      </div>
      <div className="mt-1 font-mono text-[10px] font-semibold uppercase tracking-tight text-zinc-500">
        {node.position === 'ROOT' ? '나 (ROOT)' : node.position}
      </div>
      <div className="mt-1 border border-zinc-800 py-1 font-mono text-[11px] tracking-tight text-zinc-300">
        롤업 <b className="text-white">{fmt(node.rollupPV)}</b> PV
      </div>
      <div className="mt-0.5 font-mono text-[10px] tracking-tight text-zinc-600">본인 {fmt(node.ownPV)} · EP ${fmt(node.epBalance)}</div>
      {node.truncated && <div className="mt-0.5 font-mono text-[10px] tracking-tight text-zinc-600">하위 {node.childCount} (생략)</div>}
    </div>
  );
}

/** 빈 다리 자리 표시 */
function EmptyLeg({ side }: { side: 'LEFT' | 'RIGHT' }) {
  return (
    <div className="flex w-[150px] items-center justify-center border border-dashed border-zinc-800 px-3 py-2 font-mono text-[10px] uppercase tracking-tight text-zinc-700">
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
          <div className="h-4 w-px bg-zinc-800" />
          {/* 가로 커넥터 */}
          <div className="flex items-start gap-6">
            <div className="flex flex-col items-center">
              <div className="h-4 w-px bg-zinc-800" />
              {node.left ? <TreeBranch node={node.left} /> : <EmptyLeg side="LEFT" />}
            </div>
            <div className="flex flex-col items-center">
              <div className="h-4 w-px bg-zinc-800" />
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
    <div className="border border-zinc-800 bg-black p-4">
      <div className="mb-3 flex items-center justify-between border-b border-zinc-800 pb-3">
        <h2 className="font-mono text-lg font-bold uppercase tracking-tight text-white">네트워킹 계보도</h2>
        <div className="flex gap-4 font-mono text-[11px] uppercase tracking-tight text-zinc-500">
          <span>LEFT</span>
          <span>RIGHT</span>
          <span className="text-sapphire">● 활성</span>
        </div>
      </div>
      {err ? (
        <div className="p-6 font-mono text-sm text-red-400">{err}</div>
      ) : loading && !root ? (
        <div className="p-6 font-mono text-sm text-zinc-500 animate-pulse">계보도 불러오는 중…</div>
      ) : !root ? (
        // 무한 대기 패널을 걷어내고, 안내 메시지 + 기본 뼈대 노드로 섀도우 렌더링한다.
        <div className="space-y-3">
          <div className="border border-zinc-800 bg-black p-4 font-mono text-sm text-zinc-500">
            조회된 계보 데이터가 없습니다. <span className="text-zinc-600">({userId})</span>
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
