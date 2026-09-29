---
id: "TASK-312"
aliases: []
title: "Publish immutable SHA-tagged images for every main commit"
slug: "publish-immutable-sha-tagged-images-for-every-main-commit"
status: "done"
priority: 2
owner: "claude"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: []
spe: 2
effort: "low"
due_date: ""
created: "2026-09-30"
updated: "2026-09-30"
---

# Publish immutable SHA-tagged images for every main commit

## Description
NeoDEM Live tracks `main`, but the GitOps repository (`RaaSaaR-org/deployments`) can only deploy image tags that exist in GHCR, and today only releases publish images. Every commit on `main` whose Check run succeeds must publish all three multi-arch images under one shared, immutable tag derived from the commit SHA. GitHub issue [#326](https://github.com/RaaSaaR-org/robot-management-system/issues/326).

## Details

**Current state:** `.github/workflows/build-images.yml` runs on `v*` tags, on `workflow_call` from `.github/workflows/release.yml` (release commits only) and on `workflow_dispatch`. It publishes `vX`, `X` and `latest`. Plain merges to `main` publish nothing. `.github/workflows/check.yml` cancels in-flight runs per ref, so on `main` a quick second merge cancels the first commit's Check.

### CI

- `.github/workflows/main-images.yml` (new): `workflow_run` on **Check**, `completed`, branch `main`. Runs only when the Check run concluded `success`, was a `push` event, and came from this repository. A `resolve` job computes `sha-<first 7 hex chars>` and skips the build when all three images already carry that tag. Otherwise it calls `build-images.yml` with `ref: <head_sha>` and `commit_tag: sha-<short>`.
- `.github/workflows/build-images.yml`: two new `workflow_call` inputs.
  - `ref` — the commit to check out and to write into `org.opencontainers.image.revision` (a `workflow_run` context's `github.sha` is the tip of `main`, not the commit that was checked).
  - `commit_tag` — when set, the manifest gets **only** that tag (no `latest`, no version), and the merge job refuses to overwrite a tag that already exists.
  Release/tag/dispatch behaviour is unchanged.
- `.github/workflows/check.yml`: push runs are grouped per commit SHA and never cancelled, so every merge gets a Check conclusion. PR runs keep cancel-in-progress.

### Docs
- `docs/deployment.md`: document the `sha-<short>` tag next to the release tags.

**Key files:** `.github/workflows/main-images.yml`, `.github/workflows/build-images.yml`, `.github/workflows/check.yml`, `docs/deployment.md`.

## Acceptance Criteria
- [ ] Every successful merge to `main` produces all three compatible multi-arch images (`neodem-app`, `neodem-server`, `neodem-robot-agent`, linux/amd64 + linux/arm64).
- [ ] A single shared immutable tag (`sha-<short-sha>`) identifies the exact source commit; the full SHA is the `org.opencontainers.image.revision` label.
- [ ] A downstream GitOps deployment can resolve and deploy that tag without building from source.
- [ ] No change to release-versioned tags (`vX`, `X`, `latest`).

## Test Strategy
- `actionlint` (or a YAML parse) over the changed workflows.
- After merge: the Main Images run for the merge commit publishes `sha-<short>` on all three packages; `docker buildx imagetools inspect ghcr.io/raasaar-org/neodem-server:sha-<short>` lists amd64 + arm64, and the image config's `org.opencontainers.image.revision` equals the full commit SHA.

## Notes

Decisions made unattended (2026-09-30):
- **Trigger is `workflow_run` on Check**, not a job inside `check.yml`: keeps the gate workflow free of `packages: write` and of the 6-way image build on every PR. Only a `success` conclusion publishes.
- **Tag format is `sha-` + the first 7 hex chars** of the commit SHA — fixed length, so a downstream tool can compute it from the SHA without asking git.
- **Commit builds never move `latest`.** Helm values default to `latest`; letting every merge move it would silently change what a chart install runs. `latest` stays release-only.
- **Immutability is enforced**: the resolve job skips when all three tags exist; the merge job skips any single component whose tag already exists (so a re-run after a partial failure fills the gap without overwriting what was published).
- **Release commits are also built as commits** (they are pushes to `main` too). The release run's version tags are untouched; the commit tag lives on a separately built manifest. Accepted: builds are not bit-reproducible, so `sha-X` and `vY` of the same commit can differ in digest.
- **Check on `main` is no longer cancelled by a newer push** — otherwise a fast second merge would leave the first commit without a successful Check and therefore without images, breaking "every merge".

Validation (2026-09-30): `actionlint` 1.7.12 (Docker image) reports no errors on the changed workflows; the only output is shellcheck notes on lines that already existed. The acceptance criteria can only be observed on `main` after merge (first Main Images run), so they stay unticked until then.
