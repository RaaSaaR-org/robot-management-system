/**
 * @file telemetry.ts
 * @description Telemetry generation utilities
 */

import type { RobotTelemetry, SimulatedRobotState } from './types.js';

/**
 * Generate telemetry data from robot state
 */
export function generateTelemetry(state: SimulatedRobotState): RobotTelemetry {
  return {
    robotId: state.id,
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
    errors: state.errors,
    warnings: state.warnings,
    timestamp: new Date().toISOString(),
  };
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
