import type { Language } from './plan-messages';

/**
 * Vehicle categories in the front end: PL/EN labels, icons, which units can
 * have semi-trailers / trailers attached.
 *
 * The rule lives in the API (`apps/api/src/common/vehicle-category.ts`).
 * The list and `canHaveAttachments` are copied here only so the screen does
 * not ask the server for every label — a test reads the API file and checks
 * that the copy has not drifted. The "what can I attach to" list comes from
 * the API (`/vehicles?parentFor=…`), not from this copy.
 *
 * Code = English meaning: SEMI_TRAILER = naczepa, TRAILER = przyczepa.
 */

export const VEHICLE_CATEGORIES = ['TRUCK', 'RIGID', 'SEMI_TRAILER', 'TRAILER', 'VAN'] as const;
export type VehicleCategory = (typeof VEHICLE_CATEGORIES)[number];

const LABELS: Record<Language, Record<VehicleCategory, string>> = {
  pl: {
    TRUCK: 'Ciągnik siodłowy',
    RIGID: 'Solówka',
    SEMI_TRAILER: 'Naczepa',
    TRAILER: 'Przyczepa',
    VAN: 'Bus / dostawczy',
  },
  en: {
    TRUCK: 'Tractor unit',
    RIGID: 'Rigid truck',
    SEMI_TRAILER: 'Semi-trailer',
    TRAILER: 'Drawbar trailer',
    VAN: 'Van',
  },
};

export const CATEGORY_LABELS = LABELS;

const ICONS: Record<VehicleCategory, string> = {
  TRUCK: '🚛',
  RIGID: '🚚',
  SEMI_TRAILER: '🔗',
  TRAILER: '🛞',
  VAN: '🚐',
};

/** Category label; an unknown code returns the code itself — the gap is visible, the screen does not go blank. */
export function vehicleCategoryLabel(code: string | null | undefined, language: Language = 'pl'): string {
  if (!code) return '—';
  return (LABELS[language] ?? LABELS.pl)[code as VehicleCategory] ?? code;
}

export function vehicleCategoryIcon(code: string | null | undefined): string {
  return ICONS[code as VehicleCategory] ?? '🚗';
}

/** Semi-trailer or drawbar trailer — a record that gets attached. */
export function isTowed(code: string | null | undefined): boolean {
  return code === 'SEMI_TRAILER' || code === 'TRAILER';
}

/** Tractor, rigid, van — something can be attached to them (copy of the API rule). */
export function canHaveAttachments(code: string | null | undefined): boolean {
  return code === 'TRUCK' || code === 'RIGID' || code === 'VAN';
}

export interface CarrierCandidate {
  id: string;
  vehicleCategory?: string | null;
  parentVehicleId?: string | null;
}

/**
 * Vehicles that can carry an extra load — the choice on the LTL screen.
 *
 * A rigid truck and a van carry on their own. A tractor unit carries only with
 * a semi-trailer attached (on its own it has no load space). Semi-trailers and
 * drawbar trailers are not a choice — they travel with the unit they are
 * attached to. No category = tractor, as in the database (`DEFAULT 'TRUCK'`).
 * The input list must also contain the semi-trailers: they show which tractor
 * has a combination.
 */
export function ltlCarriers<V extends CarrierCandidate>(vehicles: V[]): V[] {
  const withSemiTrailer = new Set(
    vehicles
      .filter(v => v.vehicleCategory === 'SEMI_TRAILER' && v.parentVehicleId)
      .map(v => v.parentVehicleId as string),
  );
  return vehicles.filter(v => {
    const category = v.vehicleCategory ?? 'TRUCK';
    if (category === 'RIGID' || category === 'VAN') return true;
    if (category === 'TRUCK') return withSemiTrailer.has(v.id);
    return false;
  });
}
