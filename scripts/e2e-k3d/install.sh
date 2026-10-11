#!/usr/bin/env bash
# @file install.sh
# @description Helm-install the production NeoDEM chart into the k3d cluster (TASK-351).
#
# The chart is read from NEODEM_CHART (default ../deployments/neoDEM) by path
# and never modified. values-k3d.yaml swaps only what a laptop cannot provide;
# the image tags follow the checkout and are set here.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

need helm
need kubectl
[ -f "$NEODEM_CHART/Chart.yaml" ] || fail "no chart at $NEODEM_CHART — set NEODEM_CHART"

TAG="$(image_tag)"
TIMEOUT="${E2E_INSTALL_TIMEOUT:-15m}"

log "installing $NEODEM_CHART as $RELEASE into $KUBE_CONTEXT/$NAMESPACE (images $TAG)"
start=$(now)
# --wait covers the Deployments/StatefulSets; the post-install hook (RustFS
# bucket init) runs after that and helm waits for it as well.
helm upgrade --install "$RELEASE" "$NEODEM_CHART" \
  --kube-context "$KUBE_CONTEXT" \
  --namespace "$NAMESPACE" --create-namespace \
  -f "$VALUES_FILE" \
  --set server.image.repository=neodem-server \
  --set server.image.tag="$TAG" \
  --set app.image.repository=neodem-app \
  --set app.image.tag="$TAG" \
  --set robotAgent.image.repository=neodem-robot-agent \
  --set robotAgent.image.tag="$TAG" \
  --wait --timeout "$TIMEOUT" || {
    log "helm install failed — pod state:"
    kc get pods -o wide || true
    kc get events --sort-by=.lastTimestamp | tail -25 || true
    exit 1
  }

kc get pods
ok "release $RELEASE installed in $(( $(now) - start ))s"
