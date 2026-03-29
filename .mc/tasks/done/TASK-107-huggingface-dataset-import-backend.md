---
id: TASK-107
aliases:
- TASK-107
title: HuggingFace Dataset Import — Backend
slug: huggingface-dataset-import-backend
status: done
priority: 2
owner: Devin
projects: []
customers: []
tags:
- datasets
- huggingface
- backend
sprint: ''
depends_on: []
due_date: ''
created: 2026-03-29
updated: 2026-03-29
---



# HuggingFace Dataset Import — Backend

## Description

Backend service to import LeRobot datasets directly from Hugging Face Hub into RMS — kein manueller Download nötig.

### Kontext
- SO-101 Dataset: `lerobot/svla_so101_pickplace` (50 Episoden, 11.9k Frames, LeRobot v2.1, robot_type: so100_follower)
- Unitree G1 Dex3: 13 Datasets (`unitreerobotics/G1_Dex3_*`)
- Beide verwenden LeRobot-Format → RMS hat bereits LeRobot v2/v3 Type-Support in `dataset.types.ts`

### API
```
POST /api/datasets/import/huggingface
Body: { repoId: string, revision?: string, robotTypeId?: string, includeVideos?: boolean }
```

### Server-side Download
- HF REST API: `https://huggingface.co/api/datasets/{repo_id}` für Metadaten
- Dateien: `meta/info.json`, `meta/stats.json`, `data/chunk-*/episode_*.parquet`
- Videos optional (`includeVideos: boolean`) — können sehr groß sein (>100MB pro Dataset)
- Speichern in RustFS: `datasets/{id}/`
- Nach Download: bestehende Validation + Stats Pipeline via NATS triggern

### Progress Tracking
- WebSocket events: `import:started`, `import:progress` (%), `import:completed`, `import:failed`
- HF Rate Limit (429) → retry mit exponential backoff

## Acceptance Criteria
- [ ] `POST /api/datasets/import/huggingface` mit `{ repoId: "lerobot/svla_so101_pickplace" }` funktioniert
- [ ] Progress wird via WebSocket events übertragen
- [ ] Nach Import: Dataset in `/api/datasets` mit `status=ready` sichtbar
- [ ] `includeVideos: false` überspringt Video-Dateien (default)
- [ ] TypeScript strict, 0 errors (`npx tsc --noEmit`)
- [ ] Unit Tests für `HuggingFaceImportService`

## Notes
- Erst TASK-108 (Frontend) danach beginnen
- SO-101 Dataset hat `robot_type: "so100_follower"` — beim Import automatisch auf passenden RobotType mappen
