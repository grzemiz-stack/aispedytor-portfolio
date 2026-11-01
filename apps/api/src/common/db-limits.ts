/**
 * Limits of database columns that a value from outside can exceed. An amount
 * over DECIMAL(10,2) ended the write with PostgreSQL's "numeric field
 * overflow" — a 500, and in an import the whole batch was lost.
 */

/** The largest DECIMAL(10,2) value: 8 digits before the point, 2 after. */
export const DECIMAL_10_2_MAX = 99_999_999.99;

/** Whether an amount fits an unsigned DECIMAL(10,2) money column (0 … DECIMAL_10_2_MAX). */
export const fitsMoneyColumn = (v: number): boolean => Number.isFinite(v) && v >= 0 && v <= DECIMAL_10_2_MAX;
