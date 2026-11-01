# notifications — in-app notifications of the logged-in user

Lists a user's notifications and marks them as read. Notifications are
created elsewhere (`demands` when an offer matches a demand, `vehicles` when a
document is about to expire), by writing to the `notification` table directly.

## Files

| File | What it does |
|---|---|
| `notifications.controller.ts` | HTTP routes, all behind login (`JwtAuthGuard`), always for the caller (`req.user`). |
| `notifications.service.ts` | List (paginated), mark one / all as read, `create()`. |
| `notifications.module.ts` | Registers the service and controller; exports `NotificationsService`. |

## Endpoints

| Route | Query | Returns |
|---|---|---|
| `GET /api/notifications` | `page` (default 1), `limit` (1–100, default 20) | `{ data, meta }`: the caller's notifications in the caller's company, newest first; `meta` has `total`, `page`, `limit`, `totalPages`, `hasNext`, `hasPrev` |
| `PATCH /api/notifications/:id/read` | — | The notification with `isRead: true`; `404` when it does not exist or belongs to another user |
| `PATCH /api/notifications/read-all` | — | `{ count }`: how many unread notifications of the caller were marked |

## How it works

- **Own notifications only.** Marking one as read is a single
  `updateMany` with `{ id, userId }` in the condition, so another user's
  notification cannot be changed (no IDOR) and there is no gap between a
  check and the write. If nothing was updated the answer is `404`, the same
  for "does not exist" and "belongs to someone else"; the notification is then
  read back and returned.
- The list filters by `userId` and `companyId`; marking (one or all) filters by
  `userId` only.
- `create(companyId, userId, { type, title, message, offerId? })` stores one
  notification. `type` is the Prisma enum `NotificationType`.

## Message codes

None — this module emits no `msg()` codes. The `404` message is Polish text.

## Tests

```bash
cd apps/api
npx jest test/unit/notifications-own-only
```

| Test | Covers |
|---|---|
| `test/unit/notifications-own-only.spec.ts` | Marking someone else's / an unknown notification gives the same `404` and changes nothing; own notification is marked and returned; the write itself carries `userId` |

## Known limits

See also [docs/known-issues.md](../../../../docs/known-issues.md) ("notifications").

- The web app does not show notifications; nothing calls these endpoints.
- `NotificationsService.create()` has no caller: `demands` and `vehicles` write
  notifications straight through Prisma.
- `sortBy` and `sortOrder` from `PaginationDto` are accepted but ignored; the
  order is always newest first.
- The `404` message (`Powiadomienie nie znalezione`) is Polish text, not a code.
