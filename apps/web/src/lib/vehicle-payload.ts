/**
 * The vehicle form: field rules and the request body.
 *
 * In edit an empty field goes as `null` (the API clears the column); a new
 * vehicle leaves empty fields out. Before, `field || undefined` dropped a
 * cleared field (trailer, document dates, VIN…), the API left it as it was
 * and the screen said "saved". Required fields (plate number, vehicle type)
 * cleared → an error on the form, not `null`.
 */
import { dimensionValue } from './vehicle-dimensions';

export interface VRule { min?: number; max?: number; minLen?: number; maxLen?: number; pattern?: RegExp; required?: boolean; msg?: string }

export const VEHICLE_RULES: Record<string, VRule> = {
  plateNumber:     { minLen: 3, maxLen: 15, pattern: /^[A-Za-z0-9 \-]{3,15}$/, required: true, msg: 'Nr rejestracyjny: litery, cyfry, spacje, myślniki (3-15 znaków)' },
  vehicleType:     { required: true, msg: 'Typ pojazdu: wymagany' },
  maxWeightKg:     { min: 500, max: 44000, msg: 'Masa: 500 - 44 000 kg' },
  grossVehicleWeightKg: { min: 500, max: 60000, msg: 'DMC: 500 - 60 000 kg' },
  curbWeightKg:    { min: 0, max: 40000, msg: 'Masa własna: 0 - 40 000 kg' },
  maxVolumeM3:     { min: 0, max: 200, msg: 'Objętość max. 200 m³' },
  maxLoadingMeters:{ min: 1, max: 16, msg: 'Metry ładunkowe: 1 - 16 m' },
  maxPalletCount:  { min: 1, max: 40, msg: 'Palety: 1 - 40 szt.' },
  axleCount:       { min: 2, max: 7, msg: 'Osie: 2 - 7' },
  lengthM:         { min: 2, max: 18.75, msg: 'Długość: 2 - 18.75 m' },
  heightM:         { min: 2.0, max: 4.5, msg: 'Wysokość: 2.0 - 4.5 m' },
  widthM:          { min: 2.0, max: 2.6, msg: 'Szerokość: 2.0 - 2.6 m' },
  year:            { min: 1990, max: 2030, msg: 'Rok: 1990 - 2030' },
};

export function validateVehicleField(key: string, value: string): string | null {
  const r = VEHICLE_RULES[key];
  if (!r) return null;
  if (r.required && !value.trim()) return r.msg || 'Pole wymagane';
  if (!value.trim()) return null;
  if (r.pattern && !r.pattern.test(value)) return r.msg || 'Nieprawidłowy format';
  if (r.minLen && value.length < r.minLen) return r.msg || `Min. ${r.minLen} znaków`;
  if (r.maxLen && value.length > r.maxLen) return r.msg || `Max. ${r.maxLen} znaków`;
  const n = parseFloat(value);
  if (r.min !== undefined && !isNaN(n) && n < r.min) return r.msg || `Min. ${r.min}`;
  if (r.max !== undefined && !isNaN(n) && n > r.max) return r.msg || `Max. ${r.max}`;
  return null;
}

/** Errors of every field with a rule — an empty map = can be sent. */
export function vehicleFormErrors(form: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const key of Object.keys(VEHICLE_RULES)) {
    const err = validateVehicleField(key, String(form[key] ?? ''));
    if (err) errors[key] = err;
  }
  return errors;
}

type VehicleFormValues = Record<string, any>;

export function vehiclePayload(form: VehicleFormValues, mode: 'new' | 'edit'): Record<string, unknown> {
  // An empty field: in edit `null` = "clear", for a new vehicle — left out.
  const empty = mode === 'edit' ? null : undefined;
  const text = (v: string) => (v ? v : empty);
  const float = (v: string) => (v ? parseFloat(v) : empty);
  const int = (v: string) => (v ? parseInt(v) : empty);
  return {
    plateNumber: form.plateNumber,
    licensePlate: text(form.licensePlate),
    ocrNumber: text(form.ocrNumber),
    brand: text(form.brand),
    model: text(form.model),
    vin: text(form.vin),
    year: int(form.year),
    vehicleType: form.vehicleType,
    vehicleCategory: form.vehicleCategory,
    trailerType: text(form.trailerType),
    parentVehicleId: text(form.parentVehicleId),
    maxWeightKg: float(form.maxWeightKg),
    // `!== ''`, not a truthiness test: a curb weight of 0 is a value, not a missing one.
    grossVehicleWeightKg: form.grossVehicleWeightKg !== '' ? parseFloat(form.grossVehicleWeightKg) : empty,
    curbWeightKg: form.curbWeightKg !== '' ? parseFloat(form.curbWeightKg) : empty,
    maxVolumeM3: float(form.maxVolumeM3),
    maxLoadingMeters: float(form.maxLoadingMeters),
    maxPalletCount: int(form.maxPalletCount),
    axleCount: int(form.axleCount),
    // An empty field = null ("clear"); in edit it removes the saved dimension.
    lengthM: dimensionValue(form.lengthM),
    heightM: dimensionValue(form.heightM),
    widthM: dimensionValue(form.widthM),
    hasAdr: form.hasAdr,
    // ADR classes (decisions §7): the list matching reads; empty — `null` in edit ("clear", the API stores []).
    adrClasses: Array.isArray(form.adrClasses) && form.adrClasses.length > 0 ? form.adrClasses : empty,
    hasGps: form.hasGps,
    technicalInspectionFrom: text(form.technicalInspectionFrom),
    technicalInspectionTo: text(form.technicalInspectionTo),
    insuranceFrom: text(form.insuranceFrom),
    insuranceTo: text(form.insuranceTo),
    tachographLegalizationFrom: text(form.tachographLegalizationFrom),
    tachographLegalizationTo: text(form.tachographLegalizationTo),
    plannedMaintenanceDate: text(form.plannedMaintenanceDate),
    plannedMaintenanceNotes: text(form.plannedMaintenanceNotes),
    fuelCardType: text(form.fuelCardType),
    fuelCardLast4: text(form.fuelCardLast4),
    fuelCardExpiry: text(form.fuelCardExpiry),
    notes: text(form.notes),
  };
}
