/**
 * @file SensorScanService.test.ts
 * @description Unit tests for SensorScanService (capture, storage fallback, events)
 * @feature robots
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getRegisteredRobot: vi.fn(),
  httpGet: vi.fn(),
  isAvailable: vi.fn(),
  uploadSensorScan: vi.fn(),
  getSensorScanStream: vi.fn(),
  deleteSensorScan: vi.fn(),
  repoCreate: vi.fn(),
  repoFindById: vi.fn(),
  repoListByRobot: vi.fn(),
  repoListBySession: vi.fn(),
  repoListAll: vi.fn(),
  repoDelete: vi.fn(),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../RobotManager.js', () => ({
  robotManager: { getRegisteredRobot: mocks.getRegisteredRobot },
}));

vi.mock('../HttpClient.js', () => ({
  HttpClient: class {
    get = mocks.httpGet;
  },
  HTTP_TIMEOUTS: { MEDIUM: 5000, LONG: 30000 },
}));

vi.mock('../../storage/model-storage.js', () => ({
  modelStorage: {
    isAvailable: mocks.isAvailable,
    uploadSensorScan: mocks.uploadSensorScan,
    getSensorScanStream: mocks.getSensorScanStream,
    deleteSensorScan: mocks.deleteSensorScan,
  },
  BUCKETS: { SENSOR_SCANS: 'sensor-scans' },
}));

vi.mock('../../repositories/SensorScanRepository.js', () => ({
  sensorScanRepository: {
    create: mocks.repoCreate,
    findById: mocks.repoFindById,
    listByRobot: mocks.repoListByRobot,
    listBySession: mocks.repoListBySession,
    listAll: mocks.repoListAll,
    delete: mocks.repoDelete,
  },
}));

vi.mock('fs', () => ({
  promises: { mkdir: mocks.mkdir, writeFile: mocks.writeFile, unlink: mocks.unlink },
  createReadStream: vi.fn(),
}));

import { SensorScanService } from '../SensorScanService.js';

const FRAME = {
  robotId: 'robot-001',
  sensor: 'mid360_lidar',
  sensorType: 'lidar',
  frame: 'base_link',
  pointCount: 3,
  positions: [0, 0, 0, 1, 1, 1, 2, 2, 2],
  intensities: [0.1, 0.2, 0.3],
  hasIntensity: true,
  sequence: 5,
  timestamp: '2026-06-23T00:00:00.000Z',
};

function recordFrom(overrides: Record<string, unknown> = {}) {
  return {
    id: 'scan-001',
    robotId: 'robot-001',
    sensorName: 'mid360_lidar',
    sensorType: 'lidar',
    format: 'pcd',
    pointCount: 3,
    fileSize: 100,
    hasIntensity: true,
    storageBackend: 'local',
    storageBucket: 'local',
    storageKey: '/tmp/scan.pcd',
    bounds: [0, 0, 0, 2, 2, 2],
    capturedAt: '2026-06-23T00:00:00.000Z',
    ...overrides,
  };
}

describe('SensorScanService', () => {
  let service: SensorScanService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Fresh instance each test to avoid cross-test listener bleed.
    service = new (SensorScanService as unknown as { new (): SensorScanService })();
    mocks.getRegisteredRobot.mockResolvedValue({ baseUrl: 'http://localhost:41244' });
    mocks.httpGet.mockResolvedValue(FRAME);
  });

  it('getLiveSnapshot proxies the agent and returns the frame', async () => {
    const frame = await service.getLiveSnapshot('robot-001');
    expect(frame.pointCount).toBe(3);
    expect(mocks.httpGet).toHaveBeenCalledWith(expect.stringContaining('/api/v1/robots/robot-001/pointcloud'));
  });

  it('getLiveSnapshot throws when the robot is not registered', async () => {
    mocks.getRegisteredRobot.mockResolvedValue(undefined);
    await expect(service.getLiveSnapshot('ghost')).rejects.toThrow(/not found/);
  });

  it('captureScan falls back to local storage when RustFS is unavailable', async () => {
    mocks.isAvailable.mockReturnValue(false);
    mocks.repoCreate.mockImplementation((input: Record<string, unknown>) => recordFrom(input));

    const events: unknown[] = [];
    service.onSensorScanEvent((e) => events.push(e));

    const summary = await service.captureScan('robot-001');

    expect(mocks.writeFile).toHaveBeenCalled();
    expect(mocks.uploadSensorScan).not.toHaveBeenCalled();
    expect(mocks.repoCreate).toHaveBeenCalledWith(
      expect.objectContaining({ storageBackend: 'local', sensorName: 'mid360_lidar', pointCount: 3 }),
    );
    expect(summary.downloadUrl).toContain('/api/sensor-scans/');
    expect(events).toHaveLength(1);
    expect((events[0] as { type: string }).type).toBe('scan:created');
  });

  it('captureScan uploads to RustFS when available', async () => {
    mocks.isAvailable.mockReturnValue(true);
    mocks.uploadSensorScan.mockResolvedValue('robot-001/scan.pcd');
    mocks.repoCreate.mockImplementation((input: Record<string, unknown>) => recordFrom(input));

    await service.captureScan('robot-001');

    expect(mocks.uploadSensorScan).toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.repoCreate).toHaveBeenCalledWith(expect.objectContaining({ storageBackend: 'rustfs' }));
  });

  it('listScans maps records to summaries with a download URL', async () => {
    mocks.repoListByRobot.mockResolvedValue([recordFrom()]);
    const scans = await service.listScans('robot-001');
    expect(scans).toHaveLength(1);
    expect(scans[0].downloadUrl).toBe('/api/sensor-scans/scan-001/download');
  });

  it('deleteScan returns false when the scan does not exist', async () => {
    mocks.repoFindById.mockResolvedValue(null);
    expect(await service.deleteScan('nope')).toBe(false);
  });

  it('deleteScan removes local file + row and emits scan:deleted', async () => {
    mocks.repoFindById.mockResolvedValue(recordFrom());
    mocks.repoDelete.mockResolvedValue(true);
    const events: Array<{ type: string }> = [];
    service.onSensorScanEvent((e) => events.push(e as { type: string }));

    const ok = await service.deleteScan('scan-001');

    expect(ok).toBe(true);
    expect(mocks.unlink).toHaveBeenCalledWith('/tmp/scan.pcd');
    expect(mocks.repoDelete).toHaveBeenCalledWith('scan-001');
    expect(events[0].type).toBe('scan:deleted');
  });

  it('pruneSessionFrames deletes every frame of a session and returns the count', async () => {
    mocks.repoListBySession.mockResolvedValue([
      recordFrom({ id: 'scan-001', storageKey: '/tmp/a.pcd' }),
      recordFrom({ id: 'scan-002', storageKey: '/tmp/b.pcd' }),
    ]);
    // deleteScan re-fetches each record by id before deleting.
    mocks.repoFindById.mockImplementation((id: string) =>
      Promise.resolve(recordFrom({ id, storageKey: `/tmp/${id}.pcd` })),
    );
    mocks.repoDelete.mockResolvedValue(true);

    const pruned = await service.pruneSessionFrames('session-xyz');

    expect(pruned).toBe(2);
    expect(mocks.repoListBySession).toHaveBeenCalledWith('session-xyz');
    expect(mocks.repoDelete).toHaveBeenCalledTimes(2);
    expect(mocks.unlink).toHaveBeenCalledTimes(2);
  });

  it('pruneSessionFrames is resilient: a failed frame does not abort the rest', async () => {
    mocks.repoListBySession.mockResolvedValue([
      recordFrom({ id: 'scan-001' }),
      recordFrom({ id: 'scan-002' }),
    ]);
    mocks.repoFindById.mockImplementation((id: string) =>
      id === 'scan-001'
        ? Promise.reject(new Error('db hiccup'))
        : Promise.resolve(recordFrom({ id })),
    );
    mocks.repoDelete.mockResolvedValue(true);

    const pruned = await service.pruneSessionFrames('session-xyz');

    // scan-001 threw, scan-002 still pruned.
    expect(pruned).toBe(1);
  });
});
