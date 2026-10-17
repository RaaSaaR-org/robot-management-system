#!/usr/bin/env bash
# test-all.sh — Run all project tests: typecheck + unit tests + playwright UI.
# (Includes the robot supervisor's own typecheck + vitest, robot-agent/supervisor.)
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
# has them (server/curation/.venv/bin/python is found automatically). The hardware
# sidecar stage needs only numpy + pytest — point HARDWARE_PYTHON at one, or let it
# reuse either venv above. Without an interpreter, that stage is reported as
# SKIPPED, never as passed. --python-only and CI instead fail missing stages.
#
# The Isaac offline verifiers (stage 3d, added by TASK-231) are the exception: they
# need nothing but a stdlib python3, so they have no skip path at all — no interpreter
# there is counted as a FAILURE.
#
# Every stage runs even when an earlier one fails, so one invocation gives the full
# picture. Exits non-zero for failures; local optional skips appear in the summary.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKIP_PW=false
# --python-only runs stages 3a-3d and nothing else. CI has its own jobs for the
# typechecks, the vitest suites and Playwright; what it did NOT have, until
# 2026-09-06, was anything running the python. Giving it one entry point here
# rather than four inlined pytest invocations means the CI job and a developer's
# local run cannot drift apart about what "the python suites" are.
PYTHON_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --skip-pw)      SKIP_PW=true ;;
    --python-only)  PYTHON_ONLY=true; SKIP_PW=true ;;
  esac
