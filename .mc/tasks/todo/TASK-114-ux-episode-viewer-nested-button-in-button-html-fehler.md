---
id: TASK-114
aliases:
- TASK-114
title: 'UX: Episode Viewer nested button-in-button HTML-Fehler'
slug: ux-episode-viewer-nested-button-in-button-html-fehler
status: backlog
priority: 2
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


# UX: Episode Viewer nested button-in-button HTML-Fehler

## Description
Im Episode Viewer (Desktop-View) ist der Flag-Button (⚑) als `<button>` innerhalb des Episode-Select-`<button>` verschachtelt. Das ist ungültiges HTML und erzeugt React-Konsolen-Fehler:

```
In HTML, <button> cannot be a descendant of <button>.
This will cause a hydration error.
```

### Fix
Den äußeren Episode-Container von `<button>` zu `<div role="button" tabIndex={0}>` ändern, oder den Flag-Button mit `e.stopPropagation()` als separates Element außerhalb des Buttons positionieren.

### Betroffene Datei
- `app/src/features/training/components/EpisodeViewerModal.tsx` — Episode-Liste (Desktop-Sidebar)

## Acceptance Criteria
- [ ] Kein nested `<button>` in der Episode-Liste
- [ ] Keine React-Konsolen-Warnung bezüglich DOM-Nesting
- [ ] Flag-Button funktioniert weiterhin unabhängig

## Notes
Gefunden im Ava UX Review 2026-03-30. Betrifft nur Desktop-View (Mobile nutzt `<select>` Dropdown).
