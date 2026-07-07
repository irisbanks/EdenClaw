import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

function createPrismaClient() {
  // 연결 문자열은 env(DATABASE_URL)에서 — Supabase Session Pooler URL.
  // pg.Pool 기본 max=10은 동시 가입/구매처럼 요청마다 트랜잭션 커넥션을 잡는
  // 경로에서 실측으로 병목이 확인됨(30 동시 요청에서 "Unable to start a
  // transaction in the given time" P2028 다수 발생). Supabase pooler(Supavisor)는
  // 다수의 클라이언트 커넥션을 멀티플렉싱하도록 설계되어 있어 이 쪽을 올리는 게
  // 안전하다 — DB_POOL_MAX 로 조정 가능, 기본값을 20으로 상향.
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DB_POOL_MAX) || 20,
  });
  return new PrismaClient({ adapter });
}

// Next.js dev 핫리로드 시 중복 인스턴스 방지
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? createPrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export { prisma };
export default prisma;
