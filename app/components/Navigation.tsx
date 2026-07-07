'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useUser } from '@/components/UserProvider';

const NAV_ITEMS: ReadonlyArray<{ href: string; label: string; metallic?: boolean }> = [
  { href: '/', label: '홈' },
  { href: '/dashboard', label: '정산 대시보드' },
  { href: '/trading', label: 'AI 개발 콘솔' },
  { href: '/mobile-signal', label: '모바일 주문 신호' },
  { href: '/ai-lounge', label: 'AI 소비 라운지', metallic: true },
];

const CHARGE_HREF = '/trading';

export default function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const { email, quota, logout } = useUser();

  useEffect(() => {
    for (const item of NAV_ITEMS) router.prefetch(item.href);
    router.prefetch(CHARGE_HREF);
  }, [router]);

  const needsCharge = Boolean(quota && (quota.depleted || quota.remaining <= 0));

  return (
    <header className="sticky top-0 z-50 shrink-0 border-b border-slate-800 bg-[#0f172a]">
      <div className="w-full flex items-center justify-between gap-3 px-6 h-16 bg-[#0f172a]">
        <div className="flex min-w-0 items-center gap-4">
          <Link
            href="/"
            prefetch
            className="shrink-0 whitespace-nowrap text-sm font-bold tracking-wide text-sky-400 transition-colors hover:text-sky-300"
          >
            EDENCLAW
          </Link>

          <nav
            aria-label="주요 메뉴"
            className="flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {NAV_ITEMS.map((item) => {
              const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch
                  aria-current={active ? 'page' : undefined}
                  className={`shrink-0 truncate whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors ${
                    item.metallic
                      ? active
                        ? 'border border-cyan-300/70 bg-[linear-gradient(135deg,#e2e8f0_0%,#67e8f9_32%,#1e293b_100%)] font-bold text-slate-950 shadow-[0_0_18px_rgba(34,211,238,0.45)]'
                        : 'border border-cyan-400/40 bg-[linear-gradient(135deg,rgba(226,232,240,0.18),rgba(34,211,238,0.14),rgba(15,23,42,0.85))] font-semibold text-cyan-100 hover:border-cyan-300 hover:text-white'
                      : active
                        ? 'bg-slate-800 font-semibold text-white'
                        : 'text-slate-400 hover:bg-slate-800/60 hover:text-white'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex shrink-0 flex-nowrap items-center gap-3 text-xs">
          {email ? (
            <>
              {quota && (
                <span className="hidden shrink-0 whitespace-nowrap text-slate-400 sm:inline-flex sm:items-center sm:gap-1">
                  잔여 가스
                  <span className={`font-semibold tabular-nums ${needsCharge ? 'text-red-400' : 'text-amber-400'}`}>
                    {quota.remaining.toLocaleString()}
                  </span>
                </span>
              )}
              <button
                type="button"
                onClick={() => router.push(CHARGE_HREF)}
                className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 font-bold transition-colors ${
                  needsCharge
                    ? 'animate-pulse bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 shadow-[0_0_16px_rgba(251,191,36,0.5)] hover:from-amber-300 hover:to-orange-400'
                    : 'border border-amber-400/40 bg-amber-500/10 text-amber-200 hover:border-amber-300 hover:text-amber-100'
                }`}
              >
                ⚡ 충전하러 가기
              </button>
              <span className="hidden min-w-0 max-w-[180px] truncate rounded-full bg-slate-800 px-3 py-1 font-medium text-slate-200 md:inline-block">
                {email}
              </span>
              <button
                type="button"
                onClick={logout}
                className="shrink-0 whitespace-nowrap text-slate-500 transition-colors hover:text-red-400"
              >
                로그아웃
              </button>
            </>
          ) : (
            <Link
              href="/dashboard"
              prefetch
              className="shrink-0 whitespace-nowrap rounded-md border border-sky-500/50 bg-sky-500/10 px-3 py-1.5 font-semibold text-sky-300 transition-colors hover:border-sky-400 hover:text-sky-200"
            >
              로그인 / 가입
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
