/**
 * 409 EMAIL_OFFER_EXISTS from POST /email-agent/:id/create-offer → the id of
 * the existing offer (for the link). Any other error or no id → null.
 */
export function existingOfferFromError(data: unknown): string | null {
  const d = data as { code?: unknown; params?: { offerId?: unknown } } | null;
  if (d?.code !== 'EMAIL_OFFER_EXISTS') return null;
  return typeof d.params?.offerId === 'string' && d.params.offerId ? d.params.offerId : null;
}

/**
 * An e-mail price with the currency from the API (`extractedCurrency`):
 * "1 200 PLN". No currency (null) — the amount with "waluta nieznana"
 * (currency unknown), never a default "EUR".
 */
export function emailPriceLabel(price: number, currency: string | null | undefined): string {
  const amount = price.toLocaleString('pl-PL');
  return currency ? `${amount} ${currency}` : `${amount} (waluta nieznana)`;
}
