/**
 * Amounts in the company's currency — sums and averages for the dashboard and analytics.
 *
 * Offers come in different currencies, so a database `_sum` / `_avg` over
 * them would add 1000 EUR + 4000 PLN into "5000". Instead every amount goes
 * through common/fx.ts into the company's currency; an amount in a currency
 * without a rate is NOT added silently — it is counted as `unconverted`,
 * with the code TOTAL_EXCLUDES_UNCONVERTED.
 */
import type { OfferStatus } from '@prisma/client';
import { convert } from './fx';
import { dedupeMessages, msg, type PlanMessage } from './plan-messages';

/**
 * Statuses counted as revenue: every job the company took on — accepted,
 * in transit, completed. The web flow moves a job ACCEPTED → IN_TRANSIT →
 * COMPLETED; counting ACCEPTED alone made revenue fall as work got done.
 */
export const REVENUE_STATUSES = ['ACCEPTED', 'IN_TRANSIT', 'COMPLETED'] as const satisfies readonly OfferStatus[];

/** A revenue status (accepted, in transit, completed). */
export function isRevenueStatus(status: string): boolean {
  return (REVENUE_STATUSES as readonly string[]).includes(status);
}

/** The company's currency (`Company.costCurrency`); without a company — PLN, the column default. */
export async function companyCurrency(
  prisma: { company: { findUnique(args: object): Promise<{ costCurrency?: string | null } | null> } },
  companyId: string,
): Promise<string> {
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { costCurrency: true } });
  return c?.costCurrency ?? 'PLN';
}

/** The amount of one offer: id (to count the skipped ones), value, the offer's currency. */
export interface MoneyRow {
  id: string;
  value: number | string | { toString(): string } | null | undefined;
  currency: string | null | undefined;
}

export function averageOf(vals: number[]): number | null {
  return vals.length === 0 ? null : vals.reduce((a, b) => a + b, 0) / vals.length;
}

export class MoneyInCompanyCurrency {
  private readonly messages: PlanMessage[] = [];
  /** Offers without a rate — by id, so that one offer counts once in both the sum and the average. */
  private readonly skipped = new Set<string>();
  private readonly skippedCurrencies = new Set<string>();

  constructor(readonly currency: string) {}

  /** The amount in the company's currency, or `null` (no rate — counted as skipped). */
  amount(row: MoneyRow): number | null {
    if (row.value === null || row.value === undefined) return null;
    const r = convert(Number(row.value), row.currency ?? '', this.currency);
    this.messages.push(...r.messages);
    if (!r.ok) {
      this.skipped.add(row.id);
      this.skippedCurrencies.add(row.currency ?? '?');
      return null;
    }
    return r.amount;
  }

  /** Converted amounts; without empty ones and without those that could not be converted. */
  amounts(rows: MoneyRow[]): number[] {
    return rows.map(r => this.amount(r)).filter((v): v is number => v !== null);
  }

  sum(rows: MoneyRow[]): number {
    return this.amounts(rows).reduce((a, b) => a + b, 0);
  }

  /** Average of the converted amounts; `null` when there is nothing to average. */
  average(rows: MoneyRow[]): number | null {
    return averageOf(this.amounts(rows));
  }

  /**
   * What to add to the response: the currency, the codes, how many offers were skipped.
   *
   * Codes: FX_RATE_STATIC once per currency pair; a missing rate as one
   * TOTAL_EXCLUDES_UNCONVERTED with the number of offers —
   * CURRENCY_CONVERSION_UNAVAILABLE is about a single offer on the LTL list,
   * not about a total.
   */
  summary() {
    const codes = dedupeMessages(this.messages.filter(m => m.code === 'FX_RATE_STATIC'));
    if (this.skipped.size > 0) {
      codes.push(msg('TOTAL_EXCLUDES_UNCONVERTED', {
        count: this.skipped.size, from: [...this.skippedCurrencies].sort().join(', '), to: this.currency,
      }));
    }
    return { currency: this.currency, codes, unconverted: this.skipped.size };
  }
}
