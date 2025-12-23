# Robot Integration Guide

This guide explains how to integrate new robot types into the RoboMindOS platform.

## Overview

Integrating a new robot requires updates across three components:

1. **Robot Agent** - Joint configurations and telemetry simulation
2. **Server** - Robot metadata handling (automatic)
3. **Frontend App** - 3D visualization with URDF models

---

## Available Robot Models

### Unitree Robots

Source: `temp/unitree_ros/robots/`

| Robot | Folder | Type | Joints |
|-------|--------|------|--------|
| **H1** | `h1_description/urdf/h1.urdf` | Humanoid | 19 |
| **H1 v2** | `h1_2_description/` | Humanoid | ~19 |
| **G1** | `g1_description/` | Humanoid | ~23 |
| **Go1** | `go1_description/` | Quadruped | 12 |
| **Go2** | `go2_description/` | Quadruped | 12 |
| **B1** | `b1_description/` | Quadruped | 12 |
| **B2** | `b2_description/` | Quadruped | 12 |
| **A1** | `a1_description/` | Quadruped | 12 |
| **Aliengo** | `aliengo_description/` | Quadruped | 12 |
| **Z1** | `z1_description/` | Robotic Arm | 6 |

### SO-ARM100

Source: `temp/SO-ARM100/Simulation/SO101/`

| Robot | File | Type | Joints |
|-------|------|------|--------|
| **SO101** | `so101_new_calib.urdf` | 6-DOF Arm | 6 |

Mesh assets: `assets/*.stl`

---

## Architecture

```
┌─────────────────┐     ┌─────────────┐     ┌─────────────────┐
│  Robot Agent    │────▶│   Server    │────▶│   Frontend      │
│                 │     │             │     │                 │
│ • Joint configs │     │ • Robot     │     │ • 3D Viewer     │
│ • Telemetry gen │     │   registry  │     │ • URDF loading  │
│ • ROBOT_TYPE    │     │ • WebSocket │     │ • Joint anim    │
└─────────────────┘     └─────────────┘     └─────────────────┘
        │                                           │
        │           RobotTelemetry                  │
        │  { robotType, jointStates[], ... }        │
        └───────────────────────────────────────────┘
```

**Data Flow:**
1. Robot Agent reads `ROBOT_TYPE` environment variable
2. Loads joint configuration for that robot type
3. Generates telemetry with `robotType` field and `jointStates[]`
4. Server relays telemetry to frontend via WebSocket
5. Frontend loads URDF model matching `robotType`
6. Joint states animate the 3D model in real-time

---

## Step-by-Step Integration

### Step 1: Add Robot Type Definition

Update the `RobotType` union in both locations:

**`robot-agent/src/robot/types.ts`**
```typescript
export type RobotType = 'h1' | 'so101' | 'go2' | 'generic';  // Add your type
```

**`app/src/features/robots/types/robots.types.ts`**
```typescript
export type RobotType = 'h1' | 'so101' | 'go2' | 'generic';  // Keep in sync
```

---

### Step 2: Create Joint Configuration

Create a new config file in `robot-agent/src/robot/joint-configs/`:

**`robot-agent/src/robot/joint-configs/go2.config.ts`**
```typescript
/**
 * @file go2.config.ts
 * @description Joint configuration for Unitree Go2 quadruped robot
 */

import type { JointConfig } from '../types.js';

export const GO2_JOINTS: JointConfig[] = [
  // Front Left Leg
  { name: 'FL_hip_joint', axis: 'x', limitLower: -0.86, limitUpper: 0.86, defaultPosition: 0 },
  { name: 'FL_thigh_joint', axis: 'y', limitLower: -0.69, limitUpper: 2.79, defaultPosition: 0.8 },
  { name: 'FL_calf_joint', axis: 'y', limitLower: -2.72, limitUpper: -0.84, defaultPosition: -1.5 },

  // Front Right Leg
  { name: 'FR_hip_joint', axis: 'x', limitLower: -0.86, limitUpper: 0.86, defaultPosition: 0 },
  { name: 'FR_thigh_joint', axis: 'y', limitLower: -0.69, limitUpper: 2.79, defaultPosition: 0.8 },
  { name: 'FR_calf_joint', axis: 'y', limitLower: -2.72, limitUpper: -0.84, defaultPosition: -1.5 },

  // Rear Left Leg
  { name: 'RL_hip_joint', axis: 'x', limitLower: -0.86, limitUpper: 0.86, defaultPosition: 0 },
  { name: 'RL_thigh_joint', axis: 'y', limitLower: -0.69, limitUpper: 2.79, defaultPosition: 0.8 },
  { name: 'RL_calf_joint', axis: 'y', limitLower: -2.72, limitUpper: -0.84, defaultPosition: -1.5 },

  // Rear Right Leg
  { name: 'RR_hip_joint', axis: 'x', limitLower: -0.86, limitUpper: 0.86, defaultPosition: 0 },
  { name: 'RR_thigh_joint', axis: 'y', limitLower: -0.69, limitUpper: 2.79, defaultPosition: 0.8 },
  { name: 'RR_calf_joint', axis: 'y', limitLower: -2.72, limitUpper: -0.84, defaultPosition: -1.5 },
];
```

