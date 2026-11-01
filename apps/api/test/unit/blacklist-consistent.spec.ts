/**
 * The blacklist consistently: accepting an offer, LTL, negotiation.
 *
 * Before: the blacklist in LTL gave only a warning (the offer in the ranking,
 * "Przyjmij" worked), negotiation nothing, and anyone could accept the offer.
 * Now:
 *  - `PATCH /offers/:id/status` with ACCEPTED for an offer from a contractor
 *    on THIS company's blacklist → 400 OFFER_CONTRACTOR_BLACKLISTED, unless
 *    the role is ADMIN; an ADMIN's acceptance → a log line (who, when, the
 *    offer, the contractor). Offers accepted before stay;
 *  - LTL: a blacklisted offer stays, but last, with `blockedBy`
 *    [OFFER_CONTRACTOR_BLACKLISTED], its own limit 10 + `hiddenBlocked`;
 *    COUNTERPARTY_RISK no longer repeats BLACKLIST;
 *  - negotiation: the first argument "Kontrahent na czarnej liście firmy — nie
 *    przyjmuj bez decyzji kierownika", still at most 5 in total.
 */
import { BadRequestException, Logger } from '@nestjs/common';
import { OffersService } from '../../src/offers/offers.service';
import { LtlMatchingService } from '../../src/ltl-matching/ltl-matching.service';
import { NegotiationService } from '../../src/negotiation/negotiation.service';
import { PLAN_MESSAGE_CODES } from '../../src/common/plan-messages';

const ADMIN = { userId: 'u-admin', role: 'ADMIN' };
const DISPATCHER = { userId: 'u-disp', role: 'DISPATCHER' };

function offers(contractor: { id: string; companyId: string; name: string; isBlacklisted: boolean } | null, offer: object = {}) {
  const prisma: any = {
    offer: {
      findFirst: jest.fn(async () => ({ id: 'o1', companyId: 'c', status: 'NEW', contractorId: contractor?.id ?? null, ...offer })),
      update: jest.fn(async ({ data }: any) => ({ id: 'o1', ...data })),
    },
    contractor: {
      findFirst: jest.fn(async ({ where }: any) => (contractor && contractor.id === where.id && contractor.companyId === where.companyId ? contractor : null)),
    },
  };
  const svc = new OffersService(prisma, {} as any, { deleteByPrefix: () => undefined } as any, { enqueue: (fn: any) => fn() } as any);
  return { svc, prisma };
}
const BLACK = { id: 'k-black', companyId: 'c', name: 'Zła Spedycja', isBlacklisted: true };

