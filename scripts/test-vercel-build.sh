#!/usr/bin/env bash
# Reproduce the Vercel registry build locally.
#
# Usage:
#   cd path/to/client-project
#   bash /path/to/handoff-app/scripts/test-vercel-build.sh
#
# By default runs THREE scenarios sequentially:
#   1. Happy path     — valid DATABASE_URL pointing at local Postgres
#   2. Unreachable DB — DATABASE_URL points at a port nothing listens on
#   3. Malformed URL  — DATABASE_URL is not a valid URL string
#
# The build MUST succeed in all three. Scenarios 2 and 3 simulate Vercel's
# common failure modes (DB not yet provisioned, env var miscopied, etc.).
#
# Pass a flag to run just one: --happy | --unreachable | --malformed
#
# Override env vars by exporting them before running:
#   DATABASE_URL=postgres://... bash test-vercel-build.sh --happy

CLIENT_DIR="$(pwd)"

if [ ! -d "$CLIENT_DIR/handoff" ]; then
  echo "ERROR: Run from a client project root (must contain a handoff/ subdirectory)." >&2
  exit 2
fi

clean_runtime() {
  rm -rf "$CLIENT_DIR/handoff/.handoff/runtime"
}

run_scenario() {
  local name="$1"
  local db_url="$2"

  echo ""
  echo "════════════════════════════════════════════════════════════════"
  echo " SCENARIO: $name"
  echo " DATABASE_URL=$db_url"
  echo "════════════════════════════════════════════════════════════════"

  clean_runtime

  (cd "$CLIENT_DIR/handoff" && \
    DATABASE_URL="$db_url" \
    HANDOFF_REGISTRY_MODE=true \
    AUTH_SECRET="${AUTH_SECRET:-local-test-secret}" \
    HANDOFF_SYNC_SECRET="${HANDOFF_SYNC_SECRET:-local-test-secret}" \
      handoff-app vercel-build --skip-components > /tmp/handoff-build.log 2>&1)

  local exit_code=$?

  if [ $exit_code -eq 0 ]; then
    echo "  ✓ PASSED"
    grep -E "✓ Compiled|✓ Generating" /tmp/handoff-build.log | head -3 | sed 's/^/    /'
  else
    echo "  ✗ FAILED — exit code $exit_code"
    grep -E "Error|Failed|TypeError" /tmp/handoff-build.log | head -10 | sed 's/^/    /'
    return $exit_code
  fi
}

case "${1:-all}" in
  --happy)
    run_scenario "Happy path" "${DATABASE_URL:-postgresql://handoff:handoff_dev@localhost:5433/handoff_registry}"
    ;;
  --unreachable)
    run_scenario "Unreachable DB" "postgresql://noone:nopass@localhost:65432/nope"
    ;;
  --malformed)
    run_scenario "Malformed URL" "not-a-postgres-url"
    ;;
  all|*)
    run_scenario "Happy path" "${DATABASE_URL:-postgresql://handoff:handoff_dev@localhost:5433/handoff_registry}" || exit 1
    run_scenario "Unreachable DB (port 65432)" "postgresql://noone:nopass@localhost:65432/nope" || exit 1
    run_scenario "Malformed URL" "not-a-postgres-url" || exit 1
    echo ""
    echo "════════════════════════════════════════════════════════════════"
    echo " ✓ All 3 scenarios passed. Safe to push to Vercel."
    echo "════════════════════════════════════════════════════════════════"
    ;;
esac
