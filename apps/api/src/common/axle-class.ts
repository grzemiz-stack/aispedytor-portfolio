/**
 * Toll axle class — one definition for the route planner and the detour cost.
 *
 * Tariffs (DE, PL, CH, AT…) count the axles of the whole COMBINATION, in
 * buckets 2 / 3 / 4 / 5+. The route planner uses `plannerAxleClass`, LTL
 * uses `combinationAxleClass`; a toll provider receives the `AxleClass`.
 */

import { DEFAULT_VEHICLE_CATEGORY, TRACTOR_CATEGORY, isTowedCategory } from './vehicle-category';

export type AxleClass = '2' | '3' | '4' | '5+';

/** Axle count → tariff bucket. Fewer than 3 axles is bucket "2". */
export function axleClassForCount(axleCount: number): AxleClass {
  if (axleCount >= 5) return '5+';
  if (axleCount === 4) return '4';
  if (axleCount === 3) return '3';
  return '2';
}

/** Without an axle count the planner assumes a 5+ combination — and says so with a flag. */
export const DEFAULT_PLANNER_AXLE_COUNT = 5;

export interface PlannerAxleClass {
  axleClass: AxleClass;
  /** `true` = no axle count was given, DEFAULT_PLANNER_AXLE_COUNT was assumed. */
  defaulted: boolean;
}

export function plannerAxleClass(axleCount?: number | null): PlannerAxleClass {
  if (axleCount == null) {
    return { axleClass: axleClassForCount(DEFAULT_PLANNER_AXLE_COUNT), defaulted: true };
  }
  return { axleClass: axleClassForCount(axleCount), defaulted: false };
}

// ── Combination class from the vehicle records ──────────────────────────

// Categories and the tractor come from the shared list (common/vehicle-category.ts).

export interface AxleUnit {
  vehicleCategory?: string | null;
  /** Axles of THIS record (a tractor usually 2, a semi-trailer usually 3). */
  axleCount?: number | null;
}

export interface AxleCombination extends AxleUnit {
  /** Semi-trailers / drawbar trailers attached to the record (`parentVehicleId`). */
  trailers?: AxleUnit[] | null;
}

export type CombinationAxleClass =
  | { axleClass: AxleClass; axleCount: number }
  | { axleClass: null; reason: 'TOWED_UNIT' | 'TRACTOR_WITHOUT_TRAILER' | 'AXLE_COUNT_MISSING' };

/**
 * Axle class of the whole combination: axles of this record + axles of the
 * attached semi-trailers and trailers. When it cannot be determined — `null`
 * with a reason, never a guess:
 *  - the record itself is a semi-trailer/trailer — not a combination;
 *  - a tractor without an attached semi-trailer — on its own it carries no load;
 *  - `axleCount` missing on any record of the combination.
 * A rigid / van with nothing attached: its own axles are the whole combination.
 */
export function combinationAxleClass(vehicle: AxleCombination): CombinationAxleClass {
  if (isTowedCategory(vehicle.vehicleCategory)) {
    return { axleClass: null, reason: 'TOWED_UNIT' };
  }
  const towed = vehicle.trailers ?? [];
  // No category = tractor (the database default) — the cautious reading, docs/decisions.md §7.
  const category = vehicle.vehicleCategory ?? DEFAULT_VEHICLE_CATEGORY;
  if (category === TRACTOR_CATEGORY && towed.length === 0) {
    return { axleClass: null, reason: 'TRACTOR_WITHOUT_TRAILER' };
  }
  const units = [vehicle, ...towed];
  if (units.some(u => u.axleCount == null)) {
    return { axleClass: null, reason: 'AXLE_COUNT_MISSING' };
  }
  const axleCount = units.reduce((sum, u) => sum + (u.axleCount as number), 0);
  return { axleClass: axleClassForCount(axleCount), axleCount };
}
