---
id: "TASK-364"
aliases: ["TASK-364"]
title: "k3d E2E reuses clusters safely and the server waits for Postgres"
slug: "k3d-e2e-reuses-clusters-safely-and-the-server-waits-for"
status: "in-progress"
priority: 3
owner: "claude"
projects: []
customers: []
tags: ["core", "testing", "ops"]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "medium"
due_date: ""
created: "2026-10-12"
updated: "2026-10-12"
---

# k3d E2E reuses clusters safely and the server waits for Postgres

## Description

Four rough edges found while running the k3d E2E (TASK-351): a reused cluster
fails `helm upgrade`, `test.sh` can leave a port-forward behind, the server pod
crash-loops twice on a fresh install while Postgres starts, and the in-repo
chart runs RustFS and the aws CLI from `latest`.

## Details

**Current state**

- `scripts/e2e-k3d/install.sh` runs `helm upgrade --install`. Helm 4 applies
  server-side; once someone ran `kubectl set image` on a Deployment of the
  release, the field belongs to the `kubectl-set` manager and the upgrade fails
  with `UPGRADE FAILED: conflict ... .spec.template.spec.containers[name="server"].image`.
- `scripts/e2e-k3d/test.sh` port-forwards the server on `E2E_PORT` (18081). A
  forward left over from an interrupted run keeps the port, and the next run's
  forward fails without a clear message.
- `server` image: `npm run start:prod` = `prisma migrate deploy && node dist/index.js`.
  On a fresh install Postgres is not up yet, `migrate deploy` exits with
  `P1001: Can't reach database server at neodem-postgres:5432`, and the pod
  restarts (twice, measured).
- `helm/neodem/values.yaml` runs `rustfs/rustfs:latest` and `amazon/aws-cli:latest`;
  `test.sh` lists the bucket with `amazon/aws-cli:latest`.

### Scripts (`scripts/e2e-k3d/`)

- `install.sh`: pass `--force-conflicts` when the installed helm supports it
  (Helm 4, server-side apply); Helm 3 merges client-side and needs nothing.
- `test.sh`: refuse to start when the port is already bound (name the PID),
  and on exit/INT/TERM kill the port-forward and wait for it.
- `test.sh` lists the bucket with the aws-cli image the chart renders, not `latest`.
- README documents both, and that `E2E_CLUSTER` gives a run its own cluster.

### Server

- `server/scripts/start-prod.sh` retries `prisma migrate deploy` with backoff
  while the database is unreachable (P1001), up to `DB_WAIT_TIMEOUT` seconds
  (default 120), fails at once on any other migration error, then `exec`s node.
  `start:prod` and the Dockerfile `CMD` use it, so the production chart in the
  `deployments` repo gets it without a chart change.

### Helm (`helm/neodem/`)

- `server-deployment.yaml`: a `wait-for-postgres` initContainer (`pg_isready`,
  postgres image) when Postgres is in-cluster or external.
- `values.yaml`: `rustfs/rustfs:1.0.0`, `amazon/aws-cli:2.37.4` — the newest
  releases at least two weeks old on 2026-10-12.

## Acceptance Criteria

- [ ] `install.sh` succeeds on a reused cluster after `kubectl set image` changed the server Deployment
- [ ] `test.sh` leaves no process listening on `E2E_PORT` after it exits, passing or failing
- [ ] a fresh install's server pod reaches Ready with 0 restarts
- [ ] `helm/neodem` renders no `:latest` image for RustFS or the aws CLI
- [ ] `scripts/e2e-k3d/run.sh --down` passes with `E2E_CLUSTER` set to a cluster of its own

## Test Strategy

`E2E_CLUSTER=neodem-e2e-t364 scripts/e2e-k3d/run.sh` (fresh), check the
server's restart count; `kubectl set image` the server Deployment, run
`run.sh --down` again on the same cluster; `lsof -iTCP:18081` afterwards.
`helm template helm/neodem | grep image:`.
