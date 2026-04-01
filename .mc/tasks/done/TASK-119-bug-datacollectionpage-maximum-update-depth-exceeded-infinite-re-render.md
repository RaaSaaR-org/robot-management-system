---
id: TASK-119
aliases:
- TASK-119
title: 'Bug: DataCollectionPage — Maximum update depth exceeded (infinite re-render)'
slug: bug-datacollectionpage-maximum-update-depth-exceeded-infinite-re-render
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- ux
- datacollection
- bug
sprint: ''
depends_on: []
due_date: ''
created: 2026-04-01
updated: 2026-04-01
---



# Bug: DataCollectionPage — Maximum update depth exceeded (infinite re-render)

## Description
<!-- What needs to be done -->

## Acceptance Criteria
- [ ] Criterion 1

## Notes

## Description

`/data-collection` rendert blank mit React-Error "Maximum update depth exceeded". Routing wurde korrekt in PR #88 hinzugefügt — der Bug ist pre-existing in der Komponente selbst.

**Root Cause (Vermutung):** Hooks wie `useCollectionPriorities` / `useUncertaintyAnalysis` triggern infinite re-renders, wahrscheinlich weil die Backend-Endpoints 404 zurückgeben und der Error-State einen neuen Render auslöst.

**Gefunden durch:** Quinn (QA, PR #88) — 2026-04-01

## Fix Steps

1. `DataCollectionPage.tsx` öffnen — alle hooks + useEffect-Dependencies analysieren
2. Klassische Ursache: Error-State in useEffect-Dependency-Array → stabilen Ref verwenden
3. API-Calls mit try/catch + initialState auf `[]` statt `undefined`
4. Ggf. 404-Responses graceful behandeln (leerer State, kein Error-Loop)

## Acceptance Criteria
- [ ] /data-collection lädt ohne React-Fehler
- [ ] Leerer State wird korrekt angezeigt (keine Sessions = leere Liste)
- [ ] TypeScript: 0 errors
