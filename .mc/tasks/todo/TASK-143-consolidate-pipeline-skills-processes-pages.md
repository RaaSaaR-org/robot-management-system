---
id: TASK-143
aliases:
- TASK-143
title: 'Consolidate /pipeline, /skills, and /processes — overlapping concepts'
slug: consolidate-pipeline-skills-processes-pages
status: todo
priority: 2
owner: ''
projects: []
customers: []
sprint: ''
tags:
- extended
depends_on: []
due_date: ''
created: '2026-04-06'
---

## Description

Three pages overlap conceptually and confuse users. `/pipeline` ("Train a Skill") is a global aggregate dashboard, not per-skill. `/skills` defines robot skills but is disconnected from the pipeline. `/processes` is a generic workflow manager with unclear purpose. Decide how to consolidate or remove them.

## Problem

| Page | URL | What it does | Issues |
|------|-----|-------------|--------|
| **Train a Skill** | `/pipeline` | 5-stage global dashboard (collect → dataset → train → evaluate → deploy) | Shows aggregate counts (8 sessions, 3 datasets), not tracking a single skill. Misleading title — it's a training pipeline overview, not a per-skill workflow |
| **Skills** | `/skills` | Define, version, publish robot skills + skill chains | Disconnected from pipeline. Lives under deployment feature. Errors on load ("Failed to fetch skill chains"). Has its own CRUD but no link to training |
| **Processes** | `/processes` | Generic multi-step workflow/task management | Empty, vague purpose. Overlaps with skills (chaining steps) and pipeline (multi-stage workflows) |

A user looking at these three pages gets no clear mental model of how they connect.

## Options

### Option A: Skills as the central entity
- `/skills` becomes the primary page — each skill (e.g. "pick up cup") is the unit you collect data for, train, evaluate, deploy
- `/pipeline` becomes a detail view of a single skill's lifecycle (collect → train → deploy for THIS skill), or is removed in favor of a status column on the skills list
- `/processes` removed (skill chains already cover sequencing)

### Option B: Rename pipeline, remove the rest
- `/pipeline` renamed to something honest like "Training Overview" — it's a dashboard, not a per-skill wizard
- `/skills` removed or merged into pipeline as a "deployed skills" tab
- `/processes` removed

### Option C: Wire them together
- Keep all three but connect them: creating a skill on `/skills` opens the `/pipeline` for that skill. `/processes` orchestrates deployed skills
- Most work, only worth it if processes genuinely add value beyond skill chains

## Key Files

### Pipeline (`/pipeline`)
- `app/src/features/pipeline/pages/PipelinePage.tsx` — main page, fetches aggregate stats from 5 APIs
- `app/src/features/pipeline/components/StageCard.tsx` — stage card component
- `app/src/features/pipeline/components/FirstRunWizard.tsx` — empty-state wizard
- `app/src/App.tsx:445` — route definition
- `app/src/components/layout/Sidebar.tsx:165` — sidebar entry ("Train a Skill")

### Skills (`/skills`)
- `app/src/features/deployment/pages/SkillsPage.tsx` — skills + skill chains page (lives under deployment feature)
- `app/src/features/deployment/components/SkillBrowser.tsx` — skill browser
- `app/src/features/deployment/components/SkillEditor.tsx` — skill CRUD editor
- `app/src/features/deployment/store/` — deployment store (skills, skillChains state)
- `app/src/App.tsx:389` — route definition
- Server routes: `server/src/routes/` — skill and skill-chain endpoints

### Processes (`/processes`)
- `app/src/features/processes/pages/ProcessesPage.tsx` — process list page
- `app/src/features/processes/components/TaskList.tsx` — actually named "TaskList" (aliased as ProcessList)
- `app/src/features/processes/components/CreateProcessModal.tsx` — create modal
- `app/src/App.tsx:164` — route definition
- `app/src/components/layout/Sidebar.tsx` — sidebar entry under OPERATIONS

### Lazy imports
- `app/src/routes/lazyPages.ts:230` — LazySkillsPage (from deployment feature)
- `app/src/routes/lazyPages.ts:37` — LazyProcessesPage
- `app/src/routes/lazyPages.ts:49` — LazyTasksPage = LazyProcessesPage (alias!)

## Test Strategy

- After consolidation: verify removed routes 404 or redirect, sidebar updated, no dead imports
- If skills become central: verify a skill can be created and its pipeline stages reflect real data
- Typecheck must pass across app/server
