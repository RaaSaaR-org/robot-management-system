#!/usr/bin/env bash
# test-all.sh — Run all project tests: typecheck + training e2e + playwright UI.
#
# Usage:
#   ./scripts/test-all.sh            # run everything
#   ./scripts/test-all.sh --skip-e2e # skip training pipeline (fast mode)
#   ./scripts/test-all.sh --skip-pw  # skip playwright tests
#
# Exits 0 if all tests pass, non-zero on first failure.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKIP_E2E=false
SKIP_PW=false

for arg in "$@"; do
  case "$arg" in
    --skip-e2e) SKIP_E2E=true ;;
    --skip-pw)  SKIP_PW=true ;;
  esac
done

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
step() { echo -e "\n${BLUE}━━━ $* ━━━${NC}"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
fail() { echo -e "${RED}✗${NC} $*" >&2; exit 1; }

FAILURES=0

# ---------------------------------------------------------------- 1. Typecheck
step "Server typecheck"
(cd "$REPO_ROOT/server" && npm run typecheck) || { echo "  server typecheck FAILED"; FAILURES=$((FAILURES + 1)); }

step "App typecheck"
(cd "$REPO_ROOT/app" && npx tsc --noEmit) || { echo "  app typecheck FAILED"; FAILURES=$((FAILURES + 1)); }

# ---------------------------------------------------------------- 2. Training E2E
if $SKIP_E2E; then
  step "Training E2E (SKIPPED)"
else
  step "Training E2E pipeline"
  "$REPO_ROOT/training-worker/scripts/test-e2e.sh" || { echo "  training e2e FAILED"; FAILURES=$((FAILURES + 1)); }
fi

# ---------------------------------------------------------------- 3. Playwright
if $SKIP_PW; then
  step "Playwright UI tests (SKIPPED)"
else
  step "Playwright UI tests"
  if command -v npx >/dev/null && [ -f "$REPO_ROOT/app/playwright.config.ts" ] || [ -f "$REPO_ROOT/app/playwright-tests/training-flow.spec.ts" ]; then
    # Ensure server + app are running
    if ! curl -sf http://localhost:3001/api/robots >/dev/null 2>&1; then
      echo "  Server not running on :3001 — starting..."
      (cd "$REPO_ROOT/server" && nohup npm run dev > /tmp/neodem-server.log 2>&1 &)
      for i in {1..15}; do sleep 2; curl -sf http://localhost:3001/api/robots >/dev/null 2>&1 && break; done
    fi
    if ! curl -sf http://localhost:1420 >/dev/null 2>&1; then
      echo "  App not running on :1420 — starting..."
      (cd "$REPO_ROOT/app" && nohup npm run dev > /tmp/neodem-app.log 2>&1 &)
      for i in {1..15}; do sleep 2; curl -sf http://localhost:1420 >/dev/null 2>&1 && break; done
    fi
    (cd "$REPO_ROOT/app" && npx playwright test) || { echo "  playwright FAILED"; FAILURES=$((FAILURES + 1)); }
  else
    echo "  Playwright not configured — skipping"
  fi
fi

# ---------------------------------------------------------------- 4. Summary
echo
step "Results"
if [ "$FAILURES" -eq 0 ]; then
  ok "All tests passed"
  exit 0
else
  fail "$FAILURES test suite(s) failed"
fi
