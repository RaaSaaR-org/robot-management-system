---
id: TASK-225
aliases:
- TASK-225
title: Port the VLA finetune + closed-loop eval harness to Linux, and re-fetch the training data
slug: port-vla-train-eval-harness-to-linux-and-refetch-data
status: todo
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
- vla
sprint: ''
parent: ""
depends_on: []
spe: 8
effort: ""
due_date: ''
created: 2026-08-28
updated: "2026-09-05"
status_note: 'Blocks TASK-188 and TASK-187. Rewritten 2026-08-28 after review: the first
  draft had this backwards in both directions. The TOOLING largely survived — ~/develop/vla-training
  is a committed repo with the GR00T prepare/finetune/serve scripts AND the 2-cam modality config
  TASK-188 lever 1 asks someone to build. UPDATE 2026-08-28, steps 1+2 done: the missing per-frame
  state/action parquet has been fetched for all 13 sets (3152 eps / 2,587,515 frames — NOT the
  182/157,151 TASK-188 quotes, see finding (a)), and the GR00T scripts 40/41 now resolve their paths
  the way 42 does. Two things still block a run: the local video is cam_left_high ONLY, and both the
  1-cam and 2-cam modality configs want cam_right_high (finding (b)); and TASK-189 closed-loop
  harness (grid/eval_rollouts/guards/stats/analyze), which superseded the task185 one, is gone —
  while TASK-189 is filed done and still counted as a satisfied blocker.'
---


# Port the VLA finetune + closed-loop eval harness to Linux, and re-fetch the training data

## Description

[[TASK-188]] and [[TASK-187]] both assume a working GR00T train + closed-loop-eval harness. Neither
can start today. This task is what stands between them and a first run.

> ⚠ **This file was rewritten on 2026-08-28 after review.** Its first draft said "every script lived
> only on the retired Windows box and was never committed to any repo" and "the data and the compute
> are here; the tooling is not". **Both halves were wrong, in opposite directions.** Most of the
> tooling is committed and present; the *data* is not usable. The inventory below was re-checked
> command by command on the box. Do not reason from the earlier version.
>
> **Still true, and the warning stands.** Note only that the "*data* is not usable" half has
> since been acted on: steps 1 and 2 were carried out on 2026-08-28 and the parquet is now
> fetched. Read "Step 1: done" and "Step 2: done" below for the current state — and in
> particular findings **(a)** and **(b)**, which are new and change what a first run can be
> compared against. Steps 3 and 4 have not been started.

## Details

### What is actually here, checked on the box 2026-08-28

**Tooling — mostly present, needs porting, not rebuilding:**

| | |
|---|---|
| `~/develop/vla-training` (git repo, committed) | **present** — this is the thing the first draft said did not exist |
| ├ `scripts/40_groot_prepare_dataset.sh` | present — LeRobot v3.0 → v2 conversion + modality.json placement |
| ├ `scripts/41_groot_finetune.sh` | present — and already carries the 5090 memory recipe (see below) |
| ├ `scripts/42_groot_serve.sh` | present |
| ├ `groot/g1_dex3_1cam_modality_config.py` | present |
| ├ **`groot/g1_dex3_2cam_modality_config.py`** | **present** — TASK-188 lever 1 says to *build* this. It already exists. |
| ├ `groot/modality_g1_dex3_{1cam,2cam}.json` | present |
| └ `eval/` (137 files), incl. `isaac_dds_bridge.py`, `run_apple_eval_isaac.py`, `replay_gate_isaac.py` | present — a working closed-loop Isaac eval, but written for the **apple** task |
| `~/Isaac-GR00T`, incl. `gr00t/eval/run_gr00t_server.py` | **present** (ZMQ PolicyServer) |
| `vla-server` with `configs/g1_dex3_1cam.yaml`, `g1_dex3_2cam.yaml` | **present** |
| `unitree_sim_isaaclab` | **present** and runs — `robot-agent/hardware/isaac_sim_patches/README.md`. ⚠ the row above used to imply the location was obvious; it is not. It is at `$UNITREE_ROOT/g1_quest_teleop/third_party/checkouts/unitree_sim_isaaclab`, pinned at **`e30c25b`** ("update readme"), which **no `$UNITREE_ROOT` reference in any task file points at** — verified `git rev-parse HEAD` = `e30c25b1dffdf92ada1d6c8c1fe9a47bdde0fecc` |
| GPU | **present** — RTX 5090, 32 GB |

