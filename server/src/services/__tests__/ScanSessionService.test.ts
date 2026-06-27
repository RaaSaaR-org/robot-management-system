/**
 * @file ScanSessionService.test.ts
 * @description Tests for the digital-twin pose→quaternion stamping and the
 *              persistFrame round-trip (TASK-170 Phase 2).
 * @feature digitaltwin
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getRegisteredRobot: vi.fn(),
  httpGet: vi.fn(),
  isAvailable: vi.fn(),
  uploadSensorScan: vi.fn(),
  repoCreate: vi.fn(),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../RobotManager.js', () => ({
  robotManager: { getRegisteredRobot: mocks.getRegisteredRobot },
}));

vi.mock('../HttpClient.js', () => ({
  HttpClient: class {
    get = mocks.httpGet;
  },
  HTTP_TIMEOUTS: { SHORT: 5000, MEDIUM: 10000, LONG: 30000 },
}));

vi.mock('../../storage/model-storage.js', () => ({
  modelStorage: { isAvailable: mocks.isAvailable, uploadSensorScan: mocks.uploadSensorScan },
  BUCKETS: { SENSOR_SCANS: 'sensor-scans' },
}));

vi.mock('../../repositories/SensorScanRepository.js', () => ({
  sensorScanRepository: { create: mocks.repoCreate },
}));

vi.mock('fs', () => ({
  promises: { mkdir: mocks.mkdir, writeFile: mocks.writeFile, unlink: vi.fn() },
  createReadStream: vi.fn(),
}));

import { SensorScanService, poseToQuaternion } from '../SensorScanService.js';

const FRAME = {
  robotId: 'robot-001',
  sensor: 'mid360_lidar',
  sensorType: 'lidar',
  frame: 'base_link',
  pointCount: 2,
  positions: [0, 0, 0, 1, 1, 1],
  intensities: [0.1, 0.2],
  hasIntensity: true,
  sequence: 7,
  timestamp: '2026-06-23T00:00:00.000Z',
};

describe('poseToQuaternion', () => {
  it('encodes yaw=0 as the identity quaternion', () => {
    const q = poseToQuaternion({ x: 1, y: 2, z: 3, yaw: 0 });
    expect(q).toEqual({ x: 1, y: 2, z: 3, qx: 0, qy: 0, qz: 0, qw: 1 });
  });

  it('encodes yaw via qz=sin(yaw/2), qw=cos(yaw/2)', () => {
    const yaw = Math.PI / 2; // 90°
    const q = poseToQuaternion({ x: 0, y: 0, z: 0, yaw });
    expect(q.qz).toBeCloseTo(Math.sin(yaw / 2));
    expect(q.qw).toBeCloseTo(Math.cos(yaw / 2));
    expect(q.qx).toBe(0);
    expect(q.qy).toBe(0);
  });

  it('round-trips: atan2(qz, qw) recovers half the yaw', () => {
    const yaw = 1.2345;
    const q = poseToQuaternion({ x: 0, y: 0, z: 0, yaw });
    const recovered = 2 * Math.atan2(q.qz, q.qw);
    expect(recovered).toBeCloseTo(yaw);
  });
});

describe('SensorScanService.persistFrame (session stamping)', () => {
  let service: SensorScanService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new (SensorScanService as unknown as { new (): SensorScanService })();
    mocks.isAvailable.mockReturnValue(false);
    mocks.repoCreate.mockImplementation((input: Record<string, unknown>) => ({
      id: 'scan-xyz',
      capturedAt: '2026-06-23T00:00:00.000Z',
      sessionId: input.sessionId ?? null,
      frameIndex: input.frameIndex ?? null,
      pose: input.pose ?? { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 },
      ...input,
    }));
  });

  it('stamps sessionId, frameIndex, and the pose quaternion onto the record', async () => {
    await service.persistFrame({
      robotId: 'robot-001',
      frame: FRAME as never,
      sessionId: 'session-1',
      frameIndex: 4,
      pose: { x: 2, y: -1, z: 0, yaw: Math.PI },
    });

    expect(mocks.repoCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        frameIndex: 4,
        storageBackend: 'local',
        pose: expect.objectContaining({ x: 2, y: -1, z: 0, qx: 0, qy: 0 }),
      }),
    );
    const arg = mocks.repoCreate.mock.calls[0][0] as { pose: { qz: number; qw: number } };
    expect(arg.pose.qz).toBeCloseTo(Math.sin(Math.PI / 2)); // ≈1
    expect(arg.pose.qw).toBeCloseTo(Math.cos(Math.PI / 2)); // ≈0
  });

  it('uses frame.pose when no explicit pose option is given', async () => {
    const posed = { ...FRAME, pose: { x: 5, y: 5, z: 0, yaw: 0 } };
    await service.persistFrame({ robotId: 'robot-001', frame: posed as never });
    expect(mocks.repoCreate).toHaveBeenCalledWith(
      expect.objectContaining({ pose: expect.objectContaining({ x: 5, y: 5, qw: 1 }) }),
    );
  });

  it('leaves pose undefined (DB identity default) for unposed ad-hoc captures', async () => {
    await service.persistFrame({ robotId: 'robot-001', frame: FRAME as never });
    const arg = mocks.repoCreate.mock.calls[0][0] as { pose?: unknown; sessionId: unknown };
    expect(arg.pose).toBeUndefined();
    expect(arg.sessionId).toBeNull();
  });
});
