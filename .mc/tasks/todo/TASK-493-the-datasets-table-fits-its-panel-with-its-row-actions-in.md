---
id: "TASK-493"
aliases: []
title: "The datasets table fits its panel with its row actions in view, demo robots stand on the site map, and an import-created robot type can be renamed"
slug: "the-datasets-table-fits-its-panel-with-its-row-actions-in"
status: "review"              # backlog | todo | in-progress | review | done | cancelled
priority: 2                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["datasets", "fleet", "demo", "ui", "core"]
sprint: ""
parent: ""
depends_on: []
spe: 8
effort: "medium"
due_date: "2026-11-16"
created: "2026-11-13"
updated: "2026-11-13"
---

# The datasets table fits its panel with its row actions in view, demo robots stand on the site map, and an import-created robot type can be renamed

## Description

Five presentation defects found on the live demo instance (build df6a736) by an
audience-eyed pass ahead of the demo day on 2026-11-16. Each is on a page the demo walks:

1. **Datasets list.** The table was wider than its panel at 1440x900 and 1280x720: the
   STATUS column was cut ("RE…"), UPDATED and the row-actions kebab were off-screen and
   reachable only by scrolling the table sideways, which hid the names. A row that was
   uploading or importing widened its status cell and pushed more out.
2. **Robot type names.** A type an import creates is named
   `unitree_g1_dex3 (action 31, state 31)`, a raw identifier beside the seeded
   "Unitree G1 EDU (Dex3-1)", and wrapped to three lines. There was no way to rename a
   robot type — no route, no script, no UI.
3. **Every robot "NO SITE".** The dashboard and fleet maps showed an empty building under
   a site called "Demo Warehouse": "0 robots on the map".
4. **Wording.** "…when Unitree G1 with Dex3 hands's robot agent connects…" on the robot
   page; "49 documents" under a docs list of 32.
5. **Hub provenance read as a name.** `ycchen0106/g1-apple-to-plate@37cb1d6e` sat
   directly under a dataset's title.

## Details

### Current state (before)

- `app/src/features/training/components/DatasetList.tsx` + `shared/components/ui/DataTable.tsx`:
  an auto-layout table. The name cell was capped at 28 rem but never shrank, the
  in-flight status cell was 11 rem against ~5 rem for a bare tag, and Frames was the only
  column that folded (below 1024 px). Sum of the columns at 1440: ~1186 px in a 1150 px
  panel; ~1290 px with a row uploading.
- Robot types (`RobotType`, `server/prisma/schema.prisma`) are platform-wide rows — no
  `tenantId` — written by `POST` / `DELETE /api/datasets/robot-types` (owner-only,
  `DatasetService.createRobotConfiguration` / `deleteRobotConfiguration`). The importer
  names a type in `HuggingFaceImportService.resolveRobotTypeId` and finds one again by
  the slug of its `model` **or** `name` plus the widths (`matchRobotType`). That naming
  is pinned by a test and is not changed here.
- A robot's site is `Robot.twinId`, set by `PATCH /api/robots/:id {twinId}` (the "Site"
  select on the Details tab). Its position on the map is its own: `SiteMap.tsx` draws a
  robot only when `location.siteAligned === true`, which its agent reports (a frame
  registration, or a sim whose world is the twin). `seed-demo-fleet.ts` wrote neither;
  an expected robot (TASK-477) has no agent and so no pose at all.
- `TwinTopDown.deriveWorldBounds` falls back to a 12 m square for a twin with no scan.
  The seeded warehouse's zones span 20 m; they showed only because the 4:3 viewBox is
  letterboxed in a wider element — and were cut off at both ends at 1280.
- `AwaitingAgentState.awaitingAgentSentence` built `${robotName}'s robot agent`.
- `DocsSidebar` printed `docs.length` — every file under `docs/` (49) — under a list that
  shows only the categories in `CATEGORY_ORDER` (32: decision records, ADRs and
  `testing/` are bundled so links resolve, but are not listed).

### Server

