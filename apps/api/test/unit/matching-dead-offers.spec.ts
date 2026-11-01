/**
 * Matching drops dead offers by the same rule as LTL.
 *
 * Before: vehicle → offers (the 50 newest NEW/ASSIGNED) and the dashboard
 * suggestions (the 20 newest) took offers without looking at the loading date
 * or `expiresAt` — dead ones took places in the limits and pushed live ones
 * out; the offer page ("Znajdź pojazd") did not say the offer was dead.
 * Now:
 *  - `deadReason` next to `isDeadOffer` (LTL): EXPIRED (`expiresAt` passed),
 *    TOO_OLD (older than 7 days), PICKUP_PASSED (the loading day before today,
 *    in the pickup country's zone);
 *  - lists: NEW — the full rule, ASSIGNED — no age threshold (only a passed
 *    loading day and `expiresAt`); dead ones drop out before the limit 50 / 20;
 *  - one offer (the offer page): matching computed as usual, and for NEW,
 *    ASSIGNED and EXPIRED every match gets MATCH_OFFER_NOT_LIVE { reason } in
 *    `warnings`; ACCEPTED and later — no code.
 */
import 'reflect-metadata';
import { deadReason, isDeadOffer } from '../../src/ltl-matching/offer-compatibility';
import { MatchingService } from '../../src/matching/matching.service';
import { PLAN_MESSAGE_CODES } from '../../src/common/plan-messages';

const DAY = 86_400_000;
const NOW = new Date('2030-10-10T10:00:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const ahead = (days: number) => new Date(NOW.getTime() + days * DAY);

describe('deadReason', () => {
  const ctx = { now: NOW };
  it.each([
    ['expiresAt passed', { expiresAt: ago(0.01), createdAt: ago(1), pickupDate: ahead(2) }, 'EXPIRED'],
    ['older than 7 days', { createdAt: ago(8), pickupDate: ahead(2) }, 'TOO_OLD'],
    ['the loading day before today (pickup country zone)', { createdAt: ago(1), pickupDate: new Date('2030-10-09T00:00:00Z'), pickupCountry: 'PL' }, 'PICKUP_PASSED'],
    ['loading today (date without a time)', { createdAt: ago(1), pickupDate: new Date('2030-10-10T00:00:00Z'), pickupCountry: 'PL' }, null],
    ['no dates', {}, null],
  ])('%s → %s', (_n, offer, reason) => {
    expect(deadReason(offer, ctx)).toBe(reason);
    expect(isDeadOffer(offer, ctx)).toBe(reason != null);
  });

  it('ignoreAge (ASSIGNED): older than 7 days alone is not dead; a passed loading still is', () => {
    expect(deadReason({ createdAt: ago(8), pickupDate: ahead(2) }, ctx, { ignoreAge: true })).toBeNull();
    expect(deadReason({ createdAt: ago(8), pickupDate: ago(2) }, ctx, { ignoreAge: true })).toBe('PICKUP_PASSED');
  });
});

const VEHICLE = {
  id: 'v', companyId: 'c', status: 'AVAILABLE', vehicleType: 'TRUCK', trailerType: 'CURTAIN', maxWeightKg: 24000, currentCountry: 'PL',
  brand: null, model: null, plateNumber: 'P', licensePlate: 'P', hasAdr: false, adrClasses: [], trailers: [], availableFrom: null,
  technicalInspectionTo: new Date('2099-01-01'), insuranceTo: new Date('2099-01-01'), tachographLegalizationTo: new Date('2099-01-01'),
};
const offer = (id: string, over: object = {}) => ({
  id, companyId: 'c', status: 'NEW', pickupCountry: 'PL', deliveryCountry: 'DE', pickupCity: 'Poznań', deliveryCity: 'Berlin',
  weightKg: 1000, price: 1000, currency: 'EUR', isAdr: false, adrClass: null, isFrigo: false, temperatureMin: null, temperatureMax: null,
  pickupDate: ahead(3), createdAt: ago(1), expiresAt: null, ...over,
});
function matching(offers: any[]) {
  const prisma: any = {
    offer: {
      findFirst: async ({ where }: any) => offers.find((o) => o.id === where.id) ?? null,
      // The mock does not filter — the rule must work in the code, not only in the query.
      findMany: jest.fn(async () => offers),
    },
    vehicle: { findFirst: async () => VEHICLE, findMany: async () => [VEHICLE] },
    company: { findUnique: async () => null },
  };
  return { svc: new MatchingService(prisma), prisma };
}

beforeAll(() => jest.useFakeTimers().setSystemTime(NOW));
afterAll(() => jest.useRealTimers());

describe('lists: dead offers drop out before the limit', () => {
  const dead = Array.from({ length: 60 }, (_, i) => offer(`dead${i}`, { pickupDate: ago(3) }));
  const live = Array.from({ length: 60 }, (_, i) => offer(`live${i}`));

  it('offers for a vehicle: 60 dead + 60 live → 50 live, no dead one', async () => {
    const r = await matching([...dead, ...live]).svc.findMatchingOffers('v', 'c');
    expect([r.length, r.every((m: any) => m.offerId.startsWith('live'))]).toEqual([50, true]);
  });

  it('suggestions: the 20 places go to live offers', async () => {
    const { svc, prisma } = matching([...dead, ...live]);
    await svc.getSuggestions('c');
    // Which offers were scored: live ones only, at most 20.
    const scored = jest.spyOn(svc as any, 'scoreVehicleForOffer');
    await svc.getSuggestions('c');
    const ids = new Set(scored.mock.calls.map((c: any) => c[1].id));
    expect([ids.size, [...ids].every((id) => String(id).startsWith('live'))]).toEqual([20, true]);
    expect(prisma.offer.findMany).toHaveBeenCalled();
  });

  it.each([
    ['expired by expiresAt', { expiresAt: ago(0.1) }, false],
    ['NEW older than 7 days', { createdAt: ago(8) }, false],
    ['ASSIGNED older than 7 days, loading ahead', { status: 'ASSIGNED', createdAt: ago(8) }, true],
    ['ASSIGNED with a passed loading', { status: 'ASSIGNED', pickupDate: ago(2) }, false],
  ])('%s → listed: %s', async (_n, over, listed) => {
    const r = await matching([offer('x', over)]).svc.findMatchingOffers('v', 'c');
    expect(r.map((m: any) => m.offerId)).toEqual(listed ? ['x'] : []);
  });

  it('the query pre-filters too (statuses, expiresAt, a loading at most 2 days back) — dead ones do not fill the database page', async () => {
    const { svc, prisma } = matching([offer('x')]);
    await svc.findMatchingOffers('v', 'c');
    const where = prisma.offer.findMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ['NEW', 'ASSIGNED'] });
    expect(where.OR).toEqual([{ expiresAt: null }, { expiresAt: { gt: NOW } }]);
    expect(where.pickupDate).toEqual({ gte: new Date(NOW.getTime() - 2 * DAY) });
    // NEW older than 7 days drop out in the database already; ASSIGNED do not (no age threshold).
    expect(where.NOT).toEqual({ status: 'NEW', createdAt: { lt: ago(7) } });
  });
});

