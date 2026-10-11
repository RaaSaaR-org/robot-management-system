#!/usr/bin/env bash
# @file run.sh
# @description One entry point for the k3d E2E: up → install → test, timings, exit code (TASK-351).
#
# Exits non-zero on the first failing stage. The cluster is left UP so a
# failure can be inspected; pass --down (or E2E_DOWN=1) to tear it down after
# the run whatever the outcome.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

DOWN="${E2E_DOWN:-0}"
for a in "$@"; do
  case "$a" in
    --down) DOWN=1 ;;
    *) fail "unknown argument: $a (supported: --down)" ;;
  esac
done

timings=()
stage() {
  local name="$1"; shift
  local start; start=$(now)
  "$@"
  timings+=("$name $(( $(now) - start ))s")
}

report() {
  local rc=$?
  # PASS needs the last stage to have finished, not just a zero status: an
  # interrupted run can reach this trap with $? = 0.
  [ "$COMPLETED" = 1 ] || { [ "$rc" != 0 ] || rc=1; }
  log "timings: ${timings[*]:-none} — total $(( $(now) - RUN_START ))s"
  if [ "$DOWN" = 1 ]; then "$E2E_DIR/down.sh" || true; fi
  if [ "$rc" = 0 ]; then ok "run.sh"; else printf '\033[1;31m[e2e] FAIL\033[0m run.sh (exit %s)\n' "$rc" >&2; fi
  exit "$rc"
}

RUN_START=$(now)
COMPLETED=0
trap report EXIT
trap 'exit 130' INT TERM

stage up      "$E2E_DIR/up.sh"
stage install "$E2E_DIR/install.sh"
stage test    "$E2E_DIR/test.sh"
COMPLETED=1