done

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
step() { echo -e "\n${BLUE}━━━ $* ━━━${NC}"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
fail() { echo -e "${RED}✗${NC} $*" >&2; exit 1; }

FAILURES=0
SKIPPED_STAGES=0
python_unavailable() {
  if [ "$PYTHON_ONLY" = true ] || [ "${CI:-}" = true ]; then
    echo "  $* — required Python stage unavailable"
    FAILURES=$((FAILURES + 1))
  else
    step "$* (SKIPPED)"
    SKIPPED_STAGES=$((SKIPPED_STAGES + 1))
  fi
}

if [ "$PYTHON_ONLY" = false ]; then
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

# ------------------------------------- 2b. Error-contract ratchet (TASK-297)
# app/src/api/client.ts rejects with a plain object, never an Error, so an
# `instanceof Error` branch in a store silently discards the server's sentence.
# getErrorMessage()/errorMessage() handle both shapes; authStore's use is a
# sentinel comparison, not message extraction, so it is allowed.
step "App store error-contract ratchet"
RATCHET_HITS="$(grep -rln 'instanceof Error' "$REPO_ROOT"/app/src/features/*/store \
  --include='*.ts' --include='*.tsx' 2>/dev/null \
  | grep -v '__tests__' | grep -v '/authStore\.ts$' || true)"
if [ -n "$RATCHET_HITS" ]; then
  echo "  instanceof Error in a feature store — use getErrorMessage()/errorMessage():"
  echo "$RATCHET_HITS" | sed 's/^/    /'
  FAILURES=$((FAILURES + 1))
else
  ok "no instanceof Error in app/src/features/*/store"
fi

step "Robot agent unit tests"
(cd "$REPO_ROOT/robot-agent" && npm test) || { echo "  robot-agent vitest FAILED"; FAILURES=$((FAILURES + 1)); }

# ------------------------------------------------ 2c. Robot supervisor (TASK-403)
# robot-agent/supervisor is its own package (no install: it resolves from
# robot-agent/node_modules). Its tests start real stub children and run the real
# bridge_probe.py, so they need a python with pyzmq: SUPERVISOR_TEST_PYTHON, else
# the first of python3 / HARDWARE_PYTHON / the curation and sim venvs that has it.
# None at all is a skip, like the python stages below — never a pass.
SUP_PY="${SUPERVISOR_TEST_PYTHON:-}"
if [ -z "$SUP_PY" ]; then
  for cand in python3 "${HARDWARE_PYTHON:-}" "${CURATION_PYTHON:-}" \
              "$REPO_ROOT/server/curation/.venv/bin/python" "${SIM_PYTHON:-}" \
              "$REPO_ROOT/robot-agent/hardware/sim_g1_dds/.venv/bin/python"; do
    if [ -n "$cand" ] && command -v "$cand" >/dev/null 2>&1 && "$cand" -c 'import zmq' >/dev/null 2>&1; then
      SUP_PY="$cand"; break
    fi
  done
fi
step "Robot supervisor typecheck"
(cd "$REPO_ROOT/robot-agent/supervisor" && npm run typecheck) || { echo "  supervisor typecheck FAILED"; FAILURES=$((FAILURES + 1)); }
if [ -n "$SUP_PY" ]; then
  step "Robot supervisor unit tests"
  echo "  stub interpreter: $SUP_PY"
  (cd "$REPO_ROOT/robot-agent/supervisor" && SUPERVISOR_TEST_PYTHON="$SUP_PY" npm test) \
    || { echo "  supervisor vitest FAILED"; FAILURES=$((FAILURES + 1)); }
else
  python_unavailable "Robot supervisor unit tests — set SUPERVISOR_TEST_PYTHON to a python with pyzmq"
fi
fi  # PYTHON_ONLY

# ------------------------------------------------------- 3. Python sim state machine
# sim_g1_dds is what makes Agent Mode testable without a G1, so its state machine is
# part of the regression suite — but only when the venv is actually there. A missing
# venv is reported as skipped; it must never read as a pass.
SIM_DIR="$REPO_ROOT/robot-agent/hardware/sim_g1_dds"
SIM_PY="${SIM_PYTHON:-}"
if [ -z "$SIM_PY" ] && [ -x "$SIM_DIR/.venv/bin/python" ]; then SIM_PY="$SIM_DIR/.venv/bin/python"; fi
if [ -n "$SIM_PY" ] && "$SIM_PY" -c 'import mujoco' >/dev/null 2>&1; then
  step "Sim state machine (pytest)"
  # CI must collect the DDS/rendering tests instead of importorskip hiding them.
  if [ "$PYTHON_ONLY" = true ] || [ "${CI:-}" = true ]; then
    (cd "$SIM_DIR" && "$SIM_PY" -c 'import sim_node') || {
      echo "  sim_node dependencies unavailable (Unitree SDK, CycloneDDS, MuJoCo)"
      FAILURES=$((FAILURES + 1))
    }
  fi
  (cd "$SIM_DIR" && "$SIM_PY" -m pytest -q -rs) || { echo "  sim_g1_dds pytest FAILED"; FAILURES=$((FAILURES + 1)); }
else
  python_unavailable "Sim state machine — set SIM_PYTHON, see $SIM_DIR/README.md"
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
  (cd "$CURATION_DIR" && "$CURATION_PY" -m pytest tests -q -rs) \
    || { echo "  curation pytest FAILED"; FAILURES=$((FAILURES + 1)); }
else
  python_unavailable "Curation + LeRobot converter — set CURATION_PYTHON to a python with pyarrow+pandas"
fi

# ------------------------------------------------- 3c. Hardware sidecar (python)
# robot-agent/hardware/tests/ existed for several tasks without ever running from
# this script (TASK-190) — the MID-360 frame-convention logic in g1_sidecar.py had
# no executed test at all. Same rule as the two stages above: a missing interpreter
# is SKIPPED, never a pass.
#
# The whole of tests/ runs — no file is excluded from here, so nothing can be
# masked by this script and any new file dropped in there is picked up
# automatically. The httpx-dependent cases in test_backends.py / test_vla_runner.py
# (the SmolVLA backend and runner) skip themselves on an interpreter without httpx.
# So when HARDWARE_PYTHON is unset the candidates are tried curation-first —
# CURATION_PYTHON, the curation venv, SIM_PYTHON, the sim venv — and the first one
# with numpy+pytest+httpx wins; only when none has httpx does the first with
# numpy+pytest run, and the run then SAYS the SmolVLA tests did not (TASK-385: the
# sim venv used to win, and 17 cases skipped on every default run without a word).
HW_DIR="$REPO_ROOT/robot-agent/hardware"
hw_candidates() {
  local c
  for c in "${CURATION_PYTHON:-}" "$REPO_ROOT/server/curation/.venv/bin/python" \
           "${SIM_PYTHON:-}" "$HW_DIR/sim_g1_dds/.venv/bin/python"; do
    [ -n "$c" ] && command -v "$c" >/dev/null 2>&1 && echo "$c"
  done
  return 0
}
HW_PY="${HARDWARE_PYTHON:-}"
if [ -z "$HW_PY" ]; then
  HW_FALLBACK=""
  while IFS= read -r cand; do
    if "$cand" -c 'import numpy, pytest, httpx' >/dev/null 2>&1; then HW_PY="$cand"; break; fi
    if [ -z "$HW_FALLBACK" ] && "$cand" -c 'import numpy, pytest' >/dev/null 2>&1; then
      HW_FALLBACK="$cand"
    fi
  done < <(hw_candidates)
  [ -n "$HW_PY" ] || HW_PY="$HW_FALLBACK"
fi
SMOLVLA_NOTE=""
if [ -n "$HW_PY" ] && "$HW_PY" -c 'import numpy' >/dev/null 2>&1; then
  step "Hardware sidecar (pytest)"
  echo "  interpreter: $HW_PY"
  if ! "$HW_PY" -c 'import httpx' >/dev/null 2>&1; then
    SMOLVLA_NOTE="SmolVLA backend/runner tests did NOT run: $HW_PY has no httpx (point HARDWARE_PYTHON or CURATION_PYTHON at the curation venv)"
    echo "  note: $SMOLVLA_NOTE"
  fi
  (cd "$HW_DIR" && "$HW_PY" -m pytest tests -q -rs) \
    || { echo "  hardware pytest FAILED"; FAILURES=$((FAILURES + 1)); }
else
  python_unavailable "Hardware sidecar — set HARDWARE_PYTHON to a python with numpy+pytest"
fi

# ------------------------------------------ 3d. Isaac offline verifiers (python)
# The `verify_*_offline.py` scripts under robot-agent/hardware/ are the only automated
# guard on the Isaac bridges' maths. They exist BECAUSE the GPU on this box is
# serialised and an Isaac boot costs minutes, so the bugs they catch -- quaternion
# order, the Dex3 grip code, the odometry source -- have to be caught on CPU or not at
# all. Until TASK-231 not one of them ran from here: `grep -c verify_isaac
# scripts/test-all.sh` returned 0, so the guard on a priority-1 defect (odometry x/y
# reporting the COMMANDED velocity back, wrong by 71x on the live rig) fired only when
# a human remembered to type the filename. That is how it stayed green through a review
# while the defect was still on the wire.
#
# These four need the STANDARD LIBRARY ONLY -- no numpy, no cyclonedds, no mujoco, no
# Isaac, no GPU and no network (two of them start HTTP servers, both on loopback). So
# this stage deliberately does NOT get the "SKIPPED when the interpreter is missing"
# treatment of stages 3, 3b and 3c: those need a venv somebody has to build, this needs
# a python3. A box without one is broken, not unconfigured, and a guard that quietly
# reports SKIPPED is exactly the failure this stage was added to end -- so it counts as
# a FAILURE instead, and the run cannot say "All tests passed" without it.
#
# The list is explicit rather than a glob: isaac_sim_patches/verify_push_probe_offline.py
# also matches `verify_*_offline.py` but exits 1 without UNITREE_SIM_ROOT pointing at an
# out-of-repo unitree_sim_isaaclab checkout, so it is an environment check, not a gate.
# Each verifier prints its own verdict line on success and dumps its whole output on
# failure, which is where the named check that broke is.
step "Isaac offline verifiers"
# HARDWARE_PYTHON if it is set AND runs, so this stage follows the same operator knob
# as 3c; otherwise plain python3. A HARDWARE_PYTHON that does not run is announced
# rather than swallowed -- it is usually a stale venv path, and the reader deserves to
# know the interpreter they configured is not the one that ran.
VERIFY_PY="${HARDWARE_PYTHON:-}"
if [ -n "$VERIFY_PY" ] && ! "$VERIFY_PY" -c '' >/dev/null 2>&1; then
  echo "  HARDWARE_PYTHON=$VERIFY_PY does not run — falling back to the venvs, then python3"
  VERIFY_PY=""
fi
# Then the same venvs as 3c before bare python3: they are known-good interpreters, and
# python3 on a stock Mac is 3.9. The verifiers must still parse there (TASK-385; the
# tests/test_fstring_portability.py guard keeps them so), but a venv is the better bet.
if [ -z "$VERIFY_PY" ]; then
  while IFS= read -r cand; do
    if "$cand" -c '' >/dev/null 2>&1; then VERIFY_PY="$cand"; break; fi
  done < <(hw_candidates)
fi
if [ -z "$VERIFY_PY" ] && command -v python3 >/dev/null 2>&1; then VERIFY_PY="python3"; fi
if [ -n "$VERIFY_PY" ]; then
  echo "  interpreter: $VERIFY_PY ($("$VERIFY_PY" -V 2>&1))"
  VERIFY_OUT="$(mktemp)"
  for verifier in \
    robot-agent/hardware/verify_isaac_odom_offline.py \
    robot-agent/hardware/verify_isaac_manip_offline.py \
    robot-agent/hardware/verify_isaac_camera_facade_offline.py \
    robot-agent/hardware/isaac_scenes/verify_factory_scene_offline.py
  do
    if (cd "$REPO_ROOT" && "$VERIFY_PY" "$REPO_ROOT/$verifier") >"$VERIFY_OUT" 2>&1; then
      # The verdict line, not the last line: the scene verifier ends with a rule of
      # '=' characters, and "✓ ======" would say nothing about how many checks ran.
      VERIFY_MSG="$(grep -aE '^(RESULT:|all .* checks passed)' "$VERIFY_OUT" | tail -1)"
      [ -n "$VERIFY_MSG" ] || VERIFY_MSG="$(grep -av '^[[:space:]]*$' "$VERIFY_OUT" | tail -1)"
      ok "$verifier — $VERIFY_MSG"
    else
      cat "$VERIFY_OUT"
      echo "  $verifier FAILED"
      FAILURES=$((FAILURES + 1))
    fi
  done
  rm -f "$VERIFY_OUT"
else
  # Not a skip. These need nothing but a stdlib python3, so "no interpreter" here is a
  # broken box, and a silent pass would hand back the very false green this stage exists
  # to prevent.
  echo "  NOT RUN: no usable python3 (HARDWARE_PYTHON unset or not executable, and no"
  echo "  python3 on PATH). The Isaac offline verifiers need only the standard library,"
  echo "  so this counts as a FAILURE, not a skip."
  FAILURES=$((FAILURES + 1))
fi

# Training E2E — now in separate training-worker repo (run ../training-worker/scripts/test-e2e.sh)

# ---------------------------------------------------------------- 4. Playwright
if $SKIP_PW; then
  step "Playwright UI tests (SKIPPED)"
else
  step "Playwright UI tests"
  if command -v npx >/dev/null && [ -f "$REPO_ROOT/app/playwright.config.ts" ] || [ -f "$REPO_ROOT/app/playwright-tests/training-flow.spec.ts" ]; then
    # The default config owns its demo build and preview server. Starting the
    # live stack here would touch the developer database and leave processes
    # behind even though none of these browser tests use them.
    (cd "$REPO_ROOT/app" && npx playwright test) || { echo "  playwright FAILED"; FAILURES=$((FAILURES + 1)); }
  else
    echo "  Playwright not configured — skipping"
  fi
fi

# ---------------------------------------------------------------- 5. Summary
echo
step "Results"
[ -z "$SMOLVLA_NOTE" ] || echo "  note: $SMOLVLA_NOTE"
if [ "$FAILURES" -eq 0 ]; then
  ok "All executed stages passed ($SKIPPED_STAGES Python stages skipped; see suite output for individual skips)"
  exit 0
else
  fail "$FAILURES test suite(s) failed"
fi
