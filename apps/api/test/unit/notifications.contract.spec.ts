/**
 * The notification type contract and the visibility of matching errors.
 *
 * The Prisma mock enforces the NotificationType enum read from prisma/schema.prisma
 * — the same source of truth the database uses. So the test catches a write of a
 * value that does not exist, just as PostgreSQL would:
 *   ERROR: invalid input value for enum "NotificationType": "DEMAND_MATCH"
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Logger } from '@nestjs/common';
import { DemandsService } from '../../src/demands/demands.service';
import { DemandsController } from '../../src/demands/demands.controller';
import { OffersService } from '../../src/offers/offers.service';
import type { AuthenticatedRequest } from '../../src/common/types/authenticated-request';

/** NotificationType enum values, read straight from the Prisma schema. */
function notificationTypesFromSchema(): string[] {
  const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');
  const block = schema.match(/enum NotificationType \{([^}]*)\}/);
  if (!block) throw new Error('Nie znaleziono enum NotificationType w schema.prisma');
  return block[1]
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').trim())
    .filter(Boolean);
}

const ALLOWED_TYPES = notificationTypesFromSchema();

/** Reproduces the PostgreSQL error for a value outside the enum. */
function assertNotificationType(type: string): void {
  if (!ALLOWED_TYPES.includes(type)) {
    throw new Error(`invalid input value for enum "NotificationType": "${type}"`);
  }
}

const demand = {
  id: 'dem-1',
  companyId: 'comp-1',
  dispatcherId: 'user-1',
  title: 'Zapotrzebowanie',
  status: 'OPEN',
  isActive: true,
  autoNotify: true,
  preferredCountries: [] as string[],
  maxWeight: null as number | null,
  adrRequired: false,
  temperatureRequired: false,
};

const offer = (id: string) => ({
  id,
  companyId: 'comp-1',
  status: 'NEW',
  pickupCountry: 'PL',
  deliveryCountry: 'DE',
  pickupCity: 'Warszawa',
  deliveryCity: 'Berlin',
  weightKg: 12000,
  isAdr: false,
  isFrigo: false,
});

function makeDemands(offers: any[]) {
  const created: any[] = [];
  const prisma: any = {
    dispatcherDemand: {
      findFirst: jest.fn().mockResolvedValue(demand),
      findMany: jest.fn().mockResolvedValue([demand]),
      update: jest.fn().mockResolvedValue({}),
    },
    offer: { findMany: jest.fn().mockResolvedValue(offers) },
    notification: {
      create: jest.fn(({ data }: any) => {
        assertNotificationType(data.type); // <- fails here when the type is not in the enum
        created.push(data);
        return Promise.resolve({ id: `n-${created.length}`, ...data });
      }),
    },
  };
  return { service: new DemandsService(prisma), prisma, created };
}

describe('schema.prisma — NotificationType enum', () => {
  it('contains DEMAND_MATCH', () => {
    expect(ALLOWED_TYPES).toContain('DEMAND_MATCH');
  });

  it('keeps all existing values (the list grows only on purpose)', () => {
    expect(ALLOWED_TYPES).toEqual([
      'NEW_OFFER',
      'URGENT',
      'RELOAD',
      'RETURN',
      'RISK_ALERT',
      'VEHICLE_INSPECTION_EXPIRY',
      'VEHICLE_INSURANCE_EXPIRY',
      'VEHICLE_TACHOGRAPH_EXPIRY',
      'VEHICLE_MAINTENANCE',
      'DEMAND_MATCH',
      'VEHICLE_FUEL_CARD_EXPIRY',
    ]);
  });

  it('negative control: the mock really rejects a value outside the enum', () => {
    expect(() => assertNotificationType('NIE_ISTNIEJE')).toThrow(
      'invalid input value for enum "NotificationType"',
    );
  });
});

describe('POST /demands/:id/search — a non-empty result resolves instead of failing with 500', () => {
  // The controller reads only `req.user`, but the signature is the full AuthenticatedRequest
  // (extends Express.Request). The mock carries only what the handler actually uses.
  const req = {
    user: { companyId: 'comp-1', userId: 'user-1', role: 'DISPATCHER', email: 'a@b.example.com' },
  } as AuthenticatedRequest;

  it('the controller handler returns the result, not a rejected promise', async () => {
    const { service } = makeDemands([offer('a'), offer('b')]);
    const controller = new DemandsController(service);

    const res: any = await controller.searchOffers('dem-1', req);

    expect(res.matchCount).toBe(2);
    expect(res.offers).toHaveLength(2);
  });

  it('the result notification is saved with type DEMAND_MATCH', async () => {
    const { service, created } = makeDemands([offer('a')]);
    const controller = new DemandsController(service);

    await controller.searchOffers('dem-1', req);

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ type: 'DEMAND_MATCH', userId: 'user-1' });
  });

  it('an empty result creates no notification', async () => {
    const { service, created } = makeDemands([]);
    const controller = new DemandsController(service);

    const res: any = await controller.searchOffers('dem-1', req);

    expect(res.matchCount).toBe(0);
    expect(created).toHaveLength(0);
  });

  it('the notification type is a value of the schema enum', async () => {
    const { service, created } = makeDemands([offer('a')]);
    await service.searchOffers('dem-1', 'comp-1', 'user-1');

    expect(ALLOWED_TYPES).toContain(created[0].type);
  });
});

describe('checkNewOfferAgainstDemands — notification about a new offer', () => {
  it('saves a DEMAND_MATCH notification with the offer id', async () => {
    const { service, created } = makeDemands([]);

    const res = await service.checkNewOfferAgainstDemands('comp-1', offer('off-1'));

    expect(res).toEqual([{ demandId: 'dem-1', unknownCriteria: [] }]);
    expect(created[0]).toMatchObject({ type: 'DEMAND_MATCH', offerId: 'off-1' });
  });
});

describe('OffersService — a matching error is logged, not swallowed', () => {
  function makeOffers(enqueueImpl: (fn: () => any) => Promise<any>) {
    const prisma: any = { offer: { createMany: jest.fn(), findMany: jest.fn() } };
    const demandsService: any = { checkNewOfferAgainstDemands: jest.fn() };
    const cache: any = { deleteByPrefix: jest.fn() };
    const taskQueue: any = { enqueue: enqueueImpl };
    return new OffersService(prisma, demandsService, cache, taskQueue);
  }

  const flush = () => new Promise((r) => setImmediate(r));

  it('a matching error is logged with the offer id', async () => {
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const service = makeOffers(() => Promise.reject(new Error('zapis powiadomienia odrzucony')));

    (service as any).queueDemandMatching('comp-1', { id: 'off-77' });
    await flush();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain('off-77');
    expect(spy.mock.calls[0][0]).toContain('zapis powiadomienia odrzucony');
    spy.mockRestore();
  });

  it('a matching error does not break the calling path', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const service = makeOffers(() => Promise.reject(new Error('boom')));

    expect(() => (service as any).queueDemandMatching('comp-1', { id: 'off-1' })).not.toThrow();
    await expect(flush()).resolves.toBeUndefined();
    jest.restoreAllMocks();
  });

  it('an offer without an id is named explicitly in the log', async () => {
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const service = makeOffers(() => Promise.reject(new Error('boom')));

    (service as any).queueDemandMatching('comp-1', {});
    await flush();

    expect(spy.mock.calls[0][0]).toContain('(no id)');
    spy.mockRestore();
  });

  it('a successful match logs nothing', async () => {
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const service = makeOffers((fn) => Promise.resolve(fn()));

    (service as any).queueDemandMatching('comp-1', { id: 'off-1' });
    await flush();

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