**Tooling — genuinely gone:**

| | |
|---|---|
| **TASK-189's harness** — `grid.py`, `eval_rollouts.py`, `server.py`, `guards.py`, `stats.py`, `analyze.py` + `RUNBOOK.md`, lived in `$UNITREE_ROOT/_data/task189` | **GONE.** See the warning below — this is the most consequential loss on the list. |
| `task185_finetune.py`, `task185_run_ablation_n17.sh`, `task185_serve_n17.sh` | **GONE** — but superseded by `vla-training/scripts/4x_groot_*.sh`, so this matters less than it looks |
| `eval_g1_sim_groot_success.py` | **GONE** — superseded by TASK-189's harness, which is also gone |
| `start_sim_pickplace_dex3.bat` | **GONE**, and `.bat` is moot here |

**Data — this is the real blocker:**

| | |
|---|---|
| `~/wam-t041/raw/G1_Dex3_*_Dataset` (13 dirs, 25.2 GiB) | ~~**present but UNUSABLE for training**~~ — **the `data/` split was fetched 2026-08-28 and this row is now obsolete.** State/action parquet is present and complete for all 13. Still incomplete on the *video* side — see step 1's results below |
| HF cache `datasets--unitreerobotics--G1_Dex3_*` | **empty stubs**, 156 KB total, `refs/` only |
| Merged 182-ep `unitree_g1_train` | **not present** |
| `~/wam-t041/datasets/arm-A` | present and complete — 402 eps, 402 data parquet, 959 MB — but a **different** dataset, not the one TASK-188 quotes |

~~⚠ **The 26 GB of "raw datasets" contains no training data.**~~ **Fixed on 2026-08-28 — see
"Step 1: done" below.** The diagnosis was right: the 13 directories held only `meta/` and `videos/`,
and a GR00T finetune consumes `data/chunk-*/*.parquet` (the state/action columns), which were never
fetched. It was a **download, not a rebuild**, and the download has now been done. What that
download then revealed is written up below, and **two of its findings change the plan**, so read
them before scheduling a run.

### Step 1: done. The `data/` split is fetched and verified (2026-08-28)

The parquet was pulled for all 13 sets; the videos were already local, so only `data/` moved —
574 MB, not 26 GB. Verified on the box afterwards, not assumed:

```
$ find ~/wam-t041/raw/G1_Dex3_*_Dataset -path '*/data/*' -name '*.parquet' | wc -l
14                       # 13 sets — ToastedBread has two chunk files, the other twelve one each
$ du -cb ~/wam-t041/raw/G1_Dex3_*_Dataset/data   | tail -1
573549416                # 574 MB of state/action — the part that was missing
$ du -cb ~/wam-t041/raw/G1_Dex3_*_Dataset/videos | tail -1
26463755207              # 26.5 GB of mp4 — unchanged, nothing was re-downloaded
```

**Schema**, read off `G1_Dex3_PickBottle_Dataset/data/chunk-000/file-000.parquet` with
`pyarrow.parquet.ParquetFile(...).schema_arrow`:

| column | type |
|---|---|
| `observation.state` | `list<element: float>` — `[28]` per `meta/info.json` |
| `action` | `list<element: float>` — `[28]` |
| `timestamp` | `float` |
| `frame_index`, `episode_index`, `index`, `task_index` | `int64` |

`num_rows = 176774`, which **equals that set's `meta/info.json` `total_frames` exactly** — so the
fetch is complete rather than truncated. All 13 report `codebase_version: v3.0`, `fps: 30.0`,
`robot_type: Unitree_G1_Dex3`, and 28-dim state/action, matching
`groot/g1_dex3_modality_config.py`'s arms(0–14) + hands(14–28) slicing.

