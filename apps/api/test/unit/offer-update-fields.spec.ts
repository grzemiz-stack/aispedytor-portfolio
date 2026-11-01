/**
 * PATCH /offers/:id: every field of the update DTO is either saved or refused
 * with a code — never silently dropped (decisions §3a).
 *
 * Before: `UpdateOfferDto` (every field of `CreateOfferDto`) accepted 39 fields
 * and `update` saved 22 — length, ADR and class, reefer and temperatures,
 * penalty clauses, time windows, pallets, insurance, payment term, special
 * requirements, the source and the external id were lost, while the answer
 * said "saved". Now 15 of them are saved (`null` clears, flags without null →
 * false); `source` and `externalId` (the origin and the import key) → 400
 * OFFER_FIELD_NOT_EDITABLE, the same value passes.
 *
 * The test walks the DTO metadata: a new field without a decision ("saved" or
 * "refused") breaks it.
 */
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { getMetadataStorage } from 'class-validator';
import { OffersService } from '../../src/offers/offers.service';
import { UpdateOfferDto } from '../../src/offers/dto/update-offer.dto';
import { PLAN_MESSAGE_CODES } from '../../src/common/plan-messages';

const CURRENT = {
  id: 'o1', companyId: 'c', status: 'NEW', source: 'MANUAL', externalId: 'EXT-1', contractorId: null,
  pickupCity: 'Poznań', pickupCountry: 'PL', pickupPostal: null, pickupDate: new Date('2030-03-10T00:00:00Z'),
  deliveryCity: 'Berlin', deliveryCountry: 'DE', deliveryPostal: null, deliveryDate: null, expiresAt: null,
  cargoType: null, weightKg: null, volumeM3: null, lengthM: null, isAdr: false, adrClass: null, isFrigo: false,
  temperatureMin: null, temperatureMax: null, price: 1000, currency: 'EUR', distanceKm: 280, fuelCostEstimate: null,
  tollCostEstimate: null, notes: null, clientName: null, contactEmail: null, contactPhone: null, penaltyClauses: null,
  loadingTimeWindow: null, unloadingTimeWindow: null, palletExchange: false, palletExchangeType: null, palletCount: null,
  requiredInsuranceMin: null, paymentTermDays: null, specialRequirements: null,
};

/** A value different from the current one — for every DTO field. */
const NEW_VALUE: Record<string, unknown> = {
  source: 'EMAIL', externalId: 'EXT-2', pickupCity: 'Gniezno', pickupCountry: 'CZ', pickupPostal: '62-200',
  pickupDate: '2030-03-11', deliveryCity: 'Hamburg', deliveryCountry: 'AT', deliveryPostal: '20095', deliveryDate: '2030-03-12',
  cargoType: 'palety', weightKg: 12000, volumeM3: 40, lengthM: 7.2, isAdr: true, adrClass: '3', isFrigo: true,
  temperatureMin: 2, temperatureMax: 8, price: 1200, currency: 'PLN', distanceKm: 300, fuelCostEstimate: 50,
  tollCostEstimate: 40, notes: 'rampa 3', clientName: 'Klient', contractorId: 'k1', contactEmail: 'a@b.example.com',
  contactPhone: '+48 600 000 000', expiresAt: '2030-03-09T10:00:00.000Z', penaltyClauses: 'kara 500 EUR',
  loadingTimeWindow: 90, unloadingTimeWindow: 120, palletExchange: true, palletExchangeType: 'EPAL', palletCount: 18,
  requiredInsuranceMin: 100000, paymentTermDays: 45, specialRequirements: 'pasy',
};
const REFUSED = ['source', 'externalId'];

function offers(over: Record<string, unknown> = {}) {
  const row = { ...CURRENT, ...over };
  const cache = { deleteByPrefix: jest.fn() };
  const prisma: any = {
    offer: { findFirst: jest.fn(async () => row), update: jest.fn(async ({ data }: any) => ({ ...row, ...data })) },
    contractor: { findFirst: jest.fn(async ({ where }: any) => (where.id === 'k1' ? { id: 'k1', name: 'K', isBlacklisted: false } : null)) },
    company: { findUnique: jest.fn(async () => ({ costPerKm: 4.2, costCurrency: 'PLN' })) },
    routeCalculation: { findFirst: jest.fn(async () => null) },
  };
  const svc = new OffersService(prisma, {} as any, cache as any, { enqueue: (fn: any) => fn() } as any);
  return { svc, prisma, cache };
}
const ADMIN = { userId: 'u', role: 'ADMIN' };

