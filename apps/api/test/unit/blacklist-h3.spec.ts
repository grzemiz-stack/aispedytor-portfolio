/**
 * The blacklist without loopholes (decisions §3b).
 *
 * Before:
 *  - the ADMIN rule checked only the move to ACCEPTED — NEW → IN_TRANSIT /
 *    COMPLETED (also revenue statuses) went through;
 *  - `isBlacklisted` could not be set through the API (the DTO refused it),
 *    `PATCH /offers/:id` ignored `contractorId`;
 *  - the controller path was tested with an ADMIN token only — replacing the
 *    role with 'ADMIN' in the controller survived;
 *  - any role could delete a contractor; `ON DELETE SET NULL` cleared the
 *    offers' contractor and the block with it.
 * Now:
 *  - every way into a revenue status from a non-revenue one checks the
 *    blacklist; moves between revenue statuses are not checked (already taken);
 *  - only an ADMIN changes `isBlacklisted` (403 CONTRACTOR_BLACKLIST_ADMIN_ONLY,
 *    logged); the same value passes;
 *  - `PATCH /offers/:id` saves `contractorId` (from the caller's company; null =
 *    none); detaching or replacing a blacklisted contractor — ADMIN only
 *    (otherwise "detach, then accept" would get round the block);
 *  - a controller with a DISPATCHER token gets 400 — the role comes from the token;
 *  - a contractor with offers cannot be deleted (409 CONTRACTOR_HAS_OFFERS);
 *    the blacklist also blocks an inactive contractor.
 */
import 'reflect-metadata';
import { BadRequestException, ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OffersService } from '../../src/offers/offers.service';
import { OffersController } from '../../src/offers/offers.controller';
import { ContractorsService } from '../../src/contractors/contractors.service';
import { ContractorsController } from '../../src/contractors/contractors.controller';
import { CreateContractorDto } from '../../src/contractors/dto/create-contractor.dto';
import { UpdateContractorDto } from '../../src/contractors/dto/update-contractor.dto';
import { REVENUE_STATUSES } from '../../src/common/money';
import { PLAN_MESSAGE_CODES } from '../../src/common/plan-messages';

const ADMIN = { userId: 'u-admin', role: 'ADMIN' };
const DISPATCHER = { userId: 'u-disp', role: 'DISPATCHER' };
type Contractor = { id: string; companyId: string; name: string; isBlacklisted: boolean; isActive?: boolean };
const BLACK: Contractor = { id: 'k-black', companyId: 'c', name: 'Zła Spedycja', isBlacklisted: true };
const CLEAN: Contractor = { id: 'k-clean', companyId: 'c', name: 'Dobra Spedycja', isBlacklisted: false };
const FOREIGN: Contractor = { id: 'k-foreign', companyId: 'other', name: 'Cudza', isBlacklisted: false };

function offers(current: { status?: string; contractorId?: string | null } = {}, all: Contractor[] = [BLACK, CLEAN, FOREIGN]) {
  const prisma: any = {
    offer: {
      findFirst: jest.fn(async () => ({ id: 'o1', companyId: 'c', status: 'NEW', contractorId: BLACK.id, currency: 'EUR',
        pickupCity: 'Poznań', pickupCountry: 'PL', deliveryCity: 'Berlin', deliveryCountry: 'DE', ...current })),
      update: jest.fn(async ({ data }: any) => ({ id: 'o1', ...data })),
    },
    contractor: {
      // An `isActive` filter in the query works as in the database (a contractor is active by default).
      findFirst: jest.fn(async ({ where }: any) =>
        all.find((k) => k.id === where.id && k.companyId === where.companyId && (where.isActive === undefined || (k.isActive ?? true) === where.isActive)) ?? null),
    },
  };
  const svc = new OffersService(prisma, {} as any, { deleteByPrefix: () => undefined } as any, { enqueue: (fn: any) => fn() } as any);
  return { svc, prisma };
}

