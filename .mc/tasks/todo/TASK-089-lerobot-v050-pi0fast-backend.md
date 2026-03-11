---
id: TASK-089
title: LeRobot v0.5.0 — Pi0-FAST Backend in vla-server
status: todo
priority: medium
tags:
- vla
- backend
- lerobot
owner: Devin + Robert
depends_on:
- TASK-088
created: 2026-03-11
updated: 2026-03-11
---

# TASK-089 — LeRobot v0.5.0: Pi0-FAST Backend

## Motivation

Pi0-FAST ist ein neuer autoregressive VLA-Ansatz (Gemma 300M als Action Expert + FAST-Tokenization),
der neben dem bestehenden Flow-Matching Pi0 als Alternative steht. Phuc's RTX 5070 (12 GB VRAM)
kann Pi0-FAST problemlos laufen lassen. Wir integrieren es als weiteren `VLA_BACKEND`-Wert
in unserem vla-server.

## Scope

### 1. Pi0-FAST Backend (Robert — Python/ML)
- `vla-server/backends/pi0_fast.py` — neues Backend-Modul
  - Lädt `lerobot/pi0_fast` Policy
  - FAST Action Tokenizer: `lerobot/fast-action-tokenizer`
  - Config: `temperature`, `max_decoding_steps`
  - RTC-compatible (kann mit TASK-088 RTC kombiniert werden)
- `vla-server/server.py`: Backend-Registry um `pi0_fast` erweitern
- `vla-server/config.yaml.example`: `backend: pi0_fast` Beispiel hinzufügen

### 2. TypeScript Config (Devin)
- `robot-agent/.env.so101.example`: `VLA_BACKEND=pi0_fast` als Option dokumentieren
- RMS UI: VLA Backend-Selector im VlaControlSection (Dropdown: smolvla / pi0 / pi0_fast)
  - Nur anzeigen wenn mehrere Backends konfiguriert sind

### 3. Tests
- `vla-server/tests/test_pi0_fast_backend.py`: Unit-Test mit Mock-Model
- TypeScript: `npx tsc --noEmit` → 0 errors

## Done when
- [ ] `VLA_BACKEND=pi0_fast` in `.env.so101` → Pi0-FAST Inference läuft auf phuc
- [ ] Backend-Dropdown in VlaControlSection (wenn >1 Backend verfügbar)
- [ ] Unit-Tests für pi0_fast backend
- [ ] Benchmark: Pi0-FAST vs Pi0 inference latency auf phuc dokumentiert

## References
- Pi0-FAST Docs: https://huggingface.co/docs/lerobot/pi0fast
- FAST Tokenizer: https://huggingface.co/lerobot/fast-action-tokenizer
- Pi0-FAST Base Model: https://huggingface.co/lerobot/pi0_fast
- Depends on TASK-088 (Phuc muss LeRobot v0.5.0 haben)
