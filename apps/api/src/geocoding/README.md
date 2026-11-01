# geocoding — city names to coordinates (Nominatim, cached)

Turns a place such as `Poznań, PL` into latitude/longitude through the public
OpenStreetMap Nominatim service, with a database cache and the 1 request per
second limit that Nominatim's usage policy requires. A background task fills
in coordinates of new offers so that the LTL search can work from stored
coordinates.

## Files

| File | What it does |
|---|---|
| `geocoding.service.ts` | `GeocodingService`: `lookup` (found / not found / error), `geocode` (coordinates or `null`), `normalize` (the cache key). Cache in `geocode_cache`, one shared queue to Nominatim. |
| `offer-geocoding.task.ts` | `OfferGeocodingTask`: every 5 minutes (`@Cron('*/5 * * * *')`) fills missing pickup/delivery coordinates of `NEW` offers. |
| `geocoding.module.ts` | Provides both; exports `GeocodingService` (used by `ltl-matching`). |

## Endpoints

None. The module has no controller. `GeocodingService` is called by
`ltl-matching` to geocode the route ends of a search (`routeFrom`, `routeTo`).

## How it works

**One lookup** (`GeocodingService.lookup`):

1. The query is normalized: trimmed, lower case, runs of whitespace → one
   space (`" Poznań,  PL"` and `"poznań, pl"` are the same key). An empty
   query is `not_found` at once, without cache or network.
2. **Cache** (`geocode_cache`, unique on the normalized query):
   - a hit with coordinates is returned, however old it is;
   - a remembered miss younger than `NOT_FOUND_TTL_DAYS` (7) is returned as
     `not_found`; an older one is asked again.
   A coordinate `0` is a coordinate, not a miss.
3. **Nominatim** (`https://nominatim.openstreetmap.org/search?q=…&format=json&limit=1`),
   through one queue per process: requests run one after another, at least
   `MIN_INTERVAL_MS` (1000 ms) apart. A failed request does not break the
   queue.
4. Result:
   - first result with readable coordinates → `found`, cached;
   - empty answer → `not_found`, cached as a miss (`found = false`);
   - network failure, any non-2xx status (e.g. 429, 503) or unreadable
     coordinates → `error`, **not cached**, so a short outage does not mark
     addresses as unknown for a week.

`geocode(query)` returns the coordinates or `null` for callers that do not
need the reason.

**User-Agent**: `AiSpedytor/1.0 (<NOMINATIM_CONTACT_EMAIL>)`. Without
`NOMINATIM_CONTACT_EMAIL` it is `AiSpedytor/1.0` and the service logs a
warning at start-up — the Nominatim policy asks for a contact.

**Background task** (`OfferGeocodingTask.run`, every 5 minutes):

1. If the previous run is still going, the new one is skipped (returns `null`).
2. Takes at most `BATCH_SIZE` (20) offers, newest first, with status `NEW`,
   a missing pickup or delivery coordinate, and `coordsCheckedAt` empty or
   older than 7 days — so addresses Nominatim does not know cannot take up
   every batch.
3. Looks up only the missing end(s), as `"<city>, <country>"` (or the city
   alone when there is no country).
4. Saves what was found and sets `coordsCheckedAt` — also when nothing was
   found.
5. On the first `error` the run stops: that offer is not marked as checked
   and the rest wait for the next run. Returns
   `{ checked, filled, aborted }`.

Offers without coordinates appear in the LTL search under `awaitingLocation`
(see `src/ltl-matching/README.md`).

## Message codes

None. The module returns statuses (`found`, `not_found`, `error`), not
message codes; `ltl-matching` turns a failed route-end lookup into
`ROUTE_GEOCODING_FAILED`.

## Configuration

| Variable | Meaning |
|---|---|
| `NOMINATIM_CONTACT_EMAIL` | Contact e-mail sent in the User-Agent. Empty → requests go without a contact (warning in the log). |

## Tests

```bash
cd apps/api
npx jest src/geocoding test/unit/seed-demo-ltl test/unit/ltl-detour
```

| Test | Covers |
|---|---|
| `src/geocoding/geocoding.service.spec.ts` | Cache hits and misses, the miss TTL, errors not cached, coordinate 0, key normalization, User-Agent, 1 request/s queue |
| `src/geocoding/offer-geocoding.task.spec.ts` | Filling both ends, misses marked as checked, only the missing end asked, stop on error, offer selection, overlapping runs |
| `test/unit/seed-demo-ltl.spec.ts` | The demo seed's `geocode_cache` keys match `GeocodingService.normalize` |
| `test/unit/ltl-detour.spec.ts` | LTL route ends are geocoded through `GeocodingService` |
| `test/integration/demo-ltl.int-spec.ts` | The demo scenario on a real PostgreSQL, route ends from the seeded cache (run by `tools/demo-test.sh`) |

No test calls the real Nominatim (`fetch` is mocked).

## Known limits

See also [docs/known-issues.md](../../../../docs/known-issues.md).

- The route planner has its own geocoder next to this module (two caches).
- The 1 request/s queue and the "one run at a time" guard live in process
  memory: two API instances would each send up to 1 request/s and could both
  run the background task.
- Cached hits never expire.
- An LTL search whose route ends are not cached waits in the same queue as
  the background task, so it can wait behind a running batch (at most about
  40 s).
- Only the first Nominatim result is used; the query is the city name and
  country code, nothing more precise.
- When a run stops on an error, coordinates already found for the pickup end
  of that offer are not saved in the offer (they are in the cache, so the next
  run gets them without a network call).
