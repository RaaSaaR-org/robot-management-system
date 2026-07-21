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
const { generateTelemetry, generateAlerts, formatTelemetryMessage, formatFastTelemetryMessage, clearAlertTracking } = await import('../telemetry.js');

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

    // CPU usage is delta-based: undefined until the first sampling interval
    // has elapsed (honest 'n/a'), afterwards a real 0..100 percentage.
    if (telemetry.cpuUsage !== undefined) {
      expect(telemetry.cpuUsage).toBeGreaterThanOrEqual(0);
      expect(telemetry.cpuUsage).toBeLessThanOrEqual(100);
    }
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

describe('simulation phase (TASK-191)', () => {
  const jointPosition = (state: SimulatedRobotState, name: string) =>
    generateTelemetry(state).jointStates!.find((j) => j.name === name)!.position;

  it('does not advance with call count — interleaved consumers see the same pose', () => {
    // h1 + busy + speed: elbow_flex follows the walk-cycle phase.
    const state = createMockState({ robotType: 'h1', status: 'busy', speed: 1 });
    vi.useFakeTimers();
    try {
      const a = jointPosition(state, 'elbow_flex');
      // Simulate many interleaved consumers (fast channel + full frames + REST
      // polls) sampling at the same instant — phase must not move.
      for (let i = 0; i < 25; i++) {
        generateTelemetry(state);
      }
      const b = jointPosition(state, 'elbow_flex');
      expect(b).toBe(a);
    } finally {
      vi.useRealTimers();
    }
  });

  it('advances with wall-clock time', () => {
    const state = createMockState({ robotType: 'h1', status: 'busy', speed: 1 });
    vi.useFakeTimers();
    try {
      const a = jointPosition(state, 'elbow_flex');
      vi.advanceTimersByTime(500);
      const b = jointPosition(state, 'elbow_flex');
      expect(b).not.toBe(a);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('formatFastTelemetryMessage (TASK-191)', () => {
  it('emits a telemetry_fast subset frame without slow-channel fields', () => {
    const state = createMockState({ robotType: 'h1' });
    const telemetry = generateTelemetry(state);
    const parsed = JSON.parse(formatFastTelemetryMessage(telemetry));

    expect(parsed.type).toBe('telemetry_fast');
    expect(parsed.payload.robotId).toBe('test-robot-1');
    expect(parsed.payload.jointStates).toBeDefined();
    // Slow-channel-only fields must not ride the fast channel.
    expect(parsed.payload.cpuUsage).toBeUndefined();
    expect(parsed.payload.sensors).toBeUndefined();
    expect(parsed.payload.batteryLevel).toBeUndefined();
    expect(parsed.payload.motorTemperatures).toBeUndefined();
  });

  it('keeps only fast-group entries in the simulated labels', () => {
    const state = createMockState({ robotType: 'g1_edu' });
    const telemetry = generateTelemetry(state);
    const parsed = JSON.parse(formatFastTelemetryMessage(telemetry));

    const simulated: string[] = parsed.payload.simulated ?? [];
    for (const group of simulated) {
      expect(['joints', 'imu', 'odometry', 'position']).toContain(group);
    }
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
