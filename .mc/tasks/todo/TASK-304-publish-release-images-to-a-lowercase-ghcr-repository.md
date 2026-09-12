---
id: "TASK-304"
aliases: []
title: "Publish release images to a lowercase GHCR repository"
slug: "publish-release-images-to-a-lowercase-ghcr-repository"
status: "in-progress"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: ["core", "ci"]
sprint: ""
parent: ""
depends_on: []
spe: 2
effort: "low"
due_date: ""
created: "2026-09-12"
updated: "2026-09-12"
---

# Publish release images to a lowercase GHCR repository

## Description

Every container image build in `release.yml` fails before it starts, because
the image repository is spelled `ghcr.io/RaaSaaR-org/neodem-*` and GHCR refuses
a repository name containing an uppercase letter. The v2026.09.12 release tagged
and published its GitHub Release and then published **no images at all**. Spell
the owner lowercase, in one place that every reference reads.

## Details

### Current state

`.github/workflows/build-images.yml` names the repository five times, each by
interpolating `${{ github.repository_owner }}` — which is `RaaSaaR-org`:

| Job | Line | Use |
| --- | ---- | --- |
| `build` | `images:` | `docker/metadata-action` |
| `build` | `outputs:` | `docker/build-push-action`, `push-by-digest=true` |
| `merge` | `images:` | `docker/metadata-action` |
| `merge` | `imagetools create` | the manifest list |
| `merge` | `imagetools inspect` | the verification |

`docker/metadata-action` lowercases whatever it is handed, so the two `images:`
uses have always worked. The other three do not, and the push is one of them:

```
#20 ERROR: failed to parse ref "ghcr.io/RaaSaaR-org/neodem-server":
    invalid reference format: repository name (RaaSaaR-org/neodem-server) must be lowercase
```

**This is a regression from #259** (`07cb1280`, 2026-08-28), which split each
component's build into one job per architecture. Before it, the push used
`tags: ${{ steps.meta.outputs.tags }}` — metadata-action's already-lowercased
output. #259 replaced that with a hand-written `outputs: type=image,name=…`
string carrying the raw owner. v2026.09.12 is the first release since, so this
is the first time it has fired: nothing has been published to GHCR since
v2026.08.27, and `latest` still points at that release for `app` and `server`
and at v2026.08.09 for `robot-agent`.

Everywhere else in the repo the name is already correct and lowercase —
`README.md:489-492`, `docs/deployment.md:44-46`, and the four
`helm/neodem/values.yaml` `repository:` keys (141, 181, 220, 252). Those are
what a cluster actually pulls, so the workflow is the only thing out of step.

### Key files

- `.github/workflows/build-images.yml` — add a `Compute the image repository`
  step to **both** jobs, writing `IMAGE=ghcr.io/<owner lowercased>/neodem-<component>`
  to `$GITHUB_ENV`, and replace all five references with `${{ env.IMAGE }}`.
  Lowercase only the value, never the whole `KEY=value` line: the existing
  `Normalise platform for artifact names` step can pipe its line through `tr`
  because `PLATFORM_PAIR` has no `/` in it, but `tr '[:upper:]' '[:lower:]'` on
  a whole line would also lowercase the variable name.
- Nothing else. Helm, the docs and the README are already lowercase.

## Acceptance Criteria

- [ ] `grep -c 'github.repository_owner' .github/workflows/build-images.yml` is 2
      — one computation per job, and no other reference to the raw owner.
- [ ] Both `build` and `merge` compute `IMAGE` before their first use of it.
- [ ] A `workflow_dispatch` run of `Build Container Images` with
      `version: 2026.09.12` pushes all six per-arch images and all three
      manifest lists, and `Inspect published manifest` prints two platforms per
      component.
- [ ] `ghcr.io/raasaar-org/neodem-{app,server,robot-agent}:2026.09.12` and
      `:latest` all resolve, and `latest` is the same digest as `2026.09.12` for
      all three — closing the skew #259's own comment describes.

## Test Strategy

The workflow cannot be tested without running it; the check is the run itself.
After merge, dispatch `Build Container Images` on `main` with
`version: 2026.09.12` — the workflow-only diff means the images carry the
release's application code — and confirm the acceptance criteria above with
`docker buildx imagetools inspect`.

## Notes

The v2026.09.12 tag and GitHub Release are already published and correct; only
the images are missing. `on: push: tags` cannot be replayed for a tag that
already exists, which is why the recovery path is `workflow_dispatch` with an
explicit `version`.
