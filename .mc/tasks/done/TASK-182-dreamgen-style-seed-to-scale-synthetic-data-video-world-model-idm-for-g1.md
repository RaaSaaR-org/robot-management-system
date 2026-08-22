---
id: TASK-182
aliases:
- TASK-182
title: DreamGen-style seed-to-scale synthetic data — video world model + inverse dynamics for the G1
slug: dreamgen-style-seed-to-scale-synthetic-data-video-world-model-idm-for-g1
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- extended
- synthetic-data
- cosmos3
- world-model
- vla
sprint: ''
depends_on: []
due_date: ''
created: 2026-07-12
updated: 2026-07-14
status_note: 'ACs 1-3+5 DONE, AC 4 offline-half DONE 2026-07-14 (closed-loop half
  blocked) — Spike (07-13): stages 1-3, AC 2 met (IDM 20k: MAE 0.079rad/5.5%
  norm = 4.2x over train-mean baseline). Phase 2 (07-14): (1) AC 3 DONE: +30
  dreams (50 total: 16 seen/24 novel_pick/10 unseen push/slide/tip prompts),
  all labeled with 20k IDM, exported via lerobot 0.4.1 as valid LeRobot v3.0
  Unitree_G1_Dex3 (h264) + meta/provenance.json, registered _synthetic via new
  server/src/scripts/register-neural-synthetic.ts (validation rules green),
  2/2 live Playwright (datasets UI + local episode/frames/video serving);
  dataset: $UNITREE_ROOT/_data/task182_spike/g1_dex3_pickbottle_synthetic. (2)
  neural_traj wsl.py backend WIRED to real pipeline (76_dreams_one_episode.sh,
  b64 prompt), 9/9 pytest, typecheck green. (3) AC 4 offline ablation
  (GR00T-N1-2B = DreamGen paper base, 3000 steps bs8 identical arms): real
  holdout 6.4% vs 6.5% norm-MAE (no tax on seen task); HELD-OUT unseen-behavior
  dreams 16.8% (real-only) vs 7.7% (real+dreams) = 2.2x better, leakage-free
  protocol (5 unseen dreams excluded from training). (4) AC 5 DONE: RES-001
  §4.10 = GO for scale-out (conditions: closed-loop confirm, dream filter).
  Closed-loop Isaac eval + N1.7 rerun = split out to [[TASK-185]] (user
  decision 2026-07-14): fully prepared (eval distro = user-owned vhdx copy
  with the GPU-box runtime), blocked only on the pending Windows reboot that
  activates staged driver 610.43 (WSL CUDA currently segfaults machine-wide,
  see memory wsl-cuda-aslr-segfault-fix). Full story:
  _data\task182_spike\LEARNING_REPORT.md §8.'
completed: 2026-07-14
---

## Kickoff (prep 2026-07-12 — start here)

**Decision:** run the full stage-1–3 spike locally on the GPU box via GR00T-Dreams
+ Cosmos-Predict2-**2B**; rented GPU (14B/Cosmos3) only if 2B quality fails.

### Step 0 — WSL access (MANUAL, elevated shell, one-time)

The Ubuntu-22.04 runtime (one user account, all envs) lives in
`<wsl-vhdx>` (454 GB) but is registered only for the
colleague's Windows account. `wsl --import-in-place` as <user> fails
with `E_ACCESSDENIED` (account has Modify, not Full Control — WSL can't add the
VM-identity ACE). Fix in an **elevated** PowerShell (UAC), then everything else
runs unelevated:

```powershell
icacls "<wsl-vhdx>" /grant "<domain>\<user>:(F)"
wsl --import-in-place Ubuntu-22.04 "<wsl-vhdx>"
```

⚠ Standing rules for the shared vhdx: **never `wsl --unregister Ubuntu-22.04`**
(deletes the shared 454 GB disk for everyone); never run the distro from two
Windows accounts at once (second start fails on the file lock — coordinate with
the colleague). Nothing was running it as of 2026-07-12 (last write 07-06).
`--import-in-place` registers as root default user — use `wsl -d Ubuntu-22.04 -u <user>`.

### Step 1 — session bring-up (every WSL restart)

- `sudo bash $UNITREE_ROOT/fix_wsl_gpu_libs.sh` then verify `nvidia-smi` in WSL.
- Stop Ollama before any WFM run (`gpt-oss:20b` holds ~13–16 GB of the 32 GB).
- Sanity: `bash $UNITREE_ROOT/verify_envs.sh`.