let warn: jest.SpyInstance;
beforeEach(() => { warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined); });
afterEach(() => warn.mockRestore());

describe('W2 — every way into a revenue status checks the blacklist', () => {
  const NOT_REVENUE = ['NEW', 'ASSIGNED', 'REJECTED', 'EXPIRED'];
  const pairs = NOT_REVENUE.flatMap((from) => REVENUE_STATUSES.map((to) => [from, to]));

  it.each(pairs)('%s → %s, DISPATCHER: 400 OFFER_CONTRACTOR_BLACKLISTED, nothing written', async (from, to) => {
    const m = offers({ status: from });
    const err = await m.svc.updateStatus('o1', 'c', to as any, DISPATCHER).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({ code: 'OFFER_CONTRACTOR_BLACKLISTED' });
    expect(m.prisma.offer.update).not.toHaveBeenCalled();
  });

  it.each(pairs)('%s → %s, ADMIN: allowed, with a log line', async (from, to) => {
    const m = offers({ status: from });
    await m.svc.updateStatus('o1', 'c', to as any, ADMIN);
    expect(m.prisma.offer.update).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('k-black');
  });

  it.each([
    ['ACCEPTED', 'IN_TRANSIT'],
    ['IN_TRANSIT', 'COMPLETED'],
    ['ACCEPTED', 'COMPLETED'],
  ])('%s → %s (already taken): no check, the work goes on', async (from, to) => {
    const m = offers({ status: from });
    await m.svc.updateStatus('o1', 'c', to as any, DISPATCHER);
    expect(m.prisma.offer.update).toHaveBeenCalledTimes(1);
  });
});

describe('W3 — the controller passes the role from the token', () => {
  it('PATCH /offers/:id/status with a DISPATCHER token → 400 (the real controller and service)', async () => {
    const m = offers();
    const ctl = new OffersController(m.svc);
    const req: any = { user: { userId: 'u-disp', companyId: 'c', role: 'DISPATCHER', email: 'd@b.example.com' } };
    const err = await ctl.updateStatus('o1', { status: 'ACCEPTED' } as any, req).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(m.prisma.offer.update).not.toHaveBeenCalled();
  });

  it('the same with an ADMIN token → accepted', async () => {
    const m = offers();
    const ctl = new OffersController(m.svc);
    await ctl.updateStatus('o1', { status: 'ACCEPTED' } as any, { user: { userId: 'u-admin', companyId: 'c', role: 'ADMIN' } } as any);
    expect(m.prisma.offer.update).toHaveBeenCalledTimes(1);
  });

  it('PATCH /offers/:id with a DISPATCHER token cannot detach a blacklisted contractor (403)', async () => {
    const m = offers();
    const ctl = new OffersController(m.svc);
    const err = await ctl.update('o1', { contractorId: null } as any, { user: { userId: 'u-disp', companyId: 'c', role: 'DISPATCHER' } } as any).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
  });
});

