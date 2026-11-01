import { routePlannerHref } from './route-planner-link';

/**
 * A dashboard recommendation (`/ai-evaluation/batch`) — the route and the
 * "Planuj trasę" (plan the route) link from the offer's places and price that
 * the evaluation result carries.
 *
 * Before: the link was built from `route` ("PL→DE") — the planner got
 * countries instead of cities, and the price came from the list of recent
 * offers, which might not include the evaluated one. `route` is deprecated and
 * not used here.
 */
export interface RecommendationPlaces {
  offerId: string;
  pickupCity: string;
  pickupCountry: string;
  deliveryCity: string;
  deliveryCountry: string;
  price: number | null;
  currency: string;
}

export function recommendationRoute(r: RecommendationPlaces): string {
  return `${r.pickupCity}, ${r.pickupCountry} → ${r.deliveryCity}, ${r.deliveryCountry}`;
}

/** The same link as from the offer page: "City, country", the rate with its currency, the offer id. */
export function recommendationPlannerHref(r: RecommendationPlaces): string {
  return routePlannerHref({
    from: `${r.pickupCity}, ${r.pickupCountry}`,
    to: `${r.deliveryCity}, ${r.deliveryCountry}`,
    price: r.price,
    currency: r.currency,
    offerId: r.offerId,
  });
}
