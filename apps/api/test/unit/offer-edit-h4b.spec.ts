/**
 * Editing an offer (decisions §3a).
 *
 * 1. The lock: an accepted, in-transit or completed offer — money, dates and
 *    places (price, currency, distance, toll, loading and unloading dates,
 *    validity, cities, countries) are changed by an ADMIN only; another role →
 *    403 OFFER_FIELDS_ADMIN_ONLY { fields }, nothing written; an ADMIN's change
 *    logged (who, field, from → to). Notes and contact — anyone. NEW /
 *    ASSIGNED / EXPIRED / REJECTED — anyone, everything. The same value as now
 *    is not a change (the form sends everything).
 * 2. The preview with `offerId` computes as the `PATCH` save: missing fields
 *    from the offer, the offer's saved route — preview = what the edit saves.
 */
import 'reflect-metadata';
import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { OffersService, OFFER_LOCKED_FIELDS } from '../../src/offers/offers.service';
import { OffersController } from '../../src/offers/offers.controller';
import { REVENUE_STATUSES } from '../../src/common/money';
import { PLAN_MESSAGE_CODES } from '../../src/common/plan-messages';

const ADMIN = { userId: 'u-admin', role: 'ADMIN' };
const DISPATCHER = { userId: 'u-disp', role: 'DISPATCHER' };
const PICKUP = new Date('2030-03-10T00:00:00.000Z');
const EXPIRES = new Date('2030-03-08T12:00:00.000Z');

const OFFER = {
  id: 'o1', companyId: 'c', status: 'NEW', contractorId: null, price: 1000, currency: 'EUR', distanceKm: 280, tollCostEstimate: null,
  pickupDate: PICKUP, deliveryDate: null as Date | null, expiresAt: EXPIRES, pickupCity: 'Poznań', pickupCountry: 'PL', deliveryCity: 'Berlin', deliveryCountry: 'DE',
  notes: null, contactPhone: null,
};

function offers(over: Partial<typeof OFFER> & Record<string, unknown> = {}, route: object | null = null) {
  const row = { ...OFFER, ...over };
  const prisma: any = {
    offer: {
      findFirst: jest.fn(async ({ where }: any) => (where.id === row.id && where.companyId === row.companyId ? row : null)),
      update: jest.fn(async ({ data }: any) => ({ ...row, ...data })),
    },
    company: { findUnique: jest.fn(async () => ({ costPerKm: 4.2, costCurrency: 'PLN' })) },
    routeCalculation: { findFirst: jest.fn(async () => route) },
    contractor: { findFirst: jest.fn(async () => null) },
  };
  const svc = new OffersService(prisma, {} as any, { deleteByPrefix: () => undefined } as any, { enqueue: (fn: any) => fn() } as any);
  return { svc, prisma };
}

/** A change of every locked field to another value. */
const CHANGE: Record<(typeof OFFER_LOCKED_FIELDS)[number], unknown> = {
  price: 1200, currency: 'PLN', distanceKm: 300, tollCostEstimate: 50, pickupDate: '2030-03-11', deliveryDate: '2030-03-12', expiresAt: null,
  pickupCity: 'Gniezno', pickupCountry: 'CZ', deliveryCity: 'Hamburg', deliveryCountry: 'AT',
};

let warn: jest.SpyInstance;
beforeEach(() => { warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined); });
afterEach(() => warn.mockRestore());