### Step 2 — recon (not yet done, needs step 0)

- Locate the 1,410-episode seed set in `$UNITREE_ROOT` (LeRobot v3.0
  `Unitree_G1_Dex3`), list per-task episode counts, pick the seed task
  (most episodes / cleanest video).
- Check free disk inside the vhdx (`df -h ~`).

### Step 3 — environment spike

- Clone `github.com/nvidia/GR00T-dreams` into `$UNITREE_ROOT` (own env, never
  shared — repo is Apache-2.0). It requires **cosmos-predict2** installed first
  (its setup guide) plus `pip install openai tyro numpydantic albumentations
  tianshou git+https://github.com/facebookresearch/pytorch3d.git`; use cu128
  wheels (Blackwell), expect a possible flash-attn sm_120 rebuild.
- Prove Cosmos-Predict2-2B-Video2World **inference** on the GPU box first.
  ⚠ **Primary risk:** NVIDIA lists 2B video2world inference at ~26–33 GB —
  borderline on 32 GB. Mitigations: the GR00T 480p config
  (`predict2_video2world_training_2b_groot_gr1_480`), batch 1, model
  offloading flags, T5 embeddings precomputed offline (dataset format expects
  `t5_xxl/*.pickle` anyway). If it doesn't fit → documented fallback = rented
  GPU, per AC 1.
- Reference post-train command (adapt `--nproc_per_node=8` → `1`):
  `torchrun --nproc_per_node=1 -m scripts.train
  --config=cosmos_predict2/configs/base/config.py --
  experiment=predict2_video2world_training_2b_groot_gr1_480`
- Dataset format for post-training: `metas/*.txt` + `videos/*.mp4`
  (93 frames, 432×768 in the reference) + `t5_xxl/*.pickle`; build a converter
  from our LeRobot episodes for the chosen seed task.

### Step 4 — run stages 1–3 per the scope guard

Post-train on the 1 seed task → generate ≥20 neural trajectories (novel
prompts, provenance log) → train IDM on seed (video, 28-dim action) pairs
(GR00T-Dreams has the IDM pipeline; `modality.json`/`stats.json` +
`gr00t/experiment/data_config_idm.py` config needed for our embodiment) →
**IDM error report on held-out REAL episodes before trusting generated
videos** (AC 2). Then stage 4 (export/finetune/closed-loop eval) per Details.

## Description

Build the "one seed dataset → generate the rest" synthetic-data pipeline for the
Unitree G1: post-train a video world model on a **small seed of real teleop
episodes**, generate **novel** language-prompted robot videos ("neural
trajectories"), recover pseudo-actions with an **inverse-dynamics model (IDM)**,
and mix the result into GR00T-N1.7 finetuning. This is NVIDIA's own proven
recipe (DreamGen / GR00T-Dreams: +40% on GR00T N1 vs real-only; 22 new behaviors
from a single seed task) — and it fixes the exact weakness our TASK-175
pipeline hit.

## Why (and why our current pipeline can't do this)

The existing Cosmos pipeline (`server/curation/cosmos3_synth.py`, TASK-175, UI
wizard TASK-178) does **action-conditioned forward dynamics**: it replays *real*
action windows and generates matching video. That can only add **visual**
diversity — the action distribution stays a copy of the seed. The TASK-175
ablation confirmed it (`$UNITREE_ROOT/_data/task175_ablation/REPORT.md`,
2026-07-11): mixed/inconclusive, "repetitive action structure from only 2
source trajectories".

DreamGen inverts the flow: the world model generates **new videos** (new
behaviors, new environments, prompted by initial frame + language), and the
actions are **recovered afterwards** (IDM or latent-action model). New videos ⇒
new action structure ⇒ real generalization gains. This is the "data pyramid"
that GR00T N1/N1.5 are trained on, and the GR00T-Dreams DROID run generated
780k trajectories (≈6,500 h of demos) in 11 h of GPU time.

## Details

**Current state (what we already have):**
- Seed data: 1,410 real G1+Dex3 teleop episodes across 7 language-conditioned
  tasks (LeRobot v3.0, `Unitree_G1_Dex3`, **28-dim = 14 arm + 14 hand joints,
  4 cameras** — verified against `vla-training/groot/modality_g1_dex3.json` and
  `20_convert_json_to_lerobot.sh`; the earlier "43-D" claim was the DDS lowstate
  view, not the dataset), used by the
  TASK-180 multi-task GR00T-N1.7 finetune. Teleop collection keeps running on
  pz-264 (Quest 3 → JSON → LeRobot).
- Training + eval loop proven locally: GR00T-N1.7 full finetunes on GPU_BOX
  (GPU_BOX, TASK-179/180); offline + Isaac-DDS eval in `$UNITREE_ROOT/vla-training`.
- Cosmos access paths, costs, and limits fully mapped in [[RES-001]]
  (§4.2–4.7): HF PRO ZeroGPU for prototyping, DeepInfra/rented GPU for scale;
  Cosmos3-Nano is 16B BF16 (~32 GB → does NOT fit the GPU box comfortably), but
  **GR00T-Dreams uses Cosmos-Predict2 2B/14B — the 2B post-trains/runs on a
  single high-end consumer GPU**, so a fully local path exists.

**Pipeline to build (4 stages, DreamGen recipe adapted to us):**
1. **Post-train the video WFM on seed teleop videos** — start from
   `github.com/nvidia/gr00t-dreams` (Cosmos-Predict2-2B) locally on GPU_BOX;
   fall back to 14B / Cosmos3 on a rented GPU only if 2B quality is
   insufficient. Input: a subset of our real G1 episodes (videos + task strings).
2. **Generate neural trajectories** — condition on an initial frame (real lab
   photo works; RES-001 §4.7(c) verified identity-preserving image-conditioning)
   + language prompts for *novel* behaviors/objects/environments. Log
   prompt→video provenance.
3. **Pseudo-label actions** — train an IDM on the seed dataset's (video, 28-dim
   action) pairs (small model, local), run it over the generated videos.
   Alternative (heavier, deferred like [[TASK-177]]): Cosmos 3 inverse-dynamics
   mode with a custom 43-D head (RES-001 §4.9). Filter bad rollouts (physics
   glitches, task failure) — Cosmos-Reason-as-critic or simple heuristics +
   manual spot-check; record the reject rate.
