---
id: "TASK-232"
aliases: []
title: "The manip bridge reports health it cannot know — joint loss, frozen publishers and a spawn on the door seam"
slug: "manip-bridge-reports-health-it-cannot-know"
status: "todo"
priority: 2
owner: ""
projects: []
customers: []
tags: ["core", "sim", "vla"]
sprint: ""
depends_on: []
due_date: ""
created: 2026-09-02
updated: 2026-09-02
---

# The manip bridge reports health it cannot know

## Description

The review of PR #278 found eight defects in `isaac_manip_bridge.py`, the factory
bringup script and the scene layout that share one shape: **a reply that says
`200`, `complete: true` and `connected: true` while the data behind it is absent,
fabricated or stale.** That is the exact failure class the read path was built to
remove, so it is worth closing as one piece of work rather than eight.

None of them were fixed in #278 — the four that stop the robot or destroy a run
were, and these were split out deliberately to keep that PR reviewable.

## Details

### Robot Agent — `robot-agent/hardware/isaac_manip_bridge.py`

**1. `--state-require` defaults to `body`, so hand loss is invisible (medium-high).**
`factory_mission_bringup.sh:394` launches the bridge with only `--domain/--iface/--serve`.
If `rt/dex3/left/state` goes quiet for longer than `--state-max-age` — plausible on a
shared GPU at ~7 Hz — `/state/fast` answers **200** with 36 joints, and `getStateNow()`
fills `G1_APPLE_STATE_JOINT_NAMES[29:36]` with `0.0`, which for the left Dex3 is the
**open** pose. A policy holding the apple is told its hand is open, with no non-200
anywhere. Either default `--state-require` to `all` for the 43-DOF profile, or have the
bringup pass it explicitly.

**2. `missing` never sees joint-level loss (medium).** `missing` is computed as
`values[s] is None`, so two real losses bypass even `--state-require all`:
- `_take` (line ~813) stores `min(count, len(motors))` values, so a `HandState_.motor_state`
  sequence shorter than 7 is stored as a *healthy* sample and four fingers vanish silently.
- `label_state` drops non-finite values into `dropped_joints`, so a single NaN removes that
  joint from the reply.
Both return 200. `getStateNow()` reads neither `complete` nor `count` — it should.

**3. Age is measured from delivery, not measurement (low).** `_source_report` stamps
`time.monotonic()` at receipt in `_take`. The vendor publishers (`dds/g1_robot_dds.py`,
`dds/dex3_dds.py`) re-`Write()` one reused message on their own timer, so if Isaac's step
loop stalls while those threads keep running, every source reports `state: "ok"`,
`age_s ≈ 0.02` and `complete: true` while serving frozen angles. `LowState_.tick` is
already on the wire and unused; comparing it across samples detects this.

**4. `self._seq += 1` is a non-atomic read-modify-write (low).** HTTP threads are
serialised by `apply_lock`, but `probe()` is not, and `main()` supports `--probe --serve`
together. Two frames can share a `seq`, which `/action` returns as the caller's frame id
and which `run()` uses for its `seq != last_seq` log gate.

### Robot Agent — `robot-agent/src/agent-mode/block-executor.ts`

**5. `commandedBudgetM = budgetM / travelGain` can overshoot the stage (medium).**
In `'travelled'` mode the budget is divided by `AGENT_ARC_TRAVEL_GAIN` — up to 3.2× the
navigator's real-metre budget at the documented 0.31. `alignmentArcBudgetM`
(`navigator.ts:70`) claims the `- MIN_STAGE_M` subtraction guarantees ≥ 0.3 m is left for
the walk, but that holds only while the base's true travel ratio is ≤ the configured gain.
Tune the base to walk *better* than its gain and `arcedM` exceeds the budget,
`stageM = Math.max(0, stageM - arcedM)` floors at 0, the following walk is ~0 m, and the
robot overshoots the stage it was aligning for. Either clamp `arcedM` to `budgetM` or
re-derive the gain from what the arc actually measured.

### Robot Agent — scene and bringup

**6. `NEODEM_ROBOT_SPAWN=pause_room_door` spawns on the door seam (medium).**
`isaac_scenes/common_scene/factory_pauseroom_layout.py:754` — `selectable_spawns()` gates
only on "declares a heading", so it accepts `pause_room_door` at `(10.0, 3.9)`, the exact
seam of the two shut leaves (`verify_factory_scene_offline.py`: `openness 0: leaves
x[9.28,10.00] and x[10.00,10.72] -> clear width 0.00 m`), driven at stiffness 800 /
max_force 200. The scene's own place-graph generator already excludes that coordinate as
unstandable (`make_factory_place_graph.py`, `NOT_EMITTED["pause_room_door"]`); nothing
propagates that into the resolver, whose stated design is "refuse rather than fall back".

**7. `seed_camera_shm.py` hardcodes an interpreter (low).** `DEFAULT_INTERPRETER` is
`/home/humanoid/anaconda3/envs/unitree_sim_env6/bin/python`, and
`factory_mission_bringup.sh:446` invokes the seeder with no `--interpreter`, though the
bringup resolves its own from the documented `CONDA_ENV` override. With a different
`CONDA_ENV` the helper container execs a path it does not have, `run_job` returns "the
helper container returned no JSON", and step 5b dies with a shared-memory message
unrelated to the cause. Pass `--interpreter "$PY"`.

**8. A step message no longer follows from what it checks (low).**
`factory_mission_bringup.sh:539` prints "55555 is bound -- at least one real frame has been
published". Step 5b now seeds a placeholder frame precisely so the publisher binds, and the
vendor binds inside `publish()`, so a scene whose renderer never writes will bind 55555 and
still print this. `--max-content-age 5.0` covers the snapshot gate at line 598 but not this
claim.

## Test Strategy

- `robot-agent/hardware/tests/test_g1_sidecar_joints.py` — extend with: a short
  `motor_state` sequence must make `/state/fast` incomplete rather than healthy; a NaN
  joint must appear in `missing`; a frozen `tick` with a fresh receipt time must not
  report `ok`.
- `robot-agent/src/agent-mode/__tests__/turn-profile.test.ts` — a base whose true travel
  ratio exceeds `arcTravelGain` must not arc past its budget.
- `verify_factory_scene_offline.py` — assert `selectable_spawns()` excludes every name in
  `make_factory_place_graph.NOT_EMITTED`.
- `bash -n` plus a dry run of the bringup with a non-default `CONDA_ENV`.
