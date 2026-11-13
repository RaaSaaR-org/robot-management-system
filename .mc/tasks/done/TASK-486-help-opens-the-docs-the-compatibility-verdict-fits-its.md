---
id: "TASK-486"
aliases: []
title: "Help opens the docs, the compatibility verdict fits its dialog, and empty states speak to users"
slug: "help-opens-the-docs-the-compatibility-verdict-fits-its"
status: "done"                # backlog | todo | in-progress | review | done | cancelled
priority: 2                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["app", "datasets", "training", "docs", "demo-day"]
sprint: ""
parent: ""
depends_on: []
spe: 8
effort: "medium"
due_date: "2026-11-16"
created: "2026-11-13"
updated: "2026-11-13"
---

# Help opens the docs, the compatibility verdict fits its dialog, and empty states speak to users

## Description

A hands-on browser walkthrough of the demo instance (main at 778e9d80, auth off, three imported
datasets, four robots) found a set of small UI defects that a visitor on demo day (2026-11-16)
runs into within the first minutes. Each is small; together they make the product look unfinished.
This task fixes the bundle, each fix with a test.

## Details

### What was wrong, and the cause found

1. **Help and every "Docs" link opened a blank page.** The docs viewer inlines `docs/**/*.md`
   through `import.meta.glob('../../../../docs/**/*.md')`. The app image is built with the Docker
   context `./app` (`build-images.yml`, `docker-compose.yml`, `scripts/e2e-k3d/up.sh`), so `docs/`
   — a sibling of `app/` — is not in the build, the glob matches nothing, Vite does not treat that
   as an error, `DEFAULT_SLUG` is `''` and `/docs` redirects to `/docs/` with an empty main area.
   Separately, three placeholders in the demo-mode build linked to `docsSlug="VLA-integration-guide"`
   while the file is `vla-integration-guide.md` — "Doc not found".
2. **Compatibility report**: an 826 px table in a 532 px dialog; the Same / Differs column was off
   the right edge and the second dataset's name was cut off.
3. **Generate synthetic** told a visitor to "Check server/curation/cosmos3_synth.py".
4. **Developer jargon in empty states**: Experiments (`POST /api/experiments`), Organizations and
   Team (`MULTI_TENANCY_ENABLED=true`, "Load sample (Acme Robotics)"), `/data-collection/live`
   (`?robot=<robot id>`), Publish to Hugging Face (`hf auth login`), Training ("No workers connected").
5. **Numbers and dates followed the browser locale in 57 call sites**: "69.460 frames" in the
   wizard next to "69,460" in the list; "17.4.2025" next to "Oct 3, 2026" next to "11/13/2026".
6. **Navigation labels and page titles disagreed**: Skill Training -> "Pipeline", Models ->
   "Model Registry", and the Missions row opened pages that never said Missions.
7. **Training wizard**: the review step wrote "PI0" where the picker says "Pi0"; the stepper wrapped
   onto two lines; a 43-wide Unitree G1 dataset defaulted to Pi0 + LoRA.
8. **Datasets list**: Ctrl-K found no dataset by name; the import log was unreachable once a dataset
   was ready; the delete confirmation named neither the dataset's size nor what goes with it;
   "Create view" only navigated to the episodes page; the Hugging Face browser offered "Import
   anyway" for a repository that does not exist.
9. **`GET /api/datasets/:id/import/log`** for a ready dataset still reported
   `progress.status: "validating"`, 95.

### Decisions

- **Docs in the image**: the app Dockerfile gets a `docs` stage that the builder copies to
  `/docs` (`../docs` relative to the app, as in the repo). `docker-compose.yml` and
  `scripts/e2e-k3d/up.sh` pass the checkout's `docs/` as a *named build context*, which replaces
  the stage. Without one, the stage fetches `docs/` of `DOCS_GIT_REF` (default `main`) from the
  repository with `ADD <git url>#<ref>:docs` — so the plain `docker build ./app` that
  `.github/workflows/build-images.yml` runs ships the docs too. The workflow is deliberately not
  changed here: the token this was pushed with may not write workflow files. Passing
  `build-contexts: docs=./docs` there would pin the docs to the built commit instead of `main`; it
  is a follow-up, not a prerequisite. The Docker context stays `./app` either way. A build that
  ends up without `README.md` fails (in Docker at `RUN test -f`, elsewhere in a `require-docs`
  Vite plugin), and a viewer that still has no document says so and links to GitHub instead of
  redirecting to an empty slug.
- **Jargon**: the sentence a visitor reads is plain; the env var, command or path moves into a
  shared `AdminHint` (a native `<details>`, "For administrators"). `EmptyState` gains a `hint` slot,
  `GatedNotice` an `adminHint`.
