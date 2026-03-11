---
id: TASK-088
title: LeRobot v0.5.0 — SO-101 Migration + Real-Time Chunking (RTC)
status: todo
priority: high
tags:
- vla
- hardware
- lerobot
- sidecar
owner: Robert
depends_on: []
created: 2026-03-11
updated: 2026-03-11
---

# TASK-088 — LeRobot v0.5.0: SO-101 Migration + RTC

## Motivation

LeRobot v0.5.0 konsolidiert SO-100 und SO-101 in eine einheitliche Codebasis.
Unser `so101_sidecar.py` nutzt noch die alte separate Implementierung — Risiko für
Breaking Changes beim nächsten Update. Zusätzlich bringt v0.5.0 **Real-Time Chunking (RTC)**:
statt volle Action-Chunks abzuwarten werden Predictions kontinuierlich geblended → deutlich
smoothere, reaktivere Armbewegungen.

## Scope

### 1. SO-101 API Migration
- `robot-agent/hardware/so101_sidecar.py`: auf konsolidierte v0.5.0 SO-101/SO-100 API migrieren
- Breaking Changes in LeRobot's SO-101 Interface identifizieren + anpassen
- Calibration-Format prüfen (v0.5.0 hat consolidated calibration)
- Conda-Env auf Pi updaten: `conda activate lerobot && pip install lerobot==0.5.0`
  - Achtung: v0.5.0 braucht Python 3.12 → Conda-Env upgrade nötig
  - Pi läuft Python 3.11.2 (System), aber Conda-Env kann 3.12 haben

### 2. LeRobot v0.5.0 auf GPU-Server installieren
- Phuc (100.78.204.98): PyTorch + CUDA + LeRobot v0.5.0 einrichten
  - Ubuntu 24.04, Python 3.12 ✅, CUDA 13.1, RTX 5070 12GB
  - `pip install torch --index-url https://download.pytorch.org/whl/cu128`
  - `pip install lerobot[smolvla,pi0]`
- Sebastian's Mac: LeRobot auf v0.5.0 updaten

### 3. Real-Time Chunking (RTC) in vla_runner.py
- `vla-server/server.py`: RTC-Config (`rtc_config.enabled=true`) an Policy weitergeben
- `robot-agent/hardware/vla_runner.py`: überlappende Inference-Calls statt serielle Queue
  - Statt: warten bis Queue leer → re-fill
  - Mit RTC: parallel zur Ausführung von Chunk N bereits Chunk N+1 berechnen + blenden
- Neues Config-Feld: `VLA_RTC_ENABLED=true` in `.env.so101`
- RTC-Parameter: `blend_interval`, `chunk_overlap` configurable

## Done when
- [ ] SO-101 sidecar läuft mit LeRobot v0.5.0 API (kein Breaking Error)
- [ ] Phuc-the-ripper hat funktionierendes LeRobot v0.5.0 + PyTorch + CUDA
- [ ] `VLA_RTC_ENABLED=true` macht Arm-Bewegung messbar smoother (kein Rucken an Chunk-Grenzen)
- [ ] TypeScript-Seite: `VLA_RTC_ENABLED` als Config in `robot-agent/.env.so101` dokumentiert
- [ ] `npx tsc --noEmit` in robot-agent/ → 0 errors

## References
- LeRobot v0.5.0 Blog: https://huggingface.co/blog/lerobot-release-v050
- RTC Paper: https://huggingface.co/papers/2506.07339
- RTC Docs: https://huggingface.co/docs/lerobot/rtc
- SO-101 Docs: https://huggingface.co/docs/lerobot/so101
