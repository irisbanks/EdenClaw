'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useUser } from '@/components/UserProvider';

const NAV_ITEMS: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/', label: '홈' },
  { href: '/dashboard', label: '정산 대시보드' },
  { href: '/trading', label: 'AI 개발 콘솔' },
  { href: '/mobile-signal', label: '모바일 주문 신호' },
  { href: '/ai-lounge', label: 'AI 소비 라운지' },
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
    <header className="sticky top-0 z-50 shrink-0 border-b border-zinc-800 bg-black">
      <div className="w-full flex items-center justify-between gap-3 px-6 h-14 bg-black">
        <div className="flex min-w-0 items-center gap-6">
          <Link
            href="/"
            prefetch
            className="shrink-0 whitespace-nowrap font-mono text-sm font-bold uppercase tracking-tight text-white transition-colors hover:text-sapphire"
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
                  className={`shrink-0 truncate whitespace-nowrap border px-3 py-1.5 text-xs uppercase tracking-tight transition-colors ${
                    active
                      ? 'border-sapphire bg-sapphire/10 font-semibold text-white'
                      : 'border-transparent text-zinc-500 hover:border-zinc-700 hover:text-white'
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
                <span className="hidden shrink-0 whitespace-nowrap items-center gap-2 border border-zinc-800 px-2 py-1 font-mono uppercase tracking-tight text-zinc-500 sm:inline-flex">
                  GAS
                  <span className={`font-semibold tabular-nums ${needsCharge ? 'text-red-500' : 'text-white'}`}>
                    {quota.remaining.toLocaleString()}
                  </span>
                </span>
              )}
              <button
                type="button"
                onClick={() => router.push(CHARGE_HREF)}
                className={`shrink-0 whitespace-nowrap border px-3 py-1.5 font-mono font-bold uppercase tracking-tight transition-colors ${
                  needsCharge
                    ? 'border-red-500 bg-red-500/10 text-red-400 hover:bg-red-500/20'
                    : 'border-sapphire bg-sapphire/10 text-sapphire hover:bg-sapphire/20'
                }`}
              >
                충전
              </button>
              <span className="hidden min-w-0 max-w-[180px] truncate border border-zinc-800 px-3 py-1 font-mono text-zinc-300 md:inline-block">
                {email}
              </span>
              <button
                type="button"
                onClick={logout}
                className="shrink-0 whitespace-nowrap font-mono uppercase tracking-tight text-zinc-600 transition-colors hover:text-red-400"
              >
                로그아웃
              </button>
            </>
          ) : (
            <Link
              href="/dashboard"
              prefetch
              className="shrink-0 whitespace-nowrap border border-sapphire px-3 py-1.5 font-mono font-semibold uppercase tracking-tight text-sapphire transition-colors hover:bg-sapphire/10"
            >
              로그인 / 가입
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
