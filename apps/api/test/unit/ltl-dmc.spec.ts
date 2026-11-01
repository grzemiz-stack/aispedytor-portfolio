/**
 * LtlMatchingService — gross combination weight against the GVW limit.
 *
 * The third arithmetic check of the LTL path, next to metres and capacity.
 * It answers a different question than `max_weight_kg`: that one is how much
 * may be LOADED, this one is how much the whole combination may WEIGH with
 * its curb weight.
 *
 * It matters in practice: a heavy tractor may have a nominal capacity that
 * cannot be fully used because the GVW limit is reached first. The capacity
 * check alone does not see that.
 *
 * No axle model and no geometry — plain arithmetic: curb weight + cargo.
 */
import { LtlMatchingService } from '../../src/ltl-matching/ltl-matching.service';

/** A heavy tractor: 24 t capacity, but the GVW limit allows only 23.5 t. */
const HEAVY_COMBINATION = {
  id: 'veh-1',
  companyId: 'comp-1',
  plateNumber: 'WA 12345',
  vehicleType: 'TRUCK',
  trailerType: 'CURTAIN',
  maxLoadingMeters: 13.6,
  maxWeightKg: 24000,
  maxPalletCount: 33,
  curbWeightKg: 16500,
  grossVehicleWeightKg: 40000,
};

function makeService(vehicle: any) {
  const prisma: any = {
    vehicle: { findFirst: jest.fn().mockResolvedValue(vehicle) },
    offer: { findMany: jest.fn().mockResolvedValue([]) },
    company: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  return new LtlMatchingService(prisma, {} as any);
}

const plan = (cargoWeightsKg: number[]) => ({
  vehicleId: 'veh-1',
  loads: cargoWeightsKg.map((w, i) => ({
    offerId: `o${i + 1}`,
    weight: w,
    meters: 1.0,
    loadingCity: 'Poznań',
    unloadingCity: 'Berlin',
  })),
}) as any;

const gvwWarnings = (r: any) =>
  r.warnings.filter((w: any) => w.code === 'GVW_EXCEEDED');

describe('GVW check — curb weight + cargo', () => {
  it('within capacity but over the GVW limit → one GVW_EXCEEDED warning with the numbers', async () => {
    // 16 500 kg curb weight + 24 000 kg cargo = 40 500 kg against a 40 000 kg GVW.
    // The capacity check does not see it: 24 000 <= 24 000.
    const r = await makeService(HEAVY_COMBINATION).calculateLoadPlan('comp-1', plan([24000]));

    expect(gvwWarnings(r)).toHaveLength(1);
    // Numbers in params, not in a sentence — in kilograms, the unit of the
    // vehicle record; the front-end dictionary converts to tonnes.
    expect(gvwWarnings(r)[0].params).toMatchObject({
      grossKg: 40500, maxGvwKg: 40000, curbKg: 16500, cargoKg: 24000,
    });
  });

  it('the warning is attached to the position, like metres and weight', async () => {
    const r = await makeService(HEAVY_COMBINATION).calculateLoadPlan('comp-1', plan([24000]));

    const lastPosition = r.positions[r.positions.length - 1];
    expect(lastPosition.warnings.map((w: any) => w.code)).toContain('GVW_EXCEEDED');
  });

  it('exceeding the GVW makes the plan invalid', async () => {
    const r = await makeService(HEAVY_COMBINATION).calculateLoadPlan('comp-1', plan([24000]));

    expect(r.isValid).toBe(false);
  });

  it('cargo within the GVW gives no warning', async () => {
    // 16 500 + 23 000 = 39 500 <= 40 000
    const r = await makeService(HEAVY_COMBINATION).calculateLoadPlan('comp-1', plan([23000]));

    expect(gvwWarnings(r)).toHaveLength(0);
    expect(r.isValid).toBe(true);
  });

  it('reaching the GVW exactly is not exceeding it', async () => {
    // 16 500 + 23 500 = 40 000
    const r = await makeService(HEAVY_COMBINATION).calculateLoadPlan('comp-1', plan([23500]));

    expect(gvwWarnings(r)).toHaveLength(0);
  });

  it('the GVW check is cumulative over positions', async () => {
    // 16 500 + 10 000 = 26 500 (ok), + 14 000 = 40 500 (exceeded)
    const r = await makeService(HEAVY_COMBINATION).calculateLoadPlan('comp-1', plan([10000, 14000]));

    // The code, not the sentence: the sentence is built by the front end and may change.
    expect(r.positions[0].warnings.map(w => w.code)).not.toContain('GVW_EXCEEDED');
    expect(r.positions[1].warnings.map(w => w.code)).toContain('GVW_EXCEEDED');
  });

  it('exceeding capacity and GVW together gives two separate warnings', async () => {
    // 25 000 > 24 000 capacity, and 16 500 + 25 000 = 41 500 > 40 000 GVW
    const r = await makeService(HEAVY_COMBINATION).calculateLoadPlan('comp-1', plan([25000]));

    const lastPosition = r.positions[r.positions.length - 1];
    expect(lastPosition.warnings.map(w => w.code)).toEqual(
      expect.arrayContaining(['LOAD_PLAN_WEIGHT_EXCEEDED', 'GVW_EXCEEDED']));
  });
});

describe('vehicle record without GVW or curb weight — refused', () => {
  it.each([
    ['grossVehicleWeightKg', { ...HEAVY_COMBINATION, grossVehicleWeightKg: null }],
    ['curbWeightKg', { ...HEAVY_COMBINATION, curbWeightKg: null }],
  ])('missing %s blocks the plan', async (_pole, vehicleRecord) => {
    await expect(
      makeService(vehicleRecord).calculateLoadPlan('comp-1', plan([1000])),
    ).rejects.toThrow(/kartoteka pojazdu/i);
  });

  it('the refusal names the missing field', async () => {
    await makeService({ ...HEAVY_COMBINATION, grossVehicleWeightKg: null })
      .calculateLoadPlan('comp-1', plan([1000]))
      .then(
        () => { throw new Error('Oczekiwano odmowy'); },
        (err: any) => {
          expect(err.getResponse()).toMatchObject({
            error: 'IncompleteVehicleRecord',
            missing: ['grossVehicleWeightKg'],
          });
        },
      );
  });

  it('both missing → both named', async () => {
    await makeService({ ...HEAVY_COMBINATION, grossVehicleWeightKg: null, curbWeightKg: null })
      .calculateLoadPlan('comp-1', plan([1000]))
      .then(
        () => { throw new Error('Oczekiwano odmowy'); },
        (err: any) => {
          expect(err.getResponse().missing).toEqual(
            expect.arrayContaining(['grossVehicleWeightKg', 'curbWeightKg']),
          );
        },
      );
  });

  it('a curb weight of 0 is a value, not missing data', async () => {
    // Zero is not missing data — 0 passes the assertion.
    const r = await makeService({ ...HEAVY_COMBINATION, curbWeightKg: 0 })
      .calculateLoadPlan('comp-1', plan([24000]));

    expect(gvwWarnings(r)).toHaveLength(0); // 0 + 24 000 <= 40 000
  });
});
