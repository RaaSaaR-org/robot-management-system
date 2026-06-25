/**
 * @file DigitalTwinService.test.ts
 * @description Tests for the sidecar build-job orchestrator: claim/progress/
 *              complete/fail + stale reaping (TASK-170 Phase 3). Mirrors the
 *              TrainingOrchestrator lifecycle semantics.
 * @feature digitaltwin
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  ssFindById: vi.fn(),
  ssUpdate: vi.fn(),
  ssListClaimable: vi.fn(),
  ssListStuck: vi.fn(),
  dtFindById: vi.fn(),
  dtUpdate: vi.fn(),
  scanListBySession: vi.fn(),
}));

vi.mock('../../repositories/index.js', () => ({
  scanSessionRepository: {
    findById: mocks.ssFindById,
    update: mocks.ssUpdate,
    listClaimable: mocks.ssListClaimable,
    listStuck: mocks.ssListStuck,
  },
  digitalTwinRepository: {
    findById: mocks.dtFindById,
    update: mocks.dtUpdate,
  },
  sensorScanRepository: {
    listBySession: mocks.scanListBySession,
  },
}));

import { DigitalTwinService } from '../DigitalTwinService.js';
import type { DigitalTwinEvent } from '../../types/twin.types.js';

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    robotId: 'robot-1',
    twinId: 'twin-1',
    status: 'processing',
    frameCount: 3,
    originX: 0, originY: 0, originZ: 0,
    startedAt: null, endedAt: null,
    progress: 0, stage: null, workerId: null, lastHeartbeat: null,
    errorMessage: null, tenantId: null,
    createdAt: '2026-06-23T00:00:00.000Z',
    updatedAt: '2026-06-23T00:00:00.000Z',
    ...overrides,
  };
}

function makeTwin(overrides: Record<string, unknown> = {}) {
  return {
    id: 'twin-1', name: 'Lab', robotId: null, floor: null, status: 'processing',
    version: 1, worldOriginX: 1, worldOriginY: 2, worldOriginZ: 0, resolution: 0.05,
    minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0, pointCount: 0,
    storageBackend: 'local', cloudKey: null, meshKey: null, occupancyPgmKey: null,
    occupancyYamlKey: null, roadmapKey: null, errorMessage: null, tenantId: null,
    createdAt: '2026-06-23T00:00:00.000Z', updatedAt: '2026-06-23T00:00:00.000Z',
    ...overrides,
  };
}

function makeScan(i: number) {
  return {
    id: `scan-${i}`, frameIndex: i, pointCount: 100 + i,
    pose: { x: i, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 },
  };
}

describe('DigitalTwinService', () => {
  let service: DigitalTwinService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new (DigitalTwinService as unknown as { new (): DigitalTwinService })();
    mocks.ssUpdate.mockImplementation((_id: string, patch: Record<string, unknown>) =>
      makeSession(patch),
    );
    mocks.dtUpdate.mockImplementation((_id: string, patch: Record<string, unknown>) =>
      makeTwin(patch),
    );
  });

  describe('claimNextPendingJob', () => {
    it('returns null when nothing is claimable', async () => {
      mocks.ssListClaimable.mockResolvedValue([]);
      expect(await service.claimNextPendingJob('worker-1')).toBeNull();
    });

    it('claims the oldest session, stamps worker + heartbeat, returns the build job', async () => {
      mocks.ssListClaimable.mockResolvedValue([makeSession(), makeSession({ id: 'session-2' })]);
      mocks.dtFindById.mockResolvedValue(makeTwin());
      mocks.scanListBySession.mockResolvedValue([makeScan(0), makeScan(1), makeScan(2)]);

      const job = await service.claimNextPendingJob('worker-1');

      // Oldest (first) session claimed.
      expect(mocks.ssUpdate).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({ workerId: 'worker-1', stage: 'downloading' }),
      );
      expect(mocks.ssUpdate.mock.calls[0][1].lastHeartbeat).toBeInstanceOf(Date);

      expect(job).not.toBeNull();
      expect(job!.sessionId).toBe('session-1');
      expect(job!.twinId).toBe('twin-1');
      expect(job!.resolution).toBe(0.05);
      expect(job!.worldOrigin).toEqual({ x: 1, y: 2, z: 0 });
      expect(job!.frameCount).toBe(3);
      expect(job!.frames).toHaveLength(3);
      expect(job!.frames[0]).toMatchObject({ scanId: 'scan-0', frameIndex: 0, pointCount: 100 });
    });
  });

  describe('updateProgress', () => {
    it('clamps progress, updates the session, and emits session:progress', async () => {
      mocks.ssFindById.mockResolvedValue(makeSession());
      const events: DigitalTwinEvent[] = [];
      service.onDigitalTwinEvent((e) => events.push(e));

      const result = await service.updateProgress({
        sessionId: 'session-1', workerId: 'worker-1', progress: 140, stage: 'occupancy',
      });

      expect(result).toEqual({ status: 'continue' });
      expect(mocks.ssUpdate).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({ progress: 100, stage: 'occupancy' }),
      );
      expect(events[0].type).toBe('session:progress');
    });

    it('returns cancel when the session is gone', async () => {
      mocks.ssFindById.mockResolvedValue(null);
      expect(await service.updateProgress({ sessionId: 'x', workerId: 'w', progress: 10 }))
        .toEqual({ status: 'cancel' });
    });

    it('returns cancel for a completed/failed session', async () => {
      mocks.ssFindById.mockResolvedValue(makeSession({ status: 'failed' }));
      expect(await service.updateProgress({ sessionId: 'session-1', workerId: 'w', progress: 10 }))
        .toEqual({ status: 'cancel' });
    });
  });

  describe('recordHeartbeat', () => {
    it('returns continue and refreshes the heartbeat for an active session', async () => {
      mocks.ssFindById.mockResolvedValue(makeSession());
      const result = await service.recordHeartbeat({ sessionId: 'session-1', workerId: 'worker-1' });
      expect(result).toEqual({ status: 'continue' });
      expect(mocks.ssUpdate).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({ workerId: 'worker-1' }),
      );
    });

    it('returns stop when the session is gone', async () => {
      mocks.ssFindById.mockResolvedValue(null);
      expect(await service.recordHeartbeat({ sessionId: 'x', workerId: 'w' }))
        .toEqual({ status: 'stop' });
    });
  });

  describe('completeJob', () => {
    it('persists artifacts + bounds onto the twin, marks ready, emits twin:ready', async () => {
      mocks.ssFindById.mockResolvedValue(makeSession());
      const events: DigitalTwinEvent[] = [];
      service.onDigitalTwinEvent((e) => events.push(e));

      const result = await service.completeJob({
        sessionId: 'session-1',
        workerId: 'worker-1',
        pointCount: 4242,
        bounds: [-1, -2, 0, 3, 4, 2],
        artifacts: { cloudKey: 'twin-1/cloud.pcd', occupancyPgmKey: 'twin-1/occupancy.pgm' },
        storageBackend: 'local',
      });

      expect(result).toEqual({ ok: true });
      expect(mocks.dtUpdate).toHaveBeenCalledWith(
        'twin-1',
        expect.objectContaining({
          status: 'ready',
          pointCount: 4242,
          minX: -1, maxZ: 2,
          cloudKey: 'twin-1/cloud.pcd',
          occupancyPgmKey: 'twin-1/occupancy.pgm',
        }),
      );
      expect(mocks.ssUpdate).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({ status: 'complete', progress: 100 }),
      );
      const ready = events.find((e) => e.type === 'twin:ready');
      expect(ready).toBeDefined();
      expect((ready as { twin: { id: string } }).twin.id).toBe('twin-1');
    });

    it('returns ok:false for a missing session', async () => {
      mocks.ssFindById.mockResolvedValue(null);
      const result = await service.completeJob({
        sessionId: 'nope', workerId: 'w', pointCount: 0,
        bounds: [0, 0, 0, 0, 0, 0], artifacts: {}, storageBackend: 'local',
      });
      expect(result).toEqual({ ok: false });
    });
  });

  describe('failJob', () => {
    it('marks session + twin failed and emits twin:failed', async () => {
      mocks.ssFindById.mockResolvedValue(makeSession());
      const events: DigitalTwinEvent[] = [];
      service.onDigitalTwinEvent((e) => events.push(e));

      const result = await service.failJob({
        sessionId: 'session-1', workerId: 'worker-1', error: 'merge exploded',
      });

      expect(result).toEqual({ ok: true });
      expect(mocks.ssUpdate).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({ status: 'failed', errorMessage: 'merge exploded' }),
      );
      expect(mocks.dtUpdate).toHaveBeenCalledWith(
        'twin-1',
        expect.objectContaining({ status: 'failed', errorMessage: 'merge exploded' }),
      );
      expect(events.some((e) => e.type === 'twin:failed')).toBe(true);
    });
  });

  describe('reapStaleRunningJobs', () => {
    it('fails every stuck session and returns the count', async () => {
      mocks.ssListStuck.mockResolvedValue([makeSession(), makeSession({ id: 'session-2', twinId: 'twin-2' })]);
      mocks.ssFindById.mockImplementation((id: string) =>
        Promise.resolve(makeSession({ id, twinId: id === 'session-2' ? 'twin-2' : 'twin-1' })),
      );

      const reaped = await service.reapStaleRunningJobs();
      expect(reaped).toBe(2);
      expect(mocks.ssUpdate).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({ status: 'failed' }),
      );
    });
  });
});
