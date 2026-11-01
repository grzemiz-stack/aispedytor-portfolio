/**
 * The vehicle label in the picker (LTL screen).
 *
 * Only what the vehicle record has: a missing load length or payload is left
 * out of the label, never invented as "13.6 m" / "24 t" (zero is a value and
 * is shown). No empty gaps after brand and model.
 */
import { formatMeters, formatTonnes } from './formatting';
import type { Language } from './plan-messages';

export interface VehicleLabelInput {
  plateNumber: string;
  brand: string | null;
  model: string | null;
  vehicleType: string;
  maxLoadingMeters: number | null;
  maxWeightKg: number | null;
}

export function vehicleOptionLabel(v: VehicleLabelInput, language: Language = 'pl'): string {
  const name = [v.brand, v.model].map((s) => s?.trim()).filter(Boolean).join(' ');
  const specs = [
    v.vehicleType,
    v.maxLoadingMeters != null ? formatMeters(v.maxLoadingMeters, language) : null,
    v.maxWeightKg != null ? formatTonnes(v.maxWeightKg, language) : null,
  ].filter(Boolean);
  return `${v.plateNumber}${name ? ` — ${name}` : ''} (${specs.join(', ')})`;
}
