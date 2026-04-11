/**
 * @file telemetry.test.ts
 * @description Tests for telemetry generation
 * @status test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SimulatedRobotState } from '../types.js';

// Mock fs.readFileSync (used for Pi temperature)
vi.mock('fs', () => ({
  readFileSync: vi.fn().mockReturnValue('45000'), // 45°C
}));

// Mock joint configs
vi.mock('../joint-configs/index.js', () => ({
  getJointConfig: vi.fn().mockReturnValue([
    { name: 'shoulder_pan', axis: 'z', limitLower: -3.14, limitUpper: 3.14, defaultPosition: 0 },
    { name: 'elbow_flex', axis: 'y', limitLower: -1.57, limitUpper: 1.57, defaultPosition: 0 },
  ]),
}));

// Import after mocking
const { generateTelemetry, generateAlerts, formatTelemetryMessage, clearAlertTracking } = await import('../telemetry.js');

function createMockState(overrides: Partial<SimulatedRobotState> = {}): SimulatedRobotState {
  return {
    id: 'test-robot-1',
    name: 'TestBot',
    model: 'TestModel',
    serialNumber: 'SN001',
    robotClass: 'standard',
    robotType: 'generic',
    maxPayloadKg: 10,
    description: 'Test robot',
    status: 'online',
    batteryLevel: 80,
    location: { x: 0, y: 0, floor: '1' },
    capabilities: ['navigation'],
    firmware: '1.0.0',
    ipAddress: '127.0.0.1',
    speed: 0,
    lastSeen: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    errors: [],
    warnings: [],
    heldObject: undefined,
    ...overrides,
  };
}

describe('generateTelemetry', () => {
  it('returns telemetry with correct robotId', () => {
    const state = createMockState();
    const telemetry = generateTelemetry(state);

    expect(telemetry.robotId).toBe('test-robot-1');
  });

  it('includes battery level for generic robot', () => {
    const state = createMockState({ batteryLevel: 75 });
    const telemetry = generateTelemetry(state);

    expect(telemetry.batteryLevel).toBe(75);
    expect(telemetry.powerSource).toBe('battery');
  });

  it('returns null battery for SO-101 (AC-powered)', () => {
    const state = createMockState({ robotType: 'so101' });
    const telemetry = generateTelemetry(state);

    expect(telemetry.batteryLevel).toBeNull();
    expect(telemetry.powerSource).toBe('ac_powered');
  });

  it('includes CPU and memory usage', () => {
    const state = createMockState();
    const telemetry = generateTelemetry(state);

    expect(telemetry.cpuUsage).toBeGreaterThanOrEqual(0);
    expect(telemetry.memoryUsage).toBeGreaterThanOrEqual(0);
    expect(telemetry.memoryUsage).toBeLessThanOrEqual(100);
  });

  it('includes timestamp', () => {
    const state = createMockState();
    const telemetry = generateTelemetry(state);

    expect(telemetry.timestamp).toBeDefined();
    const date = new Date(telemetry.timestamp);
    expect(date.getTime()).not.toBeNaN();
  });

  it('includes sensor data', () => {
    const state = createMockState();
    const telemetry = generateTelemetry(state);

    expect(telemetry.sensors).toBeDefined();
    expect(telemetry.sensors.gripperClosed).toBe(false);
  });

  it('generates joint states', () => {
    const state = createMockState();
    const telemetry = generateTelemetry(state);

    expect(telemetry.jointStates).toBeDefined();
    expect(telemetry.jointStates!.length).toBeGreaterThan(0);
    expect(telemetry.jointStates![0]).toHaveProperty('name');
    expect(telemetry.jointStates![0]).toHaveProperty('position');
  });

  it('SO-101 has minimal sensor data', () => {
    const state = createMockState({ robotType: 'so101' });
    const telemetry = generateTelemetry(state);

    // SO-101 should only have gripper sensors
    expect(telemetry.sensors.gripperClosed).toBeDefined();
    expect(telemetry.sensors.frontSonar).toBeUndefined();
  });
});

describe('formatTelemetryMessage', () => {
  it('returns valid JSON string with type telemetry', () => {
    const state = createMockState();
    const telemetry = generateTelemetry(state);
    const msg = formatTelemetryMessage(telemetry);

    const parsed = JSON.parse(msg);
    expect(parsed.type).toBe('telemetry');
    expect(parsed.payload.robotId).toBe('test-robot-1');
    expect(parsed.timestamp).toBeDefined();
  });
});

describe('generateAlerts', () => {
  beforeEach(() => {
    clearAlertTracking('test-robot-1');
  });

  it('returns empty array for healthy state', () => {
    const state = createMockState({ batteryLevel: 80 });
    const alerts = generateAlerts(state);

    expect(alerts).toEqual([]);
  });

  it('generates warning for low battery', () => {
    const state = createMockState({ batteryLevel: 15 });
    const alerts = generateAlerts(state);

    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].severity).toBe('warning');
    expect(alerts[0].title).toBe('Low Battery');
  });

  it('generates critical alert for very low battery', () => {
    const state = createMockState({ batteryLevel: 3 });
    const alerts = generateAlerts(state);

    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].severity).toBe('critical');
  });

  it('does not generate battery alerts for SO-101', () => {
    const state = createMockState({ robotType: 'so101', batteryLevel: 3 });
    const alerts = generateAlerts(state);

    // SO-101 uses AC power, should not have battery alerts
    const batteryAlerts = alerts.filter((a) => a.title.includes('Battery'));
    expect(batteryAlerts).toHaveLength(0);
  });

  it('generates alert for error status', () => {
    const state = createMockState({ status: 'error' });
    const alerts = generateAlerts(state);

    expect(alerts.length).toBeGreaterThan(0);
    const errorAlert = alerts.find((a) => a.title === 'Robot Error State');
    expect(errorAlert).toBeDefined();
    expect(errorAlert!.severity).toBe('error');
  });

  it('deduplicates alerts (same alert not emitted twice)', () => {
    const state = createMockState({ batteryLevel: 15 });

    const first = generateAlerts(state);
    const second = generateAlerts(state);

    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBe(0); // Already emitted
  });

  it('converts state errors to alerts', () => {
    const state = createMockState({ errors: ['Motor fault'] });
    const alerts = generateAlerts(state);

    expect(alerts.length).toBeGreaterThan(0);
    const motorAlert = alerts.find((a) => a.message === 'Motor fault');
    expect(motorAlert).toBeDefined();
  });
});
