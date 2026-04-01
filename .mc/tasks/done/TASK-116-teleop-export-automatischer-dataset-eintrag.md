---
id: TASK-116
aliases:
- TASK-116
title: Teleop Export → automatischer Dataset-Eintrag
slug: teleop-export-automatischer-dataset-eintrag
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- datasets
- teleoperation
- training
sprint: ''
depends_on: []
due_date: ''
created: 2026-03-31
updated: 2026-04-01
---



# Teleop Export → automatischer Dataset-Eintrag

## Description

Aktuell: `exportToLeRobot()` schreibt Parquet+Metadata in RustFS — aber kein Dataset-Record wird angelegt. Die Daten sind unsichtbar in der Trainings-Pipeline.

**Fix in `TeleoperationService.exportToLeRobot()`:**
- Nach erfolgreichem RustFS-Upload: `datasetService.create()` aufrufen
- Felder aus Session + LeRobot `info.json` befüllen:
  - `name`: Session-Name oder `teleop-{sessionId}-{datum}`
  - `fps`, `totalFrames`, `totalDuration` aus info.json
  - `robotTypeId`: aus Session.robotId → Robot → robotType
  - `lerobotVersion`: `'v2.0'` (aktuell hardcoded in LeRobotExportService)
  - `storagePath`: RustFS-Pfad
  - `status`: `'ready'`
  - `huggingFaceRepoId`: `null` (noch nicht gepusht)
- Export-Endpoint gibt `{ datasetId, storagePath }` zurück (bereits so)

**Frontend (SessionDetailPage):**
- Nach Export: Toast "Dataset erstellt" + Link → `/datasets`
- Datasets-Seite: exportierter Datensatz taucht sofort auf, inkl. Episode-Viewer

## Acceptance Criteria
- [ ] Session exportieren → Dataset erscheint auf `/datasets` ohne manuelle Schritte
- [ ] Dataset zeigt korrekte fps, frameCount, duration
- [ ] Dataset kann direkt als Basis für Training-Job ausgewählt werden
- [ ] TypeScript: 0 errors

## Notes
Abhängt von: nichts (in sich geschlossen)
Ermöglicht: TASK-115 (HF Push), Training-Jobs auf eigenen Daten
