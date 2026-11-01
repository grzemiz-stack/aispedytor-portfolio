import { apiErrorText } from './api-error';
import type { PlanMessage } from './plan-messages';

/**
 * The LTL search result on the screen — one whole, not five separate fields.
 *
 * The screen sets it IN FULL after every search, also after an error. Setting
 * only the error message would keep the capacity and the list of the previous
 * search — the old result, or "Brak ofert pasujących…" (no matching offers),
 * would still show under an error that has nothing to do with it.
 */
export interface LtlSearchView<C, M, I> {
  capacity: C | null;
  matches: M[];
  notices: PlanMessage[];
  incompatible: I[];
  /** Offers without coordinates — not ranked (OFFER_AWAITING_LOCATION). */
  awaitingLocation: I[];
  /** Offers without coordinates beyond the API limit — a count only. */
  hiddenAwaitingLocation: number;
  hiddenWithoutAmount: number;
  /** Offers from blacklisted contractors over the API limit — the count only. */
  hiddenBlocked: number;
  /** Offers without weight or dimensions — at most 20 from the API. */
  unmeasurable: UnmeasurableOffer[];
  /** Every offer without weight or dimensions — the section header. */
  unmeasurableTotal: number;
  error: string;
}

/** An offer that cannot be measured against capacity — route, date and what is missing. */
export interface UnmeasurableOffer {
  offerId: string;
  pickupCity: string;
  pickupCountry: string;
  deliveryCity: string;
  deliveryCountry: string;
  pickupDate: string;
  missing: ('weightKg' | 'dimensions')[];
}

const MISSING_LABEL: Record<string, string> = { weightKg: 'masy', dimensions: 'wymiarów ani liczby palet' };

/** "Brak masy i wymiarów ani liczby palet" — Polish, from the API names. */
export function missingLoadText(missing: string[]): string {
  return `Brak ${missing.map((m) => MISSING_LABEL[m] ?? m).join(' i ')}`;
}

/** "i jeszcze N" (and N more) under the list — only when the API returned fewer than all. */
export function moreUnmeasurable(view: { unmeasurable: unknown[]; unmeasurableTotal: number }): number {
  return Math.max(0, view.unmeasurableTotal - view.unmeasurable.length);
}

export function viewFromResponse<C, M, I>(data: {
  capacity: C;
  matches: M[];
  notices?: PlanMessage[];
  incompatible?: I[];
  awaitingLocation?: I[];
  hiddenAwaitingLocation?: number;
  hiddenWithoutAmount?: number;
  hiddenBlocked?: number;
  unmeasurable?: UnmeasurableOffer[];
  unmeasurableTotal?: number;
}): LtlSearchView<C, M, I> {
  return {
    capacity: data.capacity,
    matches: data.matches,
    notices: data.notices ?? [],
    incompatible: data.incompatible ?? [],
    awaitingLocation: data.awaitingLocation ?? [],
    hiddenAwaitingLocation: data.hiddenAwaitingLocation ?? 0,
    hiddenWithoutAmount: data.hiddenWithoutAmount ?? 0,
    hiddenBlocked: data.hiddenBlocked ?? 0,
    unmeasurable: data.unmeasurable ?? [],
    unmeasurableTotal: data.unmeasurableTotal ?? data.unmeasurable?.length ?? 0,
    error: '',
  };
}

/** Search error: the message and an EMPTY result — nothing from the previous search. */
export function viewFromError<C, M, I>(errorData: unknown): LtlSearchView<C, M, I> {
  return {
    capacity: null,
    matches: [],
    notices: [],
    incompatible: [],
    awaitingLocation: [],
    hiddenAwaitingLocation: 0,
    hiddenWithoutAmount: 0,
    hiddenBlocked: 0,
    unmeasurable: [],
    unmeasurableTotal: 0,
    error: apiErrorText(errorData, 'Błąd wyszukiwania'),
  };
}
