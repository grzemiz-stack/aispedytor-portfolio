# users — the company's user accounts

Lists, shows, adds and deactivates the users of a company, and lets any
logged-in user change their own password. E-mail, names and phone are stored
encrypted and returned decrypted.

## Files

| File | What it does |
|---|---|
| `users.controller.ts` | HTTP routes, all behind login (`JwtAuthGuard`) and `RolesGuard`, always scoped to the caller's company. |
| `users.service.ts` | List, read, create, deactivate; encrypts on write and decrypts on read (`EncryptionService`). |
| `dto/create-user.dto.ts` | `CreateUserDto` and the roles an ADMIN can assign (`USER_ROLES`). |
| `dto/change-password.dto.ts` | `ChangePasswordDto`. |
| `users.module.ts` | Imports `AuthModule` (the password change lives in `AuthService`); exports `UsersService`. |

## Endpoints

| Route | Who | Body | Returns |
|---|---|---|---|
| `GET /api/users` | ADMIN | — | Active users of the company, newest first |
| `GET /api/users/me` | any logged-in user | — | The caller's own user object |
| `PATCH /api/users/me/password` | any logged-in user | `ChangePasswordDto`: `currentPassword`, `newPassword` (8–100 characters) | `{ accessToken, refreshToken }` |
| `GET /api/users/:id` | ADMIN | — | One user of the company (also a deactivated one) |
| `POST /api/users` | ADMIN | `CreateUserDto`: `email`, `password` (8–100), `firstName`, `lastName` (2–100), optional `phone` (≤ 30), optional `role` (`ADMIN` or `DISPATCHER`, default `DISPATCHER`) | The created user |
| `DELETE /api/users/:id` | ADMIN | — | The deactivated user (decrypted, no hashes) |

The user object has `id`, `companyId`, `email`, `firstName`, `lastName`,
`phone`, `role`, `isActive`, `lastLoginAt`, `createdAt` — no password hash.

Errors: `403` when a route needs ADMIN and the caller is not one; `404` when
the id is not a user of the caller's company; `409` when the e-mail is
already used by any account (in any company); `400` on a body that fails
validation, including fields that are not in the DTO.

## How it works

- **Company scope.** Every query filters by the caller's `companyId` from the
  token; an id from another company is a `404`.
- **Create.** The e-mail is checked for uniqueness through its hash
  (`emailHash`, unique across all companies). The password is hashed with
  bcrypt (cost 12). E-mail, names and phone are encrypted.
- **Deactivate.** `DELETE` sets `isActive` to `false` and, in the same
  transaction, deletes all the user's refresh tokens; the user record stays.
  The last active ADMIN of the company cannot be deactivated (409
  `LAST_ACTIVE_ADMIN`); the transaction is Serializable, so two admins cannot
  deactivate each other at once (the loser gets 409 `CONCURRENT_CHANGE_RETRY`). A
  deactivated user no longer passes `JwtAuthGuard` (the JWT strategy loads
  only active users) and cannot log in. `GET /users` lists active users only.
- **Change password** (`AuthService.changePassword`). Checks the current
  password, rejects a new password equal to the current one, saves the new
  hash, deletes all of the user's refresh tokens and returns a new token pair
  for the current session. The user is always the caller from the token, never
  one from the body. Limited to 5 requests per minute.

## Message codes

- `LAST_ACTIVE_ADMIN` (409) — `DELETE` on the last active ADMIN of the
  company; nothing changes.
- `CONCURRENT_CHANGE_RETRY` (409) — the Serializable deactivation transaction
  lost to a concurrent change (Prisma P2034); retry the request.

`PATCH /users/me/password` also returns `PASSWORD_CURRENT_INVALID`
and `PASSWORD_UNCHANGED` (400), emitted by `auth/auth.service.ts`; the web app
turns them into text (`apps/web/src/lib/plan-messages.ts`).

## Tests

```bash
cd apps/api
npx jest test/unit/create-user-validation test/unit/change-password
```

| Test | Covers |
|---|---|
| `test/unit/create-user-validation.spec.ts` | `POST /users` body validation through the same `ValidationPipe` settings as `main.ts`: e-mail, password length, names, allowed roles, fields outside the DTO |
| `test/unit/users-deactivate.spec.ts` | Deactivation: decrypted response without hashes; refresh tokens deleted in the same Serializable transaction; another company's user → 404; the last active ADMIN → 409 `LAST_ACTIVE_ADMIN`; a serialization conflict → 409 `CONCURRENT_CHANGE_RETRY` |
| `test/unit/no-role-change.spec.ts` | `role` exists only in `CreateUserDto` — the API cannot change a role (so the last-ADMIN rule covers deactivation only) |
| `test/unit/change-password.spec.ts` | Password change: wrong or unchanged password, sessions ended, new tokens, inactive account or another company, DTO rules, the route and its guard |

## Known limits

See also [docs/known-issues.md](../../../../docs/known-issues.md) ("`users`",
"roles").

- No profile edit and no reactivation; `maxDispatchers` of the company is
  stored but not checked when a user is added.
- After a password change, access tokens already issued to other sessions stay
  valid until they expire (`JWT_EXPIRES_IN`, default 15 minutes); only refresh
  tokens are revoked.
- Only `PATCH /users/me/password` has a caller in the web app (settings
  screen); listing, adding and deactivating users have no screen.
- Exception and validation messages (`404`, `409`, `403`, DTO rules) are
  Polish text, not codes.
