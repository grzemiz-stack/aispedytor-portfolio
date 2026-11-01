# health — liveness and dependency status

Two checks: a public "alive" answer for the hosting platform, and a dependency
status for logged-in users.

## Files

| File | What it does |
|---|---|
| `health.controller.ts` | `GET /api/health/integrations`, behind login (`JwtAuthGuard`). |
| `health.module.ts` | Registers the controller. |

The public `GET /api/health` is not in this module: it is registered directly
on the HTTP adapter in `src/main.ts`, before Nest routing.

The web app reads `/health/integrations` on the settings page
(`apps/web/src/app/(dashboard)/settings/page.tsx`).

## Endpoints

| Route | Access | Returns |
|---|---|---|
| `GET /api/health` | public | `{ status: 'ok' }` — only "the process is alive"; checks nothing else |
| `GET /api/health/integrations` | login (`401` without) | `database`, `transEu`, `uptime`, `version`, `cache`, `queue` |

## How `/api/health/integrations` works

1. **Database**: a real `SELECT 1`; `ok`, or `error` if it fails.
2. **Trans.eu** for the caller's company, from the database:
   - `not_configured` — `TRANS_EU_CLIENT_ID` is not set;
   - `not_connected` — no stored connection for this company, or a status
     other than `ACTIVE` / `EXPIRED`;
   - `connected` — connection `ACTIVE`;
   - `expired` — connection `EXPIRED`.
   No network call is made; the token itself is not tested.
3. **uptime** in seconds since the module was loaded.
4. **version** from `npm_package_version` (set when started through npm),
   otherwise `"unknown"`.
5. **cache** and **queue**: statistics of the in-memory cache
   (`MemoryCacheService.getStats()`) and task queue (`TaskQueueService.getStats()`).
6. The whole answer is cached for 30 seconds, separately for each company
   (key `health:integrations:<companyId>`), so one company's Trans.eu status is
   never served to another.

## Message codes

None — this module emits no `msg()` codes.

## Tests

```bash
cd apps/api
npx jest test/unit/health-honest
```

| Test | Covers |
|---|---|
| `test/unit/health-honest.spec.ts` | Behind `JwtAuthGuard`; the exact set of fields and no network call; every Trans.eu status; per-company cache; database down → `error`; version `"unknown"` without npm |

## Known limits

See also [docs/decisions.md](../../../../docs/decisions.md) (`/health` public only as "alive").

- Results can be up to 30 seconds old (the cache), including `database`.
- `cache` and `queue` statistics are for the whole application, not the
  caller's company; any logged-in user of any company sees them.
- `transEu: connected` means a stored `ACTIVE` connection, not a working token.
- The public `/api/health` does not check the database.
