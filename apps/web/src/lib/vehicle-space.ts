/**
 * The vehicle's cargo space on the LTL screen — only from the vehicle record.
 *
 * The screen used to substitute `maxLoadingMeters || 13.6` and
 * `maxWeightKg || 24000` and drew sliders, free metres and a trailer for a
 * vehicle that does not exist. A field missing from the record is now
 * missing, with a notice to complete it in Fleet; 0 is a value.
 */
export type SpaceField = 'maxLoadingMeters' | 'maxWeightKg';

export type VehicleSpace =
  | { known: true; maxMeters: number; maxWeightT: number }
  | { known: false; missing: SpaceField[] };

export function vehicleSpace(v: { maxLoadingMeters: number | null; maxWeightKg: number | null }): VehicleSpace {
  const missing: SpaceField[] = [];
  if (v.maxLoadingMeters == null) missing.push('maxLoadingMeters');
  if (v.maxWeightKg == null) missing.push('maxWeightKg');
  if (missing.length > 0) return { known: false, missing };
  return { known: true, maxMeters: v.maxLoadingMeters!, maxWeightT: v.maxWeightKg! / 1000 };
}

const FIELD_TEXT: Record<SpaceField, string> = {
  maxLoadingMeters: 'długości przestrzeni ładunkowej',
  maxWeightKg: 'ładowności',
};

/** The notice (Polish UI text) naming the missing fields and pointing to Fleet. */
export function missingSpaceText(missing: SpaceField[]): string {
  return `Kartoteka pojazdu nie ma ${missing.map((f) => FIELD_TEXT[f]).join(' i ')} — uzupełnij we Flocie, żeby liczyć wolne miejsce.`;
}
