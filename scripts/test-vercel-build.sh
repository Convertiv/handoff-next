#!/usr/bin/env bash
# Reproduce the Vercel registry build locally.
#
# Usage:
#   cd path/to/client-project
#   bash /path/to/handoff-app/scripts/test-vercel-build.sh
#
# Runs the same `handoff-app vercel-build --skip-components` that Vercel runs,
# with the same env vars that exist in a registry deployment. Catches build
# errors (auth init, type errors, proxy export names, missing deps) locally
# before pushing.

set -e

# Default to a local docker postgres — override DATABASE_URL to use a different one
export DATABASE_URL="${DATABASE_URL:-postgresql://handoff:handoff_dev@localhost:5433/handoff_registry}"
export HANDOFF_REGISTRY_MODE="${HANDOFF_REGISTRY_MODE:-true}"
export AUTH_SECRET="${AUTH_SECRET:-local-vercel-build-test-secret}"
export HANDOFF_SYNC_SECRET="${HANDOFF_SYNC_SECRET:-local-vercel-build-test-secret}"

# Clear any stale .handoff/runtime so we test a fresh materialization
if [ -d "handoff/.handoff/runtime" ]; then
  echo "Clearing handoff/.handoff/runtime for fresh test..."
  rm -rf handoff/.handoff/runtime
fi

echo "Running: cd handoff && handoff-app vercel-build --skip-components"
echo "  DATABASE_URL=${DATABASE_URL}"
echo "  HANDOFF_REGISTRY_MODE=${HANDOFF_REGISTRY_MODE}"
echo "  AUTH_SECRET=*** (set)"
echo "  HANDOFF_SYNC_SECRET=*** (set)"
echo ""

cd handoff && handoff-app vercel-build --skip-components
