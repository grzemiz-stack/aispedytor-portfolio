/**
 * Editing an offer and its coordinates.
 *
 * A changed place of a route end (city or country, normalized like the
 * geocoding cache key) clears that end's coordinates and `coordsCheckedAt`:
 * the offer waits for new ones (`awaitingLocation`) and the geocoding task
 * picks it up on its next run, instead of LTL using the old place.
 */import { OffersService } from '../../src/offers/offers.service';

const OFFER = {
  id: 'off-1', companyId: 'comp-1',
  pickupCity: 'Poznań', pickupCountry: 'PL', pickupLat: 52.4, pickupLng: 16.9,
  deliveryCity: 'Berlin', deliveryCountry: 'DE', deliveryLat: 52.5, deliveryLng: 13.4,
  coordsCheckedAt: new Date('2026-10-01'),
};

function setup() {
  const prisma: any = {
    // The company cost per km and the planner route — the margin on save; none → no margin.
    company: { findUnique: async () => null },
    routeCalculation: { findFirst: async () => null },
    offer: {
      findFirst: jest.fn(async ({ where }: any) => (where.id === OFFER.id && where.companyId === OFFER.companyId ? OFFER : null)),
      update: jest.fn(async ({ data }: any) => ({ ...OFFER, ...data })),
    },
  };
  const cache: any = { get: jest.fn(), set: jest.fn(), deleteByPrefix: jest.fn() };
  return { service: new OffersService(prisma, {} as any, cache, {} as any), prisma };
}
const saved = (prisma: any) => prisma.offer.update.mock.calls[0][0].data;

it('a new pickup city clears the pickup coordinates and the check stamp, delivery untouched', async () => {
  const { service, prisma } = setup();
  await service.update('off-1', 'comp-1', { pickupCity: 'Wrocław' } as any);

  expect(saved(prisma)).toMatchObject({ pickupCity: 'Wrocław', pickupLat: null, pickupLng: null, coordsCheckedAt: null });
  expect(saved(prisma)).not.toHaveProperty('deliveryLat');
});

it('a new delivery country clears the delivery coordinates', async () => {
  const { service, prisma } = setup();
  await service.update('off-1', 'comp-1', { deliveryCountry: 'AT' } as any);

  expect(saved(prisma)).toMatchObject({ deliveryLat: null, deliveryLng: null, coordsCheckedAt: null });
  expect(saved(prisma)).not.toHaveProperty('pickupLat');
});

it('the same place written differently (case, spaces) keeps the coordinates', async () => {
  const { service, prisma } = setup();
  await service.update('off-1', 'comp-1', { pickupCity: '  poznań ', pickupCountry: 'pl' } as any);

  expect(saved(prisma)).not.toHaveProperty('pickupLat');
  expect(saved(prisma)).not.toHaveProperty('coordsCheckedAt');
});

it('an edit without a place change keeps the coordinates', async () => {
  const { service, prisma } = setup();
  await service.update('off-1', 'comp-1', { price: 1500, pickupPostal: '61-001' } as any);

  expect(Object.keys(saved(prisma)).filter((k) => /Lat|Lng|coordsCheckedAt/.test(k))).toEqual([]);
});

it('an empty city in the request is no change (the same rule as the save)', async () => {
  const { service, prisma } = setup();
  await service.update('off-1', 'comp-1', { pickupCity: '' } as any);

  expect(saved(prisma)).not.toHaveProperty('pickupLat');
});

it('both ends moved → both cleared', async () => {
  const { service, prisma } = setup();
  await service.update('off-1', 'comp-1', { pickupCity: 'Łódź', deliveryCity: 'Hamburg' } as any);

  expect(saved(prisma)).toMatchObject({ pickupLat: null, pickupLng: null, deliveryLat: null, deliveryLng: null, coordsCheckedAt: null });
});
