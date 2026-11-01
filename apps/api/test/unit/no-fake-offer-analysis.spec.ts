/**
 * No "AI analysis" of offers.
 *
 * `OfferAnalysis` held scores that no code computed (the seed used to fill it
 * with random numbers). The table is dropped by a migration, the seed does
 * not create it and the offers API does not return it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OffersService } from '../../src/offers/offers.service';

const seed = readFileSync(resolve(__dirname, '../../prisma/seed.ts'), 'utf8');

const prismaDir = resolve(__dirname, '../../prisma');

it('the schema has no OfferAnalysis and a migration drops its table', () => {
  const schema = readFileSync(resolve(prismaDir, 'schema.prisma'), 'utf8');
  expect(schema).not.toMatch(/OfferAnalysis|offer_analyses|matchedVehicle/);
  const sql = readdirSync(resolve(prismaDir, 'migrations'))
    .filter((d: string) => d.endsWith('_drop_offer_analysis'))
    .map((d: string) => readFileSync(resolve(prismaDir, 'migrations', d, 'migration.sql'), 'utf8')).join('\n');
  expect(sql).toMatch(/DROP TABLE "offer_analyses"/);
});

it('the seed does not create OfferAnalysis rows', () => {
  expect(seed).not.toMatch(/offerAnalysis\.(create|upsert|createMany)/);
  expect(seed).not.toMatch(/aiModelVersion/);
});

describe('offers API does not return OfferAnalysis', () => {
  const prisma: any = {
    offer: {
      findFirst: jest.fn().mockResolvedValue({ id: 'o' }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  };
  const cache: any = { get: () => undefined, set: () => undefined };
  const service = new OffersService(prisma, {} as any, cache, {} as any);

  it('detail', async () => {
    await service.findOne('o', 'c');
    expect(Object.keys(prisma.offer.findFirst.mock.calls[0][0].include)).not.toContain('analysis');
  });

  it('list', async () => {
    await service.findAll('c', { page: 1, limit: 20 } as any);
    expect(Object.keys(prisma.offer.findMany.mock.calls[0][0].include)).not.toContain('analysis');
  });
});