4. **Convert + train + eval** — export to LeRobot v3.0 `Unitree_G1_Dex3`,
   register via the existing synthetic-dataset path (TASK-178 service tags
   `_synthetic`), finetune GR00T-N1.7 real-only vs real+neural, evaluate
   **closed-loop** (Isaac sim eval success rate — not just offline MSE; that
   was a TASK-175 ablation weakness), including one behavior/environment that
   has NO real seed episodes (the DreamGen headline test).

**Key files / integration points:**
- `server/curation/cosmos3_synth.py` — keep; add a sibling
  `server/curation/neural_traj/` (or extend) for stages 1–3.
- `server/src/services/CosmosSyntheticService.ts` + `GenerateSyntheticModal.tsx`
  — extend generator choice (`forward-dynamics` | `neural-trajectory`) once the
  CLI pipeline is proven; UI work is a follow-up, not part of the core spike.
- `$UNITREE_ROOT/vla-training` scripts — training/eval side (runs in WSL2).

**Scope guard:** stage 1–3 spike first (≤1 seed task, ≥20 generated episodes,
IDM pseudo-label error report) before any scale-out spend. GPU budget beyond
the GPU box needs the RES-001 §4.2–4.3 numbers re-checked.

## Acceptance Criteria

- [ ] Spike report: GR00T-Dreams/Cosmos-Predict2-2B post-trained on ≥1 seed G1
      task locally (or documented why a rented GPU is required), with sample
      generated videos spot-checked for G1 fidelity
- [ ] IDM trained on seed data; pseudo-label quality quantified on held-out
      REAL episodes (IDM action error vs ground truth) before trusting it on
      generated videos
- [ ] ≥50 neural-trajectory episodes exported as valid LeRobot v3.0
      `Unitree_G1_Dex3`, passing the existing dataset-validation worker, tagged
      `_synthetic` with generator provenance
