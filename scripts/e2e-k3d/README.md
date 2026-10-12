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

Give a run a cluster of its own with `E2E_CLUSTER` — two sessions on one
laptop otherwise share `neodem-e2e`, and `--down` deletes it under the other:

```bash
E2E_CLUSTER=neodem-e2e-mine scripts/e2e-k3d/run.sh --down
```

## Reusing a cluster

Without `--down` the cluster stays up, and the next `run.sh` reuses it:
`up.sh` imports the new images, `install.sh` runs `helm upgrade`.

- **A Deployment changed by hand.** Helm 4 applies server-side, so once
  `kubectl set image` (or `kubectl edit`) touched a field, the next upgrade
  failed with `UPGRADE FAILED: conflict ... with "kubectl-set" ...
  .spec.template.spec.containers[name="server"].image`. `install.sh` passes
  `--force-conflicts` whenever the installed helm has it: the chart wins and
  takes those fields back. Helm 3 merges client-side and never hit this.
- **The port-forward.** `test.sh` forwards the server on `E2E_PORT` (18081),
  kills the forward and waits for it on every exit — pass, fail, Ctrl-C — and
  refuses to start when the port is already taken, naming the process holding
  it, instead of talking to whatever answers there.

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
6. Deleting the dataset removes every object under its `storagePath`
   (TASK-359): the bucket listing for that prefix is empty afterwards.

`install.sh` passes a compliance-log key derived from the cluster name. The
production values file ships the public example key, which the server
refuses to start on in production (TASK-359).

### With auth and multi-tenancy on (`E2E_TENANT=1`)

`values-k3d.yaml` runs `AUTH_DISABLED=true`, and the chart has no value for
`MULTI_TENANCY_ENABLED` or the bootstrap admin. So `tenant-test.sh` switches
the installed server over with `kubectl set env` and switches it back when it
exits. `run.sh` runs it after `test.sh` when `E2E_TENANT=1` is set. It takes
about 1.5 minutes, most of it two server rollouts. It checks that:

1. An anonymous API call answers `401`.
2. The bootstrap super-admin (`BOOTSTRAP_ADMIN_EMAIL`/`_PASSWORD`, TASK-367)
   can sign in and list tenants.
3. Each of two onboarded tenants has its owner in its own tenant, flagged for
   a password change. Onboarding a slug a second time answers `409`.
4. The forced password change clears that flag.
5. Tenant A registers the demo robot. Tenant B gets `404` on it for GET,
   telemetry, command and delete, and its robot list is empty.
6. An anonymous WebSocket receives no events while the robot streams. This
   check needs node 22+.

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
| `tenant-test.sh` | auth + multi-tenancy checks, opt-in with `E2E_TENANT=1` |
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
| `E2E_TENANT` | `0` | `1` adds the auth + multi-tenancy stage |
| `E2E_IMPORT_TIMEOUT` | `300` | seconds to wait for `ready` |
| `E2E_AWSCLI_IMAGE` | the aws-cli image the chart renders | image of the bucket-listing pod |
| `E2E_CLUSTER` / `E2E_NAMESPACE` / `E2E_RELEASE` | `neodem-e2e` / `neodem` / `neodem` | `E2E_CLUSTER` also names the kube context, `k3d-<cluster>` |

## Poking at a running cluster

```bash
kubectl --context k3d-neodem-e2e -n neodem get pods
kubectl --context k3d-neodem-e2e -n neodem logs deploy/neodem-server -f
kubectl --context k3d-neodem-e2e -n neodem port-forward svc/neodem-app 18080:80   # the UI
```