**Counts actually obtained**, each read from that set's own `meta/info.json`:

| dataset | eps | frames | cameras in `info.json` |
|---|---:|---:|---|
| BlockStacking | 301 | 281,196 | 4-cam (+ wrist) |
| CameraPackaging | 201 | 256,253 | 4-cam (+ wrist) |
| GraspSquare | 301 | 281,196 | 4-cam (+ wrist) |
| ObjectPlacement | 210 | 98,266 | 4-cam (+ wrist) |
| PickApple | 201 | 152,569 | 2-cam |
| PickBottle | 202 | 176,774 | 2-cam |
| PickCharger | 200 | 123,260 | 2-cam |
| PickDoll | 203 | 300,557 | 2-cam |
| PickGum | 199 | 113,592 | 2-cam |
| PickSnack | 200 | 163,487 | 2-cam |
| PickTissue | 205 | 166,756 | 2-cam |
| Pouring | 311 | 121,587 | 4-cam (+ wrist) |
| ToastedBread | 418 | 352,022 | 4-cam (+ wrist) |
| **TOTAL** | **3,152** | **2,587,515** | |

"4-cam" = `cam_left_high`, `cam_right_high`, `cam_left_wrist`, `cam_right_wrist`; "2-cam" =
`cam_left_high`, `cam_right_high`. The split is **7 `Pick*` sets at 2-cam and 6 non-`Pick` sets at
4-cam** — which is exactly what [[TASK-180]]'s open follow-ups already recorded ("the 6 non-Pick
sets are 4-cam, so the merge needs camera-key reconciliation or a 4-cam modality config"). Only
`cam_left_high` and `cam_right_high` are common to all 13.

#### (a) The counts do not match TASK-188's 182 / 157,151. Nothing here does.

Test Strategy item 1 asks for this to be stated outright rather than glossed, so: **they do not
match, and they are not close.** The 13-set total is **3,152 episodes / 2,587,515 frames** against
the **182 / 157,151** that [[TASK-188]] (line 97) and [[TASK-185]] quote — 17× the episodes and
16× the frames. **No single set matches either**, so this is not a case of one set having been
mislabelled as the merge.

**Therefore every number in TASK-188 and TASK-185 is against a different dataset and is not
comparable to anything trained on what is now on disk.** That includes the ones it is most tempting
to carry forward: the 2/10 closed-loop real-only baseline, the 0.3811 rad / 25.6 % offline holdout
figure, and the 0.081 rad hold-current-state baseline. None of them is a valid "before" for a run
against these 13 sets. Do not put them in the same table as a new result without saying so.

**Hypothesis — clearly labelled as such, not established fact.** `unitree_g1_train` was most
plausibly a **182/20 train/holdout split of `G1_Dex3_PickBottle_Dataset` alone**, not a merge:

* TASK-185 lists `unitree_g1_train` (182 real) and `unitree_g1_holdout` (20 real) side by side.
  **182 + 20 = 202, and PickBottle has exactly 202 episodes.** No other set has 202.
* The frame arithmetic works. PickBottle is 176,774 frames; 176,774 − 157,151 = **19,623 frames
  left for the 20 held-out episodes = 981.1 frames/ep**, which sits at the **70th percentile** of
  PickBottle's own episode-length distribution (min 343 / median 755 / mean 875 / max 2,633,
  computed by counting `episode_index` in the parquet). A random 20-episode holdout can sum to
  anything in [9,233, 35,403]; 19,623 is comfortably inside.
* PickBottle is **2-cam**, and TASK-188 describes the set as having exactly the two head-stereo
  views `cam_left_high` + `cam_right_high`.
* Every other set is eliminated on arithmetic or on shape. Five (ObjectPlacement, PickApple,
  PickCharger, PickGum, Pouring) have **fewer than 157,151 frames in total**, so a 182-episode
  subset of them cannot reach it. PickSnack/PickTissue/CameraPackaging/PickDoll leave a
  remainder-per-episode 2–4× off their own mean. BlockStacking, GraspSquare and ToastedBread pass
  the ratio test only by holding out 119, 119 and 236 episodes respectively — implausible holdouts,
  and all three are 4-cam, contradicting TASK-188's two-camera description.

