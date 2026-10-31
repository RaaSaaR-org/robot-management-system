---
id: "TASK-440"
aliases: []
title: "The sim robot has a left and a right wrist camera"
slug: "the-sim-robot-has-a-left-and-a-right-wrist-camera"
status: "todo"
priority: 2
owner: "claude"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: "[[TASK-439]]"
depends_on: []
spe: 2
effort: "medium"
due_date: ""
created: "2026-10-31"
updated: "2026-10-31"
---

# The sim robot has a left and a right wrist camera

## Description

Give the MuJoCo G1 Dex3 model two cameras mounted on the wrists, named
`left_wrist_camera` and `right_wrist_camera`, so the wrist-camera work of TASK-439 can be
exercised end to end without the real cameras. Adding cameras changes no physics.

## Details

### Current state

- `robot-agent/hardware/sim_g1_dds/sim_node.py` lists every MJCF `<camera>` (`camera_names`,
  ~1282-1288; `/cameras` ~1735) and renders any of them at 640x480 on the physics thread for
  `/cameras/<name>/snapshot` and `/cameras/<name>/stream` (~1228-1280, 1661+). No code
  change is needed there.
- The G1 Dex3 robot includes live in `robot-agent/hardware/sim_evaluator/mjcf/g1_dex3/`:
  `g1_43dof_fixedbase.xml` (`head_camera` at ~222 on `torso_link`; `left_wrist_yaw_link` body
  ~262, `right_wrist_yaw_link` ~387, the palm mesh at local pos 0.0415),
  `g1_43dof_fixedbase_realism.xml` (a copy with realism changes; `ego_camera` ~260; wrist
  links ~301/~426), and `g1_43dof_planarbase.xml`, **generated** from fixedbase by
  `build_planarbase_include.py` (it rewrites the `head_camera` xyaxes by regex at ~111).
- `robot-agent/src/recording/camera-map.ts` already maps `left_wrist_camera → cam_left_wrist`
  and `right_wrist_camera → cam_right_wrist` (DEFAULT_CAMERA_KEYS ~58-63); its comment at
  ~21-24 says no scene defines a wrist camera.

### Robot Agent (sim)

1. Add `<camera name="left_wrist_camera" .../>` as a child of `left_wrist_yaw_link` and
   `<camera name="right_wrist_camera" .../>` under `right_wrist_yaw_link`, in both
   `g1_43dof_fixedbase.xml` and `g1_43dof_fixedbase_realism.xml`. Mount it on the back of the
   wrist, a few cm behind the palm, looking along +x toward the fingers and slightly down so
   the Dex3 fingertips and the object in front of them are in view (`fovy` ~ 70–80). Check
   the view by rendering a snapshot (`mujoco.Renderer` in the sim venv, see
   `robot-agent/hardware/sim_g1_dds/README.md`) and look at it.
2. Regenerate `g1_43dof_planarbase.xml` with `build_planarbase_include.py` and diff it: the
   only change must be the two new cameras.
3. Order: the head camera stays the first `<camera>` in model order, so `/cameras` keeps
   `head_camera` first.
4. Update the camera-map.ts comment (~21-24): the sim now defines wrist cameras.
5. Do not change any profile (`sim-g1-edu-dev.yaml` keeps `G1_CAMERA_SOURCE: none`).

## Acceptance Criteria

- [ ] `sim_node.py` `/cameras` for the pickplace scene lists `head_camera` first and both
      wrist cameras; each wrist snapshot shows that hand's fingers.
- [ ] `g1_43dof_planarbase.xml` differs from before only by the two cameras.
- [ ] The sim pytest suite (`SIM_PYTHON`) passes; no physics value changed in any MJCF.

## Test Strategy

Add a pytest in `robot-agent/hardware/sim_g1_dds/tests/` (follow the existing ones) that
loads the scene with `mujoco.MjModel.from_xml_path` and asserts both camera names exist on
the wrist yaw link bodies and that `head_camera` has the lowest camera id. Run the sim suite
via `./scripts/test-all.sh --skip-pw` or the stage directly. Attach the two rendered wrist
snapshots (PNG) in the PR description.
