/**
 * @file TelemetryIngestionService.test.ts
 * @description Frame-handling tests for the telemetry ingestion service:
 *              fast-frame relay (TASK-191) and the persistence guard — fast
 *              frames are broadcast-only and must never reach the repository.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../RobotManager.js', () => ({
  robotManager: {
    emitTelemetry: vi.fn(),
    emitTelemetryFast: vi.fn(),
    onRobotEvent: vi.fn(),
    getRegisteredRobot: vi.fn(),
  },
}));

vi.mock('../../repositories/index.js', () => ({
  robotRepository: {
    saveTelemetry: vi.fn().mockResolvedValue(undefined),
    getAllRegisteredRobots: vi.fn().mockResolvedValue([]),
  },
}));

const { robotManager } = await import('../RobotManager.js');
const { robotRepository } = await import('../../repositories/index.js');
const { TelemetryIngestionService } = await import('../TelemetryIngestionService.js');

// ============================================================================
// HELPERS
// ============================================================================

interface TestConnection {
  robotId: string;
  wsUrl: string;
  ws: null;
  reconnectTimer: null;
  backoffMs: number;
  stopped: boolean;
  lastPersistAt: number;
  hadIssues: boolean;
}

function makeConnection(robotId = 'robot-1'): TestConnection {
  return {
    robotId,
    wsUrl: `ws://localhost:41243/ws/telemetry/${robotId}`,
    ws: null,
    reconnectTimer: null,
    backoffMs: 5000,
    stopped: false,
    lastPersistAt: 0,
    hadIssues: false,
  };
}

function fullFrame(robotId = 'agent-reported-id') {
  return {
    type: 'telemetry',
    payload: {
      robotId,
      batteryLevel: 80,
      cpuUsage: 10,
      memoryUsage: 20,
      temperature: 40,
      sensors: {},
      jointStates: [{ name: 'elbow_flex', position: 0.4, velocity: 0 }],
      timestamp: new Date().toISOString(),
    },
  };
}

function fastFrame(robotId = 'agent-reported-id') {
  return {
    type: 'telemetry_fast',
    payload: {
      robotId,
      jointStates: [{ name: 'elbow_flex', position: 0.41, velocity: 0 }],
      imu: { rpy: [0, 0, 0], gyro: [0, 0, 0], accel: [0, 0, 9.81] },
      timestamp: new Date().toISOString(),
    },
  };
}

/** Invoke the (private) frame handler the way the WS 'message' listener does. */
function handle(service: InstanceType<typeof TelemetryIngestionService>, conn: TestConnection, message: unknown): void {
  (service as unknown as { handleMessage: (c: TestConnection, d: Buffer) => void }).handleMessage(
    conn,
    Buffer.from(JSON.stringify(message))
  );
}

// ============================================================================
// TESTS
// ============================================================================

describe('TelemetryIngestionService frame handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists full frames (downsampled) and broadcasts them', () => {
    const service = new TelemetryIngestionService();
    const conn = makeConnection();

    handle(service, conn, fullFrame());

    expect(robotManager.emitTelemetry).toHaveBeenCalledTimes(1);
    expect(robotRepository.saveTelemetry).toHaveBeenCalledTimes(1);
  });

  it('relays fast frames as robot_telemetry_fast and NEVER persists them', () => {
    const service = new TelemetryIngestionService();
    const conn = makeConnection();

    // 100 fast frames + 1 full frame → exactly one repository write.
    for (let i = 0; i < 100; i++) {
      handle(service, conn, fastFrame());
    }
    handle(service, conn, fullFrame());

    expect(robotManager.emitTelemetryFast).toHaveBeenCalledTimes(100);
    expect(robotManager.emitTelemetry).toHaveBeenCalledTimes(1);
    expect(robotRepository.saveTelemetry).toHaveBeenCalledTimes(1);
  });

  it('canonicalizes the robot id on fast frames to the registry id', () => {
    const service = new TelemetryIngestionService();
    const conn = makeConnection('registry-id');

    handle(service, conn, fastFrame('spoofed-id'));

    expect(robotManager.emitTelemetryFast).toHaveBeenCalledWith(
      'registry-id',
      expect.objectContaining({ robotId: 'registry-id' })
    );
  });

  it('fast frames do not bypass the edge-triggered issue persistence of full frames', () => {
    const service = new TelemetryIngestionService();
    const conn = makeConnection();

    // A fast frame cannot carry errors/warnings state transitions into the DB.
    handle(service, conn, { ...fastFrame(), payload: { ...fastFrame().payload, errors: ['x'] } });
    expect(robotRepository.saveTelemetry).not.toHaveBeenCalled();

    // The next full frame with issues persists immediately (edge trigger).
    const frame = fullFrame();
    handle(service, conn, { ...frame, payload: { ...frame.payload, errors: ['motor fault'] } });
    expect(robotRepository.saveTelemetry).toHaveBeenCalledTimes(1);
  });

  it('ignores non-telemetry messages', () => {
    const service = new TelemetryIngestionService();
    const conn = makeConnection();

    handle(service, conn, { type: 'pong' });
    handle(service, conn, { type: 'alert', payload: { severity: 'info' } });

    expect(robotManager.emitTelemetry).not.toHaveBeenCalled();
    expect(robotManager.emitTelemetryFast).not.toHaveBeenCalled();
    expect(robotRepository.saveTelemetry).not.toHaveBeenCalled();
  });
});
