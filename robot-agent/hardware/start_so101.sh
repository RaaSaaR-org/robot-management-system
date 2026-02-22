#!/bin/bash
# start_so101.sh — Start SO-101 hardware sidecar + Robot Agent + Playwright MCP
# Usage: bash robot-agent/hardware/start_so101.sh

set -e

SIDECAR_PY="$(dirname "$0")/so101_sidecar.py"
LEROBOT_DIR="$HOME/repos/vla-tests/pi05/client"
AGENT_DIR="$(dirname "$0")/.."

echo "🎭 Starting Playwright MCP server..."
playwright-mcp --port 8931 --browser chromium --headless &
PLAYWRIGHT_PID=$!
echo "   Playwright MCP PID: $PLAYWRIGHT_PID"
sleep 2

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
npm run dev:so101

# Cleanup on exit
kill $SIDECAR_PID 2>/dev/null && echo "Sidecar stopped."
kill $PLAYWRIGHT_PID 2>/dev/null && echo "Playwright MCP stopped."
