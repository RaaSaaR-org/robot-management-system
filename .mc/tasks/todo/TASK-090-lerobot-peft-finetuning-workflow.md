---
id: TASK-090
title: LeRobot v0.5.0 — LoRA/PEFT Fine-Tuning Workflow auf phuc-the-ripper
status: todo
priority: medium
tags:
- vla
- training
- peft
- lerobot
- phuc
owner: Devin + Robert
depends_on:
- TASK-088
created: 2026-03-11
updated: 2026-03-11
---

# TASK-090 — LeRobot v0.5.0: LoRA Fine-Tuning Workflow

## Motivation

LeRobot v0.5.0 unterstützt PEFT/LoRA Fine-Tuning für große VLAs ohne Modifikation
der Trainings-Pipeline. Phuc's RTX 5070 (12 GB VRAM) ist ideal für LoRA-Runs —
deutlich weniger VRAM-Bedarf als Full Fine-Tuning.

Workflow: Teleoperation-Demos sammeln mit SO-101 → Dataset auf HF Hub → Fine-Tune auf phuc
→ Modell deployen auf phuc als Inference-Server → RMS nutzt fine-getuntes Modell.

Das wäre der erste "eigene Modell trainieren"-Flow im System.

## Scope

### 1. Fine-Tuning Script (Robert — Python)
`vla-server/scripts/finetune.sh` (Wrapper um lerobot-train):
```bash
#!/bin/bash
# Usage: ./finetune.sh <dataset_repo_id> <base_model> <output_name>
lerobot-train \
  --policy.type=${BASE_MODEL:-pi0} \
  --policy.peft_config.use_peft=true \
  --policy.peft_config.lora_rank=16 \
  --dataset.repo_id=${DATASET_REPO_ID} \
  --output_dir=./models/${OUTPUT_NAME}
```
- Configs für Pi0 + SmolVLA LoRA
- Resume from checkpoint support
- Output: HF-kompatibles Model-Directory

### 2. RMS Fine-Tuning UI (Devin — TypeScript/React)
Neue Seite: `app/src/features/training/pages/FineTuningPage.tsx`
- Dataset-Input (HF Hub Repo ID, z.B. `sebastian/so101-pick-place`)
- Base Model-Selector: pi0 / smolvla / pi0_fast
- LoRA Rank Slider (4 / 8 / 16 / 32)
- "Start Training" → SSH-Job auf phuc (via Server-Endpoint)
- Training Progress: Log-Stream vom phuc-Server
- "Deploy" Button: nach Training → phuc-Server neu starten mit neuem Modell

### 3. Server Fine-Tuning Endpoint
`server/src/routes/training.routes.ts`:
- `POST /api/training/finetune` — startet Job auf phuc via SSH + nohup
- `GET /api/training/status` — liest training log, gibt progress zurück
- `POST /api/training/deploy` — SSH auf phuc: modell wechseln + vla-server restart

### 4. Phuc-Integration
- SSH-Key für mindcube → phuc ist bereits konfiguriert (TOOLS.md: `ssh phuc`)
- `training_manager.py` auf phuc: empfängt Jobs, startet lerobot-train, streamt Logs zurück

## Done when
- [ ] `./finetune.sh sebastian/my-dataset pi0 my-model-v1` läuft durch auf phuc
- [ ] RMS UI zeigt Fine-Tuning Page + Training Progress
- [ ] Nach Training: "Deploy" Button wechselt aktives Modell auf phuc
- [ ] End-to-End getestet: Demo → Dataset → Train → Deploy → Inference mit SO-101

## References
- PEFT Docs: https://huggingface.co/docs/lerobot/peft_training
- LeRobot v0.5.0 Blog: https://huggingface.co/blog/lerobot-release-v050
- Phuc: 100.78.204.98 (SSH: `ssh phuc`), RTX 5070 12GB, Python 3.12, CUDA 13.1
- Depends on TASK-088 (Phuc muss LeRobot v0.5.0 haben)
