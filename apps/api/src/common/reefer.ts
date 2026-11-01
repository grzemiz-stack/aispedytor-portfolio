/**
 * Reefer vehicle and reefer load — one rule for the whole system.
 *
 * A reefer is not only `vehicleType === 'REFRIGERATED'`: it is also a
 * `TRUCK` with a `trailerType REEFER` record attached (that is how the seed
 * data stores it). `matching` and `risk-analysis` use this rule too.
 */

export interface ReeferUnit {
  vehicleType?: string | null;
  trailerType?: string | null;
}

export interface ReeferVehicle extends ReeferUnit {
  /** Semi-trailers stored as separate records (`parentVehicleId`). */
  trailers?: ReeferUnit[] | null;
}

export interface ReeferOffer {
  isFrigo?: boolean | null;
  temperatureMin?: number | null;
  temperatureMax?: number | null;
}

const isReeferUnit = (u: ReeferUnit) => u.trailerType === 'REEFER' || u.vehicleType === 'REFRIGERATED';

/** Reefer: the record itself or a semi-trailer attached to it. No type is not a reefer. */
export function isReefer(vehicle: ReeferVehicle): boolean {
  return isReeferUnit(vehicle) || (vehicle.trailers ?? []).some(isReeferUnit);
}

/** Reefer load: the flag or just a temperature given (0 °C is a temperature). */
export function requiresReefer(offer: ReeferOffer): boolean {
  return !!offer.isFrigo || offer.temperatureMin != null || offer.temperatureMax != null;
}
