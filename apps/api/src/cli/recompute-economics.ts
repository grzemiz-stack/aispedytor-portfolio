/**
 * `npm run offers:recompute-economics [-- --dry-run]`. Recomputes the cost,
 * profit and margin of ALL offers with the rule of
 * `offers/offer-economics.ts`, at today's company rate. Idempotent;
 * `--dry-run` writes nothing. Run once right after the migration
 * `20261011150000_offer_margin_without_tolls` (docs/DEPLOYMENT.md). Needs the
 * built `dist/` (like `company:create`).
 */
import 'reflect-metadata';
import { parseRecomputeArgs, recomputeEconomics, type RecomputeCounts } from '../offers/recompute-economics';

export function report(c: RecomputeCounts, dryRun: boolean): string {
  return `Offers: ${c.offers}; full margin: ${c.full}; upper bound (no toll): ${c.upperBound}; no margin: ${c.empty}; ` +
    `suspected fallback routes ignored: ${c.suspectRoutes}; ` +
    `${dryRun ? 'would change' : 'changed'}: ${c.changed}${dryRun ? ' (dry run — nothing written)' : ''}`;
}

async function main(): Promise<void> {
  const { dryRun } = parseRecomputeArgs(process.argv.slice(2));
  // Loaded only here: the test calls recomputeEconomics without Nest and a database.
  const { NestFactory } = await import('@nestjs/core');
  const { Module } = await import('@nestjs/common');
  const { ConfigModule } = await import('@nestjs/config');
  const { validateEnv } = await import('../common/config/secrets');
  const { PrismaModule } = await import('../prisma/prisma.module');
  const { PrismaService } = await import('../prisma/prisma.service');

  @Module({ imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }), PrismaModule] })
  class RecomputeModule {}

  const app = await NestFactory.createApplicationContext(RecomputeModule, { logger: ['error', 'warn'] });
  try {
    const counts = await recomputeEconomics(app.get(PrismaService), { dryRun });
    console.log(report(counts, dryRun));
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(`offers:recompute-economics failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
