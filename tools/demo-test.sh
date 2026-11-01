#!/usr/bin/env bash
#
# The demo script as a test: seed + LTL search on a real PostgreSQL.
#
# 1. PostgreSQL 16 in a container (random port, removed by trap EXIT).
# 2. migrate deploy, seed "today" → demo-ltl-today.int-spec.ts with the clock
#    = now: every seed offer has coordinates, and only the scenario lies on
#    the demo route (the rest of the seed is live too, but off that route).
# 3. Simulate an old database: MEGA without gross and curb weight, and offers
#    of every seed group (base, DEMO-, BULK-, LTL-) without coordinates.
# 4. Seed again with SEED_NOW = today + 30 days — it must refresh the demo
#    offers, complete the vehicle record and restore the coordinates.
# 5. test/integration/demo-ltl.int-spec.ts: a search with the screen's body,
#    clock +30 days, no network → the scenario's order, amounts and codes.
# 5a. test/integration/refresh-family.int-spec.ts: the refresh token family on
#    the database — rotation, reuse deletes the family, of two concurrent
#    refreshes one wins (403, not 500); refresh-token-hash.int-spec.ts: the
#    migration hashes a plain token as the API looks it up (nobody logged out).
# 5b. test/integration/import-dedup.int-spec.ts: the import on the database — a
#    re-import of the same externalIds doubles nothing, a bad row in `rejected`.
# 5c. test/integration/vehicle-adr-classes.int-spec.ts: a vehicle's ADR classes from
#    the form; `null` (cleared) → an empty list — the list column refuses null.
# 6. The first company by `company:create` (the built `dist/`,
#    NODE_ENV=production — as on a server): company and ADMIN in the database,
#    the e-mail encrypted, no password among the arguments, no refresh token
#    left; the same e-mail a second time → 409 and exit code 1.
# 7. offers:recompute-economics: an old margin on a new and an accepted offer →
#    --dry-run writes nothing, the run recomputes both with the same counts as
#    the dry run, a second run changes nothing.
# 8. test/integration/offer-expiry.int-spec.ts: the offer expiry task on the
#    database — dead NEW offers (loading day, expiresAt, age) → EXPIRED,
#    ASSIGNED/ACCEPTED unchanged, a second run changes nothing. Last, because
#    it also expires the dead offers of the seed.
# 9. test/integration/route-trust.int-spec.ts: saved fallback routes (a flat
#    500 km without a toll breakdown, 0 km) do not count towards an offer's
#    cost; the recompute says how many it skipped. Before the expiry test.
#
# Needs Docker. Part of the full check (tools/bramka.sh, via npm run test:demo).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/apps/api"

if ! docker info >/dev/null 2>&1; then
  echo "demo-test: Docker is not running — this test needs it." >&2
  exit 2
fi

NAME="aisp-demotest-$$"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

docker run -d --name "$NAME" -e POSTGRES_PASSWORD=demo -e POSTGRES_DB=demo -p 127.0.0.1::5432 postgres:16 >/dev/null
PORT="$(docker port "$NAME" 5432/tcp | head -1 | sed 's/.*://')"
for _ in $(seq 1 60); do
  docker exec "$NAME" pg_isready -U postgres -d demo -q && break
  sleep 1
done
sleep 1

# The seed runs only with an explicit NODE_ENV=development|test
# (prisma/seed-guard.ts), so every seed call here sets NODE_ENV=test — it does
# not rely on a local `.env` (CI has none).
# Random secrets for every run (never fixed in the repo): the seed encrypts
# data with the application key and does not start without it. The test
# database is throwaway — the key goes with it.
export ENCRYPTION_KEY="${ENCRYPTION_KEY:-$(openssl rand -hex 32)}"
export JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"
export DATABASE_URL="postgresql://postgres:demo@127.0.0.1:${PORT}/demo?schema=public"
TODAY="$(node -e 'console.log(new Date().toISOString())')"
PLUS30="$(node -e 'console.log(new Date(Date.now() + 30 * 864e5).toISOString())')"
JEST="npx jest --config test/integration/jest.config.js"

echo "== migrate deploy";              npx prisma migrate deploy
echo "== seed (today)";                NODE_ENV=test npx prisma db seed
echo "== test: demo today";            DEMO_NOW="$TODAY" $JEST test/integration/demo-ltl-today
echo "== test: fleet planning (database)"; $JEST test/integration/fleet-planning
echo "== test: refresh tokens (database)"; $JEST test/integration/refresh-family test/integration/refresh-token-hash
echo "== test: offer import (database)"; $JEST test/integration/import-dedup
echo "== test: vehicle ADR classes (database)"; $JEST test/integration/vehicle-adr-classes
echo "== old database: MEGA without gross/curb weight, seed offers without coordinates"
docker exec "$NAME" psql -U postgres -d demo -qc \
  "UPDATE vehicles SET gross_vehicle_weight_kg = NULL, curb_weight_kg = NULL WHERE id = 'seed-vehicle-mega2'"
docker exec "$NAME" psql -U postgres -d demo -qc \
  "UPDATE offers SET pickup_lat = NULL, pickup_lng = NULL, delivery_lat = NULL, delivery_lng = NULL
   WHERE external_id IN ('TE-001', 'DEMO-002', 'BULK-007', 'LTL-003')"
