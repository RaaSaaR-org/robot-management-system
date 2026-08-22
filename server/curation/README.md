# Dataset Curation (episode trim / delete / AI suggestions)

Tooling behind the in-app curation GUI (TASK-168). Edits LeRobot on-disk
datasets **non-destructively** — every edit writes a new dataset revision
directory and leaves the source untouched.

## Files

- `curate.py` — `delete` / `trim` / `suggest` subcommands.
  - **native backend** (default, pyarrow + pandas only): the v2.1
    one-parquet-per-episode layout. Reindexes episode/frame/global indices and
    rewrites `meta/` exactly like lerobot's `delete_episodes`, **copies and
    renumbers the per-episode camera videos** for every camera key, **re-cuts
    trimmed videos frame-accurately with ffmpeg** (`trim=start_frame:end_frame`
    + libx264 re-encode — stream copy is not frame-accurate), and **recomputes
    `meta/stats.json`** from the output parquets (per-dimension min/max/mean/std,
    population std; `--no-recompute-stats` skips it and flags
    `stats_recompute_required: true` instead).
  - **lerobot backend** (`--backend lerobot`, needs lerobot >= 0.6): `delete`
    for **v3.0** chunked/concatenated-video datasets via
    `lerobot.datasets.dataset_tools.delete_episodes` (loads from `--dataset`,
    writes the edited dataset to `--output`; source untouched). `trim` has no
    lerobot equivalent yet → structured error `{code: "V3_TRIM_UNSUPPORTED"}`.
  - `suggest --dataset <src> [--episode N]` — Phase-2 "video-use" heuristics:
    deterministic motion analysis of the `action` (fallback
    `observation.state`) column. Leading/trailing idle padding (mean |Δ| per
    frame below `--idle-threshold`, run length >= `--min-idle-frames`) →
    trim suggestion; near-zero total motion or fewer than `--min-frames`
    frames → delete suggestion. Output:
    `{ok, suggestions: [{episode, kind, start?, end?, reason, confidence}]}`.
- `make_synthetic_dataset.py` — generates a tiny valid dataset for testing
  without torch/lerobot (defaults to the G1 EDU 43-DOF action space). With
  `--cameras top,wrist` it also emits tiny real mp4s (testsrc, one video frame
  per data frame) via ffmpeg for the video-aware curation tests.
- `tests/` — pytest suite: delete+video renumbering, frame-accurate trim
  re-cut (counts decoded frames with the real ffmpeg), stats recompute vs
  hand-computed values, suggest heuristics on crafted idle padding, and the
  lerobot v3 backend (builds a real state-only v3 dataset; auto-skipped when
  lerobot is missing). Run:
  `cd server/curation && CURATION_FFMPEG=/path/to/ffmpeg python -m pytest tests/ -q`.
- `cosmos3_synth.py` — **TASK-175**: real Cosmos 3 synthetic-data generation.
  Calls the HF ZeroGPU `nvidia/Cosmos3-Action-Viewer` (forward dynamics) to roll
  out action-conditioned video for the bridge/WidowX embodiment, then exports a
  valid LeRobot v2.1 dataset (parquet + video + meta). See section below.
- `requirements.txt` — `pyarrow` + `pandas` for curate/make_synthetic;
  `numpy` + `httpx` + `huggingface_hub` are additionally used by `cosmos3_synth.py`.

## Usage

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

# make a synthetic dataset (add --cameras top to include tiny real videos)
.venv/bin/python make_synthetic_dataset.py /tmp/g1_ds --episodes 4 --frames 20

# delete episodes (writes a NEW dir; videos copied + renumbered, stats recomputed)
.venv/bin/python curate.py delete --dataset /tmp/g1_ds --output /tmp/g1_ds_v2 --episodes 1,3

# trim one episode to frames [5, 15) (video re-cut frame-accurately via ffmpeg)
.venv/bin/python curate.py trim --dataset /tmp/g1_ds --output /tmp/g1_ds_v3 --episode 2 --start 5 --end 15

# v3.0 chunked dataset -> lerobot backend (interpreter needs lerobot >= 0.6)
python curate.py delete --backend lerobot --dataset /data/v3_ds --output /data/v3_ds_v2 --episodes 1

# heuristic curation suggestions (read-only)
.venv/bin/python curate.py suggest --dataset /tmp/g1_ds
```

Each command prints a JSON summary on stdout (parsed by
`server/src/services/EpisodeCurationService.ts`); failures print
`{"ok": false, "error": ..., "code": ...}` and exit 1.

## Cosmos 3 synthetic data (`cosmos3_synth.py`, TASK-175)

Generates **action-conditioned** synthetic episodes via NVIDIA Cosmos 3 forward
dynamics on a free/cheap HF ZeroGPU Space, then exports them as a LeRobot v2.1
dataset that passes our dataset-validation worker. Requires an **HF PRO** token
(40 ZeroGPU GPU-min/day; each rollout is ~10–35s) — see
`scratch/cosmos3/HF-PRO-RUNBOOK.md` and `RES-001 §4.7`.

```bash
.venv/bin/pip install -r requirements.txt
export HF_TOKEN=hf_...        # PRO token (or put it in a .env next to this script)

