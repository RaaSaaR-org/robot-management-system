# k3d end-to-end test (TASK-351)

Deploys NeoDEM into a local [k3d](https://k3d.io) cluster **the way production
runs it** — the production Helm chart from the `deployments` repo, images built
from this checkout, a real RustFS StatefulSet with the chart's bucket-init Job —
and proves the HuggingFace dataset import works end to end against it.

```bash
scripts/e2e-k3d/run.sh          # up → install → test; cluster stays up afterwards
scripts/e2e-k3d/run.sh --down   # same, then delete the cluster whatever the outcome
scripts/e2e-k3d/down.sh         # delete the cluster
```

`run.sh` exits non-zero on the first failing stage and prints per-stage timings.

## What it checks

`test.sh`, against the running cluster:

1. `/health` reports `dependencies.storage` configured and `ready`.
2. `POST /api/datasets/import/huggingface` for a small public LeRobot v3.0
   dataset answers `202`.
3. The dataset row reaches `ready` — not `failed`.
4. Every `meta/` and `data/` file the Hub lists at the pinned commit is an
   object under the row's `storagePath` in the `training-datasets` bucket, with
   the Hub's size. Listed from inside the cluster with the aws CLI, using the
   server's own endpoint and credentials.
5. The episodes and frames endpoints serve what is in those objects. Until
   TASK-354 both endpoints answered `200` with **synthetic** data when they
   could not read storage; they now fail with a non-2xx instead, and the test
   still checks content: the episode lengths sum to the Hub's `total_frames`,
   and episode 0 serves exactly as many frames as its metadata says, read from
   parquet (the server logs it).

A bucket-list drift test runs with the normal server suite, no cluster needed:
`server/src/storage/__tests__/bucket-provisioning.test.ts` fails when a bucket
in the server's `BUCKETS` map is missing from `rustfs.buckets` in either chart.

## Prerequisites

- Docker Desktop with ~8 GB of memory. The cluster uses about 2 GB; the image
  builds run one at a time.
- `kubectl`, `helm`, `jq`, `curl`.
- `k3d`, installed without sudo:

  ```bash
  mkdir -p ~/.local/bin
  curl -fsSL -o ~/.local/bin/k3d \
    https://github.com/k3d-io/k3d/releases/download/v5.9.0/k3d-darwin-$(uname -m | sed 's/x86_64/amd64/')
  chmod +x ~/.local/bin/k3d
  ```

  The scripts put `~/.local/bin` on `PATH` themselves.
- The `deployments` repo checked out next to this one (`../deployments`). It is
  only read: the chart is passed to `helm` by path.
- Egress to `huggingface.co`, from the laptop and from the cluster.

## The pieces

| File | Does |
|------|------|
| `up.sh` | creates cluster `neodem-e2e` (traefik and metrics-server off), builds `neodem-{server,app,robot-agent}:e2e-<sha>[-dirty]` like `build-images.yml`, `k3d image import`s them |
| `install.sh` | `helm upgrade --install` of the production chart with `values-k3d.yaml` and the local image tags |
| `values-k3d.yaml` | only what a laptop cannot provide: `local-path` storage, no HTTPRoute, no pull secret, VLA off, one robot, no demo seed Job. Resource limits stay as production has them |
| `test.sh` | the assertions above, over a port-forward to the server |
| `down.sh` | deletes the cluster; `E2E_PRUNE_IMAGES=1` also removes the images |
| `lib.sh` | shared settings |

## Knobs

| Variable | Default | |
|----------|---------|--|
| `NEODEM_CHART` | `<main checkout>/../deployments/neoDEM` | chart to install |
| `E2E_DATASET` | `lerobot/svla_so101_pickplace` | Hub dataset; ~450 KB without videos |
| `E2E_INCLUDE_VIDEOS` | `0` | `1` imports the mp4s too (~86 MB for the default) |
| `E2E_COMPONENTS` | `server app robot-agent` | images `up.sh` builds |
| `E2E_IMAGE_TAG` | `e2e-<git sha>[-dirty]` | |
| `E2E_PORT` | `18081` | local port of the server port-forward |
| `E2E_IMPORT_TIMEOUT` | `300` | seconds to wait for `ready` |
| `E2E_CLUSTER` / `E2E_NAMESPACE` / `E2E_RELEASE` | `neodem-e2e` / `neodem` / `neodem` | |

## Poking at a running cluster

```bash
kubectl --context k3d-neodem-e2e -n neodem get pods
kubectl --context k3d-neodem-e2e -n neodem logs deploy/neodem-server -f
kubectl --context k3d-neodem-e2e -n neodem port-forward svc/neodem-app 18080:80   # the UI
```
