#!/usr/bin/env bash
# quest-connect.sh — put a Meta Quest on the NeoDEM dev server over USB (TASK-393).
#
# What it does, in order:
#   1. finds adb ($ADB, PATH, ~/platform-tools, ~/.local/opt/platform-tools, SDK, Homebrew);
#   2. checks a headset is attached AND has accepted USB debugging — an
#      "unauthorized" headset is the silent failure a bare `adb reverse` gives you;
#   3. `adb reverse tcp:PORT tcp:PORT`, so http://localhost:PORT inside the headset
#      is this computer's dev server — and localhost is a secure context, so WebXR
#      works without a certificate;
#   4. lists the reverse rules, checks the dev server answers, prints the URL.
#
# ONE PORT IS ENOUGH. The app talks to the API, the event stream and the robot's
# teleop socket through its own origin (the Vite dev proxy forwards /api, WebSockets
# included), so nothing but the page port needs forwarding — no SSH tunnel, no
# second `adb reverse` for :3001 or the robot agent.
#
# Usage:
#   ./scripts/quest-connect.sh                 # USB, port 1420
#   ./scripts/quest-connect.sh --port 1430     # a dev server on another port
#   ./scripts/quest-connect.sh --open          # also open the page in the Quest browser
#   ./scripts/quest-connect.sh --wireless      # then switch to Wi-Fi adb (cable can go)
#   ./scripts/quest-connect.sh --serial 1WMHH… # pick one of several devices
#   ./scripts/quest-connect.sh --remove        # undo the reverse rule
#
# Exit codes: 0 ok · 1 usage · 2 no adb · 3 no device · 4 unauthorized/offline ·
#             5 adb reverse failed.
#
# Portable to macOS's bash 3.2: no mapfile, no associative arrays.

set -euo pipefail

PORT=1420
SERIAL=""
WIRELESS=0
OPEN=0
REMOVE=0
WIRELESS_PORT=5555

usage() {
  sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="${2:-}"; shift 2 ;;
    --port=*) PORT="${1#*=}"; shift ;;
    --serial|-s) SERIAL="${2:-}"; shift 2 ;;
    --wireless) WIRELESS=1; shift ;;
    --open) OPEN=1; shift ;;
    --remove) REMOVE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "quest-connect: unknown option '$1' (try --help)" >&2; exit 1 ;;
  esac
done

case "$PORT" in
  ''|*[!0-9]*) echo "quest-connect: --port needs a number, got '$PORT'" >&2; exit 1 ;;
esac

say() { printf '%s\n' "$*"; }
ok() { printf '  \342\234\223 %s\n' "$*"; }
fail() { printf '  \342\234\227 %s\n' "$*" >&2; }

# ---------------------------------------------------------------------------
# 1. adb
# ---------------------------------------------------------------------------
find_adb() {
  if [ -n "${ADB:-}" ] && [ -x "${ADB}" ]; then printf '%s' "$ADB"; return 0; fi
  if command -v adb >/dev/null 2>&1; then command -v adb; return 0; fi
  for candidate in \
    "$HOME/platform-tools/adb" \
    "$HOME/.local/opt/platform-tools/adb" \
    "$HOME/Android/Sdk/platform-tools/adb" \
    "$HOME/Library/Android/sdk/platform-tools/adb" \
    "/opt/homebrew/bin/adb" \
    "/usr/local/bin/adb"; do
    if [ -x "$candidate" ]; then printf '%s' "$candidate"; return 0; fi
  done
  return 1
}

say "Meta Quest → NeoDEM (port $PORT)"
if ! ADB_BIN="$(find_adb)"; then
  fail "adb not found."
  say "    Install Android platform-tools and put adb on PATH, or set ADB=/path/to/adb."
  say "    Linux without sudo: unzip platform-tools into ~ or ~/.local/opt/ (this script looks in both)."
  say "    macOS: brew install --cask android-platform-tools"
  exit 2
fi
ok "adb: $ADB_BIN"
"$ADB_BIN" start-server >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# 2. the headset
# ---------------------------------------------------------------------------
DEVICES="$("$ADB_BIN" devices -l | sed '1d' | sed '/^[[:space:]]*$/d' || true)"

if [ -z "$DEVICES" ]; then
  fail "no headset visible to adb."
  say "    - Developer Mode on? (Meta Horizon app → Devices → headset → Headset settings → Developer mode)"
  say "    - USB-C cable plugged into THIS computer, and a data cable (not charge-only)?"
  say "    - Headset awake? adb does not see a sleeping Quest."
  exit 3
fi