- [ ] Ablation with closed-loop eval: GR00T-N1.7 real-only vs real+neural on
      (a) seen tasks and (b) ≥1 unseen behavior/environment; success rates
      recorded (fixing TASK-175's offline-only / low-seed-diversity weaknesses)
- [ ] RES-001 updated with the outcome; go/no-go on scale-out documented

## Test Strategy

Stage-gated: (1) generated-video eyeball + FVD/spot-check vs real seed frames;
(2) IDM error on held-out real episodes must beat a train-mean baseline by a
clear margin; (3) dataset validation worker green; (4) closed-loop Isaac eval
success rate is the decisive metric — offline MSE only as a sanity check.

## References (research)

**Core recipe:**
- **DreamGen: Unlocking Generalization in Robot Learning through Video World
  Models** (NVIDIA GEAR, 2025) — arXiv:2505.12705,
  https://arxiv.org/abs/2505.12705 — THE paper for this task: single-task seed
  teleop → post-trained video WFM → language-prompted neural trajectories →
  IDM/latent-action pseudo-labels → 22 new behaviors, 11.2%→43.2% on novel
  verbs; humanoid (GR1) validated.
- **GR00T-Dreams** (code, NVIDIA) — https://github.com/nvidia/gr00t-dreams —
  reference implementation (Cosmos-Predict2 based); DROID run: 780k
  trajectories in 11 h; +40% GR00T N1 improvement vs real-only.
- **NVIDIA blog: Enhance Robot Learning with Synthetic Trajectory Data
  Generated by World Foundation Models** —
  https://developer.nvidia.com/blog/enhance-robot-learning-with-synthetic-trajectory-data-generated-by-world-foundation-models/
- **GR00T N1: An Open Foundation Model for Generalist Humanoid Robots**
  (NVIDIA, 2025) — arXiv:2503.14734 — the "data pyramid" (real / synthetic+
  neural / web video) our finetunes inherit.

**Cosmos line (our access is already mapped in RES-001):**
- **Cosmos 3: Omnimodal World Models for Physical AI** (NVIDIA, 2026) —
  arXiv:2606.02800, tech report
  https://research.nvidia.com/labs/cosmos-lab/cosmos3/technical-report.pdf —
  native forward/inverse-dynamics + policy modes; inverse dynamics = the
  built-in pseudo-labeler (needs custom 43-D head for G1, RES-001 §4.9).
- **Cosmos World Foundation Model Platform for Physical AI** (NVIDIA, 2025) —
  arXiv:2501.03575.
- **Cosmos-Transfer1: Conditional World Generation with Adaptive Multimodal
  Control** (NVIDIA, 2025) — arXiv:2503.14492 — sim→real style transfer, the
  complementary augmentation axis (re-render Isaac rollouts photoreal).
- **Cosmos-H-Surgical: Learning Surgical Robot Policies from Videos via World
  Modeling** (2025) — arXiv:2512.23162 — independent domain replication of
  exactly this recipe (WFM rollouts + finetuned IDM → paired video-action data).

**Sim-based alternative/complement (transform seed demos in sim instead of
generating video):**
- **MimicGen: A Data Generation System for Scalable Robot Learning using Human
  Demonstrations** (NVIDIA, 2023) — arXiv:2310.17596 — ~200 human demos →
  50k+ demos via SE(3) trajectory adaptation in sim.
- **DexMimicGen: Automated Data Generation for Bimanual Dexterous Manipulation
  via Imitation Learning** (NVIDIA, 2024) — arXiv:2410.24185 — the humanoid+
  dexterous-hands version (~60 source demos → 21k), closest sim-based analog
  for G1+Dex3; needs our Isaac task scenes.
- **HumanoidMimicGen: Data Generation for Loco-Manipulation via Whole-Body
  Planning** (2026) — arXiv:2605.27724.
- **OmniRetarget: Interaction-Preserving Data Generation for Humanoid
  Whole-Body Loco-Manipulation** (2025) — arXiv:2509.26633.

**Context / surveys / adjacent:**
- **World Model for Robot Learning: A Comprehensive Survey** (2026) —
  arXiv:2605.00080 — positions neural-trajectory generation among WM uses.
- **Rethinking Video Generation Models for the Embodied World** (2026) —
  arXiv:2601.15282 — current limits of video models as embodied data engines.
- **Latent Action Pretraining from Videos (LAPA)** (2024) — arXiv:2410.11758 —
  the latent-action alternative to an explicit IDM (used by DreamGen too).
- **IGen: Scalable Data Generation for Robot Learning from Open-World Images**
  (2025) — arXiv:2512.01773 — seed = images instead of teleop; relevant to the
  "or video" half of the idea.

**Internal:**
- [[RES-001]] — Cosmos 3 access/pricing/limits; §4.6 TASK-175 ablation summary;
  §4.9 G1 action-space decision (43-D custom head).
- [[TASK-175]] / [[TASK-178]] — existing forward-dynamics pipeline + UI (kept,
  complementary). [[TASK-177]] — deferred Cosmos3-policy finetune (unchanged).
- Ablation report: `$UNITREE_ROOT/_data/task175_ablation/REPORT.md`.