- `PATCH /api/datasets/robot-types/:id` `{ name }` → `{ robotType }`
  (`datasets.routes.ts`, `DatasetService.renameRobotConfiguration`). Owner-only like the
  other two robot-type writes. Robot types have no tenant, so there is nothing further to
  scope — said in the route's comment rather than faked. Only `name` changes; `model` and
  the widths stay, so datasets stay valid and `matchRobotType` still finds the row for
  the next import of the same robot (asserted). 409 `ROBOT_TYPE_EXISTS` when another type
  has the name (case- and whitespace-insensitive check, and the unique index as the last
  word), 409 `ROBOT_TYPE_STANDARD` for the types seeded at start (the seed and
  `metadata.robotTypeName` find those by name), 404 `ROBOT_TYPE_NOT_FOUND`, 400 for an
  empty or > 80-character name. Same name → 200, nothing written. Audited as
  `robot-type.rename` `{ from, to }`.
- `npm run rename:robot-type -- --base-url <url> --name <old> --to <new> [--dry-run]
  [--token]` (`server/src/scripts/rename-robot-type.ts`), next to `remove:robot-type`:
  public API only, exact-name match, `renamed` / `would-rename` / `unchanged` / `absent`
  / `refused`; a second run is `unchanged`.
- `server/src/scripts/demoFleetSites.ts` (new) + `seed-demo-fleet.ts`: the seed now also
  puts its robots on the site. `--site <name|id>` (default: the instance's only site;
  several and no name → nothing is guessed), `--also <robot id>` (bind an existing robot
  too — binding only), `--no-site`. Idempotent, `--dry-run` writes nothing, a robot the
  script does not own is skipped, one an operator bound to another site stays unless
  `--site` is explicit.
- **No pose is invented.** For its own (expected) robots the seed writes
  `metadata.plannedPlace` — a zone name chosen by place type (G1 and SO-101 → `staging`,
  MicroDuck → `dock`; never a keep-out) — through the existing `PUT …/expected`. No
  server route changed for this.

### Frontend

- `DataTable`: `hideBelow` also takes `xl`, `wide` (1440 px) and `2xl`.
- `DatasetList`: the name column is `width: 100%; max-width: 0` — it takes what the
  others leave and shrinks below its text; the name wraps to two lines and then clamps,
  whole name in `title`. Every other cell has a fixed width: robot type 10 / 11 rem, two
  lines, whole name in `title`; status 9 rem for every state, with the progress bar and
  its byte line (truncating, `title`) inside it. Columns by width: < 640 name · status;
  640 + episodes with the duration under the count; 1280 + robot type, updated; 1440 +
  duration as its own column; 1536 + frames.
- `DatasetNameCell`: the Hub line reads "From Hugging Face: owner/repo@commit · LeRobot
  v2.1".
- `DatasetProvenance` (new): "Imported from Hugging Face: <owner/repo> at revision
  37cb1d6e" — the repo a link to that exact commit on the Hub, the full SHA on hover.
  **Not yet placed in the dataset page header**: that header lives in
  `DatasetEpisodesPage.tsx`, which TASK-492 is rewriting at the same time; see Notes.
- `SiteMap`: an expected robot bound to the site is no longer listed as "not aligned —
  fence not enforcing". With a `plannedPlace` that is a zone of the site it is drawn in
  that zone as a dashed, hollow ring labelled "<name> (planned)" — never the solid dot of
  a live robot — and listed under **Planned position** ("planned in STAGING", tagged Not
  connected / Arriving); without one it is listed under **Not connected**. The count
  reads "0 robots live on the map. 3 expected robots are drawn where they are planned to
  stand." Compact (dashboard): a planned robot is two text lines without a tag, and the
  unaligned tag is "not aligned" (the long one left "Sim…" of the name).
- `TwinTopDown`: `fitZones` (read-only maps) takes the bounds of an unscanned site from
  its zones, and `makeTopDownTransform(bounds, viewAspect)` fits a wide site to the room
  a wide element actually shows. The zone editor passes neither and is unchanged.
