#!/bin/bash

# task-flow-next.sh - Robo Mind App Task Automation
# Usage: ./task-flow-next.sh [task_id]
#   - Without arguments: Gets the next available task
#   - With task_id: Gets the specific task information

# Get script directory and cd there
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Display script name and purpose
echo "🧠 Task Flow - Robo Mind App Task Automation"
echo "--------------------------------------------------------------"
echo "📁 Working directory: $(pwd)"
echo "🔧 Available tools:"
echo "   - Claude CLI: $(which claude || echo 'NOT FOUND')"
echo "   - Task Master: $(which task-master || echo 'NOT FOUND')"
echo "   - Claude Flow: $(which claude-flow || echo 'NOT FOUND')"
echo "--------------------------------------------------------------"

TASK_INFO=""

# Check if task-master is available and .taskmaster directory exists
if [ ! -d ".taskmaster" ]; then
    echo "❌ .taskmaster directory not found"
    echo "📋 Available files:"
    ls -la
    exit 1
fi

# Check if claude-flow is available
if ! command -v claude-flow >/dev/null 2>&1; then
    echo "❌ claude-flow is not installed or not in PATH"
    exit 1
fi

# Check if a task ID was provided as an argument
if [ -n "$1" ]; then
    echo "📋 Getting task information for task ID: $1..."
    TASK_INFO=$(task-master show "$1" 2>/dev/null)
else
    # Get the next task from task-master
    echo "📋 Getting next task from Task Master..."
    TASK_INFO=$(task-master next 2>/dev/null)
fi

# Check if task information was returned
if [ -z "$TASK_INFO" ]; then
    if [ -n "$1" ]; then
        echo "❌ No task found with ID: $1"
    else
        echo "❌ No next task found. All tasks may be completed or in progress."
        echo "📋 Listing all tasks:"
        task-master list 2>/dev/null || echo "Failed to list tasks"
    fi
    echo "💤 Waiting 30 seconds before retrying..."
    sleep 30
    exec "$0" "$@"  # Restart the script
fi

echo "✅ Found task: $TASK_INFO"
echo "🚀 Spawning Claude Flow Hive Mind..."

# Run claude-flow with the task
claude-flow hive-mind spawn "solve the task: $TASK_INFO" \
  --agents 10 \
  --strategy parallel \
  --memory-namespace robo-mind-agent \
  --claude

echo "✅ Task execution completed. Restarting in 60 seconds..."
sleep 60
exec "$0"  # Restart to get next task
