---
id: TASK-173
aliases:
- TASK-173
title: Real-to-Sim — proper GLB→MuJoCo room collision pipeline (trimesh → obj2mjcf + CoACD)
slug: glb-to-mujoco-collision-mesh-pipeline
status: done
priority: 3
owner: ''
projects: []
customers: []
tags:
- extended
- robot-agent
- digital-twin
- simulation
sprint: ''
depends_on:
- "[[TASK-171]]"
due_date: ''
created: 2026-06-25
updated: 2026-07-11
status_note: 'DONE — GLB→trimesh→CoACD pipeline shipped on PR #164; re-verified 2026-07-11 on GPU_BOX: full sim_evaluator pytest suite green (50 passed, 1 skipped, incl. the concavity regression) on native Windows (conda neodem-svc + trimesh/coacd/obj2mjcf). Remaining walk-into-real-scanned-room validation folds into TASK-172 §A (robot day).'
---

# Real-to-Sim — proper GLB→MuJoCo room collision pipeline

**Story points: 5** (multi-repo: `sim_evaluator` + `twin-builder` + server
materialization; new Python deps; convex-decomposition correctness). Bump to 8 if
vendoring `g1_description` meshes is folded in here.

## Description

Turn the scanned room's `mesh.glb` into **true 3D collision geometry** in MuJoCo,
the right way. Today `scene_builder.py` skips the GLB (MuJoCo loads only
OBJ/STL/MSH) and falls back to occupancy/AABB walls. The naive fix — "convert GLB
to one OBJ and load it" (TASK-172 §B) — is **wrong on its own**: MuJoCo's collision
detector replaces every mesh geom with its **convex hull**, so a single room-shell
mesh collapses the concave interior into a solid block you can't walk into. The
real solution is GLB → OBJ → **convex decomposition** (CoACD via `obj2mjcf`) into a
union of convex collision pieces, with a separate decimated visual mesh.

This task **supersedes and expands** TASK-172 §B (replace that bullet with a
pointer here).

## Why (research, 2026-06-25)

A `/deep-research` run (22 sources, 25 claims adversarially verified) established:

- **Single mesh ≠ concave collision.** MuJoCo docs: *"the collision detector
  assumes all geoms are convex (it internally replaces meshes with their convex
  hulls)."* A room shell must be **convex-decomposed** or approximated by
  primitives/heightfield. *(verified 3-0)*
- **CoACD is the recommended decomposer** (SIGGRAPH 2022, V-HACD successor);
  MuJoCo's own perf guidance names trimesh / Blender / MeshLab / CoACD and says:
  primitives > aggressive decimation > convex decomposition; keep **visual mesh
  separate from collision mesh**. *(verified 3-0)*
- **`trimesh`** imports GLB 2.0 and exports OBJ + binary STL — the direct GLB fix.
  A GLB imports as a multi-mesh `Scene`, so **concatenate before export**.
  *(verified 3-0)* — but trimesh does **not** auto-repair non-manifold/watertight
  scanned meshes *(refuted 0-3)*; clean/decimate separately.
- **`obj2mjcf`** (Kevin Zakka / DeepMind) is the de-facto OBJ→MJCF tool: splits by
  material (MuJoCo = one material/mesh), auto-emits the MJCF, generates CoACD
  collision meshes. *(verified 3-0)*
- **Priority caveat:** this is the *secondary* fidelity win. For navigation,
  occupancy-grade layout (TASK-171, already shipped) is what transfers; exact mesh
  matters only when **real 3D obstacles** (tables, overhangs, low ceilings) do.
  Don't let this block the loop.

Full report: see the deep-research output referenced in the PR / task discussion.

## Status (2026-06-27)

**Implemented + committed on PR #164** (`ce8ef65` — GLB→MuJoCo collision-mesh
pipeline: trimesh keeps axes, MuJoCo convex-hulls meshes, CoACD decomposes, a
solidity guard defers degenerate boxes to occupancy). Code-complete; **nothing
software-side is open** — remaining validation is part of the TASK-172 §A
hardware run (build a scene from a real scanned `mesh.glb` and walk the G1 into
the decomposed geometry). Candidate to move to `done`.

## Current state (historical — pre-implementation)

- `robot-agent/hardware/sim_evaluator/scene_builder.py:298-343` — `use_mesh`
  branch accepts only `.obj/.stl/.msh` and emits a **single** `room_mesh` geom
  (no decomposition); GLB intentionally falls through to walls.
