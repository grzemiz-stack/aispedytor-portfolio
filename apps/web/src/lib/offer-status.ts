/**
 * Changing an offer's status from a screen.
 *
 * "Przypisz do mnie" (assign to me) assigns the person
 * (`PATCH /offers/:id/assign/:userId` — the API saves the person and the
 * ASSIGNED status), not just the status: the API refuses `/status` with
 * ASSIGNED (OFFER_ASSIGN_VIA_ASSIGN). No logged-in user, nobody to assign → null.
 */
export function offerStatusRequest(
  offerId: string,
  status: string,
  userId: string | null | undefined,
): { url: string; body?: { status: string } } | null {
  if (status === 'ASSIGNED') return userId ? { url: `/offers/${offerId}/assign/${userId}` } : null;
  return { url: `/offers/${offerId}/status`, body: { status } };
}
