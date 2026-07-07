import Link from 'next/link';
import HomeAccountPanel from '@/components/HomeAccountPanel';

const FEATURES: { href: string; title: string; desc: string; icon: string; featured?: boolean }[] = [
  { href: '/dashboard', title: '정산 대시보드', desc: '이메일로 Dual-Shield 정산·토큰 쿼터·좌우 볼륨 조회', icon: '📊' },
  { href: '/office', title: '마이오피스', desc: 'userId 기준 바이너리 정산 + 무한 계보도 실시간 대시보드', icon: '🏢' },
  { href: '/market', title: '에덴 마켓', desc: 'AI 상품 검증·공동구매·협상 에이전트 커머스', icon: '🛒' },
  { href: '/swarm', title: '스웜 생태계', desc: '자율 에이전트 군집 거래 시뮬레이션', icon: '🤖' },
  { href: '/trading', title: 'AI 자율 개발 Swarm', desc: 'Claude·Gemini·Codex 개발 루프 가동 시 가스비(토큰) 실시간 소진 + Overdraft 충전', icon: '⚡' },
  { href: '/ai-lounge', title: 'AI 소비 라운지', desc: 'Gemini Pro·Claude Code·ChatGPT·Kimi를 전환하는 소비자용 Web3 AI 세션 허브', icon: '◈', featured: true },
  { href: '/mobile-signal', title: '모바일 주문 신호', desc: 'Bitget 수동 주문용 표시 신호 확인 — 봇 주문 실행 없음', icon: '📱' },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-16">
        <header className="mb-12 text-center">
          <p className="mb-2 text-sm font-semibold tracking-widest text-sky-400">EDENCLAW</p>
          <h1 className="text-4xl font-bold text-white sm:text-5xl">Dual-Shield 정산 플랫폼</h1>
          <p className="mx-auto mt-4 max-w-2xl text-slate-400">
            대리점 무한 계보도(LegBalance) · Dual-Shield 보상 원장(Transaction) ·
            전문가용 초과 토큰 오버드래프트(TokenQuota)를 하나로 묶은 정산 엔진
          </p>
        </header>

        <div className="mb-8">
          <HomeAccountPanel />
        </div>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <Link
              key={f.href}
              href={f.href}
              className={`group rounded-2xl border p-6 transition ${
                f.featured
                  ? 'border-cyan-400/50 bg-[linear-gradient(135deg,rgba(226,232,240,0.12),rgba(34,211,238,0.13),rgba(15,23,42,0.98))] shadow-[0_0_28px_rgba(34,211,238,0.18)] hover:border-cyan-300'
                  : 'border-slate-800 bg-slate-900 hover:border-sky-600 hover:bg-slate-800/70'
              }`}
            >
              <div className="mb-3 text-3xl">{f.icon}</div>
              <h2 className={`text-lg font-semibold text-white ${f.featured ? 'group-hover:text-cyan-200' : 'group-hover:text-sky-300'}`}>{f.title}</h2>
              <p className="mt-1 text-sm text-slate-400">{f.desc}</p>
              <span className={`mt-4 inline-block text-sm font-medium ${f.featured ? 'text-cyan-300' : 'text-sky-400'}`}>바로가기 →</span>
            </Link>
          ))}
        </section>

        <footer className="mt-12 text-center text-xs text-slate-600">
          EdenClaw · Powered by Supabase PostgreSQL + Prisma · Next.js on Vercel
        </footer>
      </div>
    </main>
  );
}
