/**
 * Offers: assigning the person and the computed fields; the vehicle edit.
 *
 * Before: "Przypisz do mnie" sent only `PATCH /status` with ASSIGNED — an
 * "assigned" offer without a person. The new-offer form computed the rate per
 * km, cost, profit and margin itself (from fuel and toll typed in — another
 * cost base than `offerCost`); the DTO bounds refused them as a 400 on fields
 * nobody sees.
 * Now:
 *  - ASSIGNED only through `PATCH /:id/assign/:userId`; `/status` with
 *    ASSIGNED → 400 OFFER_ASSIGN_VIA_ASSIGN; back to NEW clears the person,
 *    later statuses (ACCEPTED etc.) keep it;
 *  - `pricePerKm`, `totalCostEstimate`, `profitEstimate`, `profitMarginPercent`
 *    removed from the create and edit DTO (an old client → 400); the API
 *    computes the rate per km from the price and the distance (on save and
 *    when the price or distance changes); no margin is computed on save; a
 *    price or distance change in edit clears the old margin, profit and cost.
 */
import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { OffersService } from '../../src/offers/offers.service';
import { CreateOfferDto } from '../../src/offers/dto/create-offer.dto';
import { UpdateOfferDto } from '../../src/offers/dto/update-offer.dto';
import { PLAN_MESSAGE_CODES } from '../../src/common/plan-messages';

const CURRENT = {
  id: 'o1', companyId: 'c', status: 'ASSIGNED', assignedToId: 'u1', price: 1200, distanceKm: 600,
  pickupCity: 'Poznań', pickupCountry: 'PL', deliveryCity: 'Berlin', deliveryCountry: 'DE',
};

function make(current: object = CURRENT) {
  const prisma: any = {
    // The company cost per km and the planner route — the margin on save; none → no margin.
    company: { findUnique: async () => null },
    routeCalculation: { findFirst: async () => null },
    offer: {
      findFirst: jest.fn(async () => ({ ...current })),
      create: jest.fn(async ({ data }: any) => ({ id: 'new', ...data })),
      update: jest.fn(async ({ data }: any) => ({ ...current, ...data })),
    },
  };
  const svc = new OffersService(prisma, { checkNewOfferAgainstDemands: async () => undefined } as any, { deleteByPrefix: () => undefined } as any, { enqueue: (fn: any) => fn() } as any);
  return { svc, prisma, data: () => prisma.offer.update.mock.calls[0]?.[0].data };
}

describe('the person and the ASSIGNED status', () => {
  it('PATCH /status with ASSIGNED → 400 OFFER_ASSIGN_VIA_ASSIGN, nothing written', async () => {
    const m = make({ ...CURRENT, status: 'NEW', assignedToId: null });
    const err = await m.svc.updateStatus('o1', 'c', 'ASSIGNED' as any).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({ code: 'OFFER_ASSIGN_VIA_ASSIGN' });
    expect(m.prisma.offer.update).not.toHaveBeenCalled();
  });

  it('ASSIGNED → NEW clears the person', async () => {
    const m = make();
    await m.svc.updateStatus('o1', 'c', 'NEW' as any);
    expect(m.data()).toEqual({ status: 'NEW', assignedToId: null, assignedAt: null });
  });

  it.each(['ACCEPTED', 'IN_TRANSIT', 'COMPLETED', 'REJECTED', 'EXPIRED'])('ASSIGNED → %s keeps the person', async (status) => {
    const m = make();
    await m.svc.updateStatus('o1', 'c', status as any);
    expect(m.data()).toEqual({ status });
  });

  it('OFFER_ASSIGN_VIA_ASSIGN is in the message list (and so in the PL/EN dictionary)', () => {
    expect(PLAN_MESSAGE_CODES).toContain('OFFER_ASSIGN_VIA_ASSIGN');
  });
});

