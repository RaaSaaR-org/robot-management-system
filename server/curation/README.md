# Dataset Curation (episode trim / delete)

Dependency-light tooling behind the in-app curation GUI (TASK-168). Edits
LeRobot **v2.1** on-disk datasets **non-destructively** — every edit writes a new
dataset revision directory and leaves the source untouched.

## Files

- `curate.py` — `delete` / `trim` subcommands. Reindexes episode/frame/global
  indices and rewrites `meta/` exactly like lerobot's `delete_episodes`.
- `make_synthetic_dataset.py` — generates a tiny valid dataset for testing
  without torch/lerobot (defaults to the G1 EDU 43-DOF action space).
- `requirements.txt` — just `pyarrow` + `pandas`.

## Usage

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

# make a synthetic dataset
.venv/bin/python make_synthetic_dataset.py /tmp/g1_ds --episodes 4 --frames 20

# delete episodes (writes a NEW dir)
.venv/bin/python curate.py delete --dataset /tmp/g1_ds --output /tmp/g1_ds_v2 --episodes 1,3

# trim one episode to frames [5, 15)
.venv/bin/python curate.py trim --dataset /tmp/g1_ds --output /tmp/g1_ds_v3 --episode 2 --start 5 --end 15
```

Each command prints a JSON summary on stdout (parsed by
`server/src/services/EpisodeCurationService.ts`).

## Server wiring

`EpisodeCurationService` shells out to `curate.py` (`CURATION_PYTHON` selects the
interpreter; it must have pyarrow/pandas). Routes:

- `POST /api/curation/:id/episodes/delete`  `{ episodes: number[], datasetPath? }`
- `POST /api/curation/:id/episodes/:index/trim`  `{ start, end?, datasetPath? }`

Dataset path resolves from `CURATION_DATASETS_ROOT/:id` unless `datasetPath` is
passed (used for local/dev and tests).

## Caveats

- **Stats are not recomputed** by this tool — results carry
  `stats_recompute_required: true`; run the existing `stats_worker` afterward.
- **v3 chunked / video datasets**: for multi-episode parquet chunks and
  concatenated MP4, route through lerobot's own
  `lerobot.datasets.dataset_tools.delete_episodes` (handles video re-encode)
  instead of this on-disk editor. This tool targets the common
  one-parquet-per-episode v2.1 layout.
