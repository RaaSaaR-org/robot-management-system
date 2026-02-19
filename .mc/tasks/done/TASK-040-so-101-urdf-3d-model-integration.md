---
id: TASK-040
aliases:
- TASK-040
title: SO-101 URDF 3D Model Integration
slug: so-101-urdf-3d-model-integration
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
sprint: ''
depends_on:
- "[[TASK-003]]"
due_date: ''
created: 2026-02-19
updated: 2026-02-19
---




# SO-101 URDF 3D Model Integration

## Description
Replace the procedural box-stack 3D model of the SO-101 robotic arm with the real URDF + STL mesh model from the [SO-ARM100 repo](https://github.com/TheRobotStudio/SO-ARM100), and verify joint state telemetry drives the model correctly.

## Details

### Problem
The SO-101 currently renders as a stack of disconnected yellow/black `boxGeometry` primitives in the 3D viewer. This happens because:
1. `app/src/features/robots/components/visualization/RobotModel.tsx` only has `h1` in `URDF_PATHS` (line 30-32) — `'so101'` is not registered
2. Since `'so101' in URDF_PATHS` is false, it falls through to `ProceduralModel` which renders the `SO101_JOINTS` array as independent boxes
3. The procedural model applies `rotation.z` to each box independently — there is no kinematic chain, so joints don't articulate like a real arm
4. No URDF file or STL meshes exist under `app/public/assets/robots/` for the SO-101

The H1 humanoid works correctly because it has a full URDF + DAE meshes at `app/public/assets/robots/h1/`.

### Source Assets
From https://github.com/TheRobotStudio/SO-ARM100/tree/main/Simulation/SO101:
- **URDF**: `so101_new_calib.urdf` (new calibration, zero at joint range midpoint)
- **Meshes**: 13 STL files in `assets/` directory (flat, no subdirectories)
- **Mesh path convention in URDF**: `"assets/<filename>.stl"` (relative paths, not `package://`)

STL files to download:
```
base_motor_holder_so101_v1.stl
base_so101_v2.stl
motor_holder_so101_base_v1.stl
motor_holder_so101_wrist_v1.stl
moving_jaw_so101_v1.stl
rotation_pitch_so101_v1.stl
sts3215_03a_no_horn_v1.stl
sts3215_03a_v1.stl
under_arm_so101_v1.stl
upper_arm_so101_v1.stl
waveshare_mounting_plate_so101_v2.stl
wrist_roll_follower_so101_v1.stl
wrist_roll_pitch_so101_v2.stl
```

`urdf-loader` (v0.12.6, already installed) has built-in STL support via Three.js `STLLoader` — no additional packages needed.

### URDF Joint Names (from the real URDF)
| URDF Joint | Type | Robot-Agent Config Name |
|---|---|---|
| `shoulder_pan` | revolute | `shoulder_pan` |
| `shoulder_lift` | revolute | `shoulder_lift` |
| `elbow_flex` | revolute | `elbow_flex` |
| `wrist_flex` | revolute | `wrist_flex` |
| `wrist_roll` | revolute | `wrist_roll` |
| `gripper` | revolute | `gripper` |
| `gripper_frame_joint` | fixed | (not animated) |

Joint names match exactly between the URDF and `robot-agent/src/robot/joint-configs/so101.config.ts` — no mapping needed.

### Implementation Steps

**Step 1: Download assets**
- Download `so101_new_calib.urdf` and all 13 STL files from the SO-ARM100 repo
- Place at `app/public/assets/robots/so101/so101.urdf` and `app/public/assets/robots/so101/assets/*.stl`
- Edit the URDF mesh paths if needed to match the served directory structure. The URDF references `"assets/filename.stl"` which should resolve correctly from the URDF's directory

**Step 2: Register URDF path** in `app/src/features/robots/components/visualization/RobotModel.tsx`:
```typescript
const URDF_PATHS: Record<string, string> = {
  h1: '/assets/robots/h1/h1.urdf',
  so101: '/assets/robots/so101/so101.urdf',  // <-- add this
};
```
This single change routes `so101` to `URDFModel` instead of `ProceduralModel`, enabling real URDF loading with proper kinematic chain articulation.

**Step 3: Verify material application**
- The `URDFModel` component applies a custom `MeshStandardMaterial` (silver with turquoise emissive glow) to all loaded meshes within the first 3 seconds
- STL files load as plain geometry without materials, so this auto-material logic should work well
- Verify the material application works for STL (the H1 uses DAE which includes its own materials)

**Step 4: Verify joint animation**
- `Model3DTab.tsx` passes `telemetry?.jointStates` from `useTelemetryStream(robotId)` to the viewer
- `URDFModel` calls `robot.setJointValue(name, position)` for each joint state
- Since URDF joint names match the telemetry names exactly, animation should work without mapping
- Test with a running robot agent (`ROBOT_TYPE=so101`) and verify joints move in the 3D viewer

**Step 5: Adjust camera/grid positioning**
- `Robot3DViewer.tsx` already has SO-101-specific camera position `[0.5, 0.4, 0.5]` and grid at `y = -0.05`
- May need adjustment after seeing the real model — the URDF origin may differ from the procedural model's assumed origin
- The `<Center>` wrapper should handle basic centering, but verify the arm isn't clipped or floating

**Key Files:**
- Create: `app/public/assets/robots/so101/so101.urdf` (from repo)
- Create: `app/public/assets/robots/so101/assets/*.stl` (13 mesh files from repo)
- Modify: `app/src/features/robots/components/visualization/RobotModel.tsx` — add `so101` to `URDF_PATHS`
- Verify: `app/src/features/robots/components/visualization/Robot3DViewer.tsx` — camera/grid position
- Verify: `app/src/features/robots/components/tabs/Model3DTab.tsx` — joint state pass-through
- Reference: `robot-agent/src/robot/joint-configs/so101.config.ts` — joint names for verification

## Test Strategy
1. Start robot agent with `ROBOT_TYPE=so101` and the app, navigate to robot detail → 3D Model tab
2. Verify the SO-101 arm renders as a proper articulated 3D model (not boxes)
3. Verify joint states from telemetry animate the model (joints should move in the viewer)
4. Verify the model has correct materials (silver with turquoise glow, matching H1 style)
5. Verify camera position frames the arm model well (not too close, not too far)
6. Verify orbit controls work (rotate, zoom, pan around the arm)
7. Verify the joint state grid next to the 3D viewer shows live values
8. Compare joint limit ranges in the viewer against `so101.config.ts` values

## Notes
The procedural `SO101_JOINTS` and `GENERIC_JOINTS` arrays in `RobotModel.tsx` can be kept as fallback for when URDF assets fail to load — the `URDFModel` component already has error/loading states that show a wireframe box.
%% mc-links: [[TASK-003]] %%
