/**
 * Trans.eu OAuth `state` — signed, with a single-use nonce and an expiry.
 *
 * The OAuth callback does not require login and takes the company from
 * `state`. An unsigned `state` (such as plain base64 of {companyId, ts}) could
 * be built by anyone who knows another company's id, linking THEIR Trans.eu
 * account to that company (CSRF / connection takeover). Therefore:
 *  - payload {companyId, nonce, exp} + HMAC-SHA256 — changing companyId or
 *    exp invalidates the signature;
 *  - exp: 10 min after the state is issued;
 *  - nonce: single use — the registry in the service consumes it in the
 *    callback.
 * The HMAC key is derived from JWT_SECRET (required, see
 * common/config/secrets.ts) for a separate purpose, so a `state` signature is
 * never a valid JWT signature and vice versa.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const STATE_TTL_MS = 10 * 60 * 1000;

export interface StatePayload {
  companyId: string;
  nonce: string;
  exp: number;
}

export type StateCheck =
  | { ok: true; payload: StatePayload }
  | { ok: false; reason: 'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED' };

const stateKey = (secret: string) => createHmac('sha256', secret).update('transeu-oauth-state').digest();
const sign = (body: string, secret: string) => createHmac('sha256', stateKey(secret)).update(body).digest('base64url');

export function signState(companyId: string, now: number, secret: string, nonce = randomBytes(16).toString('hex')): string {
  const body = Buffer.from(JSON.stringify({ companyId, nonce, exp: now + STATE_TTL_MS } satisfies StatePayload)).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

export function verifyState(state: unknown, now: number, secret: string): StateCheck {
  if (typeof state !== 'string') return { ok: false, reason: 'MALFORMED' };
  const [body, mac, extra] = state.split('.');
  if (!body || !mac || extra !== undefined) return { ok: false, reason: 'MALFORMED' };

  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'BAD_SIGNATURE' };

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'MALFORMED' };
  }
  if (typeof payload?.companyId !== 'string' || typeof payload.nonce !== 'string' || typeof payload.exp !== 'number') {
    return { ok: false, reason: 'MALFORMED' };
  }
  if (now > payload.exp) return { ok: false, reason: 'EXPIRED' };
  return { ok: true, payload };
}
