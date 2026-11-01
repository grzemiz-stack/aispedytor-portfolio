/**
 * Demo "today" — right after a plain `prisma db seed`, clock = now.
 *
 * Then the rest of the seed is live too (base offers, DEMO-*, BULK-*). Every
 * seed offer has coordinates (seed-cities.ts), so none of them gets a guessed
 * detour onto the Poznań → Berlin route; the screen lists only the scenario,
 * in the same order as with the clock at +30 days.
 */
import { PrismaService } from '../../src/prisma/prisma.service';
import { GeocodingService } from '../../src/geocoding/geocoding.service';
import { LtlMatchingService } from '../../src/ltl-matching/ltl-matching.service';
import { EXPECTED_MATCHES, SCREEN_BODY } from './demo-expected';

const NOW = new Date(process.env.DEMO_NOW ?? '');
const prisma = new PrismaService();
let fetchSpy: jest.SpyInstance;

beforeAll(() => {
  if (Number.isNaN(NOW.getTime())) throw new Error('DEMO_NOW nie ustawione — uruchom tools/demo-test.sh');
  fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => {
    throw new Error('demo nie może zależeć od sieci');
  });
});

afterAll(async () => {
  fetchSpy.mockRestore();
  await prisma.$disconnect();
});

it('no seed offer is left without coordinates', async () => {
  const missing = await prisma.offer.findMany({
    where: { OR: [{ pickupLat: null }, { pickupLng: null }, { deliveryLat: null }, { deliveryLng: null }] },
    select: { externalId: true, pickupCity: true, deliveryCity: true },
  });
  expect(missing).toEqual([]);
});

it('on the demo route the screen lists only the scenario, in the scenario order', async () => {
  const geocoding = new GeocodingService(prisma, { get: () => 'demo-test@example.invalid' } as any);
  const service = new LtlMatchingService(prisma, geocoding);
  service.now = () => NOW;
  const res = await service.findMatchingOffers('seed-company-001', SCREEN_BODY);
  expect(res.matches.map(m => [m.externalId, m.value.amount, m.value.detourCost, m.value.detourToll])).toEqual(EXPECTED_MATCHES);
  expect(res.awaitingLocation).toEqual([]);
  expect(fetchSpy).not.toHaveBeenCalled();
});