describe('accepting an offer from a blacklisted contractor', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => { warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined); });
  afterEach(() => warn.mockRestore());

  it('DISPATCHER → 400 OFFER_CONTRACTOR_BLACKLISTED, nothing written', async () => {
    const m = offers(BLACK);
    const err = await m.svc.updateStatus('o1', 'c', 'ACCEPTED' as any, DISPATCHER).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({ code: 'OFFER_CONTRACTOR_BLACKLISTED' });
    expect(m.prisma.offer.update).not.toHaveBeenCalled();
  });

  it('no actor known → treated as not ADMIN (400)', async () => {
    const m = offers(BLACK);
    await expect(m.svc.updateStatus('o1', 'c', 'ACCEPTED' as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ADMIN → accepted, and a log line says who, when, which offer and which contractor', async () => {
    const m = offers(BLACK);
    await m.svc.updateStatus('o1', 'c', 'ACCEPTED' as any, ADMIN);
    expect(m.prisma.offer.update.mock.calls[0][0].data).toEqual({ status: 'ACCEPTED' });
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    for (const part of ['o1', 'k-black', 'u-admin']) expect(line).toContain(part);
    expect(line).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  it('a contractor of ANOTHER company does not count (looked up in the caller\'s company only)', async () => {
    const m = offers({ ...BLACK, companyId: 'other' });
    await m.svc.updateStatus('o1', 'c', 'ACCEPTED' as any, DISPATCHER);
    expect(m.prisma.offer.update).toHaveBeenCalled();
    expect(m.prisma.contractor.findFirst.mock.calls[0][0].where).toEqual({ id: 'k-black', companyId: 'c' });
  });

  it('a contractor not on the blacklist, or no contractor → accepted by anyone, no log', async () => {
    for (const c of [{ ...BLACK, isBlacklisted: false }, null]) {
      const m = offers(c);
      await m.svc.updateStatus('o1', 'c', 'ACCEPTED' as any, DISPATCHER);
      expect(m.prisma.offer.update).toHaveBeenCalled();
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(['REJECTED', 'EXPIRED', 'IN_TRANSIT', 'COMPLETED', 'NEW'])('other statuses (%s) are not blocked', async (status) => {
    const m = offers(BLACK, { status: 'ACCEPTED' });
    await m.svc.updateStatus('o1', 'c', status as any, DISPATCHER);
    expect(m.prisma.offer.update).toHaveBeenCalled();
  });

  it('the code is in the message list (and so in the PL/EN dictionary)', () => {
    expect(PLAN_MESSAGE_CODES).toContain('OFFER_CONTRACTOR_BLACKLISTED');
  });
});

describe('LTL: a blacklisted offer stays, last, blocked', () => {
  const vehicle = {
    id: 'veh-1', companyId: 'c', plateNumber: 'GD 1', vehicleType: 'TRUCK', trailerType: 'CURTAIN',
    maxLoadingMeters: 13.6, maxWeightKg: 24000, maxPalletCount: 33, grossVehicleWeightKg: 40000, curbWeightKg: 15000,
  };
  const offer = (id: string, price: number, contractor: object | null = null) => ({
    id, companyId: 'c', status: 'NEW', pickupCity: 'Poznań', pickupCountry: 'PL', deliveryCity: 'Berlin', deliveryCountry: 'DE',
    pickupLat: 52.4, pickupLng: 16.9, deliveryLat: 52.5, deliveryLng: 13.4, weightKg: 1000, lengthM: 2.4, palletCount: 2,
    price, currency: 'EUR', pricePerKm: 1.5, cargoType: 'Palety', pickupDate: new Date('2030-10-01'), contractor,
  });
  const black = { id: 'k-b', companyId: 'c', name: 'Zła', reliabilityScore: 80, paymentRating: 1, isBlacklisted: true };
  // "Now" injected: the loading on 2030-10-01 must be in the future relative to NOW, not to the real day.
  const NOW = new Date('2030-09-20T10:00:00Z');
  async function search(list: any[]) {
    const prisma: any = {
      vehicle: { findFirst: jest.fn().mockResolvedValue(vehicle) },
      offer: { findMany: jest.fn().mockResolvedValue(list) },
      company: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const svc = new LtlMatchingService(prisma, {} as any);
    svc.now = () => NOW;
    (svc as any).geocode = jest.fn().mockResolvedValueOnce({ lat: 52.4064, lng: 16.9252 }).mockResolvedValueOnce({ lat: 52.52, lng: 13.405 });
    return (await svc.findMatchingOffers('c', {
      vehicleId: 'veh-1', currentCity: 'Poznań', destinationCity: 'Berlin', currentLoadWeight: 2, currentLoadMeters: 5, maxDetourKm: 300,
    } as any)) as any;
  }

  it('the highest amount but blacklisted → after every other offer, with blockedBy; the others have none', async () => {
    const res = await search([offer('rich-black', 9000, black), offer('a', 900), offer('no-price', null as any)]);
    expect(res.matches.map((m: any) => m.offerId)).toEqual(['a', 'no-price', 'rich-black']);
    expect(res.matches.map((m: any) => m.blockedBy.map((b: any) => b.code))).toEqual([[], [], ['OFFER_CONTRACTOR_BLACKLISTED']]);
  });

  it('COUNTERPARTY_RISK no longer repeats BLACKLIST (the block says it); the payment criterion stays', async () => {
    const res = await search([offer('b', 900, black)]);
    expect(res.matches[0].counterpartyRisk).toEqual({ code: 'COUNTERPARTY_RISK', params: { criteria: 'PAYMENT' } });
  });

  it('a blacklisted contractor of another company is not blocked', async () => {
    const res = await search([offer('x', 900, { ...black, companyId: 'other' })]);
    expect(res.matches[0].blockedBy).toEqual([]);
  });

  it('own limit: 12 blocked → 10 shown, hiddenBlocked 2, and they take no place from the others', async () => {
    const res = await search([...Array.from({ length: 12 }, (_, i) => offer(`b${i}`, 1000 + i, black)), offer('a', 900)]);
    const blocked = res.matches.filter((m: any) => m.blockedBy.length);
    expect([blocked.length, res.hiddenBlocked, res.matches[0].offerId]).toEqual([10, 2, 'a']);
  });

  it('the 20 places for offers with an amount stay full: 20 open + 3 blocked → all 23, the blocked ones last', async () => {
    const res = await search([...Array.from({ length: 20 }, (_, i) => offer(`a${String(i).padStart(2, '0')}`, 900 + i)), ...Array.from({ length: 3 }, (_, i) => offer(`b${i}`, 5000 + i, black))]);
    expect([res.matches.filter((m: any) => !m.blockedBy.length).length, res.matches.slice(-3).every((m: any) => m.blockedBy.length === 1)]).toEqual([20, true]);
  });

  it('none blocked → hiddenBlocked 0 (and the offer is listed, not dropped)', async () => {
    const res = await search([offer('a', 900)]);
    // A zero alone would also pass if the offer had dropped out (e.g. as dead) — hence the list.
    expect([res.hiddenBlocked, res.matches.map((m: any) => [m.offerId, m.blockedBy.length])]).toEqual([0, [['a', 0]]]);
  });
});

describe('negotiation: the blacklist argument first', () => {
  const OFFER = {
    id: 'o1', companyId: 'c', pickupCity: 'Poznań', deliveryCity: 'Berlin', pickupCountry: 'PL', deliveryCountry: 'DE',
    distanceKm: 800, tollCostEstimate: null, contractorId: 'k', pickupDate: new Date(Date.now() + 86_400_000), cargoType: 'x',
    isAdr: true, adrClass: '3', isFrigo: true, temperatureMin: 2, temperatureMax: 6, weightKg: 1000, pricePerKm: null, price: 3000, currency: 'PLN',
  };
  function negotiation(contractor: object) {
    const svc = new NegotiationService({
      offer: { findFirst: async () => OFFER, findMany: async () => [], count: async () => 0, aggregate: async () => ({ _avg: {} }) },
      company: { findUnique: async () => ({ costPerKm: 4.2, costCurrency: 'PLN' }) },
      routeCalculation: { findFirst: async () => null },
      contractor: { findFirst: jest.fn(async ({ where }: any) => ({ id: 'k', companyId: where.companyId, name: 'K', avgPaymentDays: 30, ...contractor })) },
    } as any);
    (svc as any).getPriceSuggestion = async () => ({ avgPrice: 4000, optimalPrice: 4000, minPrice: 3800, maxPrice: 4200, medianPrice: 4000, confidence: 0, sampleSize: 0, percentiles: { p25: 0, p50: 0, p75: 0 }, trendPercentChange: 0 });
    return svc;
  }

  it('blacklisted: the first argument is the blacklist sentence, still at most 5 in total', async () => {
    const r: any = await negotiation({ isBlacklisted: true, paymentRating: 1, reliabilityScore: 80 }).analyzeOffer('o1', 'c');
    expect(r.arguments[0]).toMatchObject({ title: 'Kontrahent na czarnej liście', text: 'Kontrahent na czarnej liście firmy — nie przyjmuj bez decyzji kierownika' });
    expect(r.arguments.length).toBeLessThanOrEqual(5);
    expect(r.arguments.filter((a: any) => a.title === 'Kontrahent na czarnej liście')).toHaveLength(1);
  });

  it('not blacklisted: no such argument', async () => {
    const r: any = await negotiation({ isBlacklisted: false, paymentRating: 4, reliabilityScore: 80 }).analyzeOffer('o1', 'c');
    expect(r.arguments.some((a: any) => a.title === 'Kontrahent na czarnej liście')).toBe(false);
  });
});

describe('the screens get contractorBlacklisted (the offer list and the offer page)', () => {
  const row = (contractor: object | null) => ({ id: 'o1', companyId: 'c', status: 'NEW', contractorId: 'k', contractor, assignedTo: null });
  function svc(rows: any[]) {
    const prisma: any = { offer: { findFirst: jest.fn(async () => rows[0]), findMany: jest.fn(async () => rows), count: jest.fn(async () => rows.length) } };
    const cache: any = { get: () => undefined, set: () => undefined, deleteByPrefix: () => undefined };
    return new OffersService(prisma, {} as any, cache, { enqueue: (fn: any) => fn() } as any);
  }
  it.each([
    ['blacklisted, this company', { id: 'k', name: 'Z', country: 'PL', isBlacklisted: true, companyId: 'c' }, true],
    ['blacklisted, another company', { id: 'k', name: 'Z', country: 'PL', isBlacklisted: true, companyId: 'other' }, false],
    ['not blacklisted', { id: 'k', name: 'Z', country: 'PL', isBlacklisted: false, companyId: 'c' }, false],
    ['no contractor', null, false],
  ])('%s → %s; the helper fields are not sent', async (_n, contractor, flag) => {
    const one: any = await svc([row(contractor)]).findOne('o1', 'c');
    const list: any = await svc([row(contractor)]).findAll('c', { page: 1, limit: 20 } as any);
    expect([one.contractorBlacklisted, list.data[0].contractorBlacklisted]).toEqual([flag, flag]);
    for (const c of [one.contractor, list.data[0].contractor]) {
      if (c) expect(Object.keys(c).filter((k) => k === 'isBlacklisted' || k === 'companyId')).toEqual([]);
    }
  });
});

describe('the controller passes who accepts', () => {
  it('PATCH /offers/:id/status gives the service the user id and role from the token', async () => {
    const { OffersController } = await import('../../src/offers/offers.controller');
    const service: any = { updateStatus: jest.fn(async () => ({})) };
    const ctl = new OffersController(service);
    await ctl.updateStatus('o1', { status: 'ACCEPTED' } as any, { user: { userId: 'u1', companyId: 'c', role: 'ADMIN', email: 'a@b.example.com' } } as any);
    expect(service.updateStatus.mock.calls[0]).toEqual(['o1', 'c', 'ACCEPTED', { userId: 'u1', role: 'ADMIN' }]);
  });
});
