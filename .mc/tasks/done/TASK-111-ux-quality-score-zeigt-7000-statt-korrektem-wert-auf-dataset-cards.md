---
id: TASK-111
aliases:
- TASK-111
title: 'UX: Quality Score zeigt 7000% statt korrektem Wert auf Dataset Cards'
slug: ux-quality-score-zeigt-7000-statt-korrektem-wert-auf-dataset-cards
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



# UX: Quality Score zeigt 7000% statt korrektem Wert auf Dataset Cards

## Description
Alle 3 Dataset-Cards auf `/datasets` zeigen "Quality Score: 7000%" statt eines realistischen Werts (z.B. 70%). Betrifft pusht, aloha_static_coffee und svla_so101_pickplace. Vermutlich wird der Wert als Dezimalzahl (0.70) gespeichert und mit `* 100` multipliziert, aber zusätzlich nochmal `* 100` in der Anzeige.

### Betroffene Dateien
- `app/src/features/training/components/DatasetList.tsx` (oder DatasetCard) — Quality Score Anzeige
- Möglicherweise `server/src/services/DatasetService.ts` — Quality Score Berechnung

### Screenshot
`/tmp/ava-screenshots/03-datasets-desktop.png`

## Acceptance Criteria
- [ ] Quality Score zeigt korrekten Prozentwert (0-100%)
- [ ] Progress-Bar entspricht dem angezeigten Wert

## Notes
Gefunden im Ava UX Review 2026-03-30. Alle importierten HF Datasets betroffen.
