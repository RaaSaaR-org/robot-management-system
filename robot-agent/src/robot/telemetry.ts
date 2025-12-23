/**
 * @file telemetry.ts
 * @description Telemetry and alert generation utilities
 */

import { v4 as uuidv4 } from 'uuid';
import type { RobotTelemetry, SimulatedRobotState, RobotAlert, AlertSeverity, JointState, RobotType } from './types.js';
import { getJointConfig } from './joint-configs/index.js';

// Simulation time counter for joint animations
let simulationTime = 0;

/**
 * Generate telemetry data from robot state
 */
export function generateTelemetry(state: SimulatedRobotState): RobotTelemetry {
  // Increment simulation time for smooth animations
  simulationTime += 0.1;

  return {
    robotId: state.id,
    robotType: state.robotType,
    batteryLevel: Math.round(state.batteryLevel),
    batteryVoltage: 48.0 + (state.batteryLevel / 100) * 4,
    batteryTemperature: 25 + Math.random() * 5,
    cpuUsage: 15 + Math.random() * 20,
    memoryUsage: 40 + Math.random() * 15,
    diskUsage: 35,
    temperature: 35 + Math.random() * 10,
    humidity: 45 + Math.random() * 10,
    speed: state.speed,
    sensors: generateSensorData(state),
    jointStates: generateJointStates(state.robotType, state, simulationTime),
    errors: state.errors,
    warnings: state.warnings,
    timestamp: new Date().toISOString(),
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
 * Generate simulated sensor data
 */
function generateSensorData(state: SimulatedRobotState): Record<string, number | boolean | string> {
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

  // Battery alerts
  if (state.batteryLevel < 5) {
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
  } else if (state.batteryLevel < 20) {
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
