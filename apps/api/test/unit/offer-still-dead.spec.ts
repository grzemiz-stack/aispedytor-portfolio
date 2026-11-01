/**
 * "Przywróć (Nowa)" of a dead offer → 400 OFFER_STILL_DEAD.
 *
 * Before: EXPIRED or REJECTED → NEW always went through; an offer with a
 * passed loading day, a passed `expiresAt` or older than 7 days silently went
 * back to EXPIRED on the next run of the expiry task (every hour).
 * Now:
 *  - EXPIRED → NEW and REJECTED → NEW: an offer with `deadReason != null`
 *    (the full rule, with the age threshold) → 400 OFFER_STILL_DEAD { reason },
 *    nothing written; ASSIGNED → NEW (unassigning) is not blocked;
 *  - after the loading date or the validity is changed, restoring goes
 *    through — `PATCH /offers/:id` now saves `expiresAt` (a date or null =
 *    no deadline).
 *
 * A fake clock — dates count from NOW.
 */
import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { OffersService } from '../../src/offers/offers.service';
import { PLAN_MESSAGE_CODES } from '../../src/common/plan-messages';

const DAY = 86_400_000;
const NOW = new Date('2026-10-11T10:00:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const ahead = (days: number) => new Date(NOW.getTime() + days * DAY);

function service(over: object = {}, companyCountry: string | null = 'PL') {
  const row: any = {
    id: 'o1', companyId: 'c', status: 'EXPIRED', contractorId: null, contractor: null, assignedTo: null,
    pickupCity: 'Poznań', pickupCountry: 'PL', deliveryCity: 'Berlin', deliveryCountry: 'DE',
    pickupDate: ahead(2), createdAt: ago(1), expiresAt: null, price: 1000, currency: 'EUR',
    distanceKm: 500, tollCostEstimate: null, ...over,
  };
  const prisma: any = {
    offer: {
      findFirst: jest.fn(async () => row),
      update: jest.fn(async ({ data }: any) => ({ ...row, ...data })),
    },
    company: { findUnique: jest.fn(async () => ({ country: companyCountry })) },
  };
  const svc = new OffersService(prisma, {} as any, { deleteByPrefix: () => undefined } as any, { enqueue: (fn: any) => fn() } as any);
  return { svc, prisma };
}

beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
afterEach(() => jest.useRealTimers());

describe('EXPIRED / REJECTED → NEW of a dead offer: 400 OFFER_STILL_DEAD { reason }', () => {
  it.each([
    ['EXPIRED', 'PICKUP_PASSED', { pickupDate: ago(2) }],
    ['EXPIRED', 'EXPIRED', { expiresAt: ago(0.1) }],
    ['EXPIRED', 'TOO_OLD', { createdAt: ago(8) }],
    ['REJECTED', 'PICKUP_PASSED', { pickupDate: ago(2) }],
    ['REJECTED', 'TOO_OLD', { createdAt: ago(8) }],
  ])('%s → NEW, %s → 400, nothing written', async (status, reason, over) => {
    const m = service({ status, ...over });
    const err = await m.svc.updateStatus('o1', 'c', 'NEW' as any).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({ statusCode: 400, code: 'OFFER_STILL_DEAD', params: { reason } });
    expect(m.prisma.offer.update).not.toHaveBeenCalled();
  });

  it('the loading day in the pickup country zone (a country outside the map → company country)', async () => {
    // 10.10 22:30Z: already 11.10 in Warsaw (live), still 10.10 in Lisbon (dead).
    const at = new Date('2026-10-10T22:30:00Z');
    await expect(service({ pickupDate: at, pickupCountry: 'XX' }, 'PL').svc.updateStatus('o1', 'c', 'NEW' as any)).resolves.toBeDefined();
    await expect(service({ pickupDate: at, pickupCountry: 'XX' }, 'PT').svc.updateStatus('o1', 'c', 'NEW' as any))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    ['EXPIRED, live again (the loading date moved ahead)', { status: 'EXPIRED' }],
    ['REJECTED, live', { status: 'REJECTED' }],
    ['EXPIRED, expiresAt moved ahead', { status: 'EXPIRED', expiresAt: ahead(1) }],
    ['ASSIGNED → NEW (unassigning) with a passed loading — not blocked', { status: 'ASSIGNED', pickupDate: ago(2) }],
  ])('%s → NEW goes through', async (_n, over) => {
    const m = service(over);
    await m.svc.updateStatus('o1', 'c', 'NEW' as any);
    expect(m.prisma.offer.update.mock.calls[0][0].data).toEqual({ status: 'NEW', assignedToId: null, assignedAt: null });
  });

  it.each(['ACCEPTED', 'REJECTED', 'COMPLETED'])('EXPIRED → %s is not blocked (only the way back to NEW)', async (to) => {
    const m = service({ pickupDate: ago(2) });
    await m.svc.updateStatus('o1', 'c', to as any, { userId: 'u', role: 'ADMIN' });
    expect(m.prisma.offer.update).toHaveBeenCalled();
  });

  it('the code is in the message list (and so in the PL/EN dictionary)', () => {
    expect(PLAN_MESSAGE_CODES).toContain('OFFER_STILL_DEAD');
  });
});

describe('PATCH /offers/:id saves expiresAt (before: ignored)', () => {
  it.each([
    ['a date', '2026-10-20T12:00:00Z', new Date('2026-10-20T12:00:00Z')],
    ['null — no deadline', null, null],
  ])('%s', async (_n, value, saved) => {
    const m = service();
    await m.svc.update('o1', 'c', { expiresAt: value } as any);
    expect(m.prisma.offer.update.mock.calls[0][0].data.expiresAt).toEqual(saved);
  });

  it('not sent → not touched', async () => {
    const m = service();
    await m.svc.update('o1', 'c', { notes: 'x' } as any);
    expect('expiresAt' in m.prisma.offer.update.mock.calls[0][0].data).toBe(false);
  });

  it('after moving the loading date ahead, restoring goes through', async () => {
    const m = service({ pickupDate: ago(2) });
    await expect(m.svc.updateStatus('o1', 'c', 'NEW' as any)).rejects.toBeInstanceOf(BadRequestException);
    await m.svc.update('o1', 'c', { pickupDate: ahead(2).toISOString() } as any);
    // The mock: findFirst returns the same row — carry the write over as the database would.
    Object.assign(await m.prisma.offer.findFirst(), m.prisma.offer.update.mock.calls[0][0].data);
    await m.svc.updateStatus('o1', 'c', 'NEW' as any);
    expect(m.prisma.offer.update.mock.calls[1][0].data.status).toBe('NEW');
  });
});