**Update the index export:**

**`robot-agent/src/robot/joint-configs/index.ts`**
```typescript
import { H1_JOINTS } from './h1.config.js';
import { SO101_JOINTS } from './so101.config.js';
import { GO2_JOINTS } from './go2.config.js';  // Add import
import type { JointConfig, RobotType } from '../types.js';

export function getJointConfig(robotType: RobotType): JointConfig[] {
  switch (robotType) {
    case 'h1': return H1_JOINTS;
    case 'so101': return SO101_JOINTS;
    case 'go2': return GO2_JOINTS;  // Add case
    default: return [];
  }
}

export { H1_JOINTS, SO101_JOINTS, GO2_JOINTS };
```

---

### Step 3: Copy URDF and Mesh Files

Copy the URDF file and meshes to the app's public assets:

```bash
# Create robot directory
mkdir -p app/public/assets/robots/go2/meshes

# Copy URDF (update paths inside URDF if needed)
cp temp/unitree_ros/robots/go2_description/urdf/go2.urdf \
   app/public/assets/robots/go2/go2.urdf

# Copy mesh files (DAE or STL)
cp temp/unitree_ros/robots/go2_description/meshes/*.dae \
   app/public/assets/robots/go2/meshes/
```

**Important:** Edit the URDF file to update mesh paths:
```xml
<!-- Before -->
<mesh filename="package://go2_description/meshes/base.dae"/>

<!-- After -->
<mesh filename="meshes/base.dae"/>
```

---

### Step 4: Add Telemetry Simulation

Add a simulation function in `robot-agent/src/robot/telemetry.ts`:

```typescript
// Add to telemetry.ts

function simulateGo2Joint(
  jointName: string,
  config: JointConfig,
  state: SimulatedRobotState,
  time: number
): number {
  const isMoving = state.taskStatus === 'in_progress';
  const trotFreq = 3.0;  // Trotting frequency

  // Determine leg and joint type from name
  const isFrontLeg = jointName.startsWith('FL') || jointName.startsWith('FR');
  const isLeftLeg = jointName.startsWith('FL') || jointName.startsWith('RL');
  const isHip = jointName.includes('hip');
  const isThigh = jointName.includes('thigh');
  const isCalf = jointName.includes('calf');

  if (!isMoving) {
    return config.defaultPosition;
  }

  // Diagonal legs move together (trot gait)
  const phase = (isFrontLeg === isLeftLeg) ? 0 : Math.PI;

  if (isHip) {
    // Hip abduction/adduction
    return Math.sin(time * trotFreq + phase) * 0.1;
  } else if (isThigh) {
    // Thigh swing
    return 0.8 + Math.sin(time * trotFreq + phase) * 0.3;
  } else if (isCalf) {
    // Calf extension
    return -1.5 + Math.sin(time * trotFreq + phase) * 0.2;
  }

  return config.defaultPosition;
}
```

Update `generateJointStates()` to use the new function:
```typescript
function generateJointStates(
  robotType: RobotType,
  state: SimulatedRobotState,
  time: number
): JointState[] {
  const joints = getJointConfig(robotType);

  return joints.map((config) => {
    let position: number;

    switch (robotType) {
      case 'h1':
        position = simulateH1Joint(config.name, config, state, time);
        break;
      case 'so101':
        position = simulateSO101Joint(config.name, config, state, time);
        break;
      case 'go2':
        position = simulateGo2Joint(config.name, config, state, time);
        break;
      default:
        position = config.defaultPosition;
    }

    // Clamp to limits
    position = Math.max(config.limitLower, Math.min(config.limitUpper, position));

    return {
      name: config.name,
      position,
      velocity: 0,
      effort: 0,
    };
  });
}
```