describe('the lock on a revenue offer', () => {
  const cases = REVENUE_STATUSES.flatMap((status) => OFFER_LOCKED_FIELDS.map((field) => [status, field] as const));

  it.each(cases)('%s, %s changed by a DISPATCHER → 403 OFFER_FIELDS_ADMIN_ONLY naming the field, nothing written', async (status, field) => {
    const m = offers({ status });
    const err = await m.svc.update('o1', 'c', { [field]: CHANGE[field] } as any, DISPATCHER).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse()).toMatchObject({ statusCode: 403, code: 'OFFER_FIELDS_ADMIN_ONLY', params: { fields: field } });
    expect(m.prisma.offer.update).not.toHaveBeenCalled();
  });

  it.each(REVENUE_STATUSES)('%s, ADMIN → saved, a log line names who, the field and from → to', async (status) => {
    const m = offers({ status });
    await m.svc.update('o1', 'c', { price: 1200, pickupCity: 'Gniezno' } as any, ADMIN);
    expect(m.prisma.offer.update.mock.calls[0][0].data).toMatchObject({ price: 1200, pickupCity: 'Gniezno' });
    const line = String(warn.mock.calls[0][0]);
    for (const part of ['o1', 'u-admin', 'price 1000 → 1200', 'pickupCity "Poznań" → "Gniezno"']) expect(line).toContain(part);
  });

  it.each(REVENUE_STATUSES)('%s, a DISPATCHER changes notes and contact → saved', async (status) => {
    const m = offers({ status });
    await m.svc.update('o1', 'c', { notes: 'rampa 3', contactPhone: '+48 600 000 000' } as any, DISPATCHER);
    expect(m.prisma.offer.update.mock.calls[0][0].data).toMatchObject({ notes: 'rampa 3', contactPhone: '+48 600 000 000' });
  });

  it('a DISPATCHER sending the current values of every locked field (the whole form) → no change, saved', async () => {
    const m = offers({ status: 'ACCEPTED' });
    const same = {
      price: 1000, currency: 'EUR', distanceKm: 280, tollCostEstimate: null, pickupDate: '2030-03-10', deliveryDate: null, expiresAt: EXPIRES.toISOString(),
      pickupCity: 'Poznań', pickupCountry: 'PL', deliveryCity: 'Berlin', deliveryCountry: 'DE', notes: 'x',
    };
    await m.svc.update('o1', 'c', same as any, DISPATCHER);
    expect(m.prisma.offer.update).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(['NEW', 'ASSIGNED', 'EXPIRED', 'REJECTED'])('%s: a DISPATCHER changes every locked field → saved, no log', async (status) => {
    const m = offers({ status });
    await m.svc.update('o1', 'c', { ...CHANGE } as any, DISPATCHER);
    expect(m.prisma.offer.update).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('the controller passes the role from the token: PATCH /offers/:id with a DISPATCHER token on an accepted offer → 403', async () => {
    const m = offers({ status: 'ACCEPTED' });
    const ctl = new OffersController(m.svc);
    const err = await ctl.update('o1', { price: 1200 } as any, { user: { userId: 'u-disp', companyId: 'c', role: 'DISPATCHER' } } as any).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    await ctl.update('o1', { price: 1200 } as any, { user: { userId: 'u-admin', companyId: 'c', role: 'ADMIN' } } as any);
    expect(m.prisma.offer.update).toHaveBeenCalledTimes(1);
  });

  it('the code is in the message list (and so in the PL/EN dictionary)', () => {
    expect(PLAN_MESSAGE_CODES).toContain('OFFER_FIELDS_ADMIN_ONLY');
  });
});

describe('the margin preview of an edited offer = what PATCH saves', () => {
  const ROUTE = { distanceKm: 310, tollTotalEur: 42 };
  const PICK = ['totalCostEstimate', 'profitEstimate', 'profitMarginPercent', 'marginWithoutTolls'] as const;
  const pick = (o: any) => Object.fromEntries(PICK.map((k) => [k, o[k] ?? null]));

  it.each([
    ['a new price, the saved route', { price: 1200 }],
    ['a manual toll (it goes first)', { tollCostEstimate: 80 }],
    ['another currency', { currency: 'PLN', price: 5000 }],
    ['the price cleared', { price: null }],
  ])('%s', async (_n, body) => {
    const preview = offers({ status: 'NEW' }, ROUTE);
    const saved = offers({ status: 'NEW' }, ROUTE);
    const p: any = await preview.svc.economicsPreview('c', { offerId: 'o1', ...body } as any);
    await saved.svc.update('o1', 'c', body as any, ADMIN);
    expect(pick(p)).toEqual(pick(saved.prisma.offer.update.mock.calls[0][0].data));
  });

  it('the saved route counts: with a route the preview differs from a route-less one', async () => {
    const withRoute: any = await offers({}, ROUTE).svc.economicsPreview('c', { offerId: 'o1' } as any);
    const without: any = await offers({}, null).svc.economicsPreview('c', { offerId: 'o1' } as any);
    expect(withRoute.totalCostEstimate).not.toEqual(without.totalCostEstimate);
  });

  it('an offer of another company → 404, nothing computed', async () => {
    const m = offers({ companyId: 'other' });
    await expect(m.svc.economicsPreview('c', { offerId: 'o1', price: 1 } as any)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('without offerId: a new offer, as before (no route read)', async () => {
    const m = offers({}, ROUTE);
    await m.svc.economicsPreview('c', { price: 1000, currency: 'EUR', distanceKm: 280 } as any);
    expect(m.prisma.routeCalculation.findFirst).not.toHaveBeenCalled();
  });
});
