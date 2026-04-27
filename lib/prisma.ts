import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import path from 'path';

const DB_PATH = path.resolve(process.cwd(), 'prisma/dev.db');

function createPrismaClient() {
  const adapter = new PrismaBetterSqlite3({ url: DB_PATH });
  return new PrismaClient({ adapter });
}

// Next.js dev 핫리로드 시 중복 인스턴스 방지
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? createPrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export { prisma };
export default prisma;
