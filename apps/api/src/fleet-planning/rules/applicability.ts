/**
 * Does Regulation 561/2006 apply to the vehicle on this transport?
 * (art. 2(1); Mobility Package: from 1 July 2026 also vehicles over 2.5 t
 * in international transport or cabotage.)
 *
 * Exemptions of art. 3 (and national ones of art. 13) are not modelled:
 * they depend on the use of the vehicle, which this module does not know.
 */
export const LIGHT_VEHICLES_FROM = Date.UTC(2026, 6, 1);

export interface ApplicabilityInput {
  /** Maximum permissible mass of the vehicle (with trailer or semi-trailer), kg. */
  permissibleMassKg: number;
  /** International transport or cabotage. */
  international: boolean;
  /** When the transport takes place (epoch ms). */
  at: number;
}

export function rulesApply({ permissibleMassKg, international, at }: ApplicabilityInput): boolean {
  if (permissibleMassKg > 3500) return true;
  return international && at >= LIGHT_VEHICLES_FROM && permissibleMassKg > 2500;
}
