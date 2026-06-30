# Dataset Curation (episode trim / delete)

Dependency-light tooling behind the in-app curation GUI (TASK-168). Edits
LeRobot **v2.1** on-disk datasets **non-destructively** — every edit writes a new
dataset revision directory and leaves the source untouched.

## Files

- `curate.py` — `delete` / `trim` subcommands. Reindexes episode/frame/global
  indices and rewrites `meta/` exactly like lerobot's `delete_episodes`.
- `make_synthetic_dataset.py` — generates a tiny valid dataset for testing
  without torch/lerobot (defaults to the G1 EDU 43-DOF action space).
- `cosmos3_synth.py` — **TASK-175**: real Cosmos 3 synthetic-data generation.
  Calls the HF ZeroGPU `nvidia/Cosmos3-Action-Viewer` (forward dynamics) to roll
  out action-conditioned video for the bridge/WidowX embodiment, then exports a
  valid LeRobot v2.1 dataset (parquet + video + meta). See section below.
- `requirements.txt` — `pyarrow` + `pandas` for curate/make_synthetic;
  `numpy` + `httpx` + `huggingface_hub` are additionally used by `cosmos3_synth.py`.

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
