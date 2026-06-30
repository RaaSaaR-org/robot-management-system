---
id: TASK-177
aliases:
- TASK-177
title: Cosmos 3 policy → Unitree G1 embodiment fine-tune + VLA Server backend
slug: cosmos-3-policy-unitree-g1-embodiment-fine-tune-vla-server-backend
status: backlog
priority: 3
owner: ''
projects: []
customers: []
tags:
- extended
sprint: ''
depends_on:
- '[[TASK-174]]'
due_date: ''
created: 2026-06-28
updated: 2026-06-28
---


# Cosmos 3 policy → Unitree G1 embodiment fine-tune + VLA Server backend

## Description

R&D investigation: can **Cosmos3-Nano-Policy** be **fine-tuned to the Unitree G1** embodiment and **served behind NeoDEM's VLA Server** as an alternative VLA backend? This is the long-horizon "production" bet aligned with our humanoid/G1 focus. See [[RES-001]]. Depends on [[TASK-174]]; informed by [[TASK-175]].

## Details

**Current state:** VLA Server (separate `../vla-server` repo) abstracts model backends (SmolVLA/pi0.5/GR00T) behind an HTTP interface; robot-agent calls it for inference. `Cosmos3-Nano-Policy-DROID` (16B) is a ready VLA-style policy fine-tuned on the **DROID** (Franka) dataset.

**⚠️ The core unknown:** Cosmos 3's documented action spaces are camera 9D, AV 9D, **egocentric 57D**, Franka 10D/20D, Agibot 29D, UR 10D, Google robot 10D, WidowX 10D, UMI 9D. **Unitree G1 / bipedal humanoid is NOT listed.** NVIDIA says fine-tuning to a new embodiment/camera/workspace/task is supported (open post-training scripts at `github.com/nvidia/cosmos`), but there is **no documented G1 recipe** — the 57D "egocentric motion" space is the closest existing target.

**Scope:**
1. Study the open post-training scripts + tech report to determine the **action-space mapping** for G1 (reuse 57D egocentric? define a custom head/DOF mapping for G1's ~29–43 DOF incl. Dex3-1 hands?).
2. Prototype a fine-tune on a **small G1 dataset** (from our LeRobot collection / twin-derived data) on a rented GPU.
3. Evaluate in sim first (the MuJoCo G1 twin / `sim_evaluator`) — do **not** put on real hardware until safe.
4. If viable, add a **`cosmos3` backend** to `../vla-server` behind the existing inference interface; assess **latency vs control-loop requirements** (diffusion is iterative → may not be closed-loop capable).
5. Compare against SmolVLA/pi0 on G1 (accuracy, latency, infra cost). Note: G1's reference VLA line (GR00T) already uses a Cosmos-Reason backbone — capture whether GR00T is the better humanoid path than a Cosmos3 policy fine-tune.

**Key files / repos:** `../vla-server` (new backend), `github.com/nvidia/cosmos` post-training scripts, `server/` deployment/registry, G1 sim from [[project_digital_twin]].

> ⚠️ **No free path for this task.** Unlike [[TASK-175]]/[[TASK-176]], the HF PRO / ZeroGPU route does **not** apply — ZeroGPU is **inference-only and cannot fine-tune**. This task requires a **rented NVIDIA GPU** (≥1×H100, many GPU-hours) for the post-training run. See [[RES-001]] §4.6–4.7.

## Acceptance Criteria
- [ ] Documented G1 action-space mapping decision (egocentric 57D vs custom head)
- [ ] A G1 fine-tune prototype trained and evaluated **in sim**
- [ ] Latency measured vs G1 control-loop requirement; closed-loop feasibility judged
- [ ] Recommendation: pursue Cosmos3 policy vs stick with SmolVLA/pi0/GR00T for G1, recorded in [[RES-001]]

## Test Strategy
Sim-only evaluation via the MuJoCo G1 twin + `sim_evaluator`; success-rate + latency vs baseline VLAs. No real-hardware deployment in this task.

## Notes
Biggest/riskiest of the Cosmos 3 tasks. Gate on [[TASK-174]] (cost/access) and ideally [[TASK-175]] (data pipeline). Aligns with [[project_embodiment_focus]] (G1 humanoid). Brand convention: "Kognitive Roboter".
