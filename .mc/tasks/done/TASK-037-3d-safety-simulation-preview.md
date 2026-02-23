---
id: TASK-037
aliases:
- TASK-037
title: 3D Safety Simulation Preview
slug: 3d-safety-simulation-preview
status: done
priority: 4
owner: ''
projects: []
customers: []
tags:
- extended
sprint: ''
depends_on:
- "[[TASK-008]]"
due_date: ''
created: 2026-02-19
updated: 2026-02-23
---



# 3D Safety Simulation Preview

## Description
Upgrade the safety simulation preview from 2D SVG to a 3D Three.js scene, and add grip point visualization for manipulation commands.

## Details
**Gaps identified from TASK-008 review — the current 2D SVG simulation works well but TASK-008 specified Three.js 3D capability.**

### Current State
- `app/src/features/command/components/SafetySimulationPreview.tsx` is a fully functional 2D SVG preview with animated path, obstacle markers, robot icon, collision warnings, and safety badges
- `app/src/features/command/hooks/useSimulation.ts` provides path calculation, obstacle extraction, and coordinate transforms
- `app/src/features/command/utils/pathCalculation.ts` handles path math and obstacle avoidance
- Three.js packages already installed: `three`, `@react-three/fiber`, `@react-three/drei` in `app/package.json`
- A 3D robot model viewer already exists at `app/src/features/robots/components/visualization/Robot3DViewer.tsx` — can reference patterns from there

### Frontend (`app/src/features/command/`)
- **3D scene**: Create `SafetySimulation3D.tsx` using `@react-three/fiber` Canvas
  - Render floor plane with grid
  - Robot model (reuse from `Robot3DViewer` or simplified mesh)
  - Animated path tube following the calculated route
  - Obstacle meshes with transparent danger-zone spheres
  - Camera controls (orbit, zoom) via `@react-three/drei` OrbitControls
- **Grip points**: For `pickup`/`drop` command types, visualize:
  - Target object mesh at destination
  - Grip point indicators (small spheres/cones) showing where the robot will grasp
  - Approach vector arrow
- **Toggle**: Allow switching between 2D (existing SVG) and 3D views
- **Hazard enhancement**: Show semi-transparent exclusion zone volumes in 3D space

**Key Files:**
- Create: `app/src/features/command/components/SafetySimulation3D.tsx`
- Modify: `app/src/features/command/components/SafetySimulationPreview.tsx` — add 2D/3D toggle
- Modify: `app/src/features/command/hooks/useSimulation.ts` — add grip point data for manipulation commands
- Reference: `app/src/features/robots/components/visualization/Robot3DViewer.tsx` for Three.js patterns

## Test Strategy
Test 3D scene renders without errors. Test path animation follows calculated route. Test grip points appear for pickup/drop commands. Test 2D/3D toggle preserves state. Test camera controls work (orbit, zoom). Visual inspection of hazard zones in 3D space.

## Notes
%% mc-links: [[TASK-008]] %%
