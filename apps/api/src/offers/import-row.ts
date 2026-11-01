import { pricePerKmOf } from './price-per-km';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RawOfferDto } from './dto/import-offers.dto';
import { normalizeRawOffer, type RawOffer } from './raw-offer';
import { fitsMoneyColumn } from '../common/db-limits';
import type { PlanMessageCode } from '../common/plan-messages';

/** A rejected import row: the index in `offers` (from 0), the field (`null` = the whole row) and the code. */
export interface ImportRejection {
  row: number;
  field: string | null;
  code: Extract<PlanMessageCode, 'IMPORT_ROW_FIELD_INVALID' | 'IMPORT_ROW_DATE_INVALID' | 'OFFER_VALUE_OUT_OF_RANGE'>;
}

/**
 * Checks one import row. Before, one bad row gave 400 for the whole batch
 * (validation in the ValidationPipe), and an unreadable date or an amount over
 * DECIMAL(10,2) — a 500 from `createMany`.
 *
 * In order: the row is an object; the fields as in `RawOfferDto` (the same
 * rules the pipe applied: required, types, numbers from strings, nothing
 * outside the schema); the dates readable after `normalizeRawOffer`; the price
 * and the rate (given or computed from price and distance) within
 * DECIMAL(10,2). The first stage with problems ends the check — the row will
 * not be saved anyway.
 */
export async function checkImportRow(input: unknown, row: number): Promise<
  { ok: true; offer: RawOffer; pricePerKm: number | undefined } | { ok: false; rejected: ImportRejection[] }
> {
  const reject = (field: string | null, code: ImportRejection['code']) => ({ row, field, code });
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, rejected: [reject(null, 'IMPORT_ROW_FIELD_INVALID')] };
  }

  const dto = plainToInstance(RawOfferDto, input);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length) return { ok: false, rejected: errors.map((e) => reject(e.property, 'IMPORT_ROW_FIELD_INVALID')) };

  const offer = normalizeRawOffer(dto);
  const badDates = (['pickupDate', 'deliveryDate'] as const).filter((f) => offer[f] && Number.isNaN(new Date(offer[f]!).getTime()));
  if (badDates.length) return { ok: false, rejected: badDates.map((f) => reject(f, 'IMPORT_ROW_DATE_INVALID')) };

  // The rate is computed only when the source did NOT give one. A given 0 is a
  // rate, not a missing value — `??`, not a truthiness test (pricePerKmOf
  // needs a positive distance, so there is no division by zero).
  const pricePerKm = offer.pricePerKm ?? pricePerKmOf(offer.price, offer.distanceKm) ?? undefined;
  const outOfRange = ([['price', offer.price], ['pricePerKm', pricePerKm]] as const).filter(([, v]) => v != null && !fitsMoneyColumn(v));
  if (outOfRange.length) return { ok: false, rejected: outOfRange.map(([f]) => reject(f, 'OFFER_VALUE_OUT_OF_RANGE')) };

  return { ok: true, offer, pricePerKm };
}
