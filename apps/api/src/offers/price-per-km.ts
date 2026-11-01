/**
 * The rate per km of an offer = price / distance.
 *
 * The API computes it, not the client: the new-offer form used to compute and
 * send it, and the DTO bounds (0.5–50) refused real rates (100 EUR / 300 km).
 * A price of 0 is a price (rate 0); no price or no positive distance — none.
 */
export function pricePerKmOf(price: number | null | undefined, distanceKm: number | null | undefined): number | null {
  if (price == null || distanceKm == null || !(distanceKm > 0)) return null;
  return price / distanceKm;
}