if [ -n "$SERIAL" ]; then
  LINE="$(printf '%s\n' "$DEVICES" | awk -v s="$SERIAL" '$1 == s')"
  if [ -z "$LINE" ]; then
    fail "no device with serial '$SERIAL'. adb sees:"
    printf '%s\n' "$DEVICES" | sed 's/^/      /' >&2
    exit 3
  fi
else
  COUNT="$(printf '%s\n' "$DEVICES" | wc -l | tr -d ' ')"
  if [ "$COUNT" -gt 1 ]; then
    # Several devices: prefer the one that calls itself a Quest.
    QUESTS="$(printf '%s\n' "$DEVICES" | grep -i 'quest' || true)"
    QCOUNT="$(printf '%s\n' "$QUESTS" | sed '/^$/d' | wc -l | tr -d ' ')"
    if [ "$QCOUNT" = "1" ]; then
      LINE="$QUESTS"
    else
      fail "$COUNT devices attached — choose one with --serial:"
      printf '%s\n' "$DEVICES" | sed 's/^/      /' >&2
      exit 3
    fi
  else
    LINE="$DEVICES"
  fi
fi

SERIAL="$(printf '%s' "$LINE" | awk '{print $1}')"
STATE="$(printf '%s' "$LINE" | awk '{print $2}')"
MODEL="$(printf '%s' "$LINE" | tr ' ' '\n' | sed -n 's/^model://p')"

case "$STATE" in
  device) ok "headset: $SERIAL${MODEL:+ ($MODEL)}" ;;
  unauthorized)
    fail "headset $SERIAL has not accepted USB debugging."
    say "    Put the headset on: a dialog asks to \"Allow USB debugging\"."
    say "    Tick \"Always allow from this computer\", accept, then run this again."
    say "    No dialog? Unplug and replug the cable with the headset on."
    exit 4 ;;
  offline)
    fail "headset $SERIAL is offline to adb. Replug the cable, or: $ADB_BIN kill-server"
    exit 4 ;;
  *)
    fail "headset $SERIAL is in state '$STATE'."
    exit 4 ;;
esac

A() { "$ADB_BIN" -s "$SERIAL" "$@"; }

# ---------------------------------------------------------------------------
# 3. the reverse rule
# ---------------------------------------------------------------------------
if [ "$REMOVE" = "1" ]; then
  if A reverse --remove "tcp:$PORT" >/dev/null 2>&1; then
    ok "removed: localhost:$PORT inside the headset no longer reaches this computer"
  else
    say "  - no reverse rule for tcp:$PORT to remove"
  fi
  exit 0
fi

if ! A reverse "tcp:$PORT" "tcp:$PORT" >/dev/null; then
  fail "adb reverse tcp:$PORT tcp:$PORT failed."
  exit 5
fi
ok "adb reverse tcp:$PORT tcp:$PORT"
say "  reverse rules on $SERIAL:"
A reverse --list | sed 's/^/      /'

# ---------------------------------------------------------------------------
# 4. the dev server, and where to go
# ---------------------------------------------------------------------------
URL="http://localhost:$PORT/"
if command -v curl >/dev/null 2>&1; then
  if curl -s -o /dev/null -m 3 "$URL"; then
    ok "dev server answers on $URL"
  else
    fail "nothing answers on $URL on this computer — start it: cd app && npm run dev"
  fi
fi

if [ "$WIRELESS" = "1" ]; then
  # Over Wi-Fi adb the reverse rule keeps working: it rides the adb transport,
  # not the cable. The headset and this computer must share a network.
  IP="$(A shell ip -f inet addr show wlan0 2>/dev/null | sed -n 's/.*inet \([0-9.]*\).*/\1/p' | head -n1)"
  if [ -z "$IP" ]; then
    fail "could not read the headset's Wi-Fi address (is it on Wi-Fi?) — staying on USB"
  else
    A tcpip "$WIRELESS_PORT" >/dev/null
    sleep 2
    if "$ADB_BIN" connect "$IP:$WIRELESS_PORT" | grep -q 'connected'; then
      SERIAL="$IP:$WIRELESS_PORT"
      A reverse "tcp:$PORT" "tcp:$PORT" >/dev/null
      ok "wireless adb: $SERIAL — the cable can be unplugged"
      say "    (to go back: $ADB_BIN -s $SERIAL usb)"
    else
      fail "adb connect $IP:$WIRELESS_PORT failed — staying on USB"
    fi
  fi
fi

if [ "$OPEN" = "1" ]; then
  if A shell am start -a android.intent.action.VIEW -d "$URL" com.oculus.browser >/dev/null 2>&1; then
    ok "opened $URL in the Quest browser"
  else
    fail "could not open the Quest browser — open $URL in it by hand"
  fi
fi

say ""
say "In the headset's browser open:  $URL"
say "Then: robot → VR teleop → Launch VR → Take control → Enter VR."
