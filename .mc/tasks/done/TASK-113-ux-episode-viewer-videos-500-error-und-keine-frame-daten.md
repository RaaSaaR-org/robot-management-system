---
id: TASK-113
aliases:
- TASK-113
title: 'UX: Episode Viewer Videos 500 Error und keine Frame-Daten'
slug: ux-episode-viewer-videos-500-error-und-keine-frame-daten
status: done
priority: 1
owner: ''
projects: []
customers: []
tags:
- ux
sprint: ''
depends_on: []
due_date: ''
created: 2026-03-30
updated: 2026-03-30
---



# UX: Episode Viewer Videos 500 Error und keine Frame-Daten

## Description
Episode Viewer Modal (PR #82) hat drei zusammenhängende Probleme:

1. **Video-Endpoints 500 Error**: `GET /api/datasets/{id}/episodes/0/video/up` und `.../video/side` geben 500 Internal Server Error zurück. Beide Kamera-Views zeigen schwarze Frames.
2. **Keine Frame-Daten**: "No frame data available for this episode" — Joint-State-Charts werden nicht geladen.
3. **Zeitanzeige 0:00 / 0:00**: Player-Duration wird nicht aus Episode-Metadaten befüllt (sollte 0:12 zeigen).

### Betroffene Dateien
- `server/src/routes/dataset.routes.ts` — Video-Streaming-Endpoint
- `server/src/services/DatasetService.ts` — Episode-Video/Frame-Daten Abruf
- `app/src/features/training/components/EpisodeViewerModal.tsx` — Frontend-Anzeige

### Console Errors
```
[ERROR] Failed to load resource: 500 Internal Server Error
  /api/datasets/6677b457-.../episodes/0/video/up
  /api/datasets/6677b457-.../episodes/0/video/side
```

### Screenshot
`/tmp/ava-screenshots/09-episode-viewer-episode0-desktop.png`

## Acceptance Criteria
- [ ] Video-Endpoints liefern gültige Video-Streams (oder graceful Fallback)
- [ ] Frame-Daten / Joint-State-Charts werden angezeigt
- [ ] Duration zeigt korrekte Episode-Länge
- [ ] Graceful Error-State statt schwarze Frames bei fehlenden Videos

## Notes
Gefunden im Ava UX Review 2026-03-30. Getestet mit pusht Dataset (206 Episodes).
