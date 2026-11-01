/**
 * Seed vehicles — combination axle class and reefer detection.
 *
 * Each tractor is a tractor (2 axles) + an attached semi-trailer (3) that
 * carries the trailer type. The test checks that the combination still has
 * class 5+ and the reefer combination is still a reefer.
 */
import { extraSeedVehicles, type SeedVehicle } from '../../prisma/seed-vehicles';
import { combinationAxleClass } from '../../src/common/axle-class';
import { isReefer } from '../../src/common/reefer';

const vehicles = extraSeedVehicles('d0', 'd1');
const byId = (id: string) => vehicles.find(v => v.id === id) as SeedVehicle;
/** A record with its attached semi-trailers — the way LTL and matching read it. */
const combination = (id: string) => ({ ...byId(id), trailers: vehicles.filter(v => v.parentVehicleId === id) });

const TRACTORS = ['seed-vehicle-reefer', 'seed-vehicle-tanker', 'seed-vehicle-flatbed', 'seed-vehicle-mega2'];

describe('seed vehicles — axle class of the combination', () => {
  it.each(TRACTORS)('%s: tractor 2 + trailer 3 → class 5+', id => {
    expect(byId(id)).toMatchObject({ vehicleCategory: 'TRUCK', axleCount: 2 });
    expect(combination(id).trailers).toEqual([expect.objectContaining({ vehicleCategory: 'SEMI_TRAILER', axleCount: 3 })]);
    expect(combinationAxleClass(combination(id))).toEqual({ axleClass: '5+', axleCount: 5 });
  });

  it('the rigid is a RIGID with 2 axles → class 2 on its own, and not a reefer', () => {
    expect(byId('seed-vehicle-rigid')).toMatchObject({ vehicleCategory: 'RIGID', axleCount: 2 });
    expect(combinationAxleClass(combination('seed-vehicle-rigid'))).toEqual({ axleClass: '2', axleCount: 2 });
    expect(isReefer(combination('seed-vehicle-rigid'))).toBe(false);
  });

  it('the van is a VAN with 2 axles → class 2 on its own', () => {
    expect(combinationAxleClass(combination('seed-vehicle-van'))).toEqual({ axleClass: '2', axleCount: 2 });
  });

  it('no record carries the whole combination anymore (no axleCount above 3)', () => {
    expect(vehicles.filter(v => v.axleCount > 3)).toEqual([]);
  });

  it('every trailer points at a tractor defined before it', () => {
    vehicles.forEach((v, i) => {
      if (!v.parentVehicleId) return;
      expect(vehicles.slice(0, i).map(p => p.id)).toContain(v.parentVehicleId);
    });
  });
});

describe('seed vehicles — the trailer type moved to the trailer, the reefer still is one', () => {
  it.each([
    ['seed-vehicle-reefer', 'REEFER'],
    ['seed-vehicle-tanker', 'TANKER'],
    ['seed-vehicle-flatbed', 'FLATBED'],
    ['seed-vehicle-mega2', 'CURTAIN'],
  ])('%s keeps its trailer type %s on the trailer record', (id, trailerType) => {
    expect(combination(id).trailers[0].trailerType).toBe(trailerType);
    expect(byId(id).trailerType).toBeNull();
  });

  it('the reefer combination is a reefer — also through the trailer alone', () => {
    expect(isReefer(combination('seed-vehicle-reefer'))).toBe(true);
    // Even if the tractor were not REFRIGERATED, the semi-trailer is the reefer.
    expect(isReefer({ ...combination('seed-vehicle-reefer'), vehicleType: 'TRUCK' })).toBe(true);
  });

  it.each(['seed-vehicle-tanker', 'seed-vehicle-flatbed', 'seed-vehicle-mega2', 'seed-vehicle-van'])(
    '%s is not a reefer',
    id => {
      expect(isReefer(combination(id))).toBe(false);
    },
  );
});

describe('seed vehicles — every unit that carries has a complete record (LTL answers 422 otherwise)', () => {
  /** What the LTL screen offers to choose from: a tractor with a semi-trailer, a rigid, a van. */
  const carriers = vehicles.filter(v =>
    v.vehicleCategory === 'RIGID' || v.vehicleCategory === 'VAN' ||
    (v.vehicleCategory === 'TRUCK' && vehicles.some(t => t.parentVehicleId === v.id)));

  it('the carriers are the four tractors, the rigid and the van', () => {
    expect(carriers.map(v => v.id).sort()).toEqual([...TRACTORS, 'seed-vehicle-rigid', 'seed-vehicle-van'].sort());
  });

  it.each([...TRACTORS, 'seed-vehicle-rigid', 'seed-vehicle-van'])(
    '%s: maxWeightKg, maxLoadingMeters, grossVehicleWeightKg, curbWeightKg all present',
    id => {
      const v = byId(id);
      for (const field of ['maxWeightKg', 'maxLoadingMeters', 'grossVehicleWeightKg', 'curbWeightKg'] as const) {
        expect(v[field]).toEqual(expect.any(Number));
      }
    },
  );

  it.each([...TRACTORS, 'seed-vehicle-rigid', 'seed-vehicle-van'])(
    '%s: curb weight + payload ≤ GVW (otherwise the load plan flags the empty truck)',
    id => {
      const v = byId(id);
      expect(v.curbWeightKg! + v.maxWeightKg!).toBeLessThanOrEqual(v.grossVehicleWeightKg!);
    },
  );
});
