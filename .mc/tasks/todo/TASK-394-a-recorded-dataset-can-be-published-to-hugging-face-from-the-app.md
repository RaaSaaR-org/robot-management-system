---
id: "TASK-394"
aliases: []
title: "A recorded dataset can be published to Hugging Face from the app"
slug: "a-recorded-dataset-can-be-published-to-hugging-face-from-the-app"
status: "review"
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: []
spe: 8
effort: "high"
due_date: "2026-10-18"
created: "2026-10-17"
updated: "2026-10-17"
---

# A recorded dataset can be published to Hugging Face from the app

## Description

The real-robot test on 2026-10-18 collects teleop data on the Unitree G1 EDU (Dex3-1)
through NeoDEM, and the team wants that data on the Hugging Face Hub the same day.
Today the only "push to hub" path is broken on every machine but one and asks the
operator to paste a token into the browser. A recorded dataset must be publishable
from the app — from the completed-session view and from the dataset detail page —
with the server's own Hub credentials, a generated dataset card, live progress and
the final link, straight from the dataset directory on local disk.

## Details

### Current state

- Agent-recorded sessions write a LeRobot v3.0 dataset to
  `robot-agent/data/workspace-<robotId>/datasets/<sessionId>/` (`meta/`, `data/`,
  `videos/`, plus NeoDEM's own `neodem-episodes.json`). `TeleoperationService.registerAgentDataset`
  (`server/src/services/TeleoperationService.ts`) registers it as a `Dataset` row with the
  absolute directory as `storagePath` and `status: 'ready'`.
- `POST /api/datasets/:id/push-to-hub` and `GET /api/datasets/:id/push-status`
  (`server/src/routes/datasets.routes.ts`) spawn `server/scripts/hf_push_dataset.py` with a
  hardcoded interpreter `/home/mindcube/miniconda3/envs/lerobot312/bin/python` (another
  machine), read the files from RustFS only (down on every dev box, and agent datasets are
  never in it), and take the Hub token in the request body. No dataset card, no audit entry,
  no degraded-data gate.
- The app's `HFPushModal` (`app/src/features/training/components/HFPushModal.tsx`) asks the
  operator for a token. `SessionCompleted.tsx` has no publish action at all.
- `HuggingFaceImportService` reads only public repos and has no token convention to reuse;
  `CosmosSyntheticService` reads `HF_TOKEN` from the environment.
- The box running the server is logged in to the Hub (`hf auth login`, token in
  `~/.cache/huggingface/token`) as `huhn511`, member of org `zemarobotik`.

### Decisions

- **Client: `@huggingface/hub` (JS), pinned.** It needs no system install, ships with the
  server image and the Helm chart unchanged, and does LFS/Xet uploads and per-file progress
  itself. The Python alternative depends on a venv that exists on one box (the curation
  venv has no `huggingface_hub`; the `hf` CLI lives in a uv tool env) and on a Python in the
  container image.
- **Token**: `HF_TOKEN` env, else the file at `HF_TOKEN_PATH`, else `$HF_HOME/token`, else
  `~/.cache/huggingface/token`. Never returned, never logged; any error text is scrubbed of it.
- **Status without a schema change.** The job (phase, bytes, files, commit, URL, error) is kept
  in memory per dataset; on success the repo id is written to `Dataset.huggingFaceRepoId`
  unless the row is a Hub import (its `huggingFaceRepoId` is the *source* and stays). Start and
  outcome are filed in the compliance log through `DatasetService.auditDatasetAction`
  (`publish.huggingface.start` / `publish.huggingface`), which is the durable record.
- **The legacy push route, script and modal are removed**, replaced by the publish route and
  dialog — two paths to the same thing, one of which cannot work here.
- **Gates**: 404 unknown dataset; 409 `DATASET_NOT_READY` unless `status: ready`; 409
  `DATASET_DEGRADED` when its last validation found errors or a robot-type change invalidated
  it, unless `force: true`; 409 `DATASET_IS_VIEW` for a view; 409 `DATASET_NOT_LOCAL` when the
  directory is not on this server's disk; 503 `HF_TOKEN_MISSING`; 403 `NAMESPACE_FORBIDDEN`
  when the token's user is neither the namespace nor a member of it; 409 `PUBLISH_IN_PROGRESS`.
  RBAC follows the other dataset writes: the `writeRoleGuard` on `/api/datasets` (member or
  above).
- **Idempotent**: re-publishing to the same repo makes a new commit; the repo is created only
  when it does not exist (`private` and `license` apply at creation).
- **Dataset card**: a `README.md` in the dataset directory is uploaded as is. Otherwise a
  LeRobot-style card is generated (YAML front matter with license, `task_categories: robotics`,
  tags incl. `LeRobot`, `neodem`, the robot type; `configs` pointing at `data/*/*.parquet`;
  body with task instructions, robot type, fps, episodes, frames, cameras, features,
  real-vs-simulated provenance, NeoDEM/ZeMA attribution, license). A Hub card that NeoDEM did not
  generate (no marker comment) is never overwritten.

### Server

- `POST /api/datasets/:id/publish` — body `{ repoId, private = true, license = "apache-2.0",
  tags = [], description?, force = false }`. `repoId` is `<namespace>/<name>`; a bare name gets
  the default namespace (`HF_PUBLISH_NAMESPACE`, else the token's user — no organisation name is
  hardcoded; the lab box sets `HF_PUBLISH_NAMESPACE=zemarobotik`). Validated with zod
  (400 naming the field). Answers 202 with the job.
- `GET /api/datasets/:id/publish` — the current or last job, else `{ status: 'none' }` or, for a
  dataset published before a restart, `{ status: 'done', url }` from `huggingFaceRepoId`.
- `GET /api/datasets/publish/status` — `{ configured, source, user, orgs, defaultNamespace,
  error? }` via `whoAmI` (cached 60 s). Never the token.
- Uploads `meta/**`, `data/**`, `videos/**` (+ the card) from the local directory; RustFS is not
  involved.

### Frontend

- `PublishDatasetDialog` (`app/src/features/training/components/`) replaces `HFPushModal`:
  account line from `/publish/status` (or how to configure a token), repo id prefilled
  `<defaultNamespace>/<slug of dataset name>`, private switch default on, license select, tags,
  optional description, "Publish anyway" when the server answers `DATASET_DEGRADED`; then a
  progress bar (phase, files, bytes) and the final link.
- Wired on the dataset detail (`DatasetEpisodesPage.tsx`), the datasets list (`DatasetsPage.tsx`)
  and the completed-session dataset card (`SessionCompleted.tsx`).

### Key files

- `server/src/services/HuggingFacePublishService.ts` (new)
- `server/src/services/huggingface/datasetCard.ts` (new)
- `server/src/routes/datasets.routes.ts`
- `server/src/types/dataset.types.ts`
- `server/package.json`, `server/package-lock.json` (`@huggingface/hub`)
- `server/scripts/hf_push_dataset.py` (removed)
- `server/src/__tests__/dataset-push-routes.test.ts` (replaced by `dataset-publish-routes.test.ts`)
- `server/src/services/__tests__/HuggingFacePublishService.test.ts` (new)
- `app/src/features/training/components/PublishDatasetDialog.tsx` (new; `HFPushModal.tsx` removed)
- `app/src/features/training/api/trainingApi.ts`, `app/src/features/training/types/`
- `app/src/features/training/pages/DatasetEpisodesPage.tsx`, `DatasetsPage.tsx`
- `app/src/features/datacollection/components/session/SessionCompleted.tsx`
- `docs/huggingface-publish.md` (new), `server/.env.example`

## Acceptance Criteria

- [x] `POST /api/datasets/:id/publish` uploads a local LeRobot dataset's `meta/`, `data/`,
      `videos/` and a dataset card to a Hub dataset repo, creating it (private by default) only
      when it does not exist; a second publish makes a new commit
      — `HuggingFacePublishService.ts` `run()` (repoExists/createRepo, uploadFilesWithProgress);
      review added the LeRobot codebase-version tag on the commit (`replaceTag`), without which
      `LeRobotDataset(repo_id)` refuses the repo
- [x] The token comes from `HF_TOKEN` / `HF_TOKEN_PATH` / `$HF_HOME/token` /
      `~/.cache/huggingface/token`, never from the request, and never appears in a response or log
      — `resolveToken()`, `scrubToken()` on every kept/logged error; the zod schema is `.strict()`
- [x] `GET /api/datasets/publish/status` says whether a token is configured and which Hub user
      — `getStatus()`, route in `datasets.routes.ts`
- [x] Not-ready, degraded (without `force`), view, non-local datasets, missing token, a foreign
      namespace and a concurrent publish are refused with the codes above; bad input is 400
      — `publish()`/`start()`; review closed a double-click race (two starts in one tick both passed
      the in-progress check across the awaits)
- [x] Progress (phase, files, bytes) and the final URL are readable from `GET /api/datasets/:id/publish`;
      a failure keeps its reason — `getJob()`, `job.error`
- [x] Start and outcome of each publish are in the compliance log
      — `publish.huggingface.start` / `publish.huggingface` via `auditDatasetAction`
- [x] A generated card names the task instructions, robot type, fps, episodes, frames, cameras,
      features, real/sim provenance, NeoDEM/ZeMA attribution and license; a hand-written card is kept
      — `huggingface/datasetCard.ts`; provenance reads `info._neodem.simulated`, so it is only as
      right as the recorder that writes it
- [x] The app's "Publish to Hugging Face" dialog is on the completed-session view and the dataset
      detail page, private by default, shows progress and the link — `PublishDatasetDialog.tsx`,
      `SessionCompleted.tsx` (`publish-dataset`), `DatasetEpisodesPage.tsx`, `DatasetsPage.tsx`
- [x] Server and app vitest cover it with the Hub client mocked — no network, no repo created
      — `HuggingFacePublishService.test.ts` (fake client; the real client and `fetch` both rigged
      to throw), `dataset-publish-routes.test.ts`, `PublishDatasetDialog.test.tsx`,
      `SessionCompleted.test.tsx`

## Test Strategy

- Server vitest: service tests with an injected fake Hub client over a fixture dataset in a temp
  dir (file set, card, private default, existing-repo path, namespace check, token scrubbing,
  degraded gate, card preservation); route tests with supertest for validation and error codes.
- App vitest: the dialog prefilled from status + dataset name, private on by default, submit body,
  progress → link, degraded → "Publish anyway", no-token state.
- Typecheck server and app.
- Manual (not in CI, needs the real Hub): publish a small sim dataset to a private
  `zemarobotik/neodem-smoke-*` repo from the app and open the link.