describe('W1 — the contractor of an offer (PATCH /offers/:id)', () => {
  it('sets a contractor of the caller\'s company', async () => {
    const m = offers({ contractorId: null });
    await m.svc.update('o1', 'c', { contractorId: CLEAN.id } as any, DISPATCHER);
    expect(m.prisma.offer.update.mock.calls[0][0].data.contractorId).toBe(CLEAN.id);
  });

  it('a contractor of another company → 400 OFFER_CONTRACTOR_NOT_FOUND, nothing written', async () => {
    const m = offers({ contractorId: null });
    const err = await m.svc.update('o1', 'c', { contractorId: FOREIGN.id } as any, ADMIN).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({ code: 'OFFER_CONTRACTOR_NOT_FOUND' });
    expect(m.prisma.offer.update).not.toHaveBeenCalled();
  });

  it.each([
    ['detached (null)', null],
    ['detached (empty)', ''],
    ['replaced', CLEAN.id],
  ])('a blacklisted contractor %s by a DISPATCHER → 403 CONTRACTOR_BLACKLIST_ADMIN_ONLY, nothing written', async (_n, next) => {
    const m = offers();
    const err = await m.svc.update('o1', 'c', { contractorId: next } as any, DISPATCHER).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse()).toMatchObject({ statusCode: 403, code: 'CONTRACTOR_BLACKLIST_ADMIN_ONLY' });
    expect(m.prisma.offer.update).not.toHaveBeenCalled();
  });

  it('… by ADMIN → saved (null), with a log line', async () => {
    const m = offers();
    await m.svc.update('o1', 'c', { contractorId: '' } as any, ADMIN);
    expect(m.prisma.offer.update.mock.calls[0][0].data.contractorId).toBeNull();
    expect(String(warn.mock.calls[0][0])).toContain('k-black');
  });

  it('the same contractor again, or no contractorId in the body → no check, contractor untouched', async () => {
    for (const dto of [{ contractorId: BLACK.id }, { notes: 'x' }]) {
      const m = offers();
      await m.svc.update('o1', 'c', dto as any, DISPATCHER);
      expect(m.prisma.offer.update.mock.calls[0][0].data).not.toHaveProperty('contractorId');
    }
  });

  it('a clean contractor replaced by a DISPATCHER → allowed', async () => {
    const m = offers({ contractorId: CLEAN.id });
    await m.svc.update('o1', 'c', { contractorId: null } as any, DISPATCHER);
    expect(m.prisma.offer.update.mock.calls[0][0].data.contractorId).toBeNull();
  });
});

