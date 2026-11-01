import { messageText } from './plan-messages';

/**
 * The accept button for an offer from a blacklisted contractor.
 *
 * The same rule as the API (`PATCH /offers/:id/status`, ACCEPTED): only an
 * ADMIN may accept, and the acceptance goes to the API log. Not an ADMIN — the
 * button disabled with the sentence of OFFER_CONTRACTOR_BLACKLISTED; an
 * ADMIN — active, with a warning.
 */
export const BLACKLIST_ADMIN_WARNING =
  'Kontrahent na czarnej liście firmy — przyjmujesz jako administrator; przyjęcie zostanie zapisane w logu.';

export function acceptBlock(blacklisted: boolean, role: string | null | undefined): { disabled: boolean; note: string | null } {
  if (!blacklisted) return { disabled: false, note: null };
  if (role === 'ADMIN') return { disabled: false, note: BLACKLIST_ADMIN_WARNING };
  return { disabled: true, note: messageText({ code: 'OFFER_CONTRACTOR_BLACKLISTED' }) };
}
