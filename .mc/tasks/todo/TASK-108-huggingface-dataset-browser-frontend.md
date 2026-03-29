---
id: TASK-108
aliases:
- TASK-108
title: HuggingFace Dataset Browser — Frontend
slug: huggingface-dataset-browser-frontend
status: todo
priority: 2
owner: Devin
projects: []
customers: []
tags: [datasets, huggingface, frontend]
sprint: ''
depends_on: [TASK-107]
due_date: ''
created: 2026-03-29
updated: 2026-03-29
---


# HuggingFace Dataset Browser — Frontend

## Description

UI zum Suchen und Importieren von HuggingFace Datasets direkt aus der RMS App heraus.

### Depends on
TASK-107 (HuggingFace Import Backend muss fertig sein)

### Entry Point
Button "Import from Hub" in DatasetsPage → öffnet HF Browser Modal

### HF Browser Modal
- Suchfeld (z.B. "so101", "lerobot", "unitreerobotics")
- HF Dataset Search via: `GET https://huggingface.co/api/datasets?search={q}&filter=lerobot`
- Dataset Cards: `repo_id`, `robot_type`, `total_episodes`, `total_frames`, Downloads, last updated
- "Import" Button → `POST /api/datasets/import/huggingface` → Progress Modal mit WebSocket updates
- Direktlink-Feld: HF-URL direkt eingeben (z.B. `https://huggingface.co/datasets/lerobot/svla_so101_pickplace`)

### Import Progress Modal
- Spinner + % + aktuell geladene Datei
- Nach Abschluss: Dataset erscheint automatisch in der Liste (WebSocket refresh)

### DemoFeaturePlaceholder
Im Demo Mode bleibt der Placeholder — im Live Mode wird die echte Komponente gezeigt.

## Acceptance Criteria
- [ ] "Import from Hub" Button in DatasetsPage sichtbar (non-demo mode)
- [ ] HF Suche nach "so101" findet `lerobot/svla_so101_pickplace`
- [ ] Direktlink-Import mit vollständiger HF-URL funktioniert
- [ ] Import Progress wird live angezeigt (WebSocket)
- [ ] Nach Import erscheint Dataset in der Liste ohne Page-Reload
- [ ] Mobile-friendly (390px viewport)
- [ ] Dark Mode kompatibel
- [ ] TypeScript strict, 0 errors

## Notes
- `unitreerobotics/G1_Dex3_*` Datasets sind groß (100k-350k Frames) — `includeVideos` default=false