- **Locale**: `shared/utils/format.ts` gains `formatNumber`, `formatDate` ("Nov 13, 2026" — month
  spelled out, so it is never day-first or month-first) and `formatTime`; `formatDateTime` takes a
  `Date` too. All 57 bare calls and the 13 numeric `toLocaleDateString(UI_DATE_LOCALE)` calls go
  through them. `localeGuard.test.ts` walks the sources and fails on a bare
  `toLocale*String()` / `Intl.*Format()`.
- **Navigation**: the Skill Training row's page is titled "Skill Training" (was "Pipeline"), the
  Models page "Models" (was "Model Registry"). Patrol, Guide and Automations already matched their
  rail stops; their eyebrow now reads "Automate · Missions", so the sidebar word is on the page.
- **Wizard default**: `suggestBaseModel(dataset)` returns `groot_n1_7` for a Unitree G1 dataset
  (robot type name/model or `info.json` `robot_type`), null otherwise. GR00T N1.7 is the GR00T the
  trainer runs natively and the one that ships a G1 embodiment; the compatibility report already
  recommends GR00T N1.x for these. The suggestion is applied until the person picks a model
  themselves and is labelled "Suggested" with the reason. The fine-tuning method stays LoRA — the
  data model does not say which methods a base model supports.
- **Palette**: datasets and robots are fetched once per opening (the endpoints their own pages
  use) and matched by name, word prefix, Hub repo id or robot id — never by scattered letters. An
  empty query still lists pages only.
- **Delete confirmation**: names the dataset and "402 episodes (171,625 frames, 1h 35m of
  recording)". Bytes on disk are not served by any endpoint; adding one would touch the dataset
  routes another PR is rebuilding, so the size is stated in the units the list already shows.
- **"Create view"** is renamed "Select episodes for a view": a view is cut from episodes ticked on
  the episodes page, and that is where the item goes.
- **Import log**: the importer's last frame hands over to the validation job, which makes the row
  `ready` without touching the frame. `settledImportProgress(rowStatus, frame)` reconciles them
  where the log is read: a ready row reports `ready`, 100; a failed row `failed` at the percentage
  it reached; a row still validating is left alone.

### Out of scope (other tasks)

The Upload dialog, the episode page (TASK-484), robots pages (TASK-485), auth/login (TASK-483),
rate limiting (TASK-482).

## Acceptance Criteria

- [x] `/docs` renders a document in the production build and in the demo-mode build; the app
      image bundles the docs both with `--build-context docs=./docs` and from a plain
      `docker build ./app`, and a build that gets no docs fails instead of shipping an empty viewer
- [x] Every `docsSlug` and literal `/docs/<slug>` link in the app names a bundled document
- [x] The compatibility report shows the per-axis verdict without horizontal scrolling at
      1280x720 with three datasets; long dataset names are cut with an ellipsis and keep a `title`
- [x] Generate synthetic, Experiments, Organizations, Team, `/data-collection/live`, Publish to
      Hugging Face and Training workers say what is going on in plain words, with the setup detail
      under "For administrators"
- [x] No source file formats a number or date with the browser locale (guard test)
- [x] Skill Training, Models and the three Missions pages agree with the navigation
- [x] The wizard writes "Pi0", keeps its stepper on one line, and defaults to GR00T N1.7 for a
      Unitree G1 dataset without overriding a model the person picked
- [x] Ctrl-K finds datasets and robots by name
- [x] A ready dataset keeps its "Import log" action; Delete sits under its own rule and its
      confirmation names the dataset and its size; no menu item is called "Create view" while it
      only navigates
- [x] The Hugging Face browser offers no import for a repository that does not exist
- [x] `GET /api/datasets/:id/import/log` reports `ready`, 100 for a ready dataset

## Notes

Verified in Chromium at 1280x720 and 1440x900 (browser locale de-DE) against a scratch server with
three datasets and the seeded demo fleet, on a production build and a demo-mode build; the app
image was built with a `docs` context (a marker line added to the context's README is in the
image) and without one (the docs fetched from the repository are in the image).

Not fixed here, noticed on the way:

- `app/src/features/robots/components/tabs/vr/VRTeleopModal.tsx:1590` tells the operator to
  "Restart g1_sidecar.py with G1_WRITE_MODE=arm_sdk", and
  `app/src/features/robots/components/tabs/MotionTab.tsx:378` names `run.py` / `export_neodem.py`
  in an empty state — the same jargon pattern, on robots pages (TASK-485).
- The dataset list scrolls horizontally at 1280 px: with the row menu in view the Name column is
  cut on the left (`app/src/features/training/components/DatasetList.tsx`).
