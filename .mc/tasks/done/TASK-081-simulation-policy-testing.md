---
id: TASK-081
title: Simulation Integration — MuJoCo/Isaac Lab Policy Testing & Synthetic Evaluation
status: done
priority: 2
tags:
- vla
- simulation
- evaluation
- platform
depends_on:
- TASK-069
- TASK-080
created: 2026-02-24
updated: 2026-02-26
---


# TASK-081 — Simulation Integration for Policy Testing

## Problem

TASK-058 (Synthetic Data Pipeline) und TASK-069 (Isaac Lab REST Client) decken **synthetic data generation** ab — also das Erzeugen von Trainingsdaten in Simulation.

Was fehlt: **Policy Testing in Simulation** — also das Testen eines trainierten Modells in einer simulierten Umgebung **bevor** es auf echte Hardware deployed wird.

Das ist ein fundamentaler Safety- und Effizienz-Unterschied:
- Synthetic data = Sim → Daten → Training (offline)
- Policy testing = Trained model → Sim → Evaluation metrics (online)

## Scope

### Simulation Environments

1. **MuJoCo** (lokal, CPU-fähig, schnell):
   - SO-101 MJCF Model (basierend auf TASK-040 URDF)
   - Tabletop-Szenen: Pick & Place, Stacking, Sorting
   - Domain Randomization: Licht, Texturen, Objekt-Positionen

2. **Isaac Lab** (GPU, photorealistisch, parallel):
   - Isaac Lab Szenen über TASK-069 REST Client
   - 100+ parallele Environments für schnelle Evaluation
   - Photorealistische Rendering für visuellen Transfer-Test

### Backend

```
server/src/services/SimulationService.ts
server/src/routes/simulation.routes.ts
```

- **Sim Job Submission**: Starte N Rollouts in MuJoCo/Isaac mit Model-Version X
- **Parallel Execution**: MuJoCo-Rollouts auf CPU-Cores, Isaac auf GPU
- **Metrics Collection**: Success rate, collision count, avg steps to completion
- **Sim-to-Real Gap Tracking**: Vergleich Sim-Success vs. Real-Success pro Model

### Frontend

```
app/src/features/simulation/
├── pages/SimulationPage.tsx
├── components/
│   ├── SimJobLauncher.tsx          — Configure & launch sim evaluation
│   ├── SimResultsViewer.tsx        — Results table + video grid
│   ├── SimToRealComparison.tsx     — Sim vs Real success rate chart
│   └── EnvironmentBrowser.tsx      — Browse available sim environments
├── api/simulationApi.ts
└── store/simulationStore.ts
```

### Python Worker

```
server/workers/sim_evaluator/
├── mujoco_runner.py       — Load MJCF, run policy, collect metrics
├── isaac_runner.py         — Submit to Isaac Lab via REST (reuse TASK-069)
├── environments/
│   ├── so101_tabletop.py  — MuJoCo tabletop pick & place
│   └── so101_sorting.py   — MuJoCo sorting task
└── metrics.py             — Success detection, collision detection
```

## Acceptance Criteria

- [ ] MuJoCo SO-101 Tabletop Environment lauffähig
- [ ] Sim Job: Model auswählen → N Rollouts in Sim starten → Results Dashboard
- [ ] Sim-to-Real Comparison Chart in Evaluation Dashboard (TASK-080)
- [ ] Mindestens 2 Sim-Environments (Pick & Place, Sorting)
- [ ] Isaac Lab Integration über TASK-069 REST Client

## Warum wichtig?

1. **Safety**: Modell in Sim testen bevor es einen echten Arm steuert
2. **Effizienz**: 1000 Sim-Rollouts in Minuten vs. Stunden auf echter Hardware
3. **Iteration Speed**: Schnellere Train→Eval→Retrain Zyklen
4. **Benchmark**: Objektiver Vergleich verschiedener Checkpoints

## Related

- TASK-040: SO-101 URDF 3D Model (Basis für MJCF Konvertierung)
- TASK-058: Synthetic Data Pipeline (shared Infrastructure, aber anderer Zweck)
- TASK-069: Isaac Lab REST Client (wiederverwendbar für Policy Testing)
- TASK-080: Evaluation Dashboard (Sim-Ergebnisse fließen in Evaluation ein)