This is consistent evidence, not proof — nothing on this box holds the original `unitree_g1_train`
to check against, and it is a hypothesis precisely because that artefact is gone. If it is right,
TASK-188's numbers describe a **single-task PickBottle policy**, which makes them a reasonable
target for a *PickBottle* rerun and meaningless for a 13-set multi-task run.

#### (b) The 26 GB of local video is single-camera — and it is the *wrong* single camera

Every one of the 13 local directories has exactly one populated camera:

```
$ ls ~/wam-t041/raw/G1_Dex3_*_Dataset/videos/
observation.images.cam_left_high        # ...and nothing else, in all 13
```

58 mp4 files under `cam_left_high`, **zero** files and no directory at all under `cam_right_high`,
`cam_left_wrist` or `cam_right_wrist`. That 58 is not a partial fetch: it equals upstream's
`cam_left_high` file count exactly, so the left camera is complete and the others were never
started.

**⚠ This blocks the 1-cam path too, which is not obvious.** It is tempting to conclude "1-cam is
unblocked, only the 2-cam finetune has to wait". That is wrong. The committed single-camera config
uses the **right** camera, not the left:

* `vla-training/groot/g1_dex3_1cam_modality_config.py:26` — `modality_keys=["cam_right_high"]`
* `vla-training/groot/modality_g1_dex3_1cam.json` — its `video` block contains only
  `cam_right_high` → `observation.images.cam_right_high`

and the header explains why it is that camera and not the other: the DreamGen dreams were generated
single-view, and both ablation arms had to see the identical camera set. So with only
`cam_left_high` on disk, **both** committed paths — 1-cam and 2-cam
(`g1_dex3_2cam_modality_config.py:22`, `modality_g1_dex3_2cam.json`) — reference video that is not
there. There are two ways out, and they should be a deliberate choice:

1. **Fetch `cam_right_high`** and keep both configs as committed. Exact cost, from the Hub tree API
   (`GET /api/datasets/<id>/tree/main/videos?recursive=true`, which reports sizes without
   downloading): **56 files, 24.31 GiB (26.1 GB) across the 13 sets.** That roughly doubles the
   26 GB already on disk.
2. **Point a 1-cam config at `cam_left_high`** — a two-line change to a copy of the config + its
   modality json, zero download. Cheapest way to a first end-to-end finetune. But it is then **not**
   the same camera TASK-185 trained on, which is one more reason its numbers are not a baseline.

Upstream video inventory across all 13 sets, for planning (same API, no download):

| camera | files | size |
|---|---:|---:|
| `cam_left_high` | 58 | 24.65 GiB | ← the only one local |
| `cam_right_high` | 56 | 24.31 GiB | ← needed by both committed configs |
| `cam_left_wrist` | 22 | 9.09 GiB | 6 sets only |
| `cam_right_wrist` | 23 | 9.88 GiB | 6 sets only |
| **all** | **159** | **67.92 GiB** | |

#### What the camera split means for a merged multi-set finetune

Only `cam_left_high` + `cam_right_high` exist in all 13 sets. A merged 13-set run therefore has to
either drop the wrist views (levelling all 13 down to the 2-cam intersection) or reconcile keys so
the 7 `Pick*` sets carry absent wrist entries — GR00T's loader indexes
`modality_meta[modality][key]` positionally, so a modality.json promising four cameras against a
set that has two mis-maps video keys rather than failing loudly. Note that
`scripts/40_groot_prepare_dataset.sh` copies `groot/modality_g1_dex3.json`, which is the **4-camera**
variant, into *every* dataset it prepares — correct for the 6 non-`Pick` sets, wrong for the 7
`Pick*` ones. Pass the 1cam/2cam variant explicitly, or prepare only the 4-cam sets with the default.
This is the same reconciliation TASK-180 deferred to its never-run Phase B.