---

### Step 5: Update 3D Viewer

Add the URDF path in `app/src/features/robots/components/visualization/RobotModel.tsx`:

```typescript
const URDF_PATHS: Record<string, string> = {
  h1: '/assets/robots/h1/h1.urdf',
  go2: '/assets/robots/go2/go2.urdf',  // Add new robot
};
```

Update camera positioning in `Robot3DViewer.tsx` if needed:

```typescript
const cameraPosition: [number, number, number] = (() => {
  switch (robotType) {
    case 'so101': return [0.5, 0.4, 0.5];
    case 'go2': return [1.5, 1, 1.5];  // Quadruped view
    default: return [2, 1.5, 2];
  }
})();
```

---

### Step 6: Test the Integration

1. **Start the robot agent with new type:**
   ```bash
   cd robot-agent
   ROBOT_TYPE=go2 npm run dev
   ```

2. **Start the server:**
   ```bash
   cd server
   npm run dev
   ```

3. **Start the app:**
   ```bash
   cd app
   npm run dev
   ```

4. **Verify:**
   - Check robot appears in fleet list
   - Open robot detail page
   - Confirm 3D model loads correctly
   - Verify joint animations when telemetry is received

---

## Reference: Existing Implementations

### H1 Humanoid (19 joints)

**Joint Groups:**
- Left Leg: hip_yaw, hip_roll, hip_pitch, knee, ankle
- Right Leg: hip_yaw, hip_roll, hip_pitch, knee, ankle
- Torso: torso_joint
- Left Arm: shoulder_pitch, shoulder_roll, shoulder_yaw, elbow
- Right Arm: shoulder_pitch, shoulder_roll, shoulder_yaw, elbow

**Animation:** Walking cycle with coordinated leg movement, arm counter-swing

**Files:**
- Config: `robot-agent/src/robot/joint-configs/h1.config.ts`
- URDF: `app/public/assets/robots/h1/h1.urdf`
- Meshes: `app/public/assets/robots/h1/meshes/*.dae`

### SO101 Robotic Arm (6 joints)

**Joint Groups:**
- Arm: shoulder_pan, shoulder_lift, elbow_flex, wrist_flex, wrist_roll
- End Effector: gripper

**Animation:** Reach and grasp cycles with smooth interpolation

**Files:**
- Config: `robot-agent/src/robot/joint-configs/so101.config.ts`
- URDF: Not yet integrated (uses procedural model)
- Source: `temp/SO-ARM100/Simulation/SO101/so101_new_calib.urdf`

---

## Troubleshooting

### Robot appears as wireframe box
- URDF path not found - check `URDF_PATHS` in RobotModel.tsx
- Mesh files missing - copy all DAE/STL files to assets

### Robot is dark/invisible
- Check lighting in Robot3DViewer.tsx
- Material may not be applied - RobotModel applies custom material after 3 seconds

### Robot is sideways or upside down
- ROS uses Z-up, Three.js uses Y-up
- Apply rotation: `rotation={[-Math.PI / 2, 0, 0]}`

### Joints don't animate
- Check joint names match between URDF and config
- Verify `jointStates` prop is being passed
- Check telemetry is being received via WebSocket

### URDF mesh paths broken
- Edit URDF to use relative paths: `meshes/part.dae`
- Ensure mesh folder structure matches URDF expectations

---

## File Reference

| Purpose | Path |
|---------|------|
| Robot types | `robot-agent/src/robot/types.ts` |
| Joint configs | `robot-agent/src/robot/joint-configs/` |
| Telemetry | `robot-agent/src/robot/telemetry.ts` |
| Agent config | `robot-agent/src/config/config.ts` |
| 3D model | `app/src/features/robots/components/visualization/RobotModel.tsx` |
| 3D viewer | `app/src/features/robots/components/visualization/Robot3DViewer.tsx` |
| URDF assets | `app/public/assets/robots/{type}/` |
| App types | `app/src/features/robots/types/robots.types.ts` |
