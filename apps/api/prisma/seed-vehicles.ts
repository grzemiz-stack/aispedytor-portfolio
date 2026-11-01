/**
 * Extra vehicles of the seed data — definitions only, nothing is written to
 * the database.
 *
 * A separate module so a test can check the seed data directly (axle class
 * of the combination, reefer detection) while `seed.ts` still writes it.
 *
 * `axleCount` is the axles of THIS record (docs/decisions.md §7): a tractor
 * has 2, and the semi-trailer's axles and trailer type are on a separate
 * semi-trailer record attached through `parentVehicleId`. The tractor does
 * not carry the axles of the whole combination.
 *
 * Load data (metres, weights, dimensions) stays on the tractor — LTL reads it
 * from the selected record. Moving it to the semi-trailer is a separate change.
 *
 * Every unit that carries load (tractor with semi-trailer, rigid truck, van)
 * has a complete record: gross vehicle weight and curb weight — without them
 * LTL answers 422 (`IncompleteVehicleRecord`). The values come from the
 * vehicle profiles of an earlier module, since removed as dead code; curb
 * weight + payload ≤ gross weight (test/unit/seed-vehicles.spec.ts).
 */

type VehicleType = 'TRUCK' | 'VAN' | 'MEGA' | 'STANDARD' | 'REFRIGERATED';
type TrailerType = 'CURTAIN' | 'BOX' | 'REEFER' | 'FLATBED' | 'TANKER';
type VehicleStatus = 'AVAILABLE' | 'IN_TRANSIT';

export interface SeedVehicle {
  id: string;
  plateNumber: string;
  vehicleType: VehicleType;
  vehicleCategory: 'TRUCK' | 'RIGID' | 'SEMI_TRAILER' | 'VAN';
  trailerType?: TrailerType | null;
  parentVehicleId?: string;
  axleCount: number;
  status: VehicleStatus;
  dispatcherId: string;
  maxWeightKg?: number;
  maxVolumeM3?: number;
  lengthM?: number;
  heightM?: number;
  widthM?: number;
  currentCity?: string;
  currentCountry?: string;
  maxLoadingMeters?: number;
  maxPalletCount?: number;
  /** Gross weight of the combination (kg) — on the unit that carries the load. */
  grossVehicleWeightKg?: number;
  /** Curb weight of the combination (kg) — on the unit that carries the load. */
  curbWeightKg?: number;
}

/** A 2-axle tractor + an attached 3-axle semi-trailer with its trailer type. */
function tractorWithTrailer(
  tractor: Omit<SeedVehicle, 'vehicleCategory' | 'axleCount' | 'trailerType'>,
  trailerType: TrailerType,
): SeedVehicle[] {
  return [
    { ...tractor, vehicleCategory: 'TRUCK', axleCount: 2, trailerType: null },
    {
      id: `${tractor.id}-trailer`,
      plateNumber: `${tractor.plateNumber}-N`,
      vehicleType: tractor.vehicleType,
      vehicleCategory: 'SEMI_TRAILER',
      trailerType,
      parentVehicleId: tractor.id,
      axleCount: 3,
      status: tractor.status,
      dispatcherId: tractor.dispatcherId,
    },
  ];
}

/**
 * Order matters: a tractor before its semi-trailer, because the semi-trailer
 * points to it through `parentVehicleId`.
 */
export function extraSeedVehicles(d0: string, d1: string): SeedVehicle[] {
  return [
    ...tractorWithTrailer({
      id: 'seed-vehicle-reefer', plateNumber: 'SEED-CHLOD1', vehicleType: 'REFRIGERATED',
      maxWeightKg: 21000, grossVehicleWeightKg: 40000, curbWeightKg: 16000,
      maxVolumeM3: 80, lengthM: 13.6, heightM: 2.6, widthM: 2.48,
      currentCity: 'Poznań', currentCountry: 'PL', status: 'AVAILABLE',
      dispatcherId: d0, maxLoadingMeters: 13.6, maxPalletCount: 33,
    }, 'REEFER'),
    ...tractorWithTrailer({
      id: 'seed-vehicle-tanker', plateNumber: 'SEED-CYST1', vehicleType: 'TRUCK',
      maxWeightKg: 25000, grossVehicleWeightKg: 40000, curbWeightKg: 15000,
      maxVolumeM3: 30, lengthM: 12.0,
      currentCity: 'Katowice', currentCountry: 'PL', status: 'IN_TRANSIT',
      dispatcherId: d1, maxLoadingMeters: 12.0,
    }, 'TANKER'),
    ...tractorWithTrailer({
      id: 'seed-vehicle-flatbed', plateNumber: 'SEED-PLAT1', vehicleType: 'TRUCK',
      maxWeightKg: 24000, grossVehicleWeightKg: 40000, curbWeightKg: 15500,
      lengthM: 13.6, widthM: 2.48,
      currentCity: 'Wrocław', currentCountry: 'PL', status: 'AVAILABLE',
      dispatcherId: d0, maxLoadingMeters: 13.6, maxPalletCount: 34,
    }, 'FLATBED'),
    {
      // Rigid truck: body on its own chassis, no semi-trailer — its axles are the whole combination.
      id: 'seed-vehicle-rigid', plateNumber: 'SEED-SOLO1', vehicleType: 'STANDARD', vehicleCategory: 'RIGID',
      trailerType: 'BOX', maxWeightKg: 8000, grossVehicleWeightKg: 18000, curbWeightKg: 7500,
      maxVolumeM3: 40, lengthM: 7.2, heightM: 2.4, widthM: 2.45,
      currentCity: 'Bydgoszcz', currentCountry: 'PL', status: 'AVAILABLE',
      dispatcherId: d1, maxLoadingMeters: 7.2, maxPalletCount: 18, axleCount: 2,
    },
    {
      id: 'seed-vehicle-van', plateNumber: 'SEED-BUS01', vehicleType: 'VAN', vehicleCategory: 'VAN',
      // 3.5 t van: payload 1300 kg (not 3500 kg — that is the whole gross weight).
      maxWeightKg: 1300, grossVehicleWeightKg: 3500, curbWeightKg: 2200,
      maxVolumeM3: 20, lengthM: 4.2, heightM: 2.1, widthM: 1.8,
      currentCity: 'Łódź', currentCountry: 'PL', status: 'AVAILABLE',
      dispatcherId: d1, maxLoadingMeters: 4.2, maxPalletCount: 8, axleCount: 2,
    },
    ...tractorWithTrailer({
      id: 'seed-vehicle-mega2', plateNumber: 'SEED-MEGA1', vehicleType: 'MEGA',
      maxWeightKg: 24000, grossVehicleWeightKg: 40000, curbWeightKg: 15500,
      maxVolumeM3: 100, lengthM: 13.6, heightM: 3.0, widthM: 2.48,
      currentCity: 'Szczecin', currentCountry: 'PL', status: 'AVAILABLE',
      dispatcherId: d0, maxLoadingMeters: 13.6, maxPalletCount: 34,
    }, 'CURTAIN'),
  ];
}