### ⚠ TASK-189 is marked `done` and is counted as a satisfied blocker. It is not satisfied.

[[TASK-189]] built the harness that superseded task185's: `grid.py` + `eval_rollouts.py` +
`server.py` + `guards.py` + `stats.py` + `analyze.py`, 51 offline tests, hardened by an adversarial
review, and it ran an unattended n=40 replication grid. **None of it is on this box.** It lived in
`$UNITREE_ROOT/_data/task189` on the retired machine.

That matters more than the task185 loss, because [[TASK-187]] lists `[[TASK-189]]` in its
`depends_on` and TASK-189's status is `done` — so a reader traversing the dependency graph concludes
the eval harness is ready. It is not. Anyone re-planning this work should treat TASK-189 as
**done-but-unavailable** and re-derive its two load-bearing results, which are worth more than the
code:

* n=10 is too few. TASK-189's own n=40 grid put `real_only` place at **3/40**, against the n=10
  estimate of 2/10 — the small-n number was optimistic.
* The push proxy is **invalid**, and was refused automatically: off-instruction 56/80 *equals*
  on-instruction 56/80. Any rebuilt harness must keep a guard that fails a cell whose
  off-instruction control matches its on-instruction score, or it will report success from a
  criterion that cannot distinguish the two.

### Four pieces, in dependency order

**Status 2026-08-28: 1 and 2 are done, 3 and 4 are untouched.** The two done items are
struck through and annotated below rather than deleted, so the original framing stays
readable next to what actually happened.

1. ~~**Re-fetch the training data.**~~ **✅ DONE 2026-08-28.** The `data/` split was pulled for all
   13 `unitreerobotics/G1_Dex3_*` sets — 574 MB of parquet, no mp4 re-downloaded. Counts, schema and
   verification are in **"Step 1: done"** above. Two findings came out of it that were not
   anticipated when this item was written: the counts do not match TASK-188's (finding **(a)**), and
   the local video turns out to be `cam_left_high`-only while both committed modality configs want
   `cam_right_high` (finding **(b)**). **(b) means item 3 is not actually unblocked yet** — decide
   between fetching 24.31 GiB of right-camera video and retargeting a 1-cam config at the left
   camera before starting a finetune.

   ⚠ **Do not point at [[TASK-180]] for the merge that produced `unitree_g1_train`** — the first
   draft of this file did, and it is wrong. TASK-180 Phase A merged **7 `Pick*` sets into 1410
   episodes / 7 language tasks**; its Phase B (the 13-set expansion) was never run. Neither is the
   182-episode / 157,151-frame set TASK-188 quotes. If your rebuilt set does not land at
   182/157,151, then **every number in TASK-188 and TASK-185 is against a different dataset and is
   not comparable** — say so explicitly in this task rather than quietly comparing across them.

2. ~~**Port `vla-training`'s GR00T scripts.**~~ **✅ DONE 2026-08-28** — see "Step 2: done" below
   for exactly what changed. Original framing, still accurate as the reason it was needed:
   they are committed and correct in substance but their paths are stale: `scripts/40_groot_prepare_dataset.sh` and `41_groot_finetune.sh` both hardcode
   `GROOT=~/unitree/Isaac-GR00T` and `VT=~/unitree/vla-training`, **neither of which exists here**
   (Isaac-GR00T is at `~/Isaac-GR00T`, vla-training at `~/develop/vla-training`). Make the paths
   overridable rather than editing them in place.

   The memory recipe is already in `41_groot_finetune.sh` and is worth reading before changing
   anything: N1.7 has **no LoRA** (removed since 1.6), the CLI levers are `--global-batch-size`
   (which is batch *per forward*) and `--gradient-accumulation-steps`, currently 4 × 8, and the
   documented OOM fallback is `gradient_checkpointing: True` + `optim: "paged_adamw_8bit"` set in
   `gr00t/configs/training/training_config.py` because they are not CLI-exposed. This matches what
   TASK-188 records independently — stock `adamw_torch` OOM'd at 31.9/32 GB even at batch 1, and the
   5090 has the same 32 GB. Also keep `HF_HUB_OFFLINE` unset: the gated `Cosmos-Reason2-2B` backbone
   needs an online token-authed `model_info()` call.

   Note `41_groot_finetune.sh` defaults to `--max-steps 10000`; TASK-188 lever 2 wants 14,000.
   This was **surfaced, not silently changed** — see "Step 2: done".

