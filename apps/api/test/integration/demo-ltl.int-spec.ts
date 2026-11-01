/**
 * The demo script as a test — seed + LTL search on a real PostgreSQL.
 *
 * Run by tools/demo-test.sh (part of the full check): a database in a
 * container, a seed for "today", then a seed with SEED_NOW = today + 30 days.
 * Here the service clock is that same day, so only what the seed computes
 * from its run time is live — the first run's offers and the rest of the
 * seed have already expired.
 *
 * Search: exactly the screen's body (ltl-matching/page.tsx, handleSearch) with
 * default sliders (0 m, 0 t, 100 km detour). No network — route ends come from
 * geocode_cache, offers have coordinates; `fetch` throws if anything tries.
 *
 * FX: 1 EUR = 1 / 0.23 PLN, 1 GBP = 5 PLN. Company cost 4.20 PLN/km.
 * No toll provider is registered in the demo (src/tolls): the detour toll is
 * not counted (null, TOLL_PROVIDER_NOT_CONFIGURED) and profit excludes it.
 *
 *   pos | offer               | price     | km | km cost  | toll | profit PLN | codes / notes
 *   1   | LTLDEMO-03-GBP      | 1150 GBP  |  6 |   26.25  |  —   |  5723.75   | no toll provider, rate
 *   2   | LTLDEMO-02-EUR      | 1200 EUR  |  0 |    0     |  0   |  5217.39   | rate
 *   3   | LTLDEMO-07-DETOUR   |  900 EUR  | 71 |  300.18  |  —   |  3612.87   | no toll provider, rate
 *   4   | LTLDEMO-05-RISK     | 1250 PLN  |  0 |    0     |  0   |  1250.00   | COUNTERPARTY_RISK PAYMENT
 *   5   | LTLDEMO-01-PLN      | 1200 PLN  |  0 |    0     |  0   |  1200.00   |
 *   6   | LTLDEMO-04-NOPRICE  |   — PLN   |  3 |   12.99  |  —   |    —       | threshold price 12.99
 *   –   | LTLDEMO-06-ADR      | 1500 EUR  |    |          |      |            | incompatible: no ADR
 *
 * Worked example: 07-DETOUR — 900 / 0.23 = 3913.04; 71.47 km × 4.20 = 300.18;
 * 3913.04 − 300.18 = 3612.87 (exactly: 3913.0435 − 300.174).
 */
import { PrismaService } from '../../src/prisma/prisma.service';
import { GeocodingService } from '../../src/geocoding/geocoding.service';
import { LtlMatchingService } from '../../src/ltl-matching/ltl-matching.service';
import { DEMO_LTL_PREFIX, DEMO_ROUTE } from '../../prisma/seed-demo-ltl';
import { EXPECTED_MATCHES, SCREEN_BODY } from './demo-expected';
import { cityCoords } from '../../prisma/seed-cities';

const NOW = new Date(process.env.DEMO_NOW ?? '');
const prisma = new PrismaService();

let res: Awaited<ReturnType<LtlMatchingService['findMatchingOffers']>>;
let fetchSpy: jest.SpyInstance;

beforeAll(async () => {
  if (Number.isNaN(NOW.getTime())) throw new Error('DEMO_NOW nie ustawione — uruchom tools/demo-test.sh');
  fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => {
    throw new Error('demo nie może zależeć od sieci');
  });
  const geocoding = new GeocodingService(prisma, { get: () => 'demo-test@example.invalid' } as any);
  const service = new LtlMatchingService(prisma, geocoding);
  service.now = () => NOW;
  res = await service.findMatchingOffers('seed-company-001', SCREEN_BODY);
});

afterAll(async () => {
  fetchSpy.mockRestore();
  await prisma.$disconnect();
});

