---
id: TASK-080
title: Evaluation Dashboard — Rollout Metrics, Episode Replay & Error Analysis
status: done
priority: 1
tags:
- vla
- evaluation
- platform
depends_on:
- TASK-045
- TASK-052
- TASK-054
created: 2026-02-24
updated: 2026-02-25
---


# TASK-080 — Evaluation Dashboard

## Problem

Die Plattform kann Modelle trainieren (TASK-047/048) und deployen (TASK-052/054), aber es fehlt das **Evaluation-Glied** in der Kette. Ohne Evaluation Dashboard gibt es keine datengetriebene Entscheidung, ob ein Modell besser ist als das vorherige.

Aktuell: Train → Deploy → Hope for the best.
Ziel: Train → Deploy → **Evaluate** → Iterate.

## Scope

### Backend (Server)

```
server/src/services/EvaluationService.ts
server/src/routes/evaluation.routes.ts
```

- **Rollout Tracking**: Jeder VLA-Rollout wird als Episode gespeichert (Start, Ende, Erfolg/Misserfolg, Prompt, Model-Version)
- **Success Rate Berechnung**: Pro Model-Version, pro Task-Typ, pro Zeitraum
- **Error Classification**: Kategorien wie `grasp_miss`, `collision`, `timeout`, `out_of_workspace`, `user_abort`
- **Model Comparison API**: Vergleich zweier Model-Versionen (A/B) mit statistischer Signifikanz
- **Aggregation**: Rollende Metriken (letzte 24h, 7d, 30d)

### Frontend (App)

```
app/src/features/evaluation/
├── pages/EvaluationDashboardPage.tsx
├── components/
│   ├── SuccessRateChart.tsx        — Line chart: success rate over time per model
│   ├── ModelComparisonTable.tsx    — Side-by-side comparison of two model versions
│   ├── EpisodeReplayViewer.tsx     — Video replay of recorded episodes
│   ├── ErrorAnalysisPanel.tsx      — Breakdown of failure modes (pie chart + list)
│   ├── RolloutTimeline.tsx         — Timeline of recent rollouts with status badges
│   └── PerformanceHeatmap.tsx      — Success rate per task-type heatmap
├── api/evaluationApi.ts
├── store/evaluationStore.ts
└── types/evaluation.types.ts
```

### Episode Recording (Robot Agent)

- Robot Agent loggt bei jedem VLA-Rollout: video frames, joint states, action chunks, success/failure signal
- Episodes werden via NATS an Server gestreamt oder als Batch nach Rollout-Ende gesendet
- Komprimierte Videos (H.264) + JSON Metadata

### Database

```prisma
model EvaluationEpisode {
  id            String   @id @default(cuid())
  robotId       String
  modelVersion  String
  taskPrompt    String
  startedAt     DateTime
  endedAt       DateTime
  success       Boolean
  errorType     String?    // grasp_miss, collision, timeout, etc.
  videoUrl      String?    // RustFS path to episode video
  metadata      Json       // joint states, action chunks, confidence scores
  createdAt     DateTime   @default(now())
}
```

## Acceptance Criteria

- [ ] Dashboard zeigt Success Rate pro Model-Version als Line Chart
- [ ] Episode Replay: Video + overlaid joint trajectory + action commands
- [ ] Error Analysis: Pie chart der Failure Modes, drill-down zu einzelnen Episodes
- [ ] Model Comparison: Tabelle mit A vs B (success rate, avg episode length, error distribution)
- [ ] Mindestens 3 Aggregation-Zeiträume (24h, 7d, 30d)
- [ ] Export: CSV/JSON Export der Evaluation-Daten

## Warum kritisch?

Ohne Evaluation gibt es keinen geschlossenen Feedback-Loop. Sebastian's Vision ist eine **All-in-One Plattform** — das bedeutet der gesamte Lifecycle: Collect → Train → Deploy → **Evaluate** → Collect more targeted data → Retrain. Das Evaluation Dashboard ist das fehlende Bindeglied.

## Related

- TASK-045: MLflow Model Registry (Versionen)
- TASK-052: Model Deployment Pipeline (Canary Rollout liefert implizit A/B Daten)
- TASK-054: Deployment Management Frontend (zeigt Deployment-Status, aber keine Evaluation-Metriken)
- TASK-062: Active Learning Service (nutzt Evaluation-Daten für Daten-Priorisierung)