3. **Serve a checkpoint.** — ⬜ **OPEN, not started.** `~/Isaac-GR00T/gr00t/eval/run_gr00t_server.py` is present, and
   `scripts/42_groot_serve.sh` already drives it. No WSL2 localhost-forwarding is needed any more —
   sim and server are the same host, so plain `127.0.0.1:<port>` works with nothing forwarding it.

4. **Retarget the closed-loop eval from the apple task to the cylinder pick-place task.**
   ⬜ **OPEN, not started** — and the largest remaining piece, because TASK-189's statistical
   machinery and guards have to be rebuilt from scratch (see the TASK-189 warning above).
   `vla-training/eval/` already has a working Isaac closed-loop loop (`isaac_dds_bridge.py`,
   `run_apple_eval_isaac.py`) plus a whole `isaac/apple_task/` with its own rewards and
   terminations. The work is retargeting it to `Isaac-PickPlace-Cylinder-G129-Dex3-Joint`, scoring
   off `rt/rewards_state` (reward 1.0 = cylinder in the target area) on DDS **domain 1**, and
   re-adding TASK-189's statistical machinery and guards.

   ⚠ Carry this trap forward: `G1_29_ArmController` runs a `while True` thread writing `rt/lowcmd`
   and `Dex3_1_Controller` spawns non-daemon children, so a "finished" eval keeps commanding the
   robot and fights the next run — every cell reads 0/10 until stale PIDs are killed. Make the
   harness verify no eval process survives between runs.

### Step 2: done. The GR00T scripts resolve their own paths now (2026-08-28)

Changed in `~/develop/vla-training` (repo B, separate from this one), two files, paths only:

| file | before | after |
|---|---|---|
| `scripts/40_groot_prepare_dataset.sh:8-9` | `GROOT=~/unitree/Isaac-GR00T`<br>`VT=~/unitree/vla-training` | `GROOT="${ISAAC_GROOT_DIR:-$HOME/Isaac-GR00T}"`<br>`VT="${VLA_TRAINING_DIR:-$HOME/develop/vla-training}"` |
| `scripts/41_groot_finetune.sh:20-21` | same two stale lines | same two overridable lines |

This is the pattern `scripts/42_groot_serve.sh:7` already used — that file had been ported and 40/41
had not, so the fix was to make them consistent rather than to invent anything. Comments are in
German to match the surrounding file. `ISAAC_GROOT_DIR` was already the established name; the
companion is `VLA_TRAINING_DIR`.

Verified without executing either script (both launch GPU work):

```
$ bash -n scripts/40_groot_prepare_dataset.sh && bash -n scripts/41_groot_finetune.sh   # both clean
$ bash -c 'GROOT="${ISAAC_GROOT_DIR:-$HOME/Isaac-GR00T}"; VT="${VLA_TRAINING_DIR:-$HOME/develop/vla-training}"; echo $GROOT $VT'
$HOME/Isaac-GR00T $HOME/develop/vla-training      # both exist
$ ISAAC_GROOT_DIR=/opt/groot VLA_TRAINING_DIR=/opt/vt bash -c '...'
/opt/groot /opt/vt                                                  # overrides win
```

Every path the two scripts then reach for was confirmed to exist:
`Isaac-GR00T/scripts/lerobot_conversion/convert_v3_to_v2.py`,
`Isaac-GR00T/gr00t/experiment/launch_finetune.py`,
`Isaac-GR00T/gr00t/configs/training/training_config.py` (the OOM-fallback file),
`vla-training/groot/g1_dex3_modality_config.py`.

**Deliberately left alone:**

