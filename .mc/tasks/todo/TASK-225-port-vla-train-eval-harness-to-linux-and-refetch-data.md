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
depends_on: []
due_date: ''
created: 2026-08-28
updated: 2026-08-28
status_note: 'Blocks TASK-188 and TASK-187. Rewritten 2026-08-28 after review: the first
  draft had this backwards in both directions. The TOOLING largely survived — ~/develop/vla-training
  is a committed repo with the GR00T prepare/finetune/serve scripts AND the 2-cam modality config
  TASK-188 lever 1 asks someone to build. What is actually missing is (a) the DATA: all 13 raw
  G1_Dex3 dirs are videos+meta only, zero per-frame state/action parquet, so no finetune can run;
  and (b) TASK-189 closed-loop harness (grid/eval_rollouts/guards/stats/analyze), which superseded
  the task185 one, is gone — while TASK-189 is filed done and still counted as a satisfied blocker.'
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
| `unitree_sim_isaaclab` | **present** and runs — `robot-agent/hardware/isaac_sim_patches/README.md` |
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
| `~/wam-t041/raw/G1_Dex3_*_Dataset` (13 dirs, 26 GB) | **present but UNUSABLE for training** — see below |
| HF cache `datasets--unitreerobotics--G1_Dex3_*` | **empty stubs**, 156 KB total, `refs/` only |
| Merged 182-ep `unitree_g1_train` | **not present** |
| `~/wam-t041/datasets/arm-A` | present and complete — 402 eps, 402 data parquet, 959 MB — but a **different** dataset, not the one TASK-188 quotes |

⚠ **The 26 GB of "raw datasets" contains no training data.** Every one of the 13 directories holds
only `meta/` and `videos/` — there is no `data/` directory and **zero per-frame state/action
parquet** anywhere under `~/wam-t041/raw`:

```
$ find ~/wam-t041/raw -path '*/data/*' -name '*.parquet' | wc -l
0
$ du -sh ~/wam-t041/raw          # 26G, all mp4
```

A GR00T finetune consumes `data/chunk-*/*.parquet` (the state/action columns). Those were never
fetched. So this is a **download**, not a rebuild — but nothing can train until it is done, and
26 GB of video is already on disk for episodes whose actions are missing.

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

1. **Re-fetch the training data.** This is first and nothing else can start without it. Pull the
   `data/` split for the `unitreerobotics/G1_Dex3_*` sets (the videos are already local, so fetch
   the parquet rather than re-downloading 26 GB of mp4). Then record the episode/frame counts you
   actually get.

   ⚠ **Do not point at [[TASK-180]] for the merge that produced `unitree_g1_train`** — the first
   draft of this file did, and it is wrong. TASK-180 Phase A merged **7 `Pick*` sets into 1410
   episodes / 7 language tasks**; its Phase B (the 13-set expansion) was never run. Neither is the
   182-episode / 157,151-frame set TASK-188 quotes. If your rebuilt set does not land at
   182/157,151, then **every number in TASK-188 and TASK-185 is against a different dataset and is
   not comparable** — say so explicitly in this task rather than quietly comparing across them.

2. **Port `vla-training`'s GR00T scripts.** They are committed and correct in substance but their
   paths are stale: `scripts/40_groot_prepare_dataset.sh` and `41_groot_finetune.sh` both hardcode
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

3. **Serve a checkpoint.** `~/Isaac-GR00T/gr00t/eval/run_gr00t_server.py` is present, and
   `scripts/42_groot_serve.sh` already drives it. No WSL2 localhost-forwarding is needed any more —
   sim and server are the same host, so plain `127.0.0.1:<port>` works with nothing forwarding it.

4. **Retarget the closed-loop eval from the apple task to the cylinder pick-place task.**
   `vla-training/eval/` already has a working Isaac closed-loop loop (`isaac_dds_bridge.py`,
   `run_apple_eval_isaac.py`) plus a whole `isaac/apple_task/` with its own rewards and
   terminations. The work is retargeting it to `Isaac-PickPlace-Cylinder-G129-Dex3-Joint`, scoring
   off `rt/rewards_state` (reward 1.0 = cylinder in the target area) on DDS **domain 1**, and
   re-adding TASK-189's statistical machinery and guards.

   ⚠ Carry this trap forward: `G1_29_ArmController` runs a `while True` thread writing `rt/lowcmd`
   and `Dex3_1_Controller` spawns non-daemon children, so a "finished" eval keeps commanding the
   robot and fights the next run — every cell reads 0/10 until stale PIDs are killed. Make the
   harness verify no eval process survives between runs.

### Isaac on this box

Isaac's RTX renderer is Vulkan; Vulkan needs `/dev/dri/renderD*`, whose ACL systemd-logind grants
only to whoever holds seat0 — which an SSH session does not. Run it as root in a container; the
invocation is in `robot-agent/hardware/isaac_sim_patches/README.md`. Only ever run **one**
`sim_main.py` at a time, and after killing a container wait for `nvidia-smi` to return to its
~111 MiB baseline before relaunching.

## Test Strategy

Done when it reproduces a number end to end without manual steps:

1. The data fetch produces a dataset with a non-empty `data/` split, and its episode/frame counts
   are **recorded in this task** next to TASK-188's quoted 182 / 157,151 with an explicit statement
   of whether they match. Its `meta/modality.json` lists both `cam_left_high` and `cam_right_high`.
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
