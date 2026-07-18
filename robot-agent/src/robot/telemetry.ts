/**
 * @file telemetry.ts
 * @description Telemetry and alert generation utilities. TASK-184: simulates the
 *              contract §3 field groups (imu/touch/battery/motorTemperatures/
 *              odometry) for G1/G1-EDU dev mode and marks every fabricated group
 *              in `telemetry.simulated` — state.ts unmarks groups it replaces
 *              with real hardware data.
 * @status live
 */

import os from 'os';
import * as nodeFs from 'fs';
import { readFileSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import type {
  RobotTelemetry,
  SimulatedRobotState,
  RobotAlert,
  AlertSeverity,
  JointState,
  RobotType,
  ImuTelemetry,
  HandTouch,
  BatteryState,
  OdometryState,
  TelemetryFieldGroup,
} from './types.js';
import { getJointConfig } from './joint-configs/index.js';

// Simulation phase is wall-clock derived (TASK-191): generateTelemetry() may be
// sampled by any number of consumers at any rate (2 s full frames, 100 ms fast
// frames, REST polls) — a per-call counter would make joint phase advance with
// call count instead of time, so motion speed changed with the number of pollers.
const SIM_EPOCH_MS = Date.now();

/** Seconds since agent start — monotonic no matter how often telemetry is read. */
function getSimulationTime(): number {
  return (Date.now() - SIM_EPOCH_MS) / 1000;
}

// Simulated motor warmth 0..1 — integrates toward 1 while the robot moves and
// cools back down when idle, so motor temperatures drift believably instead of
// flickering with random noise. Integrated by elapsed time, not call count.
let motorWarmth = 0;
let lastWarmthTime = 0;

// ============================================================================
// REAL SYSTEM DATA HELPERS
// ============================================================================

/** Read Raspberry Pi CPU temperature in °C */
function getPiTemperature(): number {
  try {
    const raw = readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8');
    return parseFloat(raw.trim()) / 1000;
  } catch {
    return 35 + Math.random() * 5; // fallback if not on Pi
  }
}

/** Real CPU usage % from os.loadavg (1-minute average) */
function getRealCpuUsage(): number {
  const cpuCount = os.cpus().length;
  const loadAvg = os.loadavg()[0];
  return Math.min(100, Math.round((loadAvg / cpuCount) * 100 * 10) / 10);
}

/** Real memory usage % */
function getRealMemoryUsage(): number {
  const total = os.totalmem();
  const free = os.freemem();
  return Math.round(((total - free) / total) * 100 * 10) / 10;
}

/**
 * Real disk usage % of the filesystem holding the working directory, via
 * `fs.statfsSync` (Node ≥ 18.15). Returns undefined when unavailable (older
 * Node, mocked fs in tests, or an exotic filesystem) — the field is then simply
 * omitted rather than hardcoded.
 */
function getRealDiskUsage(): number | undefined {
  try {
    // Inside the try: on older Node the export is undefined, and mocked fs
    // modules (tests) may throw on the property access itself.
    const statfs = (nodeFs as { statfsSync?: (path: string) => { blocks: number; bavail: number } })
      .statfsSync;
    if (typeof statfs !== 'function') return undefined;
    const s = statfs(process.cwd());
    if (!s || !Number.isFinite(s.blocks) || s.blocks <= 0 || !Number.isFinite(s.bavail)) {
      return undefined;
    }
    const used = 1 - s.bavail / s.blocks;
    return Math.min(100, Math.max(0, Math.round(used * 1000) / 10));
  } catch {
    return undefined;
  }
}

// ============================================================================
// TELEMETRY GENERATION
// ============================================================================

/**
 * Generate telemetry data from robot state
 *
 * Every field group fabricated here is marked in `simulated` (contract §3):
 * the real-over-sim override in state.ts replaces a group with hardware data
 * and removes it from the list, so consumers can badge sim vs. real per group.
 */
export function generateTelemetry(state: SimulatedRobotState): RobotTelemetry {
  const simulationTime = getSimulationTime();

  const isSO101 = state.robotType === 'so101';
  const isG1 = state.robotType === 'g1' || state.robotType === 'g1_edu';
  const isMoving = state.status === 'busy' && state.speed > 0;
  const piTemp = getPiTemperature();

  // Integrate motor warmth by elapsed time: heats up under motion, cools when
  // idle. The dt clamp keeps a long sampling gap from jumping the temperature.
  const warmthDt = Math.min(5, Math.max(0, simulationTime - lastWarmthTime));
  lastWarmthTime = simulationTime;
  motorWarmth = Math.min(
    1,
    Math.max(0, motorWarmth + (isMoving ? 0.01 : -0.0025) * warmthDt)
  );

  // Joints + position always come from the simulation here; sensors only for
  // non-G1 embodiments (the G1 has no sonars/bumpers/wheel motors — fabricating
  // them would be dishonest, so the record is empty and unmarked).
  const simulated: TelemetryFieldGroup[] = ['joints', 'position'];
  const sensors = isG1 ? {} : generateSensorData(state);
  if (!isG1) simulated.push('sensors');

  const telemetry: RobotTelemetry = {
    robotId: state.id,
    robotType: state.robotType,
    // SO-101 has no battery — null signals "AC-powered"
    batteryLevel: isSO101 ? null : Math.round(state.batteryLevel),
    batteryVoltage: isSO101 ? null : 48.0 + (state.batteryLevel / 100) * 4,
    batteryTemperature: isSO101 ? null : 25 + Math.random() * 5,
    powerSource: isSO101 ? 'ac_powered' : 'battery',
    // Real system data
    cpuUsage: getRealCpuUsage(),
    memoryUsage: getRealMemoryUsage(),
    diskUsage: getRealDiskUsage(),
    temperature: piTemp,
    humidity: isSO101 ? null : 45 + Math.random() * 10, // SO-101 has no humidity sensor
    speed: state.speed,
    sensors,
    jointStates: generateJointStates(state.robotType, state, simulationTime),
    errors: state.errors,
    warnings: state.warnings,
    timestamp: new Date().toISOString(),
  };

  // The battery level itself is simulated on every battery-powered embodiment.
  if (!isSO101) simulated.push('battery');

  // TASK-184 field groups, simulated for G1/G1-EDU dev mode only. Real data
  // replaces these (and unmarks the group) in RobotStateManager.getTelemetry.
  if (isG1) {
    telemetry.imu = simulateImu(simulationTime, isMoving);
    simulated.push('imu');

    telemetry.battery = simulateBattery(state, telemetry);
    // 'battery' already marked above.

    telemetry.motorTemperatures = simulateMotorTemperatures(telemetry.jointStates ?? []);
    simulated.push('motorTemperatures');

    telemetry.odometry = simulateOdometry(state);
    simulated.push('odometry');

    // Touch pads exist only on the Dex3 hands (G1 EDU) — a bare G1 has none,
    // so the group stays absent there instead of being zero-filled.
    if (state.robotType === 'g1_edu') {
      telemetry.touch = simulateTouch(simulationTime, !!state.heldObject);
      simulated.push('touch');
    }
  }

  telemetry.simulated = simulated;
  return telemetry;
}

// ============================================================================
// TASK-184 FIELD-GROUP SIMULATION (G1 / G1-EDU dev mode)
// ============================================================================

/** Gentle IMU sway: a standing/walking humanoid is never perfectly still. */
function simulateImu(time: number, isMoving: boolean): ImuTelemetry {
  const sway = isMoving ? 0.03 : 0.012; // rad amplitude
  const roll = Math.sin(time * 0.7) * sway;
  const pitch = Math.sin(time * 0.53 + 1.3) * sway * 0.8;
  const yaw = Math.sin(time * 0.11) * 0.01;
  return {
    rpy: [roll, pitch, yaw],
    // Approximate derivatives of the sway (rad/s) — small, never tip-level.
    gyro: [
      Math.cos(time * 0.7) * sway * 0.7,
      Math.cos(time * 0.53 + 1.3) * sway * 0.42,
      Math.cos(time * 0.11) * 0.001,
    ],
    // Gravity plus a touch of motion noise.
    accel: [
      (isMoving ? 0.15 : 0.02) * Math.sin(time * 1.7),
      (isMoving ? 0.1 : 0.02) * Math.sin(time * 1.3 + 0.5),
      9.81 + Math.random() * 0.05,
    ],
    temperature: 32 + motorWarmth * 6,
  };
}

/**
 * Dex3 touch pads: firm pressure when grasping an object, otherwise a slow
 * near-zero pulse (fingertips brushing). 3 pads × 4 cells per hand.
 */
function simulateTouch(time: number, isHolding: boolean): HandTouch {
  const hand = (phase: number) => {
    const pads = [];
    for (let p = 0; p < 3; p++) {
      const base = isHolding
        ? 9 + Math.sin(time * 0.9 + phase + p) * 1.5 // grasp pressure with micro-adjustments
        : Math.max(0, Math.sin(time * 0.2 + phase + p)) * 0.4; // slow idle pulses
      pads.push({
        pressure: Array.from({ length: 4 }, (_, c) => Math.max(0, base + Math.sin(c + phase) * 0.3)),
        temperature: Array.from({ length: 4 }, () => 30 + motorWarmth * 4),
      });
    }
    return pads;
  };
  return { left: hand(0), right: hand(2.1) };
}

/**
 * Battery group reusing the existing battery sim values (soc = the state
 * machine's drained/charged level, voltage/temperature = the same formulas as
 * the top-level fields) so both representations stay consistent.
 */
function simulateBattery(state: SimulatedRobotState, telemetry: RobotTelemetry): BatteryState {
  const charging = state.status === 'charging';
  return {
    soc: Math.round(state.batteryLevel),
    voltage: telemetry.batteryVoltage ?? undefined,
    // Sign convention: negative = discharging.
    current: charging ? 8 + Math.random() : -(2 + (state.status === 'busy' ? 3 : 0) + Math.random()),
    temperature: telemetry.batteryTemperature ?? undefined,
  };
}

/** Motor temperatures warming toward ~45°C under motion, cooling to ~28°C idle. */
function simulateMotorTemperatures(joints: JointState[]): Record<string, number> {
  const out: Record<string, number> = {};
  // Legs work hardest while walking; give them a slight bias over arm/hand joints.
  for (const j of joints) {
    const legBias = /hip|knee|ankle/.test(j.name) ? 1.0 : 0.7;
    const temp = 28 + motorWarmth * 17 * legBias + Math.random() * 0.6;
    out[j.name] = Math.round(temp * 10) / 10;
  }
  return out;
}

/** Odometry derived from the simulated planar position and heading. */
function simulateOdometry(state: SimulatedRobotState): OdometryState {
  const headingRad = ((state.location.heading ?? 0) * Math.PI) / 180;
  const speed = state.speed;
  return {
    position: [state.location.x, state.location.y, state.location.z ?? 0],
    rpy: [0, 0, headingRad],
    velocity: [speed * Math.cos(headingRad), speed * Math.sin(headingRad), 0],
    yawSpeed: 0,
  };
}

/**
 * Generate simulated joint states based on robot type and activity
 */
function generateJointStates(
  robotType: RobotType,
  state: SimulatedRobotState,
  time: number
): JointState[] {
  const joints = getJointConfig(robotType);
  if (joints.length === 0) return [];

  const isMoving = state.status === 'busy' && state.speed > 0;
  const isHolding = !!state.heldObject;

  return joints.map((joint) => {
    let position = joint.defaultPosition;

    if (robotType === 'h1') {
      position = simulateH1Joint(joint.name, time, isMoving, isHolding);
    } else if (robotType === 'g1' || robotType === 'g1_edu') {
      position = simulateG1Joint(joint.name, time, isMoving, isHolding);
    } else if (robotType === 'so101') {
      position = simulateSO101Joint(joint.name, time, isMoving, isHolding);
    }

    // Clamp to joint limits
    position = Math.max(joint.limitLower, Math.min(joint.limitUpper, position));

    return {
      name: joint.name,
      position,
      velocity: isMoving ? Math.random() * 0.5 : 0,
    };
  });
}

/**
 * Simulate H1 humanoid joint positions for walking animation
 */
function simulateH1Joint(jointName: string, time: number, isMoving: boolean, isHolding: boolean): number {
  const walkFreq = 2.0; // Walking cycle frequency

  if (!isMoving) {
    // Idle pose - slight natural sway
    const idleSway = Math.sin(time * 0.3) * 0.02;
    if (jointName.includes('hip_pitch')) return idleSway;
    if (jointName.includes('knee')) return 0.1;
    if (jointName.includes('elbow') && isHolding) return 0.8;
    return 0;
  }

  // Walking animation
  const phase = time * walkFreq;
  const isLeft = jointName.includes('left');
  const phaseOffset = isLeft ? 0 : Math.PI;

  switch (true) {
    // Leg joints - walking cycle
    case jointName.includes('hip_pitch'):
      return Math.sin(phase + phaseOffset) * 0.4;
    case jointName.includes('hip_roll'):
      return Math.sin(phase) * 0.05;
    case jointName.includes('hip_yaw'):
      return Math.sin(phase + phaseOffset) * 0.02;
    case jointName.includes('knee'):
      return Math.max(0, Math.sin(phase + phaseOffset + 0.5) * 0.5 + 0.3);
    case jointName.includes('ankle'):
      return Math.sin(phase + phaseOffset + 1.0) * 0.2;

    // Torso - slight counter-rotation
    case jointName === 'torso_joint':
      return Math.sin(phase) * 0.1;

    // Arms - counter-swing while walking
    case jointName.includes('shoulder_pitch'):
      return Math.sin(phase + phaseOffset + Math.PI) * 0.3;
    case jointName.includes('shoulder_roll'):
      return isLeft ? 0.2 : -0.2;
    case jointName.includes('elbow'):
      return isHolding ? 0.8 : 0.4 + Math.sin(phase + phaseOffset) * 0.1;

    default:
      return 0;
  }
}

/**
 * Simulate G1 humanoid joint positions for walking animation
 * G1 has 29 DOF: 12 leg (6 per side with ankle roll), 3 waist, 14 arm (7 per side with wrist 3DOF)
 */
function simulateG1Joint(jointName: string, time: number, isMoving: boolean, isHolding: boolean): number {
  const walkFreq = 2.0;

  if (!isMoving) {
    // Idle pose - subtle natural sway
    const idleSway = Math.sin(time * 0.3) * 0.02;
    if (jointName.includes('hip_pitch')) return idleSway;
    if (jointName.includes('knee')) return 0.1;
    if (jointName.includes('elbow') && isHolding) return 0.8;
    if (jointName.includes('waist_yaw')) return Math.sin(time * 0.15) * 0.01;
    // Dex3 hands (g1_edu): curl fingers when grasping, otherwise relaxed
    if (jointName.includes('hand')) {
      if (!isHolding) return 0;
      if (jointName.includes('thumb_2') || jointName.includes('_1_joint')) return 0.9;
      if (jointName.includes('thumb_1')) return 0.6;
      return 0;
    }
    return 0;
  }

  // Walking animation
  const phase = time * walkFreq;
  const isLeft = jointName.includes('left');
  const phaseOffset = isLeft ? 0 : Math.PI;

  switch (true) {
    // Leg joints - walking cycle
    case jointName.includes('hip_pitch'):
      return Math.sin(phase + phaseOffset) * 0.4;
    case jointName.includes('hip_roll'):
      return Math.sin(phase) * 0.05;
    case jointName.includes('hip_yaw'):
      return Math.sin(phase + phaseOffset) * 0.02;
    case jointName.includes('knee'):
      return Math.max(0, Math.sin(phase + phaseOffset + 0.5) * 0.5 + 0.3);
    case jointName.includes('ankle_pitch'):
      return Math.sin(phase + phaseOffset + 1.0) * 0.2;
    case jointName.includes('ankle_roll'):
      return Math.sin(phase + phaseOffset) * 0.03;

    // Waist - counter-rotation with 3 DOF
    case jointName === 'waist_yaw_joint':
      return Math.sin(phase) * 0.08;
    case jointName === 'waist_roll_joint':
      return Math.sin(phase * 2) * 0.02;
    case jointName === 'waist_pitch_joint':
      return Math.sin(phase) * 0.03;

    // Arms - counter-swing while walking
    case jointName.includes('shoulder_pitch'):
      return Math.sin(phase + phaseOffset + Math.PI) * 0.3;
    case jointName.includes('shoulder_roll'):
      return isLeft ? 0.2 : -0.2;
    case jointName.includes('shoulder_yaw'):
      return 0;
    case jointName.includes('elbow'):
      return isHolding ? 0.8 : 0.4 + Math.sin(phase + phaseOffset) * 0.1;
    case jointName.includes('wrist_roll'):
      return isHolding ? 0 : Math.sin(phase + phaseOffset) * 0.05;
    case jointName.includes('wrist_pitch'):
      return isHolding ? 0.1 : 0;
    case jointName.includes('wrist_yaw'):
      return 0;

    // Dex3 hands (g1_edu): gentle grasp curl when holding, small idle motion otherwise
    case jointName.includes('hand'):
      if (jointName.includes('thumb_2') || jointName.includes('_1_joint')) {
        return isHolding ? 0.9 : Math.max(0, Math.sin(phase) * 0.05);
      }
      if (jointName.includes('thumb_1')) return isHolding ? 0.6 : 0;
      return 0;

    default:
      return 0;
  }
}

/**
 * Simulate SO101 arm joint positions for working animation
 */
function simulateSO101Joint(jointName: string, time: number, isMoving: boolean, isHolding: boolean): number {
  const workFreq = 0.5; // Working cycle frequency

  if (!isMoving && !isHolding) {
    // Rest pose
    switch (jointName) {
      case 'shoulder_pan': return 0;
      case 'shoulder_lift': return 0.3;
      case 'elbow_flex': return -0.5;
      case 'wrist_flex': return 0;
      case 'wrist_roll': return 0;
      case 'gripper': return 0.5; // Open
      default: return 0;
    }
  }

  if (isHolding) {
    // Holding pose with subtle motion
    const holdSway = Math.sin(time * 0.2) * 0.05;
    switch (jointName) {
      case 'shoulder_pan': return holdSway;
      case 'shoulder_lift': return 0.5 + holdSway;
      case 'elbow_flex': return -0.3;
      case 'wrist_flex': return 0.2;
      case 'wrist_roll': return Math.sin(time * 0.1) * 0.1;
      case 'gripper': return 1.2; // Closed
      default: return 0;
    }
  }

  // Working animation (reaching)
  const phase = time * workFreq;
  switch (jointName) {
    case 'shoulder_pan': return Math.sin(phase) * 0.5;
    case 'shoulder_lift': return 0.3 + Math.sin(phase * 2) * 0.3;
    case 'elbow_flex': return -0.5 + Math.sin(phase * 2 + 0.5) * 0.3;
    case 'wrist_flex': return Math.sin(phase * 3) * 0.3;
    case 'wrist_roll': return Math.sin(phase) * 0.5;
    case 'gripper': return 0.8 + Math.sin(phase * 4) * 0.3;
    default: return 0;
  }
}

/**
 * Generate simulated sensor data (SO-101 only has gripper/arm — no sonars, bumpers, IMU).
 * NOT called for G1/G1-EDU: the G1 has none of these sensors, so fabricating the
 * record would be dishonest — its real groups live in imu/touch/battery/odometry.
 */
function generateSensorData(state: SimulatedRobotState): Record<string, number | boolean | string> {
  const isSO101 = state.robotType === 'so101';

  if (isSO101) {
    // SO-101: only arm/gripper sensors — no sonars, bumpers, IMU, wheel motors
    return {
      gripperClosed: !!state.heldObject,
      gripperForce: state.heldObject ? 5.0 + Math.random() * 2 : 0,
      armPosition: state.heldObject ? 'holding' : 'idle',
    };
  }

  // Generic/H1: full sensor simulation
  const isMoving = state.status === 'busy' && state.speed > 0;

  return {
    // Distance sensors (in cm)
    frontSonar: isMoving ? 50 + Math.random() * 200 : 999,
    rearSonar: 150 + Math.random() * 100,
    leftSonar: 100 + Math.random() * 50,
    rightSonar: 100 + Math.random() * 50,

    // Bumper sensors
    leftBumper: false,
    rightBumper: false,
    frontBumper: false,
    rearBumper: false,

    // Safety sensors
    cliffDetector: false,
    obstacleDetected: isMoving && Math.random() < 0.05,

    // Arm/gripper sensors
    gripperClosed: !!state.heldObject,
    gripperForce: state.heldObject ? 5.0 + Math.random() * 2 : 0,
    armPosition: state.heldObject ? 'holding' : 'idle',
    armAngle: state.heldObject ? 45 : 0,

    // IMU data
    accelerometerX: isMoving ? 0.1 + Math.random() * 0.1 : 0,
    accelerometerY: isMoving ? Math.random() * 0.05 : 0,
    accelerometerZ: 9.8 + Math.random() * 0.1,
    gyroX: isMoving ? Math.random() * 2 - 1 : 0,
    gyroY: isMoving ? Math.random() * 2 - 1 : 0,
    gyroZ: isMoving ? Math.random() * 5 - 2.5 : 0,

    // Motor currents (in Amps)
    leftMotorCurrent: isMoving ? 2.0 + Math.random() * 1 : 0.1,
    rightMotorCurrent: isMoving ? 2.0 + Math.random() * 1 : 0.1,
    armMotorCurrent: state.heldObject ? 1.5 + Math.random() * 0.5 : 0.1,

    // Environmental
    ambientLight: 500 + Math.random() * 200,
    noiseLevel: 40 + Math.random() * 20,
  };
}

/**
 * Format telemetry for WebSocket transmission
 */
export function formatTelemetryMessage(telemetry: RobotTelemetry): string {
  return JSON.stringify({
    type: 'telemetry',
    payload: telemetry,
    timestamp: new Date().toISOString(),
  });
}

/**
 * High-rate channel frame (TASK-191): only the fields that animate the 3D
 * viewer (joints, IMU, odometry). Pushed every TELEMETRY_FAST_INTERVAL_MS;
 * everything else (temperatures, battery, touch, sensors) stays on the full
 * frame at the regular cadence. The payload is a strict subset of
 * RobotTelemetry so consumers can treat it as a partial frame.
 */
export function formatFastTelemetryMessage(telemetry: RobotTelemetry): string {
  const fastGroups: TelemetryFieldGroup[] = ['joints', 'imu', 'odometry', 'position'];
  return JSON.stringify({
    type: 'telemetry_fast',
    payload: {
      robotId: telemetry.robotId,
      robotType: telemetry.robotType,
      jointStates: telemetry.jointStates,
      imu: telemetry.imu,
      odometry: telemetry.odometry,
      speed: telemetry.speed,
      hardwareConnected: telemetry.hardwareConnected,
      simulated: telemetry.simulated?.filter((g) => fastGroups.includes(g)),
      timestamp: telemetry.timestamp,
    },
    timestamp: new Date().toISOString(),
  });
}

// ============================================================================
// ALERT GENERATION
// ============================================================================

/**
 * Track previously emitted alerts to avoid duplicates
 */
const emittedAlerts = new Set<string>();

/**
 * Generate a unique alert key for deduplication
 */
function getAlertKey(severity: AlertSeverity, title: string, robotId: string): string {
  return `${robotId}:${severity}:${title}`;
}

/**
 * Create an alert object
 */
function createAlert(
  robotId: string,
  severity: AlertSeverity,
  title: string,
  message: string
): RobotAlert {
  return {
    id: uuidv4(),
    severity,
    title,
    message,
    source: 'robot',
    sourceId: robotId,
    timestamp: new Date().toISOString(),
    dismissable: severity !== 'critical',
    autoDismissMs: severity === 'info' ? 10000 : undefined,
  };
}

/**
 * Generate alerts from robot state conditions
 */
export function generateAlerts(state: SimulatedRobotState): RobotAlert[] {
  const alerts: RobotAlert[] = [];

  // Battery alerts (skip for SO-101 — no battery, AC-powered)
  if (state.robotType !== 'so101' && state.batteryLevel < 5) {
    const key = getAlertKey('critical', 'Critical Battery Level', state.id);
    if (!emittedAlerts.has(key)) {
      alerts.push(
        createAlert(
          state.id,
          'critical',
          'Critical Battery Level',
          `${state.name} battery is critically low (${Math.round(state.batteryLevel)}%). Immediate charging required.`
        )
      );
      emittedAlerts.add(key);
    }
  } else if (state.robotType !== 'so101' && state.batteryLevel < 20) {
    const key = getAlertKey('warning', 'Low Battery', state.id);
    if (!emittedAlerts.has(key)) {
      alerts.push(
        createAlert(
          state.id,
          'warning',
          'Low Battery',
          `${state.name} battery is low (${Math.round(state.batteryLevel)}%). Consider charging soon.`
        )
      );
      emittedAlerts.add(key);
    }
  } else if (state.batteryLevel > 25) {
    // Clear low battery alert when battery is back above threshold
    emittedAlerts.delete(getAlertKey('warning', 'Low Battery', state.id));
    emittedAlerts.delete(getAlertKey('critical', 'Critical Battery Level', state.id));
  }

  // Error status alert
  if (state.status === 'error') {
    const key = getAlertKey('error', 'Robot Error State', state.id);
    if (!emittedAlerts.has(key)) {
      alerts.push(
        createAlert(
          state.id,
          'error',
          'Robot Error State',
          `${state.name} has entered an error state. Check robot diagnostics.`
        )
      );
      emittedAlerts.add(key);
    }
  } else {
    emittedAlerts.delete(getAlertKey('error', 'Robot Error State', state.id));
  }

  // Convert state errors to alerts
  for (const error of state.errors) {
    const key = getAlertKey('error', error, state.id);
    if (!emittedAlerts.has(key)) {
      alerts.push(createAlert(state.id, 'error', 'Robot Error', error));
      emittedAlerts.add(key);
    }
  }

  // Convert state warnings to alerts
  for (const warning of state.warnings) {
    // Skip 'Low battery' warning as we handle it separately above
    if (warning === 'Low battery') continue;

    const key = getAlertKey('warning', warning, state.id);
    if (!emittedAlerts.has(key)) {
      alerts.push(createAlert(state.id, 'warning', 'Robot Warning', warning));
      emittedAlerts.add(key);
    }
  }

  return alerts;
}

/**
 * Format an alert for WebSocket transmission
 */
export function formatAlertMessage(alert: RobotAlert): string {
  return JSON.stringify({
    type: 'alert',
    payload: alert,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Clear tracked alerts for a robot (e.g., on reset)
 */
export function clearAlertTracking(robotId: string): void {
  for (const key of emittedAlerts) {
    if (key.startsWith(`${robotId}:`)) {
      emittedAlerts.delete(key);
    }
  }
}

// ============================================================================
// ZONE EVENT FORMATTERS
// ============================================================================

/** Minimal zone info for zone enter/exit events */
export interface ZoneEventInfo {
  id: string;
  name: string;
  type: string;
}

/**
 * Format a zone_enter event payload
 */
export function formatZoneEnterEvent(
  robotId: string,
  zone: ZoneEventInfo
): { type: 'zone_enter'; robotId: string; zone: ZoneEventInfo; timestamp: string } {
  return {
    type: 'zone_enter',
    robotId,
    zone,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Format a zone_exit event payload
 */
export function formatZoneExitEvent(
  robotId: string,
  zone: ZoneEventInfo
): { type: 'zone_exit'; robotId: string; zone: ZoneEventInfo; timestamp: string } {
  return {
    type: 'zone_exit',
    robotId,
    zone,
    timestamp: new Date().toISOString(),
  };
}
