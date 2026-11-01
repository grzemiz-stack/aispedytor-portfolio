/**
 * The new-offer form: field rules and the request body.
 *
 * The body has no computed fields: the API computes the rate per km from the
 * price and the distance, and the cost, profit and margin are not request
 * fields (an old client → 400). The screen still shows a preview from the
 * numbers typed in — it is not saved. The pickup date is required and checked.
 */

export interface VRule { min?: number; max?: number; minLen?: number; maxLen?: number; exactLen?: number; required?: boolean; date?: boolean; msg?: string }

export const OFFER_RULES: Record<string, VRule> = {
  pickupCity:      { minLen: 2, maxLen: 100, required: true, msg: 'Miasto załadunku: 2-100 znaków' },
  pickupCountry:   { exactLen: 2, required: true, msg: 'Kraj załadunku: kod ISO (2 znaki, np. PL)' },
  pickupDate:      { required: true, date: true, msg: 'Data załadunku: wymagana, poprawna data' },
  deliveryCity:    { minLen: 2, maxLen: 100, required: true, msg: 'Miasto rozładunku: 2-100 znaków' },
  deliveryCountry: { exactLen: 2, required: true, msg: 'Kraj rozładunku: kod ISO (2 znaki, np. DE)' },
  price:           { min: 1, max: 500000, msg: 'Cena musi być między 1 a 500 000' },
  distanceKm:      { min: 1, max: 10000, msg: 'Dystans musi być między 1 a 10 000 km' },
  weightKg:        { min: 0.1, max: 44000, msg: 'Waga musi być między 0.1 a 44 000 kg' },
  fuelCostEstimate:{ min: 0, max: 100000, msg: 'Koszt paliwa max. 100 000' },
  tollCostEstimate:{ min: 0, max: 50000, msg: 'Opłaty drogowe max. 50 000' },
  palletCount:     { min: 0, max: 40, msg: 'Liczba palet max. 40' },
  paymentTermDays: { min: 0, max: 180, msg: 'Termin płatności max. 180 dni' },
};

/** YYYY-MM-DD from the date field and a real day (not 2030-02-31). */
function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function validateOfferField(key: string, value: string): string | null {
  const r = OFFER_RULES[key];
  if (!r) return null;
  if (r.required && !value.trim()) return r.msg || 'Pole wymagane';
  if (!value.trim()) return null; // optional empty is ok
  if (r.date && !isRealDate(value)) return r.msg || 'Nieprawidłowa data';
  if (r.exactLen && value.length !== r.exactLen) return r.msg || `Wymagane ${r.exactLen} znaków`;
  if (r.minLen && value.length < r.minLen) return r.msg || `Min. ${r.minLen} znaków`;
  if (r.maxLen && value.length > r.maxLen) return r.msg || `Max. ${r.maxLen} znaków`;
  const n = parseFloat(value);
  if (r.min !== undefined && !isNaN(n) && n < r.min) return r.msg || `Min. ${r.min}`;
  if (r.max !== undefined && !isNaN(n) && n > r.max) return r.msg || `Max. ${r.max}`;
  return null;
}

/** Errors of every field with a rule — an empty map = can be sent. */
export function offerFormErrors(form: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const key of Object.keys(OFFER_RULES)) {
    const err = validateOfferField(key, form[key] ?? '');
    if (err) errors[key] = err;
  }
  return errors;
}

export function offerPayload(form: Record<string, string>, bools: { palletExchange: boolean; isAdr: boolean; isFrigo: boolean }) {
  return {
    pickupCity: form.pickupCity,
    pickupCountry: form.pickupCountry,
    pickupPostal: form.pickupPostal || undefined,
    pickupDate: form.pickupDate,
    deliveryCity: form.deliveryCity,
    deliveryCountry: form.deliveryCountry,
    deliveryPostal: form.deliveryPostal || undefined,
    deliveryDate: form.deliveryDate || undefined,
    cargoType: form.cargoType || undefined,
    weightKg: form.weightKg ? parseFloat(form.weightKg) : undefined,
    volumeM3: form.volumeM3 ? parseFloat(form.volumeM3) : undefined,
    price: form.price ? parseFloat(form.price) : undefined,
    currency: form.currency,
    distanceKm: form.distanceKm ? parseFloat(form.distanceKm) : undefined,
    tollCostEstimate: form.tollCostEstimate ? parseFloat(form.tollCostEstimate) : undefined,
    notes: form.notes || undefined,
    clientName: form.clientName || undefined,
    contactEmail: form.contactEmail || undefined,
    contactPhone: form.contactPhone || undefined,
    penaltyClauses: form.penaltyClauses || undefined,
    loadingTimeWindow: form.loadingTimeWindow ? parseInt(form.loadingTimeWindow) : undefined,
    unloadingTimeWindow: form.unloadingTimeWindow ? parseInt(form.unloadingTimeWindow) : undefined,
    palletExchange: bools.palletExchange,
    palletExchangeType: form.palletExchangeType || undefined,
    palletCount: form.palletCount ? parseInt(form.palletCount) : undefined,
    isAdr: bools.isAdr,
    adrClass: form.adrClass || undefined,
    isFrigo: bools.isFrigo,
    temperatureMin: form.temperatureMin ? parseFloat(form.temperatureMin) : undefined,
    temperatureMax: form.temperatureMax ? parseFloat(form.temperatureMax) : undefined,
    requiredInsuranceMin: form.requiredInsuranceMin ? parseFloat(form.requiredInsuranceMin) : undefined,
    paymentTermDays: form.paymentTermDays ? parseInt(form.paymentTermDays) : undefined,
    specialRequirements: form.specialRequirements || undefined,
    // The contractor chosen from the company list (decisions §3b): none — the field is left out.
    contractorId: form.contractorId || undefined,
  };
}

/**
 * The body of a new offer's margin preview (`POST /offers/economics-preview`)
 * — the same fields and conversions as saving, so preview = save. Without a
 * price there is nothing to preview.
 */
export function economicsPreviewBody(form: Record<string, string>) {
  if (!form.price) return null;
  const saved = offerPayload(form, { palletExchange: false, isAdr: false, isFrigo: false });
  return { price: saved.price, currency: saved.currency, distanceKm: saved.distanceKm, tollCostEstimate: saved.tollCostEstimate };
}
