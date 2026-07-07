import 'dotenv/config';
import { prisma } from '@/lib/prisma';
import { ensureExternalPremiumProducts } from '@/lib/services/externalPremiumProducts';

async function main() {
  const products = await ensureExternalPremiumProducts();
  for (const product of products) {
    console.log(
      `bound ${product.id}: ${product.title} | KRW ${product.price.toLocaleString()} | PV ${product.pvValue} | BV ${product.bvValue}`
    );
  }
}

main()
  .catch((error) => {
    console.error('[seed-external-premium-products]', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
