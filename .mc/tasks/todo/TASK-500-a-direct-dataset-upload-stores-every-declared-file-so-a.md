---
id: "TASK-500"
aliases: []
title: "A direct dataset upload stores every declared file, so a dataset uploaded and deleted locally comes back whole"
slug: "a-direct-dataset-upload-stores-every-declared-file-so-a"
status: "review"              # backlog | todo | in-progress | review | done | cancelled
priority: 2                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["datasets", "storage", "core"]
sprint: ""
parent: ""
depends_on: []
spe: 3
effort: "medium"
due_date: "2026-11-16"
created: "2026-11-13"
updated: "2026-11-13"
---

# A direct dataset upload stores every declared file, so a dataset uploaded and deleted locally comes back whole

## Description

The bottle-robot sessions push a dataset directory to the instance with
`rmsctl datasets upload`, delete the local copy to free disk, and fetch it back
with `rmsctl datasets download` (TASK-480, TASK-496). The upload stored only
the LeRobot tree — `meta/**`, `data/**/*.parquet`, `videos/**/*.mp4`,
`images/**` — so a `README.md` or any other file in the directory was never on
the instance and the round trip lost it without a word. The server now stores
every file a client declares; `rmsctl` (RaaSaaR-org/rmsctl) sends the whole
directory and gains `datasets verify` as the check before deleting.

## Details

### Current state

The restriction was in two places:

- **Server**, `server/src/services/datasetUpload/uploadManifest.ts`,
  `checkManifest`: every declared path was run through the Hub importer's
  `selectRepoFiles`; a path outside the four trees was not an error but was
  moved to `ignored` in the start response and never given a file id, so it
  could not be sent at all. `docs/dataset-upload.md` documented that
  ("What may be uploaded").
