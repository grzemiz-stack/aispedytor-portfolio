#!/usr/bin/env bash
#
# The project's full check. THIS file is the definition of the check
# (docs/decisions.md §10): a check that is not here does not exist.
#
# Every check runs to the end, even when an earlier one failed — the summary
# shows all of them, not only the first failure. Exit code ≠ 0 if any failed.
#
# Needs Docker (test:demo). In CI: ubuntu-24.04 has Docker.
#
# Deliberately NO `tsc --noEmit -p tsconfig.json` here: it reports errors
# because the tests are outside `rootDir`. The build uses `tsconfig.build.json`.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ "$#" -ne 0 ]; then
  echo "bramka.sh takes no arguments (there is only the full run)." >&2
  exit 2
fi

# Missing dependencies give confusing errors instead of a clear message.
# Install from the root only — `npm ci` in a subfolder deletes the root's
# dependencies.
if [ ! -d node_modules ]; then
  echo "No node_modules in the repository root. Run: npm ci (in the root)." >&2
  exit 2
fi

CHECKS=(
  # Lint: zero errors and zero warnings (`--max-warnings 0` in the `lint` scripts).
  "apps/api|lint"
  "apps/api|test"
  # The same tests with the clock at +5 years (test/setup/clock-shift.ts): a
  # test that relies on a hardcoded date "in the future" fails at once.
  "apps/api|test:future"
  "apps/api|build"
  # The LTL demo scenario on a real PostgreSQL (Docker): seed + a search with
  # the screen's body and the clock at +30 days — tools/demo-test.sh.
  "apps/api|test:demo"
  "apps/web|lint"
  "apps/web|test"
  "apps/web|build"
)

RESULTS=()
FAILED=0

for k in "${CHECKS[@]}"; do
  app="${k%%|*}"
  script="${k##*|}"
  echo
  echo "=== ${app}: npm run ${script} ==="
  if (cd "$app" && npm run "$script"); then
    RESULTS+=("OK     ${app}: npm run ${script}")
  else
    RESULTS+=("FAILED ${app}: npm run ${script}")
    FAILED=1
  fi
done

echo
echo "=== Full check summary ==="
printf '%s\n' "${RESULTS[@]}"

if [ "$FAILED" -ne 0 ]; then
  echo "FULL CHECK FAILED"
  exit 1
fi
echo "FULL CHECK PASSED"
