---
id: TASK-174
aliases:
- TASK-174
title: 'Spike: Cosmos 3 hosted access — build.nvidia.com + Reasoner NIM eval'
slug: spike-cosmos-3-hosted-access-build-nvidia-com-reasoner-nim-eval
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- extended
sprint: ''
depends_on: []
due_date: ''
created: 2026-06-28
updated: 2026-07-11
status_note: DONE — all acceptance criteria met; live generation captured via free HF Space (anonymous, 25.3s)
---


# Spike: Cosmos 3 hosted access — build.nvidia.com + Reasoner NIM eval

## Description

Time-boxed spike to evaluate **NVIDIA Cosmos 3** via hosted/managed access (no local GPU), so we can judge real value before any infra investment. Cosmos 3 cannot run on current EmAI infra (Mac MPS, Pi, Hetzner ARM) — this validates the cheapest access paths. See [[RES-001]] for full background.

## Details

**Current state:** We have no Cosmos 3 access. Cosmos 3 (Nano 16B / Super 64B, BF16, Linux+NVIDIA GPU only) is reachable today via (a) `build.nvidia.com` hosted endpoints, and (b) the **Reasoner NIM** container `nvcr.io/nim/nvidia/cosmos3-reasoner:latest` (vLLM-based, BF16/FP8/NVFP4). The **Generator NIM is not yet GA**.

**Scope (research + thin spike, no production code):**
1. Create an NVIDIA/NGC account, generate `NGC_API_KEY`, and call a Cosmos 3 model on `build.nvidia.com` (start with `cosmos3-nano`). Capture request/response shape, modalities accepted, and any rate/usage limits.
2. Test the **Reasoner** path (scene understanding from an image/video + text) against a NeoDEM-relevant clip (e.g. a robot/room frame). Record latency and qualitative quality.
3. Find and **document published pricing** (per-token / per-call / GPU-hour) for build.nvidia.com, NIM, and at least one third-party host (DeepInfra hosts `nvidia/Cosmos3-Nano`). This is an open question in [[RES-001]].
4. Identify which cloud GPU providers (Lambda, RunPod, Together, Replicate, Baseten, AWS/Azure/GCP) can run Cosmos 3 BF16 today, with rough $/hr for an H100/H200-class instance.
5. Write findings back into [[RES-001]] (fill the pricing/VRAM/real-time open questions) and recommend go/no-go for [[TASK-175]] / [[TASK-177]].

**Key files:** update `.mc/research/RES-001-*/RES-001.md`. No app/server code in this task.

## Acceptance Criteria
- [x] Successfully called a Cosmos 3 endpoint and captured a sample request/response — **DONE via free HF ZeroGPU Space** `multimodalart/Cosmos3-Nano` (`scratch/cosmos3/hf_generate.py`); build.nvidia.com hosted endpoint is 404/preview-gated (§4.1) but the Space works.
- [x] Pricing documented for ≥2 access paths (hosted + cloud-GPU) — RES-001 §4.2–4.3 (DeepInfra/Baseten + Vast/RunPod/Lambda/Together $/hr).
- [x] Latency + qualitative quality recorded for at least one NeoDEM-relevant input — **DONE:** see datapoint below + RES-001 §4.7.
- [x] [[RES-001]] open questions on pricing/VRAM updated; go/no-go recommendation written — RES-001 §4.6, Open Questions.

**✅ Live generation (2026-06-28, free / anonymous — no PRO needed):**
- Space `multimodalart/Cosmos3-Nano`, `/generate`, text→video. Prompt: *"A Unitree G1 humanoid robot picks a red mug off a kitchen counter…"*.
- Output: 640×352 h264 mp4, 33 frames @ 24fps (1.375s), 132 KB. **Latency 25.3s** wall-clock (360p, 33 frames, 20 steps), anonymous quota.
- **Quality:** photorealistic kitchen, plausible robot motion toward the red mug — but rendered a **generic robot arm, NOT a G1 humanoid** → confirms the G1 out-of-distribution gap ([[TASK-177]]).
- Reproduce: `scratch/cosmos3/hf_generate.py` (venv: `.venv`, `gradio_client`). Anonymous already works; HF PRO only needed to lift the daily quota / script reliably.

## Test Strategy
Manual: a saved sample API call + response in the research doc; reproducible curl/script snippet committed under `scratch/` or pasted into [[RES-001]].

## Notes
Time-box ~1 day. Pure evaluation — no changes to `server/`, `app/`, or `vla-server`.

**Findings (2026-06-28):** Access fully mapped in [[RES-001]] §4. Key correction vs original scope: **build.nvidia.com has no hosted serverless endpoint for Cosmos 3 Nano** (it's self-host NIM only; our key 404s — §4.1), and the **Generator NIM *has* shipped** (`cosmos3-generator:1.0.0`). **There is a free path** — HF Spaces on ZeroGPU, incl. official **`nvidia/Cosmos3-Action-Viewer`** (forward/inverse/policy) (§4.7).

**Chosen execution path:** buy **HF PRO ($9/mo)** → run one generation in-browser/`gradio_client` to close the two remaining criteria (sample gen + latency/quality). Ready-to-run kit: `scratch/cosmos3/hf_generate.py` + `scratch/cosmos3/HF-PRO-RUNBOOK.md`. HF PRO also prototypes [[TASK-175]]/[[TASK-176]]; [[TASK-177]] still needs a rented GPU (ZeroGPU can't train).