# 1) generate N action-conditioned rollouts (bridge / WidowX) into <out>/raw/
.venv/bin/python cosmos3_synth.py --out /tmp/cosmos3 generate --episodes 4

# 2) convert the rollouts -> LeRobot v2.1 dataset at <out>/lerobot_cosmos_bridge/
.venv/bin/python cosmos3_synth.py --out /tmp/cosmos3 convert
```

How it works:
- The bridge action chunk comes from the real `action` column of the example
  LeRobot dataset packaged in the Space (downloaded on demand). The LeRobot
  7-D euler action is converted to the model's 10-D `[trans(3) + 6D-rot + grip]`
  representation (`quantile_rot` normalizer) before sending.
- Generation uses the raw gradio HTTP API (`/gradio_api/call/generate` + SSE),
  **not** `gradio_client`, whose output auto-download trips the Space's restricted
  file route (403). Artifacts are fetched with the bearer token.
- The export pairs the generated video frames with the (tiled) real action chunk
  and an integrated pose proxy for `observation.state`.

Validation (proves it passes the real worker) is a committable vitest:
`server/src/services/__tests__/synthetic-dataset-validation.test.ts` against the
fixture `fixtures/cosmos-synthetic-bridge/` (meta/ from one run). Run:
`cd server && npx vitest run src/services/__tests__/synthetic-dataset-validation.test.ts`.

**Scope today:** proves the offline generation→convert→validate pipeline
end-to-end on HF PRO. Generating a *full* augmentation set and the real-vs-synthetic
fine-tune **ablation** needs a rented GPU (RES-001 §4.2–4.3); ZeroGPU is for
prototyping only.

### In-app generation (`CosmosSyntheticService`, TASK-178)

The Datasets page ("Generate Synthetic" button) drives this script from the
server. `server/src/services/CosmosSyntheticService.ts` runs `generate` then
`convert` as a background process, streams progress (parsed from stdout), and
registers the converted dataset as a `ready`, **synthetic-tagged** `Dataset`
(`infoJson._synthetic = true`) pointing at the local on-disk dataset dir. The
standard `/api/datasets/:id/episodes`, `.../frames` and `.../video/:camera`
routes gained guarded **local-disk** branches so the existing episode viewer
plays these datasets directly (no RustFS needed).

Routes (mounted at `/api/synthetic-cosmos`, auth-protected):

- `GET  /config`            → `{ available, hasToken, embodiment, maxEpisodes, … }`
- `POST /generate`          → `{ episodes, prompt? }` → `{ job }` (202)
- `GET  /jobs` · `GET /jobs/:id` · `POST /jobs/:id/cancel`

Server env (all optional — sensible defaults):

- `COSMOS_SYNTH_PYTHON` — interpreter (defaults to `server/curation/.venv/bin/python`, else `python3`)
- `COSMOS_SYNTH_OUT`    — output root (defaults to `server/curation/cosmos3_out/`)
- `HF_TOKEN` / `COSMOS_SYNTH_ENV` — PRO token, or a `.env` file to read it from
  (falls back to `scratch/cosmos3/.env`)

Dev seed (register an already-converted dir without spending GPU, e.g. for UI
testing): `npm run seed:synthetic -- <path-to>/lerobot_cosmos_bridge`.

## Cosmos 3 world-model simulator study (`cosmos3_wm_eval.py`, TASK-176)

Feasibility study: can Cosmos 3 forward dynamics act as a *learned world-model
simulator* to rank policies, complementing the geometric MuJoCo sim-RL evaluator
(`robot-agent/hardware/sim_evaluator/`)? It rolls out the **same conditioning
frame** under the **real** recorded actions plus deliberately-corrupted variants
(scrambled / reversed / zero) and scores each prediction against ground truth.

```bash
export HF_TOKEN=hf_...        # PRO token (40 ZeroGPU min/day)

# validate the metric math — no GPU, no network
.venv/bin/python cosmos3_wm_eval.py selftest

# roll out real + corrupted policies for 4 recorded sequences (GPU; ~16 jobs)
.venv/bin/python cosmos3_wm_eval.py --out /tmp/wm rollout --seqs 0,3,6,23