- The twin emits `mesh.glb`; nothing converts it.
- `sim_evaluator` uv env has `mujoco` but not `trimesh`/`coacd`/`obj2mjcf`.

## Details

### Robot Agent — `sim_evaluator`

1. **Deps:** add `trimesh`, `coacd`, `obj2mjcf` to
   `robot-agent/hardware/sim_evaluator/pyproject.toml` (+ `uv.lock`). Keep them
   import-guarded like the existing mock fallbacks so the env still boots without
   them.
2. **`glb_to_obj.py` (new):** load GLB with trimesh, **concatenate sub-meshes**,
   rescale to **meters**, rotate **Y-up (glTF) → Z-up (MuJoCo)**, optionally
   decimate, export `room.obj` (+ binary STL). Standard-engineering steps — the
   research did not prove a canonical transform, so centralize it here as the
   single world→MJCF transform (mirror `scene_builder`'s existing AABB recenter).
3. **Decomposed collision in `scene_builder.py`:** when given a mesh, produce
   collision geometry via **CoACD** (directly, or by shelling out to `obj2mjcf`)
   → emit **N convex `<mesh>` collision geoms** (contype/conaffinity, collision
   group) **plus one decimated visual mesh** (group 2, no contact). Replace the
   single-`room_mesh` emission. Keep the occupancy/AABB fallback intact for when
   no mesh / decomposition fails (log + degrade, never crash).
4. **CLI:** `scene_builder generate --mesh room.glb` should accept a GLB and run
   the convert+decompose path end-to-end (today it expects pre-converted
   OBJ/STL/MSH).

### twin-builder

- `build_sim_scene` step: run `glb_to_obj` on the twin's `mesh.glb` before
  `scene_builder`, upload the decomposed collision OBJ(s) + visual mesh as twin
  artifacts (alongside `scene.mjcf.xml`). Stay gated by `ENABLE_SIM_SCENE`.

### Server

- When materializing a twin `SimScene` into the evaluator's `mjcf/` dir, also
  fetch/stage the converted mesh assets so the MJCF's relative `<include>`/mesh
  paths resolve (same mechanism as TASK-171's MJCF materialization).

### Key files

- `robot-agent/hardware/sim_evaluator/glb_to_obj.py` (new)
- `robot-agent/hardware/sim_evaluator/scene_builder.py` (decompose + dual mesh)
- `robot-agent/hardware/sim_evaluator/pyproject.toml` / `uv.lock`
- `../twin-builder/pipelines/` (`build_sim_scene`)
- `server/src/services/SimulationService.ts` (asset materialization)

## Test Strategy

- **pytest (`sim_evaluator`):**
  - `glb_to_obj` over a sample GLB → MuJoCo-loadable OBJ, correct scale (meters)
    and Z-up orientation (assert a known vertex maps as expected).
  - A scene built from that mesh emits **multiple** convex collision geoms (not
    one) + a separate visual geom; MuJoCo loads it without error.
  - **Concavity regression:** drop a body inside the decomposed room and step —
    it rests on the floor *inside* the walls, not on top of a convex-hull block.
    (This is the bug the whole task exists to prevent.)
  - Decomposition-absent / conversion-failure path falls back to occupancy/AABB
    walls and still loads.
- **twin-builder self-test:** `build_sim_scene` over a sample twin bundle with a
  GLB → decomposed collision artifacts + valid `scene.mjcf.xml` in the complete
  payload.
- **Manual:** build a twin, load its `scene.mjcf.xml` in MuJoCo, see the real
  scanned room shape as walkable collision geometry with the G1 standing inside.

## Out of scope

- Isaac/USD variant (GLB→USD via `convert_mesh.py --collision-approximation
  convexDecomposition`, field `MeshConverterCfg.mesh_collision_props`) — note for a
  follow-up; pin the Isaac Lab version (API churns).
- Vendoring real `g1_description` meshes (TASK-172 §B) — separable.
- Coordinate-frame drift across twin/MuJoCo/Isaac/real — open question from the
  research, no proven recipe; track separately if it bites.

## Commit / PR

Plain `git push` (not igor); commit `.mc/tasks/` changes on the PR branch before
merging. Depends on TASK-171 (twin→MJCF converter + SimScene materialization).