- No possessive after a name: `AwaitingAgentState` ("when the robot agent of {name}
  connects…"), `TeleopTab`, `CockpitCommandDock`, `LiveSessionRedirect`, `MessageBubble`.
- `DocsSidebar`: the count is the number of documents the list offers ("32 documents"),
  and "N documents match" while searching.

### Key files

- `server/src/routes/datasets.routes.ts`, `server/src/services/DatasetService.ts`
- `server/src/scripts/rename-robot-type.ts` (new), `server/src/scripts/demoFleetSites.ts`
  (new), `server/src/scripts/seed-demo-fleet.ts`, `server/package.json`
- `server/src/__tests__/robot-type-rename.integration.test.ts` (new),
  `server/src/__tests__/demo-fleet-sites.integration.test.ts` (new),
  `server/src/scripts/__tests__/renameRobotType.test.ts` (new),
  `server/src/scripts/__tests__/demoFleet.test.ts`,
  `server/src/routes/__tests__/datasets-expectations-routes.test.ts`
- `app/src/shared/components/ui/DataTable.tsx`
- `app/src/features/training/components/DatasetList.tsx`,
  `components/datasets/DatasetNameCell.tsx`, `components/datasets/DatasetProvenance.tsx` (new)
- `app/src/features/fleet/components/SiteMap.tsx`,
  `app/src/features/digitaltwin/components/TwinTopDown.tsx`
- `app/src/features/robots/components/common/AwaitingAgentState.tsx`
- `app/src/components/docs/DocsSidebar.tsx`
- `docs/demo-fleet.md` ("On the site map", "Renaming a robot type")

## Acceptance Criteria

- [x] At 1280x720, 1440x900 and 1920x1080, light and dark, with the four live dataset
      names and the robot type `unitree_g1_dex3 (action 31, state 31)`: the table does not
      scroll sideways, the status is whole and every row's kebab is inside the panel —
      idle and with one row uploading (measured: scroll width = client width; kebab right
      edge 8 px inside the panel).
- [x] A row that starts uploading or importing changes no column's width.
- [x] A robot type can be renamed by an owner through the API and by a documented script
      with `--dry-run`; a taken name and a standard type are refused; the importer still
      finds the renamed row; the importer's auto-naming is untouched.
- [x] `npm run seed:demo-fleet` binds the demo robots (and `--also` robots) to the site,
      idempotently and with `--dry-run`, writes no pose, and the maps show the expected
      robots at a planned place that cannot be read as live.
- [x] No sentence puts `'s` after a robot's name; the docs count is the number of
      documents listed.
- [x] The dataset list says "From Hugging Face: …".
- [ ] The dataset page header says "Imported from Hugging Face: …" with a link — component
      and tests are in; the one-line wiring waits for TASK-492 (see Notes).

## Test Strategy

- `cd server && npx vitest run` — `robot-type-rename.integration.test.ts` and
  `demo-fleet-sites.integration.test.ts` (real routes, temp SQLite), `renameRobotType.test.ts`,
  the site cases in `demoFleet.test.ts`, the PATCH cases in
  `datasets-expectations-routes.test.ts`.
- `cd app && npx vitest run` — "the table fits its panel" in `DatasetList.test.tsx`,
  `DatasetProvenance.test.tsx`, "expected robots on the site map" in `SiteMap.test.tsx`,
  `TwinTopDown.test.ts`, `DocsSidebar.test.tsx`, the reworded cases in
  `unconnectedRobot.test.tsx`.
- In a browser against a local server (fresh SQLite, `npm run seed:demo-fleet -- --also
  sim-robot-001`, the four live datasets inserted as rows): `/datasets` idle and with one
  row uploading, `/dashboard`, `/fleet`, `/robots/demo-g1-dex3` at 1280x720, 1440x900 and
  1920x1080, light and dark. jsdom has no layout, so the widths are measured there.

## Notes

- **The dataset page header is not changed in this PR.** `DatasetEpisodesPage.tsx` is
  being changed by TASK-492 in parallel, and this task was told to keep out of it. What
  is left is to replace the `data-testid="dataset-source"` span in that page's
  `PageHeader` `meta` with `<DatasetProvenance dataset={dataset} />` (same test id) once
  TASK-492 has merged.
- **Name for the live 31-wide type.** Its layout is 3 waist + 14 arm + 14 Dex3-1 hand
  joints (`meta/info.json` of the bottle-sorting set), so "Unitree G1 upper body + Dex3-1
  hands" is accurate; "arms + Dex3-1 hands" is already the name of the standard 28-wide
  type and would leave the waist out.
- The fake "uploading" row in the browser pass is a row with `status: uploading` plus the
  upload store set in the page; the bar is the real component, the bytes are not a real
  transfer.
