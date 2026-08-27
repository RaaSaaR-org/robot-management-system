---
id: TASK-225
aliases:
- TASK-225
title: Rebuild the VLA finetune + closed-loop eval harness on Linux (it went with the Windows box)
slug: rebuild-vla-train-eval-harness-on-linux
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
status_note: 'Blocks TASK-188 and TASK-187. The Windows GPU box was retired 2026-08-28
  and took the whole task185 harness with it — those scripts exist in NO git repo.
  The data and the GPU are here; the tooling is not.'
---


# Rebuild the VLA finetune + closed-loop eval harness on Linux (it went with the Windows box)

## Description

Every script that trained a GR00T policy and scored it closed-loop lived only on the retired
Windows/WSL box and was never committed to any repo. [[TASK-188]] and [[TASK-187]] both assume it
exists. Neither can start until it is rebuilt here.

This task is the rebuild. It is not a research task — the levers and metrics are already specified
in [[TASK-188]]; this is the tooling those levers need.

## Details

### What is gone, and what survived (verified on the box 2026-08-28)

| | |
|---|---|
| `task185_finetune.py` — finetune runner | **GONE**, in no git repo |
| `task185_run_ablation_n17.sh` — training driver | **GONE** |
| `task185_serve_n17.sh` — checkpoint server | **GONE** |
| `eval_g1_sim_groot_success.py` — closed-loop harness | **GONE** |
| `start_sim_pickplace_dex3.bat` — sim launcher | **GONE** (`.bat` is moot here) |
| Merged 182-ep `unitree_g1_train` | **not present** |
| Raw `unitreerobotics/G1_Dex3_*` datasets | **present** — `~/wam-t041/raw/` and the HF cache |
| `~/wam-t041/datasets/arm-A` | present, 402 eps / 171,625 frames — a *different* set, not the one TASK-188 quotes |
| `~/Isaac-GR00T`, incl. `gr00t/eval/run_gr00t_server.py` | **present** |
| `vla-server` with `configs/g1_dex3_1cam.yaml`, `g1_dex3_2cam.yaml` | **present** |
| `unitree_sim_isaaclab` | **present**, and runs — see `robot-agent/hardware/isaac_sim_patches/README.md` |
| GPU | **present** — RTX 5090, 32 GB |

So the data and the compute are here. What has to be rewritten is the glue.

### Four pieces, in dependency order

1. **Rebuild the training set.** TASK-188 quotes `unitree_g1_train` as 182 episodes / 157,151 frames
   / 30 fps with `cam_left_high` + `cam_right_high`. It is not on this box. TASK-180 (in `done/`)
   documents the 13-dataset merge that produced this family — re-run that merge from
   `~/wam-t041/raw/`, then record the resulting episode/frame counts in this task, because if they
   differ from 182/157,151 then every number quoted in TASK-188 and TASK-185 is against a different
   dataset and is not comparable.
2. **Finetune runner.** Replace `task185_finetune.py`. The env levers it carried are worth keeping:
   `paged_adamw_8bit` (stock `adamw_torch` OOM'd at 31.9/32 GB even at batch 1 — the 5090 has the
   same 32 GB, so this still applies) and gradient checkpointing. The gated `Cosmos-Reason2-2B`
   backbone needs an online token-authed `model_info()` call, so `HF_HUB_OFFLINE` must be unset.
3. **Serve a checkpoint.** `~/Isaac-GR00T/gr00t/eval/run_gr00t_server.py` is present and is the ZMQ
   PolicyServer. No WSL2 localhost-forwarding is needed any more — sim and server are the same host,
   so a plain `127.0.0.1:<port>` works.
4. **Closed-loop eval.** Replace `eval_g1_sim_groot_success.py`. It scores success off the sim's
   `rt/rewards_state` (reward 1.0 = cylinder in the target area) on DDS **domain 1**.
   ⚠ Carry the trap forward: `G1_29_ArmController` runs a `while True` thread writing `rt/lowcmd`
   and `Dex3_1_Controller` spawns non-daemon children, so a "finished" eval keeps commanding the
   robot and fights the next run — every cell reads 0/10 until stale PIDs are killed. Make the new
   harness verify no eval process survives between runs.

### Isaac on this box

Isaac's RTX renderer is Vulkan; Vulkan needs `/dev/dri/renderD*`, whose ACL systemd-logind grants
only to whoever holds seat0 — which an SSH session does not. Run it as root in a container; the
invocation is in `robot-agent/hardware/isaac_sim_patches/README.md`. Only ever run **one**
`sim_main.py` at a time, and after killing a container wait for `nvidia-smi` to return to its
~111 MiB baseline before relaunching.

## Test Strategy

The harness is done when it can reproduce a number end to end without manual steps:

1. The merge produces a dataset whose episode/frame counts are recorded in this task, and whose
   `meta/modality.json` lists both `cam_left_high` and `cam_right_high`.
2. A short finetune (a few hundred steps, enough to prove the loop, not to produce a policy) runs to
   completion on the 5090 without OOM and writes a checkpoint.
3. That checkpoint serves, and the closed-loop harness drives the sim and returns a success count
   over **≥ 20 reset-isolated rollouts** — the n=10 that TASK-189 showed is too few to tell 2/10
   from 5/10.
4. Two consecutive eval runs give the same score on the same checkpoint, proving no stale process
   is bleeding across runs.
5. The **hold-current-state** offline baseline (0.081 rad, from TASK-185) is reported alongside any
   MAE, so the metric's degeneracy stays visible — offline MAE ranks inertness on this data.