describe('W1 — isBlacklisted is set by ADMIN only', () => {
  function contractors(current: Contractor = CLEAN) {
    const prisma: any = {
      contractor: {
        findFirst: jest.fn(async () => ({ ...current })),
        create: jest.fn(async ({ data }: any) => ({ id: 'new', ...data })),
        update: jest.fn(async ({ data }: any) => ({ ...current, ...data })),
      },
    };
    return { svc: new ContractorsService(prisma, { deleteByPrefix: () => undefined } as any), prisma };
  }

  it('the DTOs accept isBlacklisted (it was rejected before)', async () => {
    for (const cls of [CreateContractorDto, UpdateContractorDto]) {
      const errors = await validate(plainToInstance(cls as any, { name: 'Firma', isBlacklisted: true }) as object, { whitelist: true, forbidNonWhitelisted: true });
      expect(errors).toEqual([]);
    }
  });

  it.each([
    ['update: on', CLEAN, true],
    ['update: off', BLACK, false],
  ])('%s — DISPATCHER → 403 CONTRACTOR_BLACKLIST_ADMIN_ONLY, nothing written', async (_n, current, value) => {
    const m = contractors(current);
    const err = await m.svc.update(current.id, 'c', { isBlacklisted: value } as any, DISPATCHER).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse()).toMatchObject({ code: 'CONTRACTOR_BLACKLIST_ADMIN_ONLY' });
    expect(m.prisma.contractor.update).not.toHaveBeenCalled();
  });

  it.each([
    ['update: on', CLEAN, true],
    ['update: off', BLACK, false],
  ])('%s — ADMIN → saved, with a log line (who, which contractor)', async (_n, current, value) => {
    const m = contractors(current);
    await m.svc.update(current.id, 'c', { isBlacklisted: value } as any, ADMIN);
    expect(m.prisma.contractor.update.mock.calls[0][0].data.isBlacklisted).toBe(value);
    const line = String(warn.mock.calls[0][0]);
    for (const part of [current.id, 'u-admin']) expect(line).toContain(part);
  });

  it('the same value as now (a form sending everything) → allowed for anyone', async () => {
    const m = contractors(BLACK);
    await m.svc.update(BLACK.id, 'c', { isBlacklisted: true, notes: 'x' } as any, DISPATCHER);
    expect(m.prisma.contractor.update).toHaveBeenCalledTimes(1);
  });

  it('create with isBlacklisted: true — DISPATCHER → 403; ADMIN → saved; without the field → false', async () => {
    const d = contractors();
    await expect(d.svc.create('c', { name: 'Nowa', isBlacklisted: true } as any, DISPATCHER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(d.prisma.contractor.create).not.toHaveBeenCalled();
    const a = contractors();
    await a.svc.create('c', { name: 'Nowa', isBlacklisted: true } as any, ADMIN);
    expect(a.prisma.contractor.create.mock.calls[0][0].data.isBlacklisted).toBe(true);
    const n = contractors();
    await n.svc.create('c', { name: 'Nowa' } as any, DISPATCHER);
    expect(n.prisma.contractor.create.mock.calls[0][0].data.isBlacklisted).toBe(false);
  });

  it('the controller passes the role from the token (DISPATCHER → 403)', async () => {
    const m = contractors();
    const ctl = new ContractorsController(m.svc);
    const err = await ctl.update(CLEAN.id, { isBlacklisted: true } as any, { user: { userId: 'u-disp', companyId: 'c', role: 'DISPATCHER' } } as any).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    const err2 = await ctl.create({ name: 'Nowa', isBlacklisted: true } as any, { user: { userId: 'u-disp', companyId: 'c', role: 'DISPATCHER' } } as any).catch((e) => e);
    expect(err2).toBeInstanceOf(ForbiddenException);
  });

  it('the code is in the message list (and so in the PL/EN dictionary)', () => {
    expect(PLAN_MESSAGE_CODES).toContain('CONTRACTOR_BLACKLIST_ADMIN_ONLY');
  });
});

describe('the blacklist blocks whether the contractor is active or not (deactivation does not lift it)', () => {
  const INACTIVE_BLACK: Contractor = { ...BLACK, isActive: false };

  it('accepting: DISPATCHER → 400 also for a deactivated blacklisted contractor', async () => {
    const m = offers({}, [INACTIVE_BLACK, CLEAN]);
    const err = await m.svc.updateStatus('o1', 'c', 'ACCEPTED' as any, DISPATCHER).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(m.prisma.offer.update).not.toHaveBeenCalled();
  });

  it('detaching: DISPATCHER → 403 also for a deactivated blacklisted contractor', async () => {
    const m = offers({}, [INACTIVE_BLACK, CLEAN]);
    await expect(m.svc.update('o1', 'c', { contractorId: null } as any, DISPATCHER)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('W2 — a contractor with offers cannot be deleted (decision a)', () => {
  function deletable(offerCount: number) {
    const prisma: any = {
      contractor: { findFirst: jest.fn(async () => ({ ...BLACK })), delete: jest.fn(async () => ({ ...BLACK })) },
      offer: { count: jest.fn(async () => offerCount) },
    };
    return { svc: new ContractorsService(prisma, { deleteByPrefix: () => undefined } as any), prisma };
  }

  it('any offers → 409 CONTRACTOR_HAS_OFFERS { offers }, nothing deleted (the offers keep their contractor)', async () => {
    const m = deletable(3);
    const err = await m.svc.delete(BLACK.id, 'c').catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ statusCode: 409, code: 'CONTRACTOR_HAS_OFFERS', params: { offers: 3 } });
    expect(m.prisma.contractor.delete).not.toHaveBeenCalled();
    expect(m.prisma.offer.count.mock.calls[0][0].where).toEqual({ contractorId: BLACK.id, companyId: 'c' });
  });

  it('no offers → deleted as before', async () => {
    const m = deletable(0);
    await m.svc.delete(BLACK.id, 'c');
    expect(m.prisma.contractor.delete).toHaveBeenCalledWith({ where: { id: BLACK.id, companyId: 'c' } });
  });

  it('the code is in the message list (and so in the PL/EN dictionary)', () => {
    expect(PLAN_MESSAGE_CODES).toContain('CONTRACTOR_HAS_OFFERS');
  });
});
