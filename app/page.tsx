import Link from 'next/link';

const HERO_VIDEO = {
  poster: '/video-placeholders/edenclaw-dark-quant-poster.jpg',
  sources: [
    {
      src: '/videos/edenclaw-dark-quant-loop.mp4',
      type: 'video/mp4',
    },
  ],
};

const MODULES = [
  {
    index: '01',
    label: 'SYSTEM',
    href: '/dashboard',
    title: 'Dual-Shield Settlement Core',
    desc: '정산 원장, 토큰 쿼터, 좌우 볼륨을 하나의 리스크 프레임으로 통제합니다.',
  },
  {
    index: '02',
    label: 'STRUCTURE',
    href: '/office',
    title: 'Binary Network Office',
    desc: '무한 계보도와 LegBalance 흐름을 실시간으로 추적하는 운영 단말입니다.',
  },
  {
    index: '03',
    label: 'MARKET',
    href: '/market',
    title: 'AI Verified Commerce',
    desc: '상품 검증, 공동구매, 협상 에이전트를 금융 인프라처럼 정리합니다.',
  },
  {
    index: '04',
    label: 'SWARM',
    href: '/swarm',
    title: 'Autonomous Agent Mesh',
    desc: '다중 에이전트 전략과 시뮬레이션을 관측 가능한 시스템으로 운용합니다.',
  },
  {
    index: '05',
    label: 'SIGNAL',
    href: '/mobile-signal',
    title: 'Manual Order Signal',
    desc: 'Bitget 수동 주문 참고용 신호만 표시합니다. 봇 주문 실행은 비활성화되어 있습니다.',
  },
  {
    index: '06',
    label: 'QUOTA',
    href: '/trading',
    title: 'Developer Compute Ledger',
    desc: 'AI 개발 루프의 토큰 소진, 오버드래프트, 충전 상태를 계량화합니다.',
  },
];

const METRICS = [
  { value: 'DRY', label: 'Execution Mode' },
  { value: '0', label: 'Exchange Orders' },
  { value: '24/7', label: 'Signal Watch' },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-black text-white">
      <section className="relative isolate flex min-h-screen overflow-hidden">
        <div className="absolute inset-0 -z-30 bg-black">
          <video
            aria-hidden="true"
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
            poster={HERO_VIDEO.poster}
            className="h-full w-full object-cover opacity-70 grayscale"
          >
            {HERO_VIDEO.sources.map((source) => (
              <source key={source.src} src={source.src} type={source.type} />
            ))}
          </video>
        </div>

        <div
          aria-hidden="true"
          className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_50%_30%,rgba(39,39,42,0.72),rgba(0,0,0,0)_42%),linear-gradient(115deg,rgba(255,255,255,0.08),rgba(0,0,0,0)_34%)]"
        />
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-black/60" />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 opacity-[0.11] [background-image:linear-gradient(rgba(255,255,255,0.18)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.18)_1px,transparent_1px)] [background-size:80px_80px]"
        />

        <div className="mx-auto flex w-full max-w-7xl flex-col justify-between px-5 py-7 sm:px-8 lg:px-10">
          <nav className="flex items-center justify-between border-b border-zinc-900 pb-5 text-[10px] font-semibold uppercase tracking-[0.34em] text-zinc-500">
            <span>EDENCLAW / QUANT OS</span>
            <span className="hidden sm:inline">No private execution · Manual signal only</span>
          </nav>

          <div className="flex flex-1 items-center py-20">
            <div className="w-full">
              <p className="mb-8 text-xs font-semibold uppercase tracking-[0.55em] text-zinc-400">
                Autonomous finance interface
              </p>

              <h1 className="max-w-6xl text-[clamp(4.4rem,16vw,15rem)] font-black uppercase leading-[0.74] tracking-[-0.12em] text-white">
                <span className="sr-only">EDENCLAW</span>
                <span aria-hidden="true" className="block translate-x-[-0.04em]">
                  EDEN
                </span>
                <span
                  aria-hidden="true"
                  className="mt-3 block translate-x-[0.11em] border-t border-white/80 pt-4"
                >
                  CLAW
                </span>
              </h1>

              <div className="mt-12 grid gap-8 lg:grid-cols-[1fr_420px] lg:items-end">
                <p className="max-w-2xl text-base leading-8 text-zinc-300 sm:text-lg">
                  EdenClaw is a black-box command surface for settlement,
                  agent swarms, commerce verification, and manual trading
                  signal observation. Sharp edges. No toy icons. No automatic
                  exchange execution.
                </p>

                <div className="grid grid-cols-3 border border-zinc-900 bg-black">
                  {METRICS.map((metric) => (
                    <div key={metric.label} className="border-r border-zinc-900 p-4 last:border-r-0">
                      <p className="text-2xl font-black tracking-[-0.05em] text-white">{metric.value}</p>
                      <p className="mt-2 text-[10px] uppercase tracking-[0.28em] text-zinc-500">
                        {metric.label}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-10 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/mobile-signal"
                  className="border border-white bg-white px-6 py-4 text-center text-xs font-black uppercase tracking-[0.34em] text-black transition hover:bg-zinc-200"
                >
                  Open Signal
                </Link>
                <Link
                  href="/dashboard"
                  className="border border-zinc-800 bg-black px-6 py-4 text-center text-xs font-black uppercase tracking-[0.34em] text-white transition hover:border-zinc-500"
                >
                  Enter System
                </Link>
              </div>
            </div>
          </div>

          <div className="grid gap-3 border-t border-zinc-900 pt-5 text-[10px] uppercase tracking-[0.28em] text-zinc-600 sm:grid-cols-3">
            <span>Video layer: replaceable abstract dark loop</span>
            <span>Overlay: bg-black/60 readability shield</span>
            <span>Cards: border-zinc-900 / rounded-none</span>
          </div>
        </div>
      </section>

      <section className="border-t border-zinc-900 bg-black px-5 py-20 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <div className="mb-10 flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.45em] text-zinc-500">
                Operating modules
              </p>
              <h2 className="mt-4 max-w-3xl text-3xl font-black uppercase tracking-[-0.06em] text-white sm:text-5xl">
                Interfaces built like instruments, not templates.
              </h2>
            </div>
            <p className="max-w-md text-sm leading-7 text-zinc-500">
              Every surface is indexed, bordered, and deliberately quiet. The
              system reads as a command desk: no mascots, no shopping-cart
              clipart, no decorative robot noise.
            </p>
          </div>

          <div className="grid grid-cols-1 border-l border-t border-zinc-900 md:grid-cols-2 xl:grid-cols-3">
            {MODULES.map((module) => (
              <Link
                key={module.href}
                href={module.href}
                className="group min-h-72 rounded-none border-b border-r border-zinc-900 bg-black p-6 transition hover:bg-zinc-950"
              >
                <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-[0.32em] text-zinc-600">
                  <span>
                    {module.index} / {module.label}
                  </span>
                  <span className="text-zinc-800 transition group-hover:text-white">OPEN</span>
                </div>

                <div className="mt-16">
                  <h3 className="text-2xl font-black uppercase leading-none tracking-[-0.06em] text-white">
                    {module.title}
                  </h3>
                  <p className="mt-5 max-w-sm text-sm leading-7 text-zinc-500 transition group-hover:text-zinc-300">
                    {module.desc}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