* The whole 5090 memory recipe in `41_groot_finetune.sh`'s header — no LoRA in N1.7,
  `--global-batch-size 4` × `--gradient-accumulation-steps 8`, and the non-CLI OOM fallback
  (`gradient_checkpointing: True` + `optim: "paged_adamw_8bit"` in
  `gr00t/configs/training/training_config.py`). Untouched, and the diff is two lines plus comments.
* `HF_HUB_OFFLINE` is **still unset**, and is not set anywhere in `scripts/4*.sh`. It must stay that
  way: the gated `Cosmos-Reason2-2B` backbone needs an online token-authed `model_info()` call.
* `--max-steps 10000`. **Surfaced, not changed** — a comment in the header now records that
  TASK-188 lever 2 wants 14,000 and that the value has been left as-is on purpose. It also warns
  that appending a second `--max-steps 14000` is only safe if tyro is confirmed to let the later of
  two duplicate flags win; otherwise edit the line. That was not tested, because testing it means
  starting a finetune.

**Not ported, and out of scope for this step** — the same stale `~/unitree/vla-training` prefix
survives in `scripts/30_train_act.sh:12`, `31_train_smolvla.sh:12`, `32_train_pi05_lora.sh:19`,
`71_dreams_prepare_seed.sh:9` (that one at least reads `${VT:-...}`, so it is overridable) and in
`groot/g1_dex3_modality_config.py:7`'s docstring example. None is on the GR00T finetune path, so
none blocks steps 3–4, but the next person in that repo will hit them.

### Isaac on this box

Isaac's RTX renderer is Vulkan; Vulkan needs `/dev/dri/renderD*`, whose ACL systemd-logind grants
only to whoever holds seat0 — which an SSH session does not. Run it as root in a container; the
invocation is in `robot-agent/hardware/isaac_sim_patches/README.md`. Only ever run **one**
`sim_main.py` at a time, and after killing a container wait for `nvidia-smi` to return to its
~111 MiB baseline before relaunching.

## Test Strategy

Done when it reproduces a number end to end without manual steps:

1. ✅ **Met, 2026-08-28, except the modality.json clause.** The data fetch produces a dataset with a
   non-empty `data/` split, and its episode/frame counts
   are **recorded in this task** next to TASK-188's quoted 182 / 157,151 with an explicit statement
   of whether they match. Its `meta/modality.json` lists both `cam_left_high` and `cam_right_high`.
   — Counts recorded and the mismatch stated outright, see finding **(a)**. The modality.json clause
   **cannot be met as written yet**, for two reasons worth keeping: (i) these are `v3.0` sets and
   carry no `meta/modality.json` at all — that file is written by
   `scripts/40_groot_prepare_dataset.sh` *after* the v3→v2 conversion, so this is a check on the
   prepared dataset, not the raw one; and (ii) per finding **(b)** there is no `cam_right_high`
   video on disk, so a modality.json naming it would point at files that do not exist. Re-check this
   item after the camera decision in **(b)** is made.
2. A short finetune (a few hundred steps — enough to prove the loop, not to produce a policy) runs
   to completion on the 5090 without OOM and writes a checkpoint.
3. That checkpoint serves, and the closed-loop harness drives the sim and returns a success count
   over **≥ 40 reset-isolated rollouts**. Not 20: [[TASK-189]] ran exactly this comparison and found
   its n=10 estimate of 2/10 became 3/40 at n=40, and its title records n≥40 as the power bar. A
   rebuilt harness that settles for less re-introduces the problem TASK-189 existed to fix.
4. The harness **refuses** a cell whose off-instruction control score equals its on-instruction
   score, automatically and without asking. This is TASK-189's single most valuable guard: it is
   what caught the push proxy being invalid (56/80 vs 56/80) instead of reporting it as a result.
5. Two consecutive eval runs give the same score on the same checkpoint, proving no stale process
   is bleeding across runs.
6. The **hold-current-state** offline baseline (0.081 rad, from TASK-185) is reported alongside any
   MAE, so the metric's degeneracy stays visible — offline MAE ranks inertness on this data.
