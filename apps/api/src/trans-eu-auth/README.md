# trans-eu-auth — linking a company's Trans.eu account (OAuth 2.0)

Links a company to its Trans.eu account with the OAuth authorization-code
flow, stores the access and refresh tokens encrypted, and hands a valid access
token to other modules (`exchange-publisher` uses `getValidAccessToken`).

## Files

| File | What it does |
|---|---|
| `trans-eu-auth.service.ts` | Login URL, code-for-token exchange, token refresh, encrypted storage in the `ExchangeConnection` table, status, disconnect; encrypts legacy plain-text tokens on module start. |
| `oauth-state.ts` | Signs and verifies the OAuth `state` (HMAC-SHA256, nonce, 10-minute expiry). Pure functions. |
| `trans-eu-auth.controller.ts` | HTTP routes under `/api/integrations/transeu`. |
| `trans-eu-auth.module.ts` | Nest module; exports `TransEuAuthService`. |

## Endpoints

| Route | Access | Returns |
|---|---|---|
| `GET /api/integrations/transeu/connect` | login, ADMIN only (`JwtAuthGuard`, `RolesGuard`) | Sets the browser-binding cookie `transeu_oauth`, then `302` to the Trans.eu `/oauth2/authorize` page for the caller's company; `400` when `TRANS_EU_CLIENT_ID` is not set; `403` for a dispatcher |
| `GET /api/integrations/transeu/callback` | public (called by Trans.eu) | `302` to `FRONTEND_URL/settings?transeu=connected`, or `?transeu=error&reason=…` when Trans.eu sends `error`; `400` for an invalid `state` (also `BROWSER_MISMATCH`: no or another binding cookie) or missing client credentials; `401` when the token exchange fails |
| `GET /api/integrations/transeu/status` | login | `{ connected: false, exchange }` when never linked; otherwise `connected` (status is `ACTIVE`), `exchange`, `status`, `expiresAt`, `scope` |
| `DELETE /api/integrations/transeu/disconnect` | login, ADMIN only | Deletes the company's Trans.eu row; `{ success: true, message }`; `403` for a dispatcher |

The callback URL sent to Trans.eu is `API_BASE_URL` + `/api/integrations/transeu/callback`.

## How it works

1. **Connect.** `startAuthorization` builds a `state` = base64url payload
   `{ companyId, nonce, exp }` + `.` + HMAC-SHA256 signature. The HMAC key is
   derived from `JWT_SECRET` for this purpose only. It also draws a random
   32-byte browser binding: the controller sends it to the browser in the
   cookie `transeu_oauth` (HttpOnly, SameSite=Lax, path = the callback, 10
   minutes, Secure when `API_BASE_URL` is https); the server keeps only its
   SHA-256 next to the nonce, in process memory until `exp` (10 minutes). The
   binding is neither in the URL nor in `state`. Requested scope:
   `offers.loads.manage offers.vehicles.manage`.
2. **Callback.** `consumeState` checks the signature, the expiry, that the
   nonce was issued here and not used yet (it is deleted on use), and that the
   request carries the binding cookie of the browser that started `connect`
   (else `BROWSER_MISMATCH` — a login link forwarded to someone else cannot
   link their Trans.eu account to the sender's company; the nonce is used up
   anyway). The cookie is cleared on every callback outcome. Any failure
   is a `400` before anything is sent to Trans.eu or saved. Then the code is
   exchanged at `/oauth2/token`, and the tokens are upserted into
   the `ExchangeConnection` table (one row per company and exchange), status `ACTIVE`.
   Without `expires_in` the access token is taken to live 3600 s.
3. **Use.** `getValidAccessToken` returns the stored access token while it has
   more than 60 s left; otherwise it refreshes it with the refresh token. If
   Trans.eu answers the refresh with any non-2xx status (also a 5xx), the
   row is set to `EXPIRED` and a `401` is thrown — the account has to be
   connected again. If the call fails before an answer (network error,
   timeout), the error goes up as a `500` and the row stays `ACTIVE`.
4. **Encryption.** Both tokens are encrypted with `EncryptionService`
   (AES-256-GCM, `ENCRYPTION_KEY`). On module start every row whose tokens are
   not in ciphertext format is encrypted in place (idempotent; a half-migrated
   row is completed without double encryption). Until then a plain-text row is
   still readable.
5. **Error from Trans.eu.** The `error` query parameter is URL-encoded into the
   redirect, never pasted in raw.

Configuration (names only): `TRANS_EU_CLIENT_ID`, `TRANS_EU_CLIENT_SECRET`,
`API_BASE_URL`, `FRONTEND_URL` (default `http://localhost:3000`),
`JWT_SECRET`, `ENCRYPTION_KEY`. See `docs/DEPLOYMENT.md`.

## Message codes

None. Errors are Nest exceptions with Polish text, not `{ code, params }`.

## Tests

```bash
cd apps/api
npx jest test/unit/transeu-
```

| Test | Covers |
|---|---|
| `test/unit/transeu-oauth-state.spec.ts` | Signed `state`: forged, tampered, wrong secret, expiry boundary; single use of the nonce; a forged state stops the callback before any call or write; the browser binding: a forwarded link in another browser or without the cookie → `BROWSER_MISMATCH`, nonce used up, nothing sent; the cookie's attributes, reading and clearing; the `error` parameter is URL-encoded in the redirect |
| `test/unit/app-scope.spec.ts` | A dispatcher on `connect` / `disconnect` → 403 |
| `test/unit/transeu-token-encryption.spec.ts` | Tokens encrypted when saved and on refresh; migration of plain-text rows (idempotent, half-migrated rows, readable before migration) |

## Known limits

See also [docs/known-issues.md](../../../../docs/known-issues.md) ("Integrations").

- No UI: the web app has no "Connect to Trans.eu" button and does not read the
  `transeu=` parameter on `/settings`.
- The request and response formats were not verified against the live
  Trans.eu API.
- Issued nonces live in process memory: works with one API instance only; a
  restart between connect and callback makes the callback fail with `400`.
- `connect` is a `GET` behind a Bearer token that answers with a redirect;
  a plain browser link cannot carry the token, and with the web app and the
  API on different domains a `fetch` cannot set the binding cookie. For a
  screen: `POST connect-ticket` with the Bearer token → a one-time URL → the
  browser navigates to `GET /connect?ticket=…`, which sets the cookie and
  redirects.
- `disconnect` only deletes the local row; the token is not revoked at
  Trans.eu.
- A Trans.eu outage (5xx on refresh) marks the connection `EXPIRED` — it
  has to be connected again; a network error gives a `500` and leaves it
  `ACTIVE`.
- Exception messages are Polish text, not codes.