- **Client**, `rmsctl` `src/commands/dataset_upload.rs`: `scan_dir` walked only
  `meta/`, `data/`, `videos/`, `images/` and applied the same filter
  (`is_dataset_file`), reporting the rest as a bare count ("1 other entry left
  out").

Everything downstream was already neutral: `GET /api/datasets/:id/files`
(`DatasetFilesService.ts`) lists whatever is under the dataset's prefix, and
validation, the episode browser, the video route, statistics and the Hub
publisher (`collectFiles`, `PUBLISHED_DIRS`) ask for `meta/`, `data/`,
`videos/`, `images/` by name and never list the dataset root.

### Server

- `checkManifest` accepts every declared file that passes `parseDeclaredFiles`
  (safe relative path, size, optional sha256) and `toUploadEntries` (no path
  that is both a file and a directory, part ceiling, total under
  `DATASET_UPLOAD_MAX_BYTES`, at most `DATASET_UPLOAD_MAX_FILES`). The
  LeRobot-tree requirements (`meta/info.json`, a data parquet, the episode
  rows) are unchanged, as is `importMode` (`full` only when `videos/` or
  `images/` is declared — a stray top-level `.mp4` does not make it one).
- `ignored` stays in `ManifestCheck` and in the start response and is always
  `[]`. That is the compatibility signal: an older server lists there what it
  will not store, a current one never does, so a client needs no version
  probe.
- Files beside the tree count against the size and file caps — they are
  stored.
- The app's upload dialog is untouched: it filters in the browser
  (`app/src/features/training/upload/lerobotFolder.ts`) and still declares only
  the four trees.

### Client (RaaSaaR-org/rmsctl, separate PR)

- `datasets upload` declares every regular file; built-in skips are `.git`,
  `.DS_Store`, `__pycache__` (any depth), a top-level `.cache`, `*.rmsctl-part`,
  empty directories and non-regular files; `--exclude <glob>` (repeatable),
  `--lerobot-only`, `--no-default-excludes`. The run without `--yes` lists
  every left-out entry with its reason.
- Against a server from before this task the start response's `ignored` is not
  empty: the CLI cancels the upload it just opened and fails naming the files,
  before a byte is sent. `--lerobot-only` uploads the tree alone to such a
  server.
- `datasets verify <id> <dir>` compares a directory with
  `GET /api/datasets/:id/files` (paths, sizes, SHA-256 where listed) without
  downloading a file, and exits non-zero with the list of differences.

### Key files

- `server/src/services/datasetUpload/uploadManifest.ts`
- `server/src/services/datasetUpload/DatasetUploadService.ts` (a log line that
  can no longer fire)
- `server/src/services/datasetUpload/__tests__/uploadManifest.test.ts`
- `server/src/services/datasetUpload/__tests__/DatasetUploadService.test.ts`
- `docs/dataset-upload.md`, `docs/dataset-download.md`, `README.md`

## Acceptance Criteria

- [x] A start request that declares `README.md`, a file in a directory of its
      own, an empty file and a non-ASCII name gets a file id for each; `ignored`
      is `[]`
- [x] Path confinement and the limits still hold for those files: `../x`,
      a file that is also a directory, more than `maxFiles`, a total over
      `maxTotalBytes` are refused as before
- [x] A directory without the LeRobot tree is still `NOT_A_LEROBOT_DATASET`
- [x] Validation, episodes, frames and video work on a dataset stored with
      extra files
- [x] `rmsctl datasets upload` → `verify` → `download` → `diff -r` is empty
      for `g1-dex3-bottle-sorting-sim`, `README.md` included
- [x] The new `rmsctl` against a server without this change fails with a clear
      message and leaves nothing behind
- [x] `docs/dataset-upload.md` and `docs/dataset-download.md` say what is
      stored and how a client tells an older server

## Test Strategy

- `uploadManifest.test.ts`: every safe file is accepted (README, dotfile, a
  `.txt` under `videos/`, an empty file, a non-ASCII name) with `ignored: []`;
  the tree is still required; an unsafe extra path and a file-and-directory
  clash are refused; extras count against the size cap; a top-level `.mp4`
  does not turn a tables-only upload into `full`.
- `DatasetUploadService.test.ts`: a start with `README.md` returns six files.
- End to end, local server from this branch + throwaway `rustfs/rustfs:1.0.0`,
  `rmsctl` from RaaSaaR-org/rmsctl `feat/datasets-upload-everything-verify`
  (see Notes).

## Notes

### End-to-end run (2026-11-13)

Server from this branch (`tsx src/index.ts`, SQLite, NATS absent so validation
ran in-process), RustFS 1.0.0 in docker, `rmsctl` release build.

- `/mnt/data/rms-demo/g1-dex3-bottle-sorting-sim` (9 files with `README.md`,
  446.1 MB): upload → `ready`, validation `valid`; `GET /files` lists 9 files,
  all with `sha256`; `datasets verify` exit 0 (SHA-256 of 9); download →
  `diff -r` against the source: empty. `GET /episodes` (80), `/episodes/3/frames`
  (31-wide state), `/episodes/3/video/observation.images.head` with `Range`
  (206, `video/mp4`), `/stats`, `/modality`, `/quality`: all 200.
- A copy with extras — an empty file, `docs/übersicht — späte Schicht.md`,
  `calib/cam head.yaml`, `scripts/convert.py`, `.gitattributes`, `videos/` as a
  symlinked directory — plus `.git/`, `.DS_Store`, `.cache/`,
  `scripts/__pycache__/`, an empty directory, a `*.rmsctl-part`, and
  `raw/` + `debug.log` excluded with `--exclude raw --exclude '*.log'`: the dry
  run lists the 8 left-out entries with reasons; 14 files uploaded, `ready`,
  `valid`; verify with the same excludes exit 0, without them exit 1 naming
  `debug.log` and `raw/session.bag`; download → `diff -r` shows exactly the 8
  left-out entries and nothing else; episodes, frames and video 200/206; the
  non-ASCII file is served by `/files/content`.
- Verify on a changed copy: a deleted file ("only on the instance"), a new
  file ("missing on the instance"), an appended byte ("size differs") and a
  flipped byte at the same size ("content differs") — all four listed, exit 1.
- Server **without** this change (same tree, `uploadManifest.ts` from `main`):
  the new `rmsctl` fails with "this server stores only the LeRobot tree … and
  would leave out 1 file(s): README.md … the upload that was opened has been
  cancelled"; `datasets list` is empty afterwards. With `--lerobot-only` the 8
  tree files upload as before, and `verify` then reports `README.md` as
  missing on the instance (exit 1) unless `--lerobot-only` is given there too.

### Deploy

- The demo instance needs this server change before a default
  `rmsctl datasets upload` works against it; until then the new CLI refuses
  (cleanly) and `--lerobot-only` behaves like the old CLI. An old `rmsctl`
  keeps working against a new server — it declares only the tree.
- Datasets uploaded before the deploy hold only the tree. `rmsctl datasets
  verify` shows what they lack; nothing on the server back-fills it.

### Not done

- The app's upload dialog still sends only the four trees (documented).
- The local-disk sink (a server without RustFS) was covered by the unit tests
  only in this run, not end to end.
- No back-fill for datasets uploaded earlier, and the Hub importer still
  selects only the LeRobot tree from a repository.
