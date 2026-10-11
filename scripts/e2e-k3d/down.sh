#!/usr/bin/env bash
# @file down.sh
# @description Delete the k3d E2E cluster and free its memory (TASK-351).
set -euo pipefail
source "$(dirname "$0")/lib.sh"

need k3d
if k3d cluster list "$CLUSTER" >/dev/null 2>&1; then
  log "deleting cluster $CLUSTER"
  k3d cluster delete "$CLUSTER"
else
  log "cluster $CLUSTER does not exist — nothing to do"
fi

# The images stay in the local Docker cache so the next run builds
# incrementally; `E2E_PRUNE_IMAGES=1` removes them too.
if [ "${E2E_PRUNE_IMAGES:-0}" = 1 ]; then
  docker images --format '{{.Repository}}:{{.Tag}}' \
    | grep -E '^neodem-(server|app|robot-agent):e2e-' \
    | while read -r img; do docker rmi "$img" >/dev/null && log "removed $img"; done
fi
ok "down"