describe('demo seed — the data the screen needs', () => {
  it('the second seed run replaced the demo offers: 7 of them, all from DEMO_NOW', async () => {
    const offers = await prisma.offer.findMany({ where: { externalId: { startsWith: DEMO_LTL_PREFIX } } });
    expect(offers).toHaveLength(7);
    const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    for (const o of offers) {
      const n = (day(o.pickupDate) - day(NOW)) / 86_400_000;
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(5);
    }
  });

  it('SEED-MEGA1 has its record back after the "old database" step (else LTL answers 422)', async () => {
    const mega = await prisma.vehicle.findUnique({ where: { id: DEMO_ROUTE.vehicleId } });
    expect(mega).toMatchObject({ grossVehicleWeightKg: 40000, curbWeightKg: 15500 });
  });

  it('offers left without coordinates by the "old database" step got them back from the city map', async () => {
    const offers = await prisma.offer.findMany({
      where: { externalId: { in: ['TE-001', 'DEMO-002', 'BULK-007', 'LTL-003'] } },
    });
    expect(offers).toHaveLength(4);
    for (const o of offers) {
      expect([o.externalId, o.pickupLat, o.pickupLng, o.deliveryLat, o.deliveryLng]).toEqual([
        o.externalId, ...Object.values(cityCoords(o.pickupCity)), ...Object.values(cityCoords(o.deliveryCity)),
      ]);
    }
  });

  it('no offer in the database is without coordinates after the re-seed', async () => {
    const missing = await prisma.offer.count({ where: { OR: [{ pickupLat: null }, { deliveryLat: null }] } });
    expect(missing).toBe(0);
  });

  it('the demo company counts profit: 4.20 PLN per km', async () => {
    const company = await prisma.company.findUnique({ where: { id: 'seed-company-001' } });
    expect(Number(company!.costPerKm)).toBe(4.2);
    expect(company!.costCurrency).toBe('PLN');
  });
});

describe('demo search — the screen request on any day (clock +30 days)', () => {
  it('no network was used', () => {
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('order and amounts by profit in PLN', () => {
    expect(res.matches.map(m => [m.externalId, m.value.amount, m.value.detourCost, m.value.detourToll])).toEqual(EXPECTED_MATCHES);
    expect(res.matches.every(m => m.value.basis === 'PROFIT' && m.value.currency === 'PLN')).toBe(true);
  });

  it('codes on the cards', () => {
    const codes = Object.fromEntries(res.matches.map(m => [m.externalId, m.value.codes.map(c => c.code)]));
    expect(codes['LTLDEMO-03-GBP']).toEqual(['TOLL_PROVIDER_NOT_CONFIGURED', 'FX_RATE_STATIC']);
    expect(codes['LTLDEMO-02-EUR']).toEqual(['FX_RATE_STATIC']);
    expect(codes['LTLDEMO-01-PLN']).toEqual([]);
    expect(codes['LTLDEMO-04-NOPRICE']).toEqual(expect.arrayContaining(['OFFER_PRICE_MISSING', 'OFFER_THRESHOLD_PRICE']));
    const noPrice = res.matches.find(m => m.externalId === 'LTLDEMO-04-NOPRICE')!.value;
    expect(noPrice.thresholdPrice).toBe(12.99);
  });

  it('payment risk only on the risky contractor’s card', () => {
    expect(res.matches.filter(m => m.counterpartyRisk).map(m => [m.externalId, m.counterpartyRisk])).toEqual([
      ['LTLDEMO-05-RISK', { code: 'COUNTERPARTY_RISK', params: { criteria: 'PAYMENT' } }],
    ]);
  });

  it('the ADR offer is in the incompatible list with its reason; nothing unmeasurable or hidden', async () => {
    const adr = await prisma.offer.findFirst({ where: { externalId: `${DEMO_LTL_PREFIX}06-ADR` } });
    expect(res.incompatible.map(o => [o.offerId, o.reasons.map(r => r.code)])).toEqual([
      [adr!.id, ['OFFER_ADR_VEHICLE_NOT_CERTIFIED']],
    ]);
    expect(res.unmeasurable).toEqual([]);
    expect(res.hiddenWithoutAmount).toBe(0);
    // The seed has coordinates everywhere (seed-cities.ts) — nothing awaits location.
    expect(res.awaitingLocation).toEqual([]);
  });
});
