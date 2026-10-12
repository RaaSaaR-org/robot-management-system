#!/usr/bin/env bash
# @file up.sh
# @description Create the k3d cluster and load images built from this checkout (TASK-351).
#
# Images are built the way .github/workflows/build-images.yml builds them: one
# context per component directory, and the app with same-origin API URLs so
# nginx proxies /api to the server. Built one at a time — three parallel
# builds do not fit in Docker Desktop's ~8 GB alongside a cluster.
#
# E2E_COMPONENTS limits what is built (default: "server app robot-agent").
set -euo pipefail
source "$(dirname "$0")/lib.sh"

need docker
need k3d "install it without sudo, see scripts/e2e-k3d/README.md"
need kubectl

TAG="$(image_tag)"
COMPONENTS="${E2E_COMPONENTS:-server app robot-agent}"

if k3d cluster list "$CLUSTER" >/dev/null 2>&1; then
  log "cluster $CLUSTER already exists — reusing it"
else
  log "creating cluster $CLUSTER (1 server, no agents, traefik off)"
  # Traefik is off: production exposes the app through an Envoy HTTPRoute,
  # which values-k3d.yaml disables; the test reaches the server by port-forward.
  k3d cluster create "$CLUSTER" \
    --servers 1 --agents 0 \
    --k3s-arg '--disable=traefik@server:0' \
    --k3s-arg '--disable=metrics-server@server:0' \
    --wait --timeout 180s
fi

for c in $COMPONENTS; do
  args=()
  if [ "$c" = app ]; then
    args+=(--build-arg VITE_API_BASE_URL=/api --build-arg VITE_WS_URL=/api/a2a/ws --build-arg VITE_A2A_SERVER_URL=)
  fi
  log "building neodem-$c:$TAG"
  start=$(now)
  docker build -q -t "neodem-$c:$TAG" "${args[@]}" "$REPO_ROOT/$c" >/dev/null
  log "built neodem-$c in $(( $(now) - start ))s"
done

images=()
for c in $COMPONENTS; do images+=("neodem-$c:$TAG"); done

# The third-party images the chart runs (postgres, nats, rustfs, aws-cli,
# busybox), read off the rendered chart. Pulled through the HOST's Docker and
# imported, because the cluster's own image cache dies with the cluster: left
# to the node, every run re-downloads ~600 MB, and the first run measured over
# ten minutes of pulls — past helm's --wait, so the bucket-init hook never ran.
# `docker pull` of a cached tag only checks the digest, so `latest` (RustFS)
# still tracks upstream the way production's IfNotPresent pull does on a fresh
# node, for whatever the chart leaves unpinned.
if [ -f "$NEODEM_CHART/Chart.yaml" ]; then
  while read -r img; do
    log "pulling $img"
    docker pull -q "$img" >/dev/null
    images+=("$img")
  done < <(chart_images)
fi
# Saved to a tarball for ONE platform, then imported. A pulled image is a
# multi-arch index whose other platforms' layers Docker (containerd store)
# never downloaded; `k3d image import <name>` saves the whole index, ctr then
# fails on the first missing digest — and k3d still reports "Successfully
# imported" (measured: v5.9.0). Hence the explicit platform and the check below.
PLATFORM="$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}')"
TARBALL="$(mktemp -d)/images.tar"
log "saving ${#images[@]} images for $PLATFORM"
docker save --platform "$PLATFORM" -o "$TARBALL" "${images[@]}"
log "importing into $CLUSTER"
k3d image import --cluster "$CLUSTER" "$TARBALL"
rm -rf "$(dirname "$TARBALL")"

node="k3d-$CLUSTER-server-0"
for img in "${images[@]}"; do
  ref="$img"; [[ "$ref" == */* ]] || ref="docker.io/library/$ref"; [[ "${ref%%/*}" == *.* ]] || ref="docker.io/$ref"
  docker exec "$node" crictl inspecti "$ref" >/dev/null 2>&1 || fail "$img is not in the cluster after import"
done

ok "cluster $CLUSTER is up with images tagged $TAG"
