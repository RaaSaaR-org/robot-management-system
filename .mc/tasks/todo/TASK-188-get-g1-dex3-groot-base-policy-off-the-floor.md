---
id: TASK-188
aliases:
- TASK-188
title: Get the G1+Dex3 GR00T base policy off the floor (2-cam, 14k steps, exec-horizon tuning)
slug: get-g1-dex3-groot-base-policy-off-the-floor
status: backlog
priority: 2
owner: ''
projects: []
customers: []
tags:
- extended
- vla
sprint: ''
depends_on:
- '[[TASK-185]]'
- '[[TASK-225]]'
due_date: ''
created: 2026-07-17
updated: 2026-08-28
status_note: 'Spun out of TASK-185. THE bottleneck: our best policy completes its own
  trained task only 2/10, so every ablation runs into a floor effect and can detect
  nothing. Fix absolute policy quality before testing any data-augmentation idea
  (dreams, Cosmos 3, …). ⚠ STALE PREMISE as of 2026-08-28: levers 1 and 2 were
  already executed on 2026-07-23 (vla-server 57202ad) and produced a checkpoint,
  n188_2cam_14k/checkpoint-8000. Its closed-loop score was never recorded. Reconcile
  before spending another ~5 GPU-hours re-running them.'
---

## Description

> ⚠ **The Windows GPU box is retired (2026-08-28).** This file was written when a
> separate Windows/WSL machine ("GPU_BOX") existed. It does not any more — the only
> machine is the Linux dev box with the RTX 5090. Read every mention of GPU_BOX,
> WSL, `.bat` or `C:\...` below as *historical context*, not as where the work
> happens.

**What this means for TASK-188 — checked on the box 2026-08-28:**

| | |
|---|---|
| `task185_finetune.py` | **GONE** — not on this box, and in no git repo |
| `task185_run_ablation_n17.sh` | **GONE** |
| `task185_serve_n17.sh` | **GONE** |
| `eval_g1_sim_groot_success.py` (the closed-loop harness) | **GONE** |
| `start_sim_pickplace_dex3.bat` | **GONE** (and `.bat` is moot here anyway) |
| Raw `unitreerobotics/G1_Dex3_*` datasets | **present but UNUSABLE** — 26 GB of `videos/` + `meta/` only; **zero** `data/*.parquet`, so no state/action. HF cache entries are empty stubs (156 KB). Must be re-fetched. |
| Merged 182-episode `unitree_g1_train` | **not present**; nearest is `~/wam-t041/datasets/arm-A` (402 eps / 171,625 frames), a different set |
| `Isaac-GR00T`, incl. `gr00t/eval/run_gr00t_server.py` | **present** (`~/Isaac-GR00T`) |
| `~/develop/vla-training` — committed GR00T prepare/finetune/serve scripts + Isaac closed-loop eval | **present** |
| **`vla-training/groot/g1_dex3_2cam_modality_config.py`** | **present** — lever 1 below says to *build* this; it already exists |
| TASK-189's eval harness (`grid.py`, `eval_rollouts.py`, `guards.py`, `stats.py`, `analyze.py`) | **GONE** — and [[TASK-189]] is filed `done`, so the dependency graph wrongly reads as satisfied |
| GPU | **present** — RTX 5090, 32 GB |

⚠ **Corrected 2026-08-28, after review — an earlier version of this banner said
"the harness no longer exists anywhere" and "the data and the GPU are here".
Both were wrong, in opposite directions.**

Most of the *tooling* survived: `~/develop/vla-training` is a committed repo
carrying the GR00T prepare/finetune/serve scripts, an Isaac closed-loop eval,
and — note — the 2-camera modality config that **lever 1 below asks someone to
build**. What it needs is path porting, not a rewrite.

What is genuinely missing is the *data*: all 13 raw dataset directories hold
`videos/` and `meta/` only, with **no `data/` split and zero per-frame
state/action parquet**, so no finetune can run against them at all. And
TASK-189's closed-loop harness — the one that superseded task185's — is gone.

**That rebuild is [[TASK-225]]**, which now blocks this task and [[TASK-187]] and
is listed in `depends_on` above. Do not start any lever below until it lands.

It also settles the reconciliation question in this file's `status_note`: the
`n188_2cam_14k/checkpoint-8000` weights lived on the retired box, so unless they
were backed up elsewhere **there is no score to go and look up**, and no way to
re-derive one without the harness. Treat levers 1 and 2 as unmeasured rather than
as already-run, and do not spend time hunting for that number first.


Train a GR00T-N1.7 policy on the **real** `G1_Dex3` pick-place data that can actually do its own
task — target **≥ 6/10 closed-loop** on `Isaac-PickPlace-Cylinder-G129-Dex3-Joint`, up from
today's **2/10**. This is the prerequisite for every downstream experiment: while both arms of an
ablation sit at 0–2/10 the comparison is a floor effect and cannot detect anything ([[TASK-185]]).

No synthetic data is involved here. This is purely "can we get a competent policy out of the
182 real teleop episodes we already have".

## Details

**Current state (measured in [[TASK-185]], 2026-07-17):**
- Best real-only policy: **2/10** closed-loop; offline 0.3811 rad / 25.6 % on the real holdout.
- A trivial **hold-current-state** policy scores **0.081 rad** — 3–5× *better* offline than any
  policy we have trained. Offline MAE ranks inertness on this data, so it must never be the
  headline metric; always report the hold-state baseline beside it.
- Dataset `unitree_g1_train`: **182 episodes / 157,151 frames / 30 fps**, and **two cameras**:
  `observation.images.cam_left_high` + `observation.images.cam_right_high` (480×640, head stereo).

