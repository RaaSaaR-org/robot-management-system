---
id: TASK-077
aliases:
- TASK-077
title: VLA Native Integration in RMS
slug: vla-native-integration-rms
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- extended
- vla
updated: 2026-08-29
---

# TASK-077 — VLA Native Integration in RMS

## Status: done
## Priority: high
## Component: robot-agent, sidecar

---
## 🚨 BLOCKED — Muss TASK-082 zuerst abgeschlossen sein

**Blocked-by: TASK-082 (VLA Server Consolidation)**

TASK-082 konsolidiert alle VLA-Server-Implementierungen in eine saubere Struktur
(`vla-server/` + `vla_runner.py`). TASK-077 darf erst starten wenn TASK-082 done ist,
weil sonst Code gebaut wird der sofort wieder weggeworfen werden muss.

**Nach TASK-082 ist der Scope von TASK-077 reduziert:**
- `vla_runner.py` (sidecar-native VLA loop) → bereits in TASK-082 enthalten
- TASK-077 fokussiert sich NUR noch auf: **TypeScript/UI-Integration**
  - VLA Status in Robot Detail Page (läuft/gestoppt, welcher Prompt)
  - Start/Stop Button aus dem Dashboard
  - VLA Sessions in DB loggen (Compliance)

Kein Python-Code mehr in TASK-077. Nur TypeScript + UI.

---

## Goal

Re-implement VLA inference natively in RMS — independent of `vla-tests` repo.
Remove subprocess-spawning of `client_pi.py`. Own the full stack: camera → inference → arm.

## Motivation

Currently the sidecar spawns `client_pi.py` (from vla-tests) as a subprocess.
This creates a cross-repo dependency with no versioning, no interface contract, and
breakage risk on either side. `vla-tests` remains the research lab; RMS gets its own
sustainable, production-ready VLA stack.

## Architecture

### Robot Agent (TypeScript)

```
robot-agent/src/vla/
├── VLAProvider.ts          ← Interface: start(config) / stop() / status()
├── providers/
│   ├── Pi05Provider.ts     ← OpenPI WebSocket (ws://<host>:8000)
│   └── GrootProvider.ts    ← GR00T gRPC (port 5555) [implement later]
└── VLAManager.ts           ← selects provider from .env.so101 VLA_BACKEND=pi05|groot
```

### Sidecar (Python)

```
robot-agent/hardware/
├── so101_sidecar.py        ← existing: arm + camera REST API
└── vla_runner.py           ← NEW: inference loop (camera → model → arm)
    ├── camera capture via picamera2 (reuse existing capture logic)
    ├── arm send_action via LeRobot
    └── inference client: Pi05Client (WS) or GrootClient (gRPC)
```

`/vla/start` → spawns `vla_runner.py` subprocess (same machine, controlled)
`/vla/stop`  → kills it
`/vla/status` → subprocess.poll()

## Implementation Steps

1. [ ] Write `vla_runner.py` — camera + arm + pi05 WS inference loop
       - Based on learnings from `client_pi.py` (copy logic, not import)
       - Args: `--host`, `--port`, `--prompt`, `--camera-index`, `--wrist-camera-index`
       - Structured JSON logging to stdout (for sidecar to capture)
2. [ ] Update `so101_sidecar.py` to spawn `vla_runner.py` instead of `client_pi.py`
3. [ ] Write `VLAProvider.ts` interface + `Pi05Provider.ts` (delegates to sidecar REST)
4. [ ] Write `VLAManager.ts` — reads `VLA_BACKEND` env var, instantiates correct provider
5. [ ] Update `state.ts` to use `VLAManager` instead of direct sidecar calls
6. [ ] Add `VLA_BACKEND=pi05` + `VLA_SERVER_HOST` to `.env.so101`
7. [ ] Test end-to-end: dashboard → start VLA → arm moves
8. [ ] `GrootProvider.ts` — implement only after GR00T is validated in vla-tests

## What stays in vla-tests

- `client_pi.py` — research tool, the GPU_BOX GPU server integration, model comparisons
- Server-side setup docs
- Experimental backends (GR00T, SmolVLA)

## Done when

- [ ] RMS VLA flow works with pi05 without any dependency on vla-tests
- [ ] `client_pi.py` subprocess call removed from sidecar
- [ ] TypeScript typechecks pass (`npx tsc --noEmit`)
- [ ] Tested live with SO-101 arm
