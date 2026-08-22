#!/usr/bin/env bash
# test-all.sh — Run all project tests: typecheck + unit tests + playwright UI.
#
# Usage:
#   ./scripts/test-all.sh            # run everything
#   ./scripts/test-all.sh --skip-pw  # skip playwright tests
#
# Training E2E is now in the separate training-worker repo.
#
# The vitest and pytest stages were added by TASK-194: until then this script ran only
# typechecks and Playwright, so the ~6500 unit tests across server/app/robot-agent never
# ran from the documented entry point and new suites could rot unnoticed.
#
# The sim pytest stage needs the cyclonedds+mujoco venv from
# robot-agent/hardware/sim_g1_dds/README.md — point SIM_PYTHON at it. The curation
# pytest stage needs pyarrow + pandas — point CURATION_PYTHON at an interpreter that
# has them (server/curation/.venv/bin/python is found automatically). Without either,
# that stage is reported as SKIPPED, never as passed.
#
# Every stage runs even when an earlier one fails, so one invocation gives the full
# picture. Exits 0 if all tests pass, non-zero otherwise.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKIP_PW=false

for arg in "$@"; do
  case "$arg" in
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

step "Robot agent typecheck"
(cd "$REPO_ROOT/robot-agent" && npm run typecheck) || { echo "  robot-agent typecheck FAILED"; FAILURES=$((FAILURES + 1)); }

# ---------------------------------------------------------------- 2. Unit tests
step "Server unit tests"
(cd "$REPO_ROOT/server" && npm test) || { echo "  server vitest FAILED"; FAILURES=$((FAILURES + 1)); }

step "App unit tests"
(cd "$REPO_ROOT/app" && npm test) || { echo "  app vitest FAILED"; FAILURES=$((FAILURES + 1)); }

step "Robot agent unit tests"
(cd "$REPO_ROOT/robot-agent" && npm test) || { echo "  robot-agent vitest FAILED"; FAILURES=$((FAILURES + 1)); }

# ------------------------------------------------------- 3. Python sim state machine
# sim_g1_dds is what makes Agent Mode testable without a G1, so its state machine is
# part of the regression suite — but only when the venv is actually there. A missing
# venv is reported as skipped; it must never read as a pass.
SIM_DIR="$REPO_ROOT/robot-agent/hardware/sim_g1_dds"
SIM_PY="${SIM_PYTHON:-}"
if [ -z "$SIM_PY" ] && [ -x "$SIM_DIR/.venv/bin/python" ]; then SIM_PY="$SIM_DIR/.venv/bin/python"; fi
if [ -n "$SIM_PY" ] && "$SIM_PY" -c 'import mujoco' >/dev/null 2>&1; then
  step "Sim state machine (pytest)"
  (cd "$SIM_DIR" && "$SIM_PY" -m pytest -q) || { echo "  sim_g1_dds pytest FAILED"; FAILURES=$((FAILURES + 1)); }
else
  step "Sim state machine (SKIPPED — set SIM_PYTHON, see $SIM_DIR/README.md)"
fi

# ---------------------------------------------------- 3b. Curation / LeRobot format
# The converter and the dataset tooling are python, and their tests existed for two
# tasks without ever running from this script — which is how a mandatory pipeline step
# ends up untested. Same rule as the sim stage: a missing interpreter is SKIPPED, never
# a pass. The video tests inside additionally skip themselves without ffmpeg.
CURATION_DIR="$REPO_ROOT/server/curation"
CURATION_PY="${CURATION_PYTHON:-}"
if [ -z "$CURATION_PY" ] && [ -x "$CURATION_DIR/.venv/bin/python" ]; then
  CURATION_PY="$CURATION_DIR/.venv/bin/python"
fi
if [ -n "$CURATION_PY" ] && "$CURATION_PY" -c 'import pyarrow, pandas' >/dev/null 2>&1; then
  step "Curation + LeRobot converter (pytest)"
  (cd "$CURATION_DIR" && "$CURATION_PY" -m pytest tests -q) \
    || { echo "  curation pytest FAILED"; FAILURES=$((FAILURES + 1)); }
else
  step "Curation + LeRobot converter (SKIPPED — set CURATION_PYTHON to a python with pyarrow+pandas)"
fi

# Training E2E — now in separate training-worker repo (run ../training-worker/scripts/test-e2e.sh)

# ---------------------------------------------------------------- 4. Playwright
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

# ---------------------------------------------------------------- 5. Summary
echo
step "Results"
if [ "$FAILURES" -eq 0 ]; then
  ok "All tests passed"
  exit 0
else
  fail "$FAILURES test suite(s) failed"
fi
