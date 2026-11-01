/**
 * Toll provider port.
 *
 * This repository does not compute toll amounts. A toll provider (a toll
 * calculation service under its own contract) is plugged in behind this
 * interface; without one, every toll amount is `null` with the message code
 * TOLL_PROVIDER_NOT_CONFIGURED and costs are marked incomplete.
 *
 * Register an implementation in `tolls.module.ts` — the only place where the
 * provider is chosen. Every implementation must pass the contract tests in
 * `test/contract/toll-provider.contract.ts`.
 */
import type { AxleClass } from '../common/axle-class';

/** Injection token. The value is a TollProvider, or `null` when none is configured. */
export const TOLL_PROVIDER = Symbol('TOLL_PROVIDER');

export type EmissionClass = 'EURO_0' | 'EURO_I' | 'EURO_II' | 'EURO_III' | 'EURO_IV' | 'EURO_V' | 'EURO_VI';

export interface TollRequest {
  route: {
    /** Origin, waypoints in order, destination. */
    points: { lat: number; lng: number }[];
    /** Route geometry as "lat,lng;lat,lng;…" (empty when the route source has none). */
    polyline: string;
    distanceKm: number;
    /** Distance driven in each country (ISO 3166-1 alpha-2); order is not significant. */
    countries: { countryCode: string; distanceKm: number }[];
  };
  vehicle: {
    /** Axle class of the whole combination (tractor + attached units). */
    axleClass: AxleClass;
    emissionClass: EmissionClass;
    /** Gross combination weight in tonnes; `null` when unknown. */
    grossWeightTonnes: number | null;
  };
}

export interface TollItem {
  /** ISO 3166-1 alpha-2; must be one of the request's countries. */
  countryCode: string;
  /** Amount charged in that country, ≥ 0, in `currency`. */
  amount: number;
  /** ISO 4217 code, e.g. "EUR". */
  currency: string;
  /** Name of the toll system, if known (e.g. "Toll Collect"). */
  system?: string;
}

export interface TollQuote {
  /** Non-empty name of the provider; stored with every saved calculation. */
  source: string;
  /** One item per charged country. A country with no charge may be omitted. */
  items: TollItem[];
}

/**
 * The only error a provider may throw. `reason` is short and machine-readable
 * (e.g. "timeout", "unauthorized", "quota_exceeded", "bad_response").
 */
export class TollProviderError extends Error {
  constructor(readonly reason: string, message?: string) {
    super(message ?? `Toll provider error: ${reason}`);
    this.name = 'TollProviderError';
  }
}

export interface TollProvider {
  quote(request: TollRequest): Promise<TollQuote>;
}
