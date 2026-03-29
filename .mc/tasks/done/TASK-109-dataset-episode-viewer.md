---
id: TASK-109
aliases:
- TASK-109
title: Dataset Episode Viewer
slug: dataset-episode-viewer
status: done
priority: 3
owner: Devin
projects: []
customers: []
tags:
- datasets
- viewer
- frontend
sprint: ''
depends_on:
- TASK-107
due_date: ''
created: 2026-03-29
updated: 2026-03-29
---



# Dataset Episode Viewer

## Description

In-App Viewer um LeRobot Episodes zu inspizieren — Video Player + Joint State Timeline synchronisiert.

### Kontext: lerobot/svla_so101_pickplace
- 2 Kameras: `observation.images.up` + `observation.images.side` (640×480, 30fps, av1/mp4)
- 6 DOF: `shoulder_pan`, `shoulder_lift`, `elbow_flex`, `wrist_flex`, `wrist_roll`, `gripper`
- 50 Episoden, ~240 Frames pro Episode (~8 Sekunden)

### Episode List Panel
- Alle Episoden eines Datasets (episode_index, Länge in Frames, Dauer in Sekunden)
- Filter nach Task (bei Multi-Task Datasets)
- Episode als "good" / "flagged" markieren (für Curation Workflow)

### Episode Detail View (beim Klick)
- **Video Player:** mp4 aus RustFS streamen — beide Kameras nebeneinander (up + side)
- **Playback Controls:** Play/Pause, Scrubber, Speed (0.5x, 1x, 2x)
- **Joint State Chart (Recharts):** Zeitachse × alle 6 DOF als Linien
  - Scrubber synchronisiert Video-Timestamp mit Chart-Position
- **Action vs. State overlay:** geplant (action) vs. tatsächlich (observation.state)

### Backend Endpoints (neu)
- `GET /api/datasets/:id/episodes` — Liste mit Metadaten
- `GET /api/datasets/:id/episodes/:index/frames` — Parquet-Daten als JSON (paginiert, max 500 Frames)
- `GET /api/datasets/:id/episodes/:index/video/:camera` — Video-Stream aus RustFS (range requests)

## Acceptance Criteria
- [ ] Episode von `lerobot/svla_so101_pickplace` ist im Viewer sichtbar
- [ ] Beide Kameras (up + side) werden nebeneinander angezeigt
- [ ] Joint State Chart zeigt alle 6 DOF synchron zum Video-Scrubber
- [ ] Episoden als "flagged" markieren + persistieren
- [ ] Mobile: Episode List scrollbar, Viewer als Fullscreen Overlay
- [ ] TypeScript strict, 0 errors

## Notes
- Parquet-Parsing auf dem Server (Node.js): `parquet-wasm` oder `hyparquet` npm package prüfen
- Videos via range requests für scrubbing-performance
