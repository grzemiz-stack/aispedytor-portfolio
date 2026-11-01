/**
 * The offer edit screen (decisions §3a) — on `PATCH /offers/:id`.
 *
 * The rules come from the API, not our own:
 *  - an accepted, in-transit or completed offer: money and dates (price,
 *    currency, distance, toll, loading date, validity) are changed by an ADMIN
 *    only — the others see them read-only, and the API would answer 403
 *    OFFER_FIELDS_ADMIN_ONLY anyway;
 *  - the contractor: detaching or replacing a blacklisted one is for an ADMIN
 *    only (403 CONTRACTOR_BLACKLIST_ADMIN_ONLY, a sentence from the dictionary);
 *  - cost, profit and margin are recomputed by saving; the preview with
 *    `offerId` computes the same.
 * The body carries only the fields changed against the offer; cleared — `null`.
 * The loading date is required.
 */
import { validateOfferField } from './offer-form';

const REVENUE = ['ACCEPTED', 'IN_TRANSIT', 'COMPLETED'];
/** Screen fields only an ADMIN changes in a revenue status (a subset of the API's OFFER_LOCKED_FIELDS). */
export const EDIT_LOCKED_FIELDS = ['price', 'currency', 'distanceKm', 'tollCostEstimate', 'pickupDate', 'expiresAt'] as const;

export type OfferEditForm = {
  pickupDate: string; expiresAt: string; price: string; currency: string; distanceKm: string; tollCostEstimate: string;
  contractorId: string; notes: string;
};

export interface EditableOffer {
  status: string; pickupDate: string; expiresAt?: string | null; price: number | string | null; currency: string;
  distanceKm: number | null; tollCostEstimate: number | string | null; contractorId?: string | null; notes: string | null;
}

export function moneyAndDatesLocked(status: string, role: string | null | undefined): boolean {
  return REVENUE.includes(status) && role !== 'ADMIN';
}

/** ISO → a `datetime-local` value in the browser's time zone. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function editFormFrom(offer: EditableOffer): OfferEditForm {
  const str = (v: number | string | null | undefined) => (v == null ? '' : String(Number(v)));
  return {
    pickupDate: offer.pickupDate.slice(0, 10),
    expiresAt: toLocalInput(offer.expiresAt),
    price: str(offer.price),
    currency: offer.currency,
    distanceKm: str(offer.distanceKm),
    tollCostEstimate: str(offer.tollCostEstimate),
    contractorId: offer.contractorId ?? '',
    notes: offer.notes ?? '',
  };
}

const num = (v: string) => (v.trim() === '' ? null : parseFloat(v));

function value(key: keyof OfferEditForm, form: OfferEditForm): unknown {
  switch (key) {
    case 'price': case 'distanceKm': case 'tollCostEstimate': return num(form[key]);
    case 'expiresAt': return form.expiresAt ? new Date(form.expiresAt).toISOString() : null;
    case 'contractorId': case 'notes': return form[key] || null;
    default: return form[key];
  }
}

/** The `PATCH` body: only the changed fields; when locked, without the locked ones. */
export function offerEditPayload(form: OfferEditForm, initial: OfferEditForm, locked: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of Object.keys(form) as (keyof OfferEditForm)[]) {
    if (form[key] === initial[key]) continue;
    if (locked && (EDIT_LOCKED_FIELDS as readonly string[]).includes(key)) continue;
    body[key] = value(key, form);
  }
  return body;
}

/** The edit margin preview: the same fields as saving, with `offerId` (the API computes with the offer's route). */
export function offerEditPreviewBody(offerId: string, form: OfferEditForm) {
  return {
    offerId,
    price: value('price', form),
    currency: form.currency,
    distanceKm: value('distanceKm', form),
    tollCostEstimate: value('tollCostEstimate', form),
  };
}

export function offerEditErrors(form: OfferEditForm): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const key of ['pickupDate', 'price', 'distanceKm', 'tollCostEstimate'] as const) {
    const err = validateOfferField(key, form[key]);
    if (err) errors[key] = err;
  }
  return errors;
}
