#!/usr/bin/env bash
# test-quest-connect.sh — tests for quest-connect.sh's adb search and exit codes (TASK-412).
#
# Usage: scripts/test-quest-connect.sh
#
# Each case runs the script with a fake HOME holding a fake adb (a bash stub
# that answers `devices -l` from a fixture and logs every call), and a PATH of
# /usr/bin:/bin only — so a real adb on PATH would win the search; the run is
# reported SKIPPED when /usr/bin or /bin has one. Talks to no device.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUT="$HERE/quest-connect.sh"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ok   $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }

if [ -x /usr/bin/adb ] || [ -x /bin/adb ]; then
  echo "SKIPPED: an adb in /usr/bin or /bin would shadow the fake HOME's"
  exit 0
fi

# make_adb <path> <devices fixture>: a stub adb that logs its arguments next to itself.
make_adb() {
  local bin="$1" dir
  dir="$(dirname "$bin")"
  mkdir -p "$dir"
  cat >"$bin" <<STUB
#!/usr/bin/env bash
printf '%s\n' "\$*" >>"$dir/calls.log"
case "\$*" in
  "devices -l") printf 'List of devices attached\n%b\n' '$2' ;;
  *"reverse --list") printf 'UsbFfs tcp:1442 tcp:1442\n' ;;
esac
exit 0
STUB
  chmod +x "$bin"
}

# run_case <home> [args...] → sets OUT and CODE
run_case() {
  local home="$1"; shift
  set +e
  OUT="$(env -i HOME="$home" PATH=/usr/bin:/bin bash "$SUT" "$@" 2>&1)"
  CODE=$?
  set -e
}

DEVICE='2G0YC5ZG8X0123\tdevice usb:1-1 product:eureka model:Quest_3 transport_id:2'
UNAUTH='2G0YC5ZG8X0123\tunauthorized usb:1-1 transport_id:3'

echo "quest-connect.sh"

# 1. ~/platform-tools/adb is found (the case this task adds), no device → exit 3.
H="$SCRATCH/h1"; make_adb "$H/platform-tools/adb" ''
run_case "$H" --port 1442
if [ "$CODE" = 3 ] && printf '%s' "$OUT" | grep -q "adb: $H/platform-tools/adb"; then
  pass "finds ~/platform-tools/adb; no headset → exit 3"
else
  fail "finds ~/platform-tools/adb; no headset → exit 3 (got $CODE: $OUT)"
fi

# 2. both installed: ~/platform-tools wins.
H="$SCRATCH/h2"; make_adb "$H/platform-tools/adb" ''; make_adb "$H/.local/opt/platform-tools/adb" ''
run_case "$H" --port 1442
if printf '%s' "$OUT" | grep -q "adb: $H/platform-tools/adb"; then pass "prefers ~/platform-tools over ~/.local/opt"; else fail "prefers ~/platform-tools (got: $OUT)"; fi

# 3. only ~/.local/opt/platform-tools still works.
H="$SCRATCH/h3"; make_adb "$H/.local/opt/platform-tools/adb" ''
run_case "$H" --port 1442
if printf '%s' "$OUT" | grep -q "adb: $H/.local/opt/platform-tools/adb"; then pass "still finds ~/.local/opt/platform-tools/adb"; else fail "the .local/opt fallback (got: $OUT)"; fi

# 4. no adb anywhere → exit 2.
run_case "$SCRATCH/empty" --port 1442
if [ "$CODE" = 2 ]; then pass "no adb → exit 2"; else fail "no adb → exit 2 (got $CODE)"; fi

# 5. an unauthorized headset → exit 4, and no reverse attempted.
H="$SCRATCH/h5"; make_adb "$H/platform-tools/adb" "$UNAUTH"
run_case "$H" --port 1442
if [ "$CODE" = 4 ] && ! grep -q 'reverse' "$H/platform-tools/calls.log"; then pass "unauthorized → exit 4, no reverse"; else fail "unauthorized → exit 4 (got $CODE)"; fi

# 6. a ready headset → exactly adb -s <serial> reverse tcp:1442 tcp:1442.
H="$SCRATCH/h6"; make_adb "$H/platform-tools/adb" "$DEVICE"
run_case "$H" --port 1442
if [ "$CODE" = 0 ] && grep -qx -- '-s 2G0YC5ZG8X0123 reverse tcp:1442 tcp:1442' "$H/platform-tools/calls.log"; then
  pass "device → adb -s <serial> reverse tcp:1442 tcp:1442"
else
  fail "device → reverse (got $CODE; calls: $(tr '\n' '|' <"$H/platform-tools/calls.log"))"
fi

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
