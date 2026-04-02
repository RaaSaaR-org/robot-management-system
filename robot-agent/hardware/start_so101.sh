#!/bin/bash
# start_so101.sh — Start SO-101 hardware sidecar + Robot Agent + Playwright MCP
# Usage: bash robot-agent/hardware/start_so101.sh
#
# Environment:
#   LEROBOT_DIR   — LeRobot checkout (default: ~/lerobot)
#   NODE_ENV      — "production" uses npm run start:so101, else dev:so101
#   SKIP_PLAYWRIGHT — set to "true" to skip Playwright MCP server

set -e

SIDECAR_PY="$(dirname "$0")/so101_sidecar.py"
LEROBOT_DIR="${LEROBOT_DIR:-$HOME/lerobot}"
AGENT_DIR="$(dirname "$0")/.."

cleanup() {
  [ -n "$SIDECAR_PID" ] && kill $SIDECAR_PID 2>/dev/null && echo "Sidecar stopped."
  [ -n "$PLAYWRIGHT_PID" ] && kill $PLAYWRIGHT_PID 2>/dev/null && echo "Playwright MCP stopped."
}
trap cleanup EXIT

if [ "$SKIP_PLAYWRIGHT" != "true" ] && command -v playwright-mcp &>/dev/null; then
  echo "🎭 Starting Playwright MCP server..."
  playwright-mcp --port 8931 --browser chromium --headless &
  PLAYWRIGHT_PID=$!
  echo "   Playwright MCP PID: $PLAYWRIGHT_PID"
  sleep 2
fi

echo "🦾 Starting SO-101 hardware sidecar..."
cd "$LEROBOT_DIR"
uv run python "$SIDECAR_PY" &
SIDECAR_PID=$!
echo "   Sidecar PID: $SIDECAR_PID"

# Wait for sidecar to be ready
echo "   Waiting for sidecar..."
for i in $(seq 1 10); do
  if curl -sf http://localhost:8765/health > /dev/null 2>&1; then
    echo "   ✅ Sidecar ready"
    break
  fi
  sleep 1
  if [ $i -eq 10 ]; then
    echo "   ⚠️  Sidecar didn't start — running agent in simulation mode"
  fi
done

# Start robot agent
echo "🤖 Starting Robot Agent (SO-101 profile)..."
cd "$AGENT_DIR"
if [ "$NODE_ENV" = "production" ]; then
  npm run start:so101
else
  npm run dev:so101
fi
