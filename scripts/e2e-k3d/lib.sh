# shellcheck shell=bash
# @file lib.sh
# @description Shared settings and helpers for the k3d end-to-end scripts (TASK-351).
#
# Sourced, never run. Every knob is an environment variable with a default, so
# a run needs no flags: `scripts/e2e-k3d/run.sh`.

E2E_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$E2E_DIR/../.." && pwd)"

# k3d lands in ~/.local/bin when installed without sudo (see README).
export PATH="$HOME/.local/bin:$PATH"

CLUSTER="${E2E_CLUSTER:-neodem-e2e}"
NAMESPACE="${E2E_NAMESPACE:-neodem}"
RELEASE="${E2E_RELEASE:-neodem}"
KUBE_CONTEXT="k3d-$CLUSTER"

# The production chart lives in the separate `deployments` repo. Read-only:
# the scripts only ever pass it to `helm` by path. It sits next to the MAIN
# checkout, which is not REPO_ROOT when this runs from a git worktree.
MAIN_CHECKOUT="$(dirname "$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo "$REPO_ROOT/.git")")"
NEODEM_CHART="${NEODEM_CHART:-$MAIN_CHECKOUT/../deployments/neoDEM}"
VALUES_FILE="$E2E_DIR/values-k3d.yaml"

# One tag per checkout state, so a rebuilt image is a new tag and `helm
# upgrade` rolls the pods instead of keeping the old image under the same name.
image_tag() {
  if [ -n "${E2E_IMAGE_TAG:-}" ]; then echo "$E2E_IMAGE_TAG"; return; fi
  local sha
  sha="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo local)"
  if [ -n "$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null)" ]; then
    # A hash of the uncommitted changes, not a bare "-dirty": two different
    # dirty trees must not share a tag, or the second build's pods never roll.
    local dirty
    dirty="$( { git -C "$REPO_ROOT" diff HEAD
                (cd "$REPO_ROOT" && git ls-files -o --exclude-standard -z | xargs -0 shasum 2>/dev/null)
              } | shasum | cut -c1-8)"
    sha="$sha-dirty-$dirty"
  fi
  echo "e2e-$sha"
}

log()  { printf '\033[1;34m[e2e]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[e2e] PASS\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[e2e] FAIL\033[0m %s\n' "$*" >&2; exit 1; }

need() {
  command -v "$1" >/dev/null 2>&1 || fail "'$1' not found on PATH${2:+ — $2}"
}

# The third-party images the chart renders with values-k3d.yaml, one per line
# (everything but the neodem-* images built from this checkout).
chart_images() {
  helm template e2e "$NEODEM_CHART" -f "$VALUES_FILE" \
    | sed -nE 's/^[[:space:]]*image:[[:space:]]*"?([^"[:space:]]+)"?.*/\1/p' \
    | grep -v -E '(^|/)neodem-' | sort -u
}

kc() { kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" "$@"; }

# Seconds since the epoch, for the timings run.sh prints.
now() { date +%s; }