### ⚠ Levers 1 and 2 have already been run — reconcile before re-running (added 2026-08-28)

This task was written 2026-07-17. Six days later, `vla-server` commit **`57202ad`** (2026-07-23,
"feat(groot): g1_dex3 support - multi-camera, …") shipped `configs/g1_dex3_2cam.yaml`, and its
README names a checkpoint **`n188_2cam_14k/checkpoint-8000`** — i.e. a 2-camera run trained to
14k steps. That is levers 1 and 2 of the three below, already executed, against this very task's
number.

**What is not recorded anywhere:** whether that checkpoint cleared the ≥6/10 closed-loop bar. The
weights are **not on this box** (nothing matching `n188*` under `/home/humanoid`), so the result
lives only on the GPU_BOX, if at all.

**Do this first, before any training:** find `n188_2cam_14k/checkpoint-8000`, evaluate it against
the test strategy below, and write the number into this task. If it already clears 6/10, this task
is done and only lever 3 (execution horizon) remains open. Re-running a 2.5 h finetune that has
already been run is the expensive failure mode here.

⚠ Also from that config, and easy to lose: the serve script's `sort -V | tail -1` auto-pick selects
`checkpoint-10000`, which is **truncated**. Pass `checkpoint-8000` explicitly.

**Three concrete levers, in order of expected payoff:**

1. **Use both cameras (we are currently throwing one away).** TASK-185 trained single-camera on
   purpose — the dreams are single-view and both ablation arms had to match — which handicapped
   the real policy too. TASK-180's working 2-cam setup is the reference. Needs a **2-cam modality
   config built the same way as the 1-cam one**: copy `g1_dex3_1cam_modality_config.py` and add
   `cam_left_high`. ⚠ Do **not** reuse `vla-training/groot/g1_dex3_modality_config.py` as-is — it
   uses **dotted** modality keys (`"state.arms"`, `"video.cam_left_high"`) which raise
   `KeyError: 'state.arms'` in `get_dataset_statistics` and mis-map video keys by position (see
   `_ft_out/g1_dex3_modality_config_fixed.py`). N1.7 wants short keys (`arms`, `cam_right_high`).
   The dataset's `meta/modality.json` must list both cameras to match.
2. **Train long enough.** TASK-185 ran 3000 × batch 8 = 24k samples ≈ **0.15 epochs** — the loss
   was still descending smoothly (1.40 → 0.78). Use TASK-180's proven **14,000 steps** (~2.5 h at
   ~1.55 it/s). Expect only ~5 % on open-loop MSE (TASK-180: 0.4036 @14k vs 0.4258 @2k) — the
   point is closed-loop competence, which nobody has measured across step counts.
3. **Tune the execution horizon.** The bridge predicts 16-step chunks and executes the first 8 at
   15 Hz with a 0.2 rad/step clip. Nobody has swept this. Try exec_horizon ∈ {4, 8, 16} and
   hz ∈ {15, 30}; the real data is 30 fps, so 15 Hz may be halving the intended speed.
   [[TASK-183]] (real-time chunking) is the principled version of this knob.

**Key files:**
- `vla-training/groot/g1_dex3_1cam_modality_config.py` + `modality_g1_dex3_1cam.json` — the working
  pattern to copy for 2-cam (short keys, `arms` 0–14 / `hands` 14–28).
- `$UNITREE_ROOT/task185/task185_finetune.py` (the WSL eval distro) — finetune runner; env levers
  `TASK185_OPTIM=paged_adamw_8bit` (stock `adamw_torch` OOMs at 31.9/32 GB even at batch 1) and
  `TASK185_GRAD_CHECKPOINTING`. Keep `unset HF_HUB_OFFLINE` (the gated Cosmos-Reason2-2B backbone
  needs an online token-authed `model_info()` call).
- `$UNITREE_ROOT/_data/task185_run_ablation_n17.sh` — training driver (change `STEPS`, modality path).
- `$UNITREE_ROOT/_data/task185_serve_n17.sh` — serve a checkpoint from WSL; sim on native Windows
  reaches it over `127.0.0.1:<port>` via WSL2 localhost-forwarding (no need to copy 15 GB).
- `$UNITREE_ROOT/_data/task185/eval_g1_sim_groot_success.py` — closed-loop harness. It already sends
  **both** `cam_right_high` and `cam_left_high` (currently the same head frame — for a real 2-cam
  policy, wire the sim's second view properly rather than duplicating).
- Sim: `$UNITREE_ROOT/unitree_sim_isaaclab/start_sim_pickplace_dex3.bat` (DDS **domain 1**).

**Trap (cost TASK-185 a full round):** `G1_29_ArmController` runs a `while True` thread writing
`rt/lowcmd` and `Dex3_1_Controller` spawns non-daemon children, so a "finished" eval keeps
commanding the robot and fights the next run — every cell read 0/10 until stale PIDs were killed.
Verify no `eval_g1_sim_groot_success` process survives between runs.

## Test Strategy

Closed-loop success from the sim's `rt/rewards_state` (reward 1.0 = cylinder in the target post
area), **≥ 20 reset-isolated rollouts** on "Put the bottle into the plate." — n=10 is too few to
tell 2/10 from 5/10 (see [[TASK-189]]). Baseline to beat: **2/10**. Report the hold-state offline
baseline (0.081 rad) alongside any MAE so the metric's degeneracy stays visible.
Ablate the three levers one at a time (2-cam @3k vs 1-cam @3k; then 14k; then the horizon sweep)
so we learn which one actually buys the competence — not just that the bundle helped.
