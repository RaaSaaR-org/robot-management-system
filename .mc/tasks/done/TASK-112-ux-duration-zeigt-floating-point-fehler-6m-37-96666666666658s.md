---
id: TASK-112
aliases:
- TASK-112
title: 'UX: Duration zeigt Floating-Point-Fehler (6m 37.96666666666658s)'
slug: ux-duration-zeigt-floating-point-fehler-6m-37-96666666666658s
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



# UX: Duration zeigt Floating-Point-Fehler (6m 37.96666666666658s)

## Description
Dataset-Card für `svla_so101_pickplace` zeigt Duration als "6m 37.96666666666658s" — ein Floating-Point-Präzisionsfehler. Die Sekunden müssen gerundet werden. Auf Mobile ist der Text besonders problematisch, da er das Card-Layout sprengt.

### Betroffene Dateien
- `app/src/features/training/components/DatasetList.tsx` — Duration-Formatierung
- Alternativ: Utility-Funktion die Sekunden in "Xm Ys" formatiert

### Zusätzlich
- "LeRobot vv3.0" zeigt doppeltes "v" — sollte "v3.0" oder "LeRobot 3.0" sein

### Screenshot
`/tmp/ava-screenshots/11-datasets-mobile-scrolled.png`

## Acceptance Criteria
- [ ] Sekunden werden auf ganze Zahlen gerundet (z.B. "6m 38s")
- [ ] Kein Floating-Point-Artefakt sichtbar
- [ ] "LeRobot vv3.0" → "LeRobot v3.0"

## Notes
Gefunden im Ava UX Review 2026-03-30.
