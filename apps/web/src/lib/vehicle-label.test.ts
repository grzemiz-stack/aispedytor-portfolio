/**
 * The vehicle label on the LTL list — the vehicle record only.
 */
import { vehicleOptionLabel, type VehicleLabelInput } from './vehicle-label';

const v = (over: Partial<VehicleLabelInput> = {}): VehicleLabelInput => ({
  plateNumber: 'PO 12345',
  brand: 'Volvo',
  model: 'FH',
  vehicleType: 'MEGA',
  maxLoadingMeters: 13.6,
  maxWeightKg: 24000,
  ...over,
});

describe('vehicleOptionLabel', () => {
  it('shows the record values', () => {
    expect(vehicleOptionLabel(v())).toBe('PO 12345 — Volvo FH (MEGA, 13,6 m, 24,0 t)');
  });

  it('missing length or payload is left out, not invented as 13.6 m / 24 t', () => {
    expect(vehicleOptionLabel(v({ maxLoadingMeters: null, maxWeightKg: null }))).toBe('PO 12345 — Volvo FH (MEGA)');
    expect(vehicleOptionLabel(v({ maxLoadingMeters: null }))).toBe('PO 12345 — Volvo FH (MEGA, 24,0 t)');
  });

  it('zero is a value, not missing', () => {
    expect(vehicleOptionLabel(v({ maxLoadingMeters: 0, maxWeightKg: 0 }))).toBe('PO 12345 — Volvo FH (MEGA, 0,0 m, 0,0 t)');
  });

  it('no brand or model: no dash and no empty gaps', () => {
    expect(vehicleOptionLabel(v({ brand: null, model: null }))).toBe('PO 12345 (MEGA, 13,6 m, 24,0 t)');
    expect(vehicleOptionLabel(v({ brand: '  ', model: 'FH' }))).toBe('PO 12345 — FH (MEGA, 13,6 m, 24,0 t)');
  });

  it('English formatting', () => {
    expect(vehicleOptionLabel(v(), 'en')).toBe('PO 12345 — Volvo FH (MEGA, 13.6 m, 24.0 t)');
  });
});
