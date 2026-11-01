# auth — login, tokens, company registration

Logs users in with e-mail and password, issues access tokens (JWT) and
refresh tokens, rotates refresh tokens, logs out, registers a new company
with its first ADMIN user, and changes a user's own password. Provides the
`JwtAuthGuard` that every other module puts in front of its routes.

## Files

| File | What it does |
|---|---|
| `auth.controller.ts` | HTTP routes under `/api/auth`. All of them are rate-limited to 5 requests per minute per route and client IP (`@Throttle`; the app-wide default is 100). |
| `auth.service.ts` | Login, refresh, logout, registration, password change, token issuing. |
| `auth.module.ts` | Wires `JwtModule` with `JWT_SECRET` (required, `common/config/secrets.ts`) and `JWT_EXPIRES_IN` (default `15m`). |
| `strategies/jwt.strategy.ts` | Reads the `Authorization: Bearer` token, checks signature and expiry, then loads the user: an inactive or deleted user gets 401 even with a valid token. Puts `{ userId, companyId, role, email }` on `req.user`. |
| `guards/jwt-auth.guard.ts` | `JwtAuthGuard` — the Passport `jwt` guard used by the other modules. |
| `dto/` | Request bodies (`LoginDto`, `RefreshDto`, `RegisterCompanyDto`), validated by the global `ValidationPipe` (unknown fields are rejected). |

## Endpoints

| Route | Body | Returns |
|---|---|---|
| `POST /api/auth/login` | `LoginDto`: `email`, `password` (at least 6 characters) | `accessToken`, `refreshToken`, `user` (`id`, `companyId`, `email`, `firstName`, `lastName`, `role`) |
| `POST /api/auth/refresh` | `RefreshDto`: `refreshToken` | a new `accessToken` + `refreshToken` in the same family; the used refresh token is marked used; using it again → 403 and the whole family deleted |
| `POST /api/auth/logout` | — (Bearer token) | `{ message }`; deletes all refresh tokens of the user |
| `POST /api/auth/register` | `RegisterCompanyDto`: company (`companyName`, `taxId`, optional `regon`, `street`, `city`, `postalCode`, `country`, `billingEmail`, `phone`, `website`) and its first user (`email`, `firstName`, `lastName` — at least 2 characters, `password` — 8–100 characters) | `accessToken`, `refreshToken`, `userId`, `companyId` |

`POST /api/auth/register` is off unless `NODE_ENV` is `development`/`test` or
`REGISTRATION_ENABLED=true` — otherwise 403 `REGISTRATION_DISABLED` from
`RegistrationEnabledGuard` (`common/config/registration.ts`). The first company
on a server: `npm run company:create` (`src/cli/create-company.ts`, tested in
`test/unit/create-company-cli.spec.ts` and on PostgreSQL in `tools/demo-test.sh`).

`PATCH /api/users/me/password` (route in `users/users.controller.ts`, logic in
`AuthService.changePassword`) changes the logged-in user's own password.

Errors: login `401` for an unknown e-mail, a wrong password or an inactive
account (one message for all three); refresh `403` for an unknown, expired or
reused refresh token (Swagger says so — `401` is listed as not returned);
register `409 REGISTER_EMAIL_TAKEN`, `400 REGISTER_TAX_ID_INVALID`, `403
REGISTRATION_DISABLED`; `400` for validation errors; `429` when the rate limit
is hit.

## How it works

- **E-mail lookup.** E-mails are stored encrypted (`emailEncrypted`) and found
  by a keyed hash of the lower-cased address (`emailHash`,
  `EncryptionService.hash`, HMAC-SHA256 with `ENCRYPTION_KEY`). First and last
  names are stored encrypted too.
- **Passwords** are bcrypt hashes (cost 12).
- **Access token**: JWT signed with `JWT_SECRET`, payload `{ sub, companyId,
  role, email }`, lifetime `JWT_EXPIRES_IN` (default 15 minutes).
- **Refresh token**: 32 random bytes (base64url); `refresh_tokens` keeps only
  its SHA-256 (`token_hash`, `hashRefreshToken`) and a 7-day expiry, and
  refresh looks the token up by that hash. Every login (also registration and a password change)
  starts a family (`family_id`); a refresh marks the used token (`used_at`,
  conditionally — of two concurrent refreshes exactly one wins) and issues the
  next pair in the same family. Using an already used token (also the loser of
  such a race) deletes the whole family, answers 403 and logs a warning with
  the user id; other families of the user (other devices) stay. A deactivated
  user gets 403 and the token is deleted; an expired token is deleted when it
  is presented. The web app stores the new pair
  (`apps/web/src/lib/api-client.ts`).
- **Logout** deletes every refresh token of the user — all sessions, not just
  this one. Access tokens already issued stay valid until they expire.