echo "== seed (SEED_NOW=${PLUS30})";  NODE_ENV=test SEED_NOW="$PLUS30" npx prisma db seed
echo "== test: demo +30 days";         DEMO_NOW="$PLUS30" $JEST test/integration/demo-ltl.int-spec
echo "== first company by script (company:create, NODE_ENV=production)"
[ -f dist/cli/create-company.js ] || npm run build >/dev/null
CC_ARGS=(--company-name "Pierwsza Firma" --tax-id 5260250274 --email admin@pierwsza.example.com --first-name Anna --last-name Nowak --cost-per-km 4,20)
OUT="$(printf '%s\n' 'Start-haslo-123' | NODE_ENV=production node dist/cli/create-company.js "${CC_ARGS[@]}")"
echo "$OUT"
case "$OUT" in *"Company created: companyId="*) ;; *) echo "company:create: unexpected output" >&2; exit 1 ;; esac
# With a rate (--cost-per-km) there is no line about a missing cost per km.
case "$OUT" in *"No cost per km set"*) echo "company:create: says no cost per km although --cost-per-km was given" >&2; exit 1 ;; esac
case "$OUT" in *Start-haslo-123*|*eyJ*) echo "company:create printed a secret" >&2; exit 1 ;; esac
CHECK="$(docker exec "$NAME" psql -U postgres -d demo -tAc \
  "SELECT c.name, c.cost_per_km, u.role, u.is_active, u.email_encrypted LIKE '%admin@%', (SELECT count(*) FROM refresh_tokens r WHERE r.user_id = u.id)
   FROM companies c JOIN users u ON u.company_id = c.id WHERE c.tax_id = '5260250274'")"
[ "$CHECK" = "Pierwsza Firma|4.20|ADMIN|t|f|0" ] || { echo "company:create: database check failed: $CHECK" >&2; exit 1; }
ERR="$(printf '%s\n' 'Start-haslo-123' | NODE_ENV=production node dist/cli/create-company.js "${CC_ARGS[@]}" 2>&1 >/dev/null || true)"
case "$ERR" in *"(409)"*REGISTER_EMAIL_TAKEN*) ;; *) echo "company:create: the same e-mail twice must fail with 409 REGISTER_EMAIL_TAKEN, got: $ERR" >&2; exit 1 ;; esac
# Without a rate: the second line says negotiation and the planner show no cost.
OUT2="$(printf '%s\n' 'Start-haslo-123' | NODE_ENV=production node dist/cli/create-company.js --company-name "Druga Firma" --tax-id 7770000005 --email admin@druga.example.com --first-name Ewa --last-name Lis)"
echo "$OUT2"
case "$OUT2" in *"No cost per km set (--cost-per-km)"*OFFER_COST_RATE_MISSING*) ;; *) echo "company:create: without --cost-per-km the output must say there is no cost per km" >&2; exit 1 ;; esac
echo "company:create OK"

echo "== recompute offer economics (offers:recompute-economics, NODE_ENV=production)"
# Simulate an old margin "from fuel" (before the margin rule) on a new and an accepted offer.
docker exec "$NAME" psql -U postgres -d demo -qc \
  "UPDATE offers SET profit_margin_percent = 99.00, margin_without_tolls = false WHERE external_id IN ('DEMO-002', 'DEMO-003')"
old_margins() { docker exec "$NAME" psql -U postgres -d demo -tAc \
  "SELECT string_agg(external_id || '=' || coalesce(profit_margin_percent::text, '-'), ',' ORDER BY external_id) FROM offers WHERE external_id IN ('DEMO-002', 'DEMO-003')"; }
[ -f dist/cli/recompute-economics.js ] || npm run build >/dev/null
DRY="$(NODE_ENV=production node dist/cli/recompute-economics.js --dry-run)"; echo "$DRY"
case "$DRY" in *"would change: "*"(dry run — nothing written)"*) ;; *) echo "recompute: unexpected dry-run output" >&2; exit 1 ;; esac
[ "$(old_margins)" = "DEMO-002=99.00,DEMO-003=99.00" ] || { echo "recompute: --dry-run wrote to the database: $(old_margins)" >&2; exit 1; }
RUN="$(NODE_ENV=production node dist/cli/recompute-economics.js)"; echo "$RUN"
# The same counts as the dry run (apart from "would change"/"changed").
[ "${DRY%%; would change:*}" = "${RUN%%; changed:*}" ] || { echo "recompute: dry-run counts differ from the run" >&2; exit 1; }
[ "${DRY#*would change: }" = "${RUN#*changed: } (dry run — nothing written)" ] || { echo "recompute: dry-run changed count differs from the run" >&2; exit 1; }
case "$(old_margins)" in *"=99.00"*) echo "recompute: the old margin is still there (also on the accepted offer): $(old_margins)" >&2; exit 1 ;; esac
AGAIN="$(NODE_ENV=production node dist/cli/recompute-economics.js)"; echo "$AGAIN"
case "$AGAIN" in *"; changed: 0") ;; *) echo "recompute: a second run must change nothing" >&2; exit 1 ;; esac
echo "recompute OK"

# Saved fallback routes skipped in the offer cost (a JSON filter).
echo "== test: suspected fallback routes (database)"; $JEST test/integration/route-trust

# Last: the expiry task also expires the dead offers of the seed.
echo "== test: offer expiry task (database)"; $JEST test/integration/offer-expiry
