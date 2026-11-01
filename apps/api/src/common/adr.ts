/**
 * ADR — one rule for the whole system (LTL and vehicle ↔ offer matching).
 *
 * Both callers use this file, so a vehicle without ADR certification can
 * never get a good match for an ADR load. Same pattern as common/reefer.ts.
 */
import { msg, type PlanMessage } from './plan-messages';

export interface AdrOffer {
  isAdr?: boolean | null;
  adrClass?: string | null;
}

export interface AdrVehicle {
  hasAdr?: boolean | null;
  adrClasses?: string[] | null;
}

export interface AdrCheck {
  /** Reasons why the vehicle may NOT carry this load. Empty list = it may. */
  reasons: PlanMessage[];
  /** Remarks that do not block (e.g. an ADR offer without a class). */
  warnings: PlanMessage[];
}

export const ADR_CLASSES = ['1', '2', '3', '4.1', '4.2', '4.3', '5.1', '5.2', '6.1', '6.2', '7', '8', '9'];

export interface ParsedAdrClasses {
  classes: string[];
  /** Parts that cannot be read as an ADR class. */
  unrecognized: string[];
}

/**
 * "3", "Klasa 3", "kl. 4.1", "3, 8", "3/8" → canonical classes.
 *
 * Divisions 1.1–1.6 and 2.1–2.3 (UN numbering) count as class 1 and 2. A bare
 * "4", "5" or "6" is ambiguous — it goes to `unrecognized`, because an
 * unknown class is not a permission.
 */
export function parseAdrClasses(text: string | null | undefined): ParsedAdrClasses {
  const classes = new Set<string>();
  const unrecognized: string[] = [];
  const cleaned = (text ?? '')
    .toLowerCase()
    .replace(/\b(klasa|klasy|class|classes|adr)\b/g, ' ')
    .replace(/\bkl\b\.?/g, ' ')
    .replace(/(\d),(\d)/g, (_m, a: string, b: string) => {
      // A comma without spaces between digits. In Polish "4,1" is class 4.1
      // (4, 5 and 6 are not classes on their own, so there is no other reading).
      // "1,3" and "2,3" are a division OR two classes — ambiguous, so
      // unrecognized. Anything else ("3,8") is a list.
      if ('456'.includes(a)) return `${a}.${b}`;
      if ('12'.includes(a)) return `${a}_${b}`; // one token, unrecognized
      return `${a} ${b}`;
    });
  for (const raw of cleaned.split(/[\s,;/+&]+|\bi\b|\band\b/)) {
    const token = raw.trim().replace(/\.$/, '');
    if (!token) continue;
    const sub = token.match(/^([12])\.[1-6]$/);
    const cls = sub ? sub[1] : token;
    if (ADR_CLASSES.includes(cls)) classes.add(cls);
    else unrecognized.push(raw.trim());
  }
  return { classes: [...classes].sort(), unrecognized };
}

/** Whether the vehicle may carry the offer's load as far as ADR goes — reasons and warnings as codes. */
export function adrCompatibility(offer: AdrOffer, vehicle: AdrVehicle): AdrCheck {
  const out: AdrCheck = { reasons: [], warnings: [] };

  const classText = offer.adrClass?.trim() || '';
  // A class given with `isAdr = false` is an inconsistent offer — treat it as ADR to be safe.
  if (!offer.isAdr && !classText) return out;

  if (!vehicle.hasAdr) {
    out.reasons.push(msg('OFFER_ADR_VEHICLE_NOT_CERTIFIED'));
    return out;
  }
  if (!classText) {
    out.warnings.push(msg('OFFER_ADR_CLASS_NOT_GIVEN'));
    return out;
  }

  const offered = parseAdrClasses(classText);
  if (offered.unrecognized.length > 0 || offered.classes.length === 0) {
    out.reasons.push(msg('OFFER_ADR_CLASS_UNRECOGNIZED', { adrClass: classText }));
    return out;
  }

  // Vehicle entries that cannot be read allow nothing.
  const allowed = new Set((vehicle.adrClasses ?? []).flatMap(c => parseAdrClasses(c).classes));
  if (allowed.size === 0) {
    out.reasons.push(msg('OFFER_ADR_CLASSES_UNKNOWN', { offerClasses: offered.classes.join(', ') }));
    return out;
  }
  if (!offered.classes.every(c => allowed.has(c))) {
    out.reasons.push(
      msg('OFFER_ADR_CLASS_NOT_ALLOWED', {
        offerClasses: offered.classes.join(', '),
        vehicleClasses: [...allowed].sort().join(', '),
      }),
    );
  }
  return out;
}
