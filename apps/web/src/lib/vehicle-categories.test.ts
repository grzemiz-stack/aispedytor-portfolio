import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CATEGORY_LABELS,
  VEHICLE_CATEGORIES,
  canHaveAttachments,
  isTowed,
  ltlCarriers,
  vehicleCategoryLabel,
} from './vehicle-categories';

/**
 * The list and the rule are read STRAIGHT from the API source — the front-end
 * copy must not silently drift from what the server checks.
 */
const API = readFileSync(resolve(__dirname, '../../../api/src/common/vehicle-category.ts'), 'utf8');

function apiCategories(): string[] {
  const m = API.match(/VEHICLE_CATEGORIES = \[([^\]]*)\] as const/);
  if (!m) throw new Error('VEHICLE_CATEGORIES not found in the API source');
  return (m[1].match(/'([A-Z_]+)'/g) ?? []).map(s => s.slice(1, -1));
}

/** Parents from ALLOWED_PARENTS in the API — the units others may be attached to. */
function apiParents(): string[] {
  const m = API.match(/ALLOWED_PARENTS = \{([\s\S]*?)\} as const/);
  if (!m) throw new Error('ALLOWED_PARENTS not found in the API source');
  const lists = [...m[1].matchAll(/\[([^\]]*)\]/g)].flatMap(x => (x[1].match(/'([A-Z_]+)'/g) ?? []).map(s => s.slice(1, -1)));
  return [...new Set(lists)].sort();
}

describe('vehicle categories in the web app', () => {
  it('the list equals the API list', () => {
    expect([...VEHICLE_CATEGORIES].sort()).toEqual(apiCategories().sort());
  });

  it('every API category has a PL and an EN label, and they differ', () => {
    for (const code of apiCategories()) {
      const pl = vehicleCategoryLabel(code, 'pl');
      const en = vehicleCategoryLabel(code, 'en');
      expect(pl).not.toBe(code);
      expect(en).not.toBe(code);
      expect(pl).not.toBe(en);
    }
  });

  it('SEMI_TRAILER is labelled Naczepa (EN Semi-trailer), TRAILER Przyczepa', () => {
    expect(CATEGORY_LABELS.pl.SEMI_TRAILER).toBe('Naczepa');
    expect(CATEGORY_LABELS.pl.TRAILER).toBe('Przyczepa');
    expect(CATEGORY_LABELS.en.SEMI_TRAILER).toBe('Semi-trailer');
  });

  it('canHaveAttachments matches the parents allowed by the API', () => {
    expect(VEHICLE_CATEGORIES.filter(canHaveAttachments).sort()).toEqual(apiParents());
  });

  it('the towed categories are exactly SEMI_TRAILER and TRAILER', () => {
    expect(VEHICLE_CATEGORIES.filter(isTowed)).toEqual(['SEMI_TRAILER', 'TRAILER']);
  });

  it('an unknown code shows the code, a missing one a dash', () => {
    expect(vehicleCategoryLabel('XYZ')).toBe('XYZ');
    expect(vehicleCategoryLabel(null)).toBe('—');
  });
});

describe('ltlCarriers — vehicles offered on the LTL screen', () => {
  // Shape as in the seed: tractor + semi-trailer as separate records with
  // almost the same plate (SEED-MEGA1 / SEED-MEGA1-N).
  const fleet = [
    { id: 'mega-trailer', plateNumber: 'SEED-MEGA1-N', vehicleCategory: 'SEMI_TRAILER', vehicleType: 'MEGA', parentVehicleId: 'mega' },
    { id: 'mega', plateNumber: 'SEED-MEGA1', vehicleCategory: 'TRUCK', vehicleType: 'MEGA', parentVehicleId: null },
    { id: 'solo-tractor', plateNumber: 'WA 12345', vehicleCategory: 'TRUCK', vehicleType: 'TRUCK', parentVehicleId: null },
    { id: 'rigid', plateNumber: 'SEED-SOLO1', vehicleCategory: 'RIGID', vehicleType: 'STANDARD', parentVehicleId: null },
    { id: 'rigid-trailer', plateNumber: 'SEED-SOLO1-P', vehicleCategory: 'TRAILER', vehicleType: 'STANDARD', parentVehicleId: 'rigid' },
    { id: 'van', plateNumber: 'SEED-BUS01', vehicleCategory: 'VAN', vehicleType: 'VAN', parentVehicleId: null },
    { id: 'loose-trailer', plateNumber: 'LUZ-1', vehicleCategory: 'SEMI_TRAILER', vehicleType: 'MEGA', parentVehicleId: null },
    { id: 'no-category', plateNumber: 'OLD-1', vehicleCategory: null, vehicleType: 'TRUCK', parentVehicleId: null },
  ];

  it('tractor with a semi-trailer, rigid and van — nothing else', () => {
    expect(ltlCarriers(fleet).map(v => v.id)).toEqual(['mega', 'rigid', 'van']);
  });

  it('a semi-trailer or a drawbar trailer is never a choice, attached or not', () => {
    const ids = ltlCarriers(fleet).map(v => v.id);
    expect(ids).not.toContain('mega-trailer');
    expect(ids).not.toContain('rigid-trailer');
    expect(ids).not.toContain('loose-trailer');
  });

  it('the decision is the category, not vehicleType (a VAN-type rigid stays, a MEGA-type trailer goes)', () => {
    const ids = ltlCarriers([
      { id: 'r', vehicleCategory: 'RIGID', vehicleType: 'VAN', parentVehicleId: null },
      { id: 't', vehicleCategory: 'SEMI_TRAILER', vehicleType: 'MEGA', parentVehicleId: null },
    ]).map(v => v.id);
    expect(ids).toEqual(['r']);
  });

  it('a tractor without a semi-trailer (or with no category) carries nothing', () => {
    const ids = ltlCarriers(fleet).map(v => v.id);
    expect(ids).not.toContain('solo-tractor');
    expect(ids).not.toContain('no-category');
  });
});

describe('LTL screen uses ltlCarriers for its vehicle list', () => {
  // No component tests: the screen source is read. A list filter on
  // `vehicleType !== 'VAN'` would let semi-trailers through (SEED-MEGA1-N) and drop vans.
  const PAGE = readFileSync(resolve(__dirname, '../app/(dashboard)/ltl-matching/page.tsx'), 'utf8');

  it('the fetched list goes through ltlCarriers', () => {
    expect(PAGE).toMatch(/setVehicles\(ltlCarriers<Vehicle>\(list\)\)/);
  });

  it('no list filter on vehicleType', () => {
    expect(PAGE).not.toMatch(/filter\(\s*\(v[^)]*\)\s*=>\s*v\.vehicleType/);
  });
});
