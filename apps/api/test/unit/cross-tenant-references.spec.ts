/**
 * Ids taken from a request must belong to the caller's company.
 *
 * Three writes are checked:
 *  - PATCH /offers/:id/assign/:userId — `userId` from the URL (otherwise the
 *    offer could go to a user of ANOTHER company, who would then see it as
 *    assigned);
 *  - POST /offers with `contractorId` — otherwise the offer could point to
 *    another company's contractor and findOne would show its name and country;
 *  - POST /vehicles with `dispatcherId`.
 * The Prisma fake filters like the database: by id AND by the company in the
 * condition.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OffersService } from '../../src/offers/offers.service';
import { VehiclesService } from '../../src/vehicles/vehicles.service';

const USERS = [
  { id: 'own-user', companyId: 'comp-1', isActive: true },
  { id: 'own-inactive', companyId: 'comp-1', isActive: false },
  { id: 'foreign-user', companyId: 'comp-2', isActive: true },
];
const CONTRACTORS = [
  { id: 'own-contractor', companyId: 'comp-1' },
  { id: 'foreign-contractor', companyId: 'comp-2' },
];

/** findFirst as in the database: every field in `where` must match. */
const like = <T extends Record<string, unknown>>(rows: T[]) =>
  jest.fn(async ({ where }: any) => rows.find(r => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null);

function offers() {
  const prisma: any = {
    // The company cost per km and the planner route — the margin on save; none → no margin.
    company: { findUnique: async () => null },
    routeCalculation: { findFirst: async () => null },
    user: { findFirst: like(USERS) },
    contractor: { findFirst: like(CONTRACTORS) },
    offer: {
      findFirst: jest.fn(async ({ where }: any) => (where.companyId === 'comp-1' ? { id: where.id, companyId: 'comp-1' } : null)),
      update: jest.fn(async ({ data }: any) => ({ id: 'off-1', ...data })),
      create: jest.fn(async ({ data }: any) => ({ id: 'new-offer', ...data })),
    },
  };
  const demands: any = { checkNewOfferAgainstDemands: jest.fn().mockResolvedValue(undefined) };
  const cache: any = { get: jest.fn(), set: jest.fn(), deleteByPrefix: jest.fn() };
  const queue: any = { enqueue: jest.fn().mockResolvedValue(undefined) };
  return { service: new OffersService(prisma, demands, cache, queue), prisma };
}

function vehicles() {
  const prisma: any = {
    // The company cost per km and the planner route — the margin on save; none → no margin.
    company: { findUnique: async () => null },
    routeCalculation: { findFirst: async () => null },
    user: { findFirst: like(USERS) },
    vehicle: { create: jest.fn(async ({ data }: any) => ({ id: 'new-veh', ...data })), findFirst: jest.fn() },
  };
  const cache: any = { get: jest.fn(), set: jest.fn(), deleteByPrefix: jest.fn() };
  return { service: new VehiclesService(prisma, cache), prisma };
}

const responseOf = async (p: Promise<unknown>) => {
  try { await p; } catch (e: any) { return { status: e.getStatus?.(), body: e.getResponse?.(), type: e.constructor }; }
  return null;
};

describe('offer assignment — only an active user of the same company', () => {
  it('user of another company → 404 OFFER_ASSIGNEE_NOT_FOUND, nothing written', async () => {
    const { service, prisma } = offers();
    const r = await responseOf(service.assign('off-1', 'comp-1', 'foreign-user'));
    expect(r).toMatchObject({ status: 404, type: NotFoundException, body: { code: 'OFFER_ASSIGNEE_NOT_FOUND' } });
    expect(prisma.offer.update).not.toHaveBeenCalled();
  });

  it('inactive user of the same company → 404 as well', async () => {
    const { service, prisma } = offers();
    expect(await responseOf(service.assign('off-1', 'comp-1', 'own-inactive'))).toMatchObject({ status: 404 });
    expect(prisma.offer.update).not.toHaveBeenCalled();
  });

  it('unknown id and foreign id give the same answer (no hint that the foreign one exists)', async () => {
    const a = await responseOf(offers().service.assign('off-1', 'comp-1', 'foreign-user'));
    const b = await responseOf(offers().service.assign('off-1', 'comp-1', 'does-not-exist'));
    expect(a).toEqual(b);
  });

  it('own active user → assigned', async () => {
    const { service, prisma } = offers();
    await service.assign('off-1', 'comp-1', 'own-user');
    expect(prisma.offer.update.mock.calls[0][0].data).toMatchObject({ assignedToId: 'own-user', status: 'ASSIGNED' });
  });

  it('the lookup is scoped to the caller’s company and active users', async () => {
    const { service, prisma } = offers();
    await service.assign('off-1', 'comp-1', 'own-user');
    expect(prisma.user.findFirst.mock.calls[0][0].where).toEqual({ id: 'own-user', companyId: 'comp-1', isActive: true });
  });
});

describe('offer contractor — only from the same company', () => {
  const dto = (contractorId?: string) => ({ pickupCity: 'A', pickupCountry: 'PL', pickupDate: '2030-01-01', deliveryCity: 'B', deliveryCountry: 'DE', contractorId }) as any;

  it('contractor of another company → 400 OFFER_CONTRACTOR_NOT_FOUND, no offer created', async () => {
    const { service, prisma } = offers();
    const r = await responseOf(service.create('comp-1', dto('foreign-contractor')));
    expect(r).toMatchObject({ status: 400, type: BadRequestException, body: { code: 'OFFER_CONTRACTOR_NOT_FOUND' } });
    expect(prisma.offer.create).not.toHaveBeenCalled();
  });

  it('own contractor → created with it; no contractor → no lookup', async () => {
    const own = offers();
    await own.service.create('comp-1', dto('own-contractor'));
    expect(own.prisma.offer.create.mock.calls[0][0].data.contractorId).toBe('own-contractor');
    const none = offers();
    await none.service.create('comp-1', dto());
    expect(none.prisma.contractor.findFirst).not.toHaveBeenCalled();
  });
});

describe('vehicle dispatcher — only from the same company', () => {
  const dto = (dispatcherId?: string) => ({ plateNumber: 'PO 1', vehicleType: 'TRUCK', vehicleCategory: 'RIGID', dispatcherId }) as any;

  it('dispatcher of another company → 400 VEHICLE_DISPATCHER_NOT_FOUND, no vehicle created', async () => {
    const { service, prisma } = vehicles();
    const r = await responseOf(service.create('comp-1', dto('foreign-user')));
    expect(r).toMatchObject({ status: 400, body: { code: 'VEHICLE_DISPATCHER_NOT_FOUND' } });
    expect(prisma.vehicle.create).not.toHaveBeenCalled();
  });

  it('own dispatcher → created with it', async () => {
    const { service, prisma } = vehicles();
    await service.create('comp-1', dto('own-user'));
    expect(prisma.vehicle.create.mock.calls[0][0].data.dispatcherId).toBe('own-user');
  });
});
