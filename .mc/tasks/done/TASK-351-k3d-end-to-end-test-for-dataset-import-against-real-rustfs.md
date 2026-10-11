---
id: "TASK-351"
aliases: ["TASK-351"]
title: "k3d end-to-end test for dataset import against real RustFS"
slug: "k3d-end-to-end-test-for-dataset-import-against-real-rustfs"
status: "done"
priority: 2
owner: "claude"
projects: []
customers: []
tags: ["core", "storage", "testing"]
sprint: ""
parent: ""
depends_on: []
spe: 5
effort: "high"
due_date: ""
created: "2026-10-12"
updated: "2026-10-12"
---

# k3d end-to-end test for dataset import against real RustFS

## Description

The HuggingFace dataset import broke in production (https://neodem.emai.dev)
against a real RustFS, and nothing short of a cluster reproduces that: unit
tests mock the S3 client. This adds a repeatable local E2E that deploys NeoDEM
into a k3d cluster the way production does — the production Helm chart, the
images built from the current checkout, a real RustFS StatefulSet — and proves
an HF import lands in RustFS and reads back through the API.

## Details

**Current state:** production is installed from the Helm chart in the separate
`deployments` repo (`deployments/neoDEM`, a fork of `helm/neodem` with a
cinder-iscsi storage class, an Envoy `HTTPRoute` and a demo seed Job). Recent
fixes on `main` touching this path: #369 (RustFS client retries after a failed
start), #371 (HF import answers 503 on an unusable sink, prepares storage
before metadata), #373 (`/health` reports storage status).

### Scripts — `scripts/e2e-k3d/`

- `up.sh` — create a one-node k3d cluster, build `server`, `app` and
  `robot-agent` images from the checkout (same contexts and app build args as
  `.github/workflows/build-images.yml`), `k3d image import` them.
- `install.sh` — `helm upgrade --install` the `deployments/neoDEM` chart **by
  path, read-only** (`NEODEM_CHART`, default `../deployments/neoDEM`) with
  `scripts/e2e-k3d/values-k3d.yaml`: `local-path` storage class, no HTTPRoute,
  VLA off, demo seed off, small resources, local image tags, no pull secret.
- `test.sh` — the E2E: wait for `/health` with storage ok → `POST
  /api/datasets/import/huggingface` for a small public LeRobot dataset → poll
  `GET /api/datasets/:id` to a terminal status → list the objects under the
  dataset's prefix in the `training-datasets` bucket with the aws CLI in a
  throwaway pod → read the dataset and its episodes back through the API.
- `down.sh` — delete the cluster.
- `run.sh` — up → install → test, non-zero on any failure, prints timings.
- `README.md` — prerequisites (k3d, kubectl, helm, Docker ~8 GB), usage, knobs.

### Bucket drift check

A server unit test asserts every bucket in `BUCKETS`
(`server/src/storage/model-storage.ts`) is in `rustfs.buckets` of
`helm/neodem/values.yaml` **and** `../deployments/neoDEM/values.yaml` (skipped
when that path is absent, e.g. in CI). The server never creates buckets, so a
missing one fails its feature only at runtime.

**Key files:** `scripts/e2e-k3d/*`, `server/src/storage/__tests__/`,
`helm/neodem/values.yaml`.

## Acceptance Criteria

- [x] `scripts/e2e-k3d/run.sh` builds, deploys and runs the E2E on a Mac with
      Docker Desktop (~8 GB) and exits 0 when the import works.
- [x] The E2E asserts the imported files exist as objects in RustFS, not just
      that the row says `ready`.
- [x] The bucket drift test fails when a `BUCKETS` entry is missing from either
      chart and skips the deployments chart when it is not checked out.
- [x] `down.sh` leaves no cluster behind.

## Test Strategy

Run `scripts/e2e-k3d/run.sh` end to end and `scripts/e2e-k3d/down.sh`; run the
server vitest suite for the drift test.

## Notes

### Results (2026-10-12, Mac arm64, Docker Desktop 7.7 GiB, k3d v5.9.0)

On `main` @ a5a9db6d plus this branch, against `rustfs/rustfs:latest` and the
production chart, the HF import into RustFS **works**:

- `lerobot/svla_so101_pickplace`, metadata only: 5 objects, `ready` in 2 s.
- same with videos: 7 objects (~86 MB), `ready` in 4 s.
- `nvidia/GR00T-N1.7-AppleToPlate` (the production demo import), metadata
  only: 407 objects (~78 MB), `ready` in 36 s, every size matches the Hub.

So the production import failure does not reproduce with today's `main`
(#369/#371/#373 included) — it was most likely fixed by those, or depends on
something the cluster has and k3d does not (see open questions below).

Full `run.sh --down` on a fresh cluster with a warm Docker cache: **103 s**
(up 46 s, install 49 s, test 8 s), exit 0, cluster deleted afterwards. A cold
first run adds the image builds (server 128 s, app and robot-agent ~5 min
together) and the first pulls of postgres/nats/rustfs/aws-cli.

### Bugs found

1. **Image UID ≠ chart UID — fixed here.** `server/Dockerfile` and
   `robot-agent/Dockerfile` created their own user, UID 1001, and `chown`ed
   `/app` to it; both charts run every pod as UID 1000
   (`securityContext.runAsUser`). Nothing under `/app` was writable in the
   cluster: the robot agent built from `main` crash-loops at boot
   (`EACCES: permission denied, mkdir '/app/data/workspace-g1-01'`), and the
   server's local-disk paths (TASK-350's callers, the pre-#371 importer
   fallback) fail the same way. Fixed by running as the base image's `node`
   user (UID/GID 1000) and creating `/app/data` in the image.
2. **`helm/neodem` did not provision 4 of the 8 buckets** (`sensor-scans`,
   `digital-twins`, `incident-clips`, `patrol-photos`) — fixed here, and held
   down by `bucket-provisioning.test.ts`. `deployments/neoDEM` lists all 8.
3. **Not fixed — episodes/frames of a RustFS dataset are synthetic unless it
   is v3.0 with a single file per chunk.** `server/src/routes/datasets.routes.ts:992`
   reads only `meta/episodes/chunk-000/file-000.parquet` and `:1105` only
   `data/chunk-NNN/file-000.parquet`. A v2.1 dataset (the production demo
   dataset GR00T-N1.7-AppleToPlate: `episodes.jsonl`,
   `episode_NNNNNN.parquet`) or a v3.0 dataset split into `file-001…` falls
   to the fallbacks at `:1033` and `:1139`, which answer 200 with equal
   episode lengths (402 × 426 frames instead of the real lengths summing to
   171625) and sine-wave frames. Repro: `E2E_DATASET=nvidia/GR00T-N1.7-AppleToPlate
   scripts/e2e-k3d/test.sh` fails at the episodes check. Tracked as [[TASK-354]].

### Open questions / not covered

- The production chart's `rustfs-init` Job swallows `aws s3 mb` failures
  (`|| echo "Bucket … already exists"`), so a bucket that could not be created
  looks the same as one that exists. Worth checking `kubectl logs job/…-init`
  on the cluster.
- The production chart sets `RUSTFS_ROOT_USER`/`RUSTFS_ROOT_PASSWORD`; it works
  only while the credentials equal RustFS's defaults (`rustfsadmin`). Not
  verified against newer RustFS env names.
- Production pins `rustfs/rustfs:latest` with `IfNotPresent`: the node runs
  whatever `latest` was on its first pull, which k3d cannot reproduce.