# score predicted-vs-ground-truth -> report.json + REPORT.md + strip_si*.png
.venv/bin/python cosmos3_wm_eval.py --out /tmp/wm score
```

How it works / why this shape:
- Reuses the proven GPU-call + action helpers from `cosmos3_synth.py` (raw gradio
  API, euler→10-D bridge action). No new Python deps (numpy + ffmpeg only).
- **Auto-alignment:** the predicted clip's first frame is the conditioning frame,
  so we match it against every ground-truth frame to recover the true alignment —
  no assumption about how the Space maps `sample_index` to dataset frames.
- **Metrics:** global SSIM/PSNR are confounded by the static background (they
  reward a do-nothing policy), so we add **motion_corr** (correlation of
  predicted vs real change-maps, ~0 for a static policy) and **foreground-masked
  SSIM** as the fair policy-ranking metrics.

**Outcome (NO-GO, now):** Cosmos 3 (Nano, free Action-Viewer) is action-conditioned
and visually plausible, but **not a reliable policy-ranking simulator** — the real
policy is ranked #1 in only 1/4 sequences (≈ chance) and naive SSIM always prefers
a do-nothing policy. Full results + go/no-go in
`RES-001 §4.8` (`.mc/research/.../task176-wm-eval/`). Keep MuJoCo
`evaluate_policy.py` as the source of truth.

## Server wiring

`EpisodeCurationService` shells out to `curate.py`; `DatasetCurationService`
orchestrates per **dataset id**: it loads the Dataset row, picks the backend
from `lerobotVersion` (`v3*` → lerobot backend), resolves the source
(**local-disk** dataset dirs are curated in place from their absolute
`storagePath`; **RustFS** datasets are downloaded from their `storagePath`
prefix in the `training-datasets` bucket to a temp dir first), runs the edit,
and registers the result as a **new Dataset revision row**
(`<name> (curated)`, counter appended on repeats). RustFS results are uploaded
under a fresh `<uuid>/` prefix and re-validated through the standard
`validateAndUpdateDataset` path (fills infoJson/statsJson, flips to `ready`);
local results are registered `ready` directly from the produced meta. The
original dataset row/files are never touched. Lineage/audit info is persisted
in `infoJson._curation` (`{parentDatasetId, operation, params, timestamp,
tool}`) — the ComplianceLog service is robot-session-scoped and doesn't fit
dataset edits, so the lineage record doubles as the audit trail.

Routes (mounted at `/api/curation`):

- `POST /api/curation/:id/episodes/delete`  `{ episodes: number[], datasetPath? }`
- `POST /api/curation/:id/episodes/:index/trim`  `{ start, end?, datasetPath? }`
- `POST /api/curation/:id/suggest`  `{ episode?, datasetPath? }` — AI suggestions
  (heuristics; videos are not downloaded for RustFS datasets here)

The edit endpoints respond with the curate.py summary plus
`newDatasetId`/`newDatasetName` when a revision row was registered.
`datasetPath` (or `CURATION_DATASETS_ROOT/:id` when the id has no DB row) keeps
the legacy path-mode working for local/dev and tests — no row is created then.

Env vars (see `server/.env.example`):

- `CURATION_PYTHON` — interpreter for the native backend (pyarrow + pandas;
  default `python3`)
- `CURATION_LEROBOT_PYTHON` — interpreter with lerobot >= 0.6, for the
  `--backend lerobot` path in `curate.py`. **Not needed for a v3.0 dataset**
  since TASK-217: a v3.0 tree is converted once to a v2.1 view by
  `lerobot_v3_to_v2.py` (which needs only pyarrow, i.e. `CURATION_PYTHON`) and
  `curate.py` reads that. The README said this variable was required for v3.0
  and it was not.
- `DATASET_VIEW_CACHE_DIR` — where those converted views are built (default
  `server/data/dataset-views`). Regenerable and safe to delete; a view is keyed
  by the source path, the source's `meta/` contents and the converter's own
  version, and superseded copies are removed after a successful rebuild.
- `DATASET_VIEW_CONVERT_TIMEOUT_MS` — how long one conversion may run
  (default 900000). `DATASET_VIEW_FAILURE_COOLDOWN_MS` — how long a failed
  conversion is remembered before it is retried (default 30000).
- `DATASET_UPLOAD_MAX_BYTES` / `DATASET_UPLOAD_MAX_MEMBERS` — caps on what one
  uploaded archive may extract to (defaults 20 GiB and 200000 members).
- `CURATION_DATASETS_ROOT` — legacy path-mode root (default `/tmp/neodem-datasets`)
- `CURATION_FFMPEG` — ffmpeg binary for video re-cuts (default: `ffmpeg` on PATH)
- `CURATION_VLM` — set to `gemini` (with a real `GOOGLE_API_KEY`) to enrich
  suggestions with a Gemini pass over sampled episode frames
  (`CURATION_VLM_MODEL`, default `gemini-2.5-flash`)

## Caveats

- **Stats**: the native backend recomputes `meta/stats.json` itself (parquet
  features only — image/video stats are not recomputed) and sets
  `stats_recompute_required: false`. With `--no-recompute-stats` the flag stays
  `true`; run the stats worker afterward.
- **v3 chunked / video datasets**: `delete` goes through lerobot's own
  `delete_episodes` (handles chunk re-encode). `trim` and `suggest` are not
  supported for v3 yet (`V3_TRIM_UNSUPPORTED` / `V3_SUGGEST_UNSUPPORTED`).
- **VLM suggestion pass** (`CURATION_VLM=gemini`) is implemented but
  **untested live** — no Gemini API key on this box. The heuristic path works
  without it and is fully tested.