const DTO_FIELDS = [...new Set(getMetadataStorage().getTargetValidationMetadatas(UpdateOfferDto, '', true, false).map((m) => m.propertyName))];

it('every field of the update DTO has a decision in this test (a new field breaks it until decided)', () => {
  expect(DTO_FIELDS.length).toBeGreaterThan(35);
  expect(DTO_FIELDS.filter((f) => !(f in NEW_VALUE))).toEqual([]);
});

it.each(DTO_FIELDS.filter((f) => !REFUSED.includes(f)))('%s — a new value is saved', async (field) => {
  const m = offers();
  await m.svc.update('o1', 'c', { [field]: NEW_VALUE[field] } as any, ADMIN);
  expect(m.prisma.offer.update.mock.calls[0][0].data).toHaveProperty(field);
});

it.each(REFUSED)('%s — a new value → 400 OFFER_FIELD_NOT_EDITABLE naming it, nothing written', async (field) => {
  const m = offers();
  const err = await m.svc.update('o1', 'c', { [field]: NEW_VALUE[field] } as any, ADMIN).catch((e) => e);
  expect(err).toBeInstanceOf(BadRequestException);
  expect(err.getResponse()).toMatchObject({ code: 'OFFER_FIELD_NOT_EDITABLE', params: { field } });
  expect(m.prisma.offer.update).not.toHaveBeenCalled();
});

it('source and externalId with their current values (a form sending everything) → no error', async () => {
  const m = offers();
  await m.svc.update('o1', 'c', { source: 'MANUAL', externalId: 'EXT-1', notes: 'x' } as any, ADMIN);
  expect(m.prisma.offer.update).toHaveBeenCalledTimes(1);
});

it('cleared: null clears the nullable columns; the flags (no null in the database) become false', async () => {
  const m = offers({ isAdr: true, adrClass: '3', isFrigo: true, palletExchange: true, lengthM: 7, penaltyClauses: 'x' });
  await m.svc.update('o1', 'c', { isAdr: null, adrClass: null, isFrigo: null, palletExchange: null, lengthM: null, penaltyClauses: '' } as any, ADMIN);
  expect(m.prisma.offer.update.mock.calls[0][0].data).toMatchObject({
    isAdr: false, adrClass: null, isFrigo: false, palletExchange: false, lengthM: null, penaltyClauses: null,
  });
});

it('the cargo fields are not locked after acceptance: a DISPATCHER changes ADR, reefer and pallets of an accepted offer', async () => {
  const m = offers({ status: 'ACCEPTED' });
  await m.svc.update('o1', 'c', { isAdr: true, adrClass: '3', isFrigo: true, temperatureMin: 2, palletCount: 18 } as any, { userId: 'd', role: 'DISPATCHER' });
  expect(m.prisma.offer.update.mock.calls[0][0].data).toMatchObject({ isAdr: true, adrClass: '3', isFrigo: true, temperatureMin: 2, palletCount: 18 });
});

it('a change of ADR / reefer clears the offer list cache; matching and LTL have no cache — they read the offer from the database', async () => {
  const m = offers();
  await m.svc.update('o1', 'c', { isAdr: true, adrClass: '3', isFrigo: true } as any, ADMIN);
  expect(m.cache.deleteByPrefix).toHaveBeenCalledWith('offers:c');
  for (const f of ['matching/matching.service.ts', 'ltl-matching/ltl-matching.service.ts', 'negotiation/negotiation.service.ts']) {
    expect([f, /MemoryCacheService|this\.cache\./.test(readFileSync(resolve(__dirname, '../../src', f), 'utf8'))]).toEqual([f, false]);
  }
});

it('the code is in the message list (and so in the PL/EN dictionary)', () => {
  expect(PLAN_MESSAGE_CODES).toContain('OFFER_FIELD_NOT_EDITABLE');
});