- **Registration** checks that the e-mail is free (`409
  REGISTER_EMAIL_TAKEN`) and, for a company in `PL`, the Polish tax ID — 10
  digits with the check digit, separators removed (`400
  REGISTER_TAX_ID_INVALID`); a tax ID of another country is stored as given.
  Then it creates the company (`country` default `PL`, `costCurrency` from
  the country, `subscriptionPlan: 'FREE'`, `maxDispatchers: 10`,
  `billingEmail` default the user's e-mail) and an active `ADMIN` user **in
  one transaction** — a failure on the user leaves no company; an e-mail
  taken by a concurrent registration (unique index) is also `409`. The
  password hash is computed before the transaction, the tokens after it
  commits. No plan, usage limit or trial is set up.
- **Password change** (`changePassword`): the user must be active and in the
  caller's company (else 404); checks the current password, refuses an
  unchanged one, saves the new hash, deletes all refresh tokens and returns a
  new pair for the current session (docs/decisions.md §8).

## Message codes

Returned as `{ statusCode, code, message: code }` through small helpers in
`auth.service.ts`:

- `REGISTER_EMAIL_TAKEN` — 409; `REGISTER_TAX_ID_INVALID` — 400 (registration;
  `company:create` prints the same codes).
- `PASSWORD_CURRENT_INVALID` — 400, the current password is wrong;
  `PASSWORD_UNCHANGED` — 400, the new password equals the current one.
- `REGISTRATION_DISABLED` — 403, from `RegistrationEnabledGuard`
  (`common/config/registration.ts`).

The login and refresh errors are Polish text, not codes.

## Tests

```bash
cd apps/api
npx jest test/unit/auth-login-jwt test/unit/register-company test/unit/registration-enabled test/unit/change-password test/unit/refresh- test/unit/app-start-secrets
```

| Test | Covers |
|---|---|
| `test/unit/auth-login-jwt.spec.ts` | Login: password, `isActive`, one message for every failure; the JWT strategy: expired or forged token, company and role from the database, not the token; lifetimes 15 min / 7 days; logout deletes only the caller's tokens |
| `test/unit/register-company.spec.ts` | Registration: taken e-mail → 409 (also a concurrent one), Polish tax ID with the check digit → 400 only for `PL`, company and user in one transaction (a failure on the user leaves nothing) |
| `test/unit/registration-enabled.spec.ts` | `POST /auth/register` off outside development/test unless `REGISTRATION_ENABLED=true` → 403 `REGISTRATION_DISABLED` |
| `test/unit/change-password.spec.ts` | Password change: hash saved, sessions ended, new tokens; wrong / unchanged password; inactive user or another company; DTO rules; the route under `/users` behind `JwtAuthGuard` |
| `test/unit/refresh-inactive-user.spec.ts` | Refresh for a deactivated user: 403, the token deleted, no new pair; an active user gets a new pair in the same family, the old token marked used |
| `test/unit/refresh-token-hash.spec.ts` | Only the SHA-256 is stored; lookup by the hash; the hash itself is not a token (403) |
| `test/integration/refresh-token-hash.int-spec.ts` | On PostgreSQL: the migration hashes an existing plain token exactly as the API looks it up — that session keeps working |
| `test/unit/refresh-token-family.spec.ts` | Families: one per login, kept on refresh; reuse → 403, the family deleted, a warning; other logins untouched; two concurrent refreshes → one pair, the other 403 |
| `test/integration/refresh-family.int-spec.ts` | The same on PostgreSQL in `tools/demo-test.sh`, including the race |
| `test/unit/app-start-secrets.spec.ts` | The API does not start without a valid `JWT_SECRET` / `ENCRYPTION_KEY` |

The web side of refresh-token rotation (and the cross-tab lock) is tested in
`apps/web/src/lib/api-client.test.ts` and `api-client-refresh.test.ts`.

## Known limits

See also [docs/known-issues.md](../../../../docs/known-issues.md) ("Security",
"API correctness").

- The web app has no registration screen (the first company:
  `company:create`). Only a Polish tax ID is checked; other countries' IDs
  are stored as given.
- Sentry gets only the field names of a failed request's body and query,
  never their values, no headers (the Bearer token) and no cookies
  (`common/sentry/sentry.setup.ts`, checked on the real SDK).
- Two browser tabs refreshing with one refresh token at the same moment are
  serialised by `navigator.locks` — which browsers give only to a secure
  context (HTTPS or `localhost`). Over plain `http` elsewhere the second
  refresh counts as reuse and both tabs are logged out
  ([docs/DEPLOYMENT.md](../../../../docs/DEPLOYMENT.md), "Hosting, proxy and HTTPS").
- The web app keeps both tokens in
  `localStorage`.
- `RegisterCompanyDto` has no `@ApiProperty`, so Swagger shows no body schema
  for `POST /api/auth/register`.
- Validation and exception messages are Polish text, not codes.