describe('the computed fields', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const BODY = { pickupCity: 'Poznań', pickupCountry: 'PL', deliveryCity: 'Berlin', deliveryCountry: 'DE', pickupDate: '2030-10-12', price: 100, distanceKm: 300 };
  const validate = (metatype: any, value: object) =>
    pipe.transform(value, { type: 'body', metatype, data: '' }).then(() => 'ok', (e) => (e instanceof BadRequestException ? 400 : e));

  it('the body the form sends now passes — a rate of 0.33/km is no reason for a 400', async () => {
    expect(await validate(CreateOfferDto, { ...BODY, fuelCostEstimate: 50, tollCostEstimate: 20 })).toBe('ok');
  });

  it.each(['pricePerKm', 'totalCostEstimate', 'profitEstimate', 'profitMarginPercent'])('%s is no longer accepted (create and edit) → 400', async (field) => {
    expect([await validate(CreateOfferDto, { ...BODY, [field]: 1 }), await validate(UpdateOfferDto, { [field]: 1 })]).toEqual([400, 400]);
  });

  it.each([
    ['price / distance', { price: 1200, distanceKm: 600 }, 2],
    ['a price of 0 is a price', { price: 0, distanceKm: 600 }, 0],
    ['no distance', { price: 1200 }, null],
    ['no price', { distanceKm: 600 }, null],
  ])('create: the API computes the rate per km — %s', async (_n, over, expected) => {
    const m = make();
    await m.svc.create('c', { pickupCity: 'A', pickupCountry: 'PL', deliveryCity: 'B', deliveryCountry: 'DE', pickupDate: '2030-10-12', ...over } as any);
    const data = m.prisma.offer.create.mock.calls[0][0].data;
    // The margin is computed on save; this fake company has no rate → an explicit none (null).
    expect([data.pricePerKm, data.profitMarginPercent, data.profitEstimate, data.totalCostEstimate]).toEqual([expected, null, null, null]);
  });

  it.each([
    ['a new price, the stored distance', { price: 1800 }, 3],
    ['a new distance, the stored price', { distanceKm: 400 }, 3],
    ['both', { price: 900, distanceKm: 300 }, 3],
  ])('edit: the rate is recomputed — %s', async (_n, dto, expected) => {
    const m = make();
    await m.svc.update('o1', 'c', dto as any);
    expect(m.data().pricePerKm).toBe(expected);
  });

  it.each([
    ['price', { price: 1800 }],
    ['distance', { distanceKm: 400 }],
  ])('edit: a new %s clears the old margin, profit and total cost (null, not a number computed from the old price)', async (_n, dto) => {
    const m = make({ ...CURRENT, profitMarginPercent: 40, profitEstimate: 480, totalCostEstimate: 720 });
    await m.svc.update('o1', 'c', dto as any);
    const d = m.data();
    expect([d.profitMarginPercent, d.profitEstimate, d.totalCostEstimate]).toEqual([null, null, null]);
  });

  it('edit without a price or distance change: the stored rate, margin, profit and total cost are not touched', async () => {
    const m = make({ ...CURRENT, profitMarginPercent: 40, profitEstimate: 480, totalCostEstimate: 720 });
    await m.svc.update('o1', 'c', { notes: 'x', fuelCostEstimate: 100 } as any);
    const d = m.data();
    expect(['pricePerKm', 'profitMarginPercent', 'profitEstimate', 'totalCostEstimate'].filter((k) => k in d)).toEqual([]);
  });
});

describe('the API clears vehicle fields the edit form sends as null', () => {
  // The same fields as `CLEARABLE` in apps/web/src/lib/forms.test.ts.
  const NULLS = {
    licensePlate: null, ocrNumber: null, brand: null, model: null, vin: null, year: null, trailerType: null, parentVehicleId: null,
    maxWeightKg: null, grossVehicleWeightKg: null, curbWeightKg: null, maxVolumeM3: null, maxLoadingMeters: null, maxPalletCount: null,
    axleCount: null, technicalInspectionFrom: null, technicalInspectionTo: null, insuranceFrom: null, insuranceTo: null,
    tachographLegalizationFrom: null, tachographLegalizationTo: null, plannedMaintenanceDate: null, plannedMaintenanceNotes: null,
    fuelCardType: null, fuelCardLast4: null, fuelCardExpiry: null, notes: null,
  };

  it('UpdateVehicleDto lets every null through, and the numbers stay null (not 0) after the conversion', async () => {
    const { UpdateVehicleDto } = await import('../../src/vehicles/dto/update-vehicle.dto');
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const out = await pipe.transform({ plateNumber: 'PO 12345', vehicleType: 'TRUCK', ...NULLS }, { type: 'body', metatype: UpdateVehicleDto, data: '' });
    expect(Object.keys(NULLS).filter((k) => out[k] !== null)).toEqual([]);
  });

  it('VehiclesService.update writes null into every cleared column', async () => {
    const { VehiclesService } = await import('../../src/vehicles/vehicles.service');
    const prisma: any = {
      // The company cost per km and the planner route — the margin on save; none → no margin.
      company: { findUnique: async () => null },
      routeCalculation: { findFirst: async () => null },
      vehicle: {
        findFirst: jest.fn(async () => ({ id: 'v1', companyId: 'c', vehicleCategory: 'SEMI_TRAILER', parentVehicleId: 'v9' })),
        findMany: jest.fn(async () => []),
        update: jest.fn(async ({ data }: any) => data),
      },
      user: { findFirst: jest.fn(async () => null) },
    };
    const svc = new VehiclesService(prisma, { deleteByPrefix: () => undefined } as any);
    await svc.update('v1', 'c', { ...NULLS } as any);
    const data = prisma.vehicle.update.mock.calls[0][0].data;
    expect(Object.keys(NULLS).filter((k) => data[k] !== null)).toEqual([]);
  });
});
