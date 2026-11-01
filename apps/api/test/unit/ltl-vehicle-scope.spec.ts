/**
 * The LTL search reads the vehicle's compatibility fields (ADR, reefer,
 * axles) only from the caller's company (ltl-matching
 * loadCompatVehicle). With the `companyId` filter removed, a vehicle record
 * of another company with the same id would decide what the caller's truck
 * may carry. The fake filters by `where` like the database and holds the
 * same vehicle id in two companies — the other company's record first.
 */
import { LtlMatchingService } from '../../src/ltl-matching/ltl-matching.service';

const POZNAN = { lat: 52.4064, lng: 16.9252 };
const BERLIN = { lat: 52.52, lng: 13.405 };
const HAMBURG = { lat: 53.5511, lng: 9.9937 };

const base = {
  id: 'veh-1', plateNumber: 'PO 12345', vehicleType: 'TRUCK', trailerType: 'CURTAIN', maxLoadingMeters: 13.6,
  maxWeightKg: 24000, maxPalletCount: 33, grossVehicleWeightKg: 40000, curbWeightKg: 15000, adrClasses: [], trailers: [],
};
const VEHICLES = [
  { ...base, companyId: 'comp-B', hasAdr: true, adrClasses: ['3'] },
  { ...base, companyId: 'comp-1', hasAdr: false },
];
const ADR_OFFER = {
  id: 'adr', companyId: 'comp-1', status: 'NEW', externalId: null, source: 'manual', pickupCity: 'Berlin', pickupCountry: 'DE',
  deliveryCity: 'Poznań', deliveryCountry: 'PL', pickupLat: BERLIN.lat, pickupLng: BERLIN.lng, deliveryLat: POZNAN.lat, deliveryLng: POZNAN.lng,
  weightKg: 1000, lengthM: 1.2, palletCount: 1, price: 900, currency: 'EUR', pricePerKm: null, cargoType: 'Palety', contractor: null,
  isAdr: true, adrClass: '3',
};

const matches = (row: any, where: any) => Object.entries(where).every(([k, v]) => v === undefined || row[k] === v);

it('an ADR offer for a truck without ADR stays incompatible — another company\'s record with the same id does not count', async () => {
  const prisma: any = {
    vehicle: { findFirst: jest.fn(async ({ where }: any) => VEHICLES.find((v) => matches(v, where)) ?? null) },
    offer: { findMany: jest.fn().mockResolvedValue([ADR_OFFER]) },
    company: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const service = new LtlMatchingService(prisma, {} as any);
  (service as any).geocode = jest.fn().mockResolvedValueOnce(POZNAN).mockResolvedValueOnce(HAMBURG);
  const res = await service.findMatchingOffers('comp-1', {
    vehicleId: 'veh-1', currentLoadMeters: 0, currentLoadWeight: 0, routeFrom: 'Poznań', routeTo: 'Hamburg', maxDetourKm: 1000,
  } as any);
  expect(res.incompatible.map((o: any) => o.offerId)).toEqual(['adr']);
  expect(prisma.vehicle.findFirst.mock.calls.every(([args]: any[]) => args.where.companyId === 'comp-1')).toBe(true);
});
