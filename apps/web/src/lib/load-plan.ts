import { type PlanMessage } from './plan-messages';

/**
 * A load-plan item from an offer — no invented values (docs/decisions.md §2).
 *
 * An offer without weight must not enter the plan as 0 kg, nor one without
 * dimensions as 2.4 m: the gross weight (GVW) check would then pass falsely.
 * Same rule as in the API (`resolveLoadFootprint` in ltl-matching.service.ts):
 *  - weight: missing = missing; 0 is a value;
 *  - dimensions: the length, without it pallets × 0.4 m (euro pallet); without both = missing.
 * Missing data = the offer does NOT enter the plan, with the code LOAD_PLAN_OFFER_INCOMPLETE.
 */

/** 1 euro pallet on a semi-trailer = 0.4 loading metres — like EUROPALLET_LENGTH_M in the API. */
export const EUROPALLET_LENGTH_M = 0.4;

export type MissingLoadData = 'weightKg' | 'dimensions';

export interface LoadPlanSource {
  id: string;
  weightKg: number | null;
  lengthM: number | null;
  palletCount: number | null;
  cargoType: string | null;
  pickupCity: string;
  deliveryCity: string;
}

export interface LoadPlanItem {
  offerId: string;
  weight: number;
  meters: number;
  description: string;
  loadingCity: string;
  unloadingCity: string;
  position: number;
}

export type LoadPlanItemResult =
  | { ok: true; item: LoadPlanItem }
  | { ok: false; missing: MissingLoadData[]; message: PlanMessage };

export function loadPlanItem(offer: LoadPlanSource, position: number): LoadPlanItemResult {
  const missing: MissingLoadData[] = [];
  // `!= null`, not a truthiness test: 0 kg and 0 m are values.
  const weight = offer.weightKg != null ? Number(offer.weightKg) : null;
  if (weight === null) missing.push('weightKg');
  const meters =
    offer.lengthM != null ? Number(offer.lengthM)
      : offer.palletCount != null ? Number(offer.palletCount) * EUROPALLET_LENGTH_M
        : null;
  if (meters === null) missing.push('dimensions');

  if (missing.length > 0) {
    return { ok: false, missing, message: { code: 'LOAD_PLAN_OFFER_INCOMPLETE', params: { missing: missing.join(',') } } };
  }
  return {
    ok: true,
    item: {
      offerId: offer.id,
      weight: weight as number,
      meters: meters as number,
      description: offer.cargoType || `${offer.pickupCity} → ${offer.deliveryCity}`,
      loadingCity: offer.pickupCity,
      unloadingCity: offer.deliveryCity,
      position,
    },
  };
}
