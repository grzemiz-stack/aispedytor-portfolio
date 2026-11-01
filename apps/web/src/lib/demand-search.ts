/**
 * The demand "Szukaj" (search) result on the screen.
 *
 * Before: the screen took only the count from `POST /demands/:id/search` for a
 * toast — the offer list, the unknown criteria and the scan limit were lost.
 * Now: under the demand the first 10 offers in the API order, the total, the
 * criteria that could not be judged, and a note when the API scanned only the
 * newest offers (the limit).
 */

export const DEMAND_RESULTS_SHOWN = 10;

interface SearchOffer {
  id: string;
  pickupCity: string;
  pickupCountry: string;
  deliveryCity: string;
  deliveryCountry: string;
  pickupDate: string | null;
  price: number | string | null;
  currency: string | null;
  matchUnknownCriteria?: string[];
}

export interface DemandSearchResponse {
  matchCount: number;
  offers: SearchOffer[];
  unknownCriteriaSummary?: Record<string, number>;
  scanned: number;
  scanLimitReached: boolean;
}

const CRITERION_LABEL: Record<string, string> = {
  pickupCountry: 'kraj załadunku',
  weight: 'masa',
  adr: 'ADR',
  temperature: 'temperatura',
};

export interface DemandSearchView {
  total: number;
  shown: { id: string; route: string; pickupDate: string | null; price: string | null; unknown: string | null }[];
  more: number;
  scanNote: string | null;
}

export function demandSearchView(r: DemandSearchResponse): DemandSearchView {
  const shown = r.offers.slice(0, DEMAND_RESULTS_SHOWN).map((o) => ({
    id: o.id,
    route: `${o.pickupCity}, ${o.pickupCountry} → ${o.deliveryCity}, ${o.deliveryCountry}`,
    pickupDate: o.pickupDate ? new Date(o.pickupDate).toLocaleDateString('pl-PL') : null,
    // The price always with the offer currency; no price — none, not "0".
    price: o.price != null && o.price !== '' && o.currency ? `${Number(o.price).toLocaleString('pl-PL')} ${o.currency}` : null,
    unknown: o.matchUnknownCriteria?.length
      ? `nie da się ocenić: ${o.matchUnknownCriteria.map((c) => CRITERION_LABEL[c] ?? c).join(', ')}`
      : null,
  }));
  return {
    total: r.matchCount,
    shown,
    more: Math.max(0, r.matchCount - shown.length),
    scanNote: r.scanLimitReached
      ? `Przejrzano ${r.scanned} najnowszych ofert — starszych wyszukiwanie nie sprawdzało.`
      : null,
  };
}
