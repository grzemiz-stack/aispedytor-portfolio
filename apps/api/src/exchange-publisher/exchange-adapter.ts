/**
 * Freight exchange adapter port (today: Timocom).
 *
 * This repository does not publish on Timocom. An adapter is plugged in
 * behind this interface; without one, publishing with `publishToTimocom`
 * answers `success: false` with the code TIMOCOM_NOT_IMPLEMENTED and nothing
 * is sent.
 *
 * The adapter publishes with the account of `input.companyId` — never with
 * one account shared by every company (the pattern: Trans.eu,
 * `TransEuAuthService` and the `exchange_connections` table). Register it in
 * `exchange-publisher.module.ts` — the only place where the adapter is chosen.
 */
import type { PublishOfferInput } from './exchange-publisher.service';

/** Injection token. The value is an ExchangeAdapter, or `null` when none is plugged in. */
export const TIMOCOM_ADAPTER = Symbol('TIMOCOM_ADAPTER');

export interface ExchangeAdapter {
  /**
   * Publishes the load with the account of `input.companyId` and returns the
   * exchange's offer id. On failure (e.g. a company without a linked account)
   * throw an error with a readable `message` — it becomes the result's
   * `error`, and nothing is saved.
   */
  publish(input: PublishOfferInput): Promise<{ offerId: string }>;
}