describe('one offer (the offer page, "Znajdź pojazd"): shown, with a code', () => {
  const warn = (ms: any[]) => ms.map((m) => m.warnings.find((w: any) => w.code === 'MATCH_OFFER_NOT_LIVE') ?? null);

  it.each([
    ['NEW, the loading passed', { pickupDate: ago(2) }, 'PICKUP_PASSED'],
    ['NEW, expiresAt passed', { expiresAt: ago(0.1) }, 'EXPIRED'],
    ['NEW, older than 7 days', { createdAt: ago(8) }, 'TOO_OLD'],
    ['ASSIGNED, the loading passed', { status: 'ASSIGNED', pickupDate: ago(2) }, 'PICKUP_PASSED'],
    ['status EXPIRED', { status: 'EXPIRED' }, 'EXPIRED'],
  ])('%s → MATCH_OFFER_NOT_LIVE %s on each match, the score still computed', async (_n, over, reason) => {
    const r = await matching([offer('o', over)]).svc.findMatchingVehicles('o', 'c');
    expect(warn(r)).toEqual([{ code: 'MATCH_OFFER_NOT_LIVE', params: { reason } }]);
    expect(r[0].matchScore).toBeGreaterThan(0);
  });

  it.each([
    ['live NEW', {}],
    ['ASSIGNED older than 7 days, loading ahead', { status: 'ASSIGNED', createdAt: ago(8) }],
    ['ACCEPTED with a passed loading (a job in progress)', { status: 'ACCEPTED', pickupDate: ago(2) }],
    ['IN_TRANSIT', { status: 'IN_TRANSIT', pickupDate: ago(2), createdAt: ago(20) }],
  ])('%s → no code', async (_n, over) => {
    const r = await matching([offer('o', over)]).svc.findMatchingVehicles('o', 'c');
    expect(warn(r)).toEqual([null]);
  });

  it('MATCH_OFFER_NOT_LIVE is in the message list (and so in the PL/EN dictionary)', () => {
    expect(PLAN_MESSAGE_CODES).toContain('MATCH_OFFER_NOT_LIVE');
  });
});
