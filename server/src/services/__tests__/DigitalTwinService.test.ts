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
  ssCompleteIfProcessing: vi.fn(),
  ssFailIfActive: vi.fn(),
  ssListClaimable: vi.fn(),
  ssListStuck: vi.fn(),
  ssListOrphanedRecording: vi.fn(),
  ssListByTwin: vi.fn(),
  dtFindById: vi.fn(),
  dtUpdate: vi.fn(),
  dtDelete: vi.fn(),
  scanListBySession: vi.fn(),
  pruneSessionFrames: vi.fn(),
  listScansBySession: vi.fn(),
  deleteScan: vi.fn(),
  simSceneDeleteByTwinId: vi.fn(),
  simSceneUpsertForTwin: vi.fn(),
  deleteTwinArtifact: vi.fn(),
}));

vi.mock('../../repositories/index.js', () => ({
  scanSessionRepository: {
    findById: mocks.ssFindById,
    update: mocks.ssUpdate,
    completeIfProcessing: mocks.ssCompleteIfProcessing,
    failIfActive: mocks.ssFailIfActive,
    listClaimable: mocks.ssListClaimable,
    listStuck: mocks.ssListStuck,
    listOrphanedRecording: mocks.ssListOrphanedRecording,
    listByTwin: mocks.ssListByTwin,
  },
  digitalTwinRepository: {
    findById: mocks.dtFindById,
    update: mocks.dtUpdate,
    delete: mocks.dtDelete,
  },
  sensorScanRepository: {
    listBySession: mocks.scanListBySession,
  },
  simSceneRepository: {
    deleteByTwinId: mocks.simSceneDeleteByTwinId,
    upsertForTwin: mocks.simSceneUpsertForTwin,
  },
}));

vi.mock('../SensorScanService.js', () => ({
  sensorScanService: {
    pruneSessionFrames: mocks.pruneSessionFrames,
    listScansBySession: mocks.listScansBySession,
    deleteScan: mocks.deleteScan,
  },
}));

vi.mock('../../storage/model-storage.js', () => ({
  modelStorage: {
    deleteTwinArtifact: mocks.deleteTwinArtifact,
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
    mocks.pruneSessionFrames.mockResolvedValue(0);
    // Deletion-cascade defaults: nothing to erase unless a test says otherwise.
    mocks.ssListByTwin.mockResolvedValue([]);
    mocks.listScansBySession.mockResolvedValue([]);
    mocks.deleteScan.mockResolvedValue(true);
    mocks.dtDelete.mockResolvedValue(true);
    mocks.simSceneDeleteByTwinId.mockResolvedValue(undefined);
    mocks.deleteTwinArtifact.mockResolvedValue(undefined);
    // CAS transitions succeed by default; tests that exercise a lost race
    // override these to false.
    mocks.ssCompleteIfProcessing.mockResolvedValue(true);
    mocks.ssFailIfActive.mockResolvedValue(true);
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
      expect(mocks.ssCompleteIfProcessing).toHaveBeenCalledWith('session-1');
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

    it('prunes the redundant raw frames after a successful build', async () => {
      mocks.ssFindById.mockResolvedValue(makeSession());
      mocks.pruneSessionFrames.mockResolvedValue(7);

      await service.completeJob({
        sessionId: 'session-1', workerId: 'worker-1', pointCount: 10,
        bounds: [0, 0, 0, 1, 1, 1], artifacts: { cloudKey: 'k' }, storageBackend: 'local',
      });

      expect(mocks.pruneSessionFrames).toHaveBeenCalledWith('session-1');
    });

    it('keeps raw frames when TWIN_PRUNE_RAW_FRAMES=false', async () => {
      vi.stubEnv('TWIN_PRUNE_RAW_FRAMES', 'false');
      mocks.ssFindById.mockResolvedValue(makeSession());

      await service.completeJob({
        sessionId: 'session-1', workerId: 'worker-1', pointCount: 10,
        bounds: [0, 0, 0, 1, 1, 1], artifacts: { cloudKey: 'k' }, storageBackend: 'local',
      });

      expect(mocks.pruneSessionFrames).not.toHaveBeenCalled();
      vi.unstubAllEnvs();
    });

    it('still completes ok when pruning throws', async () => {
      mocks.ssFindById.mockResolvedValue(makeSession());
      mocks.pruneSessionFrames.mockRejectedValue(new Error('storage down'));

      const result = await service.completeJob({
        sessionId: 'session-1', workerId: 'worker-1', pointCount: 10,
        bounds: [0, 0, 0, 1, 1, 1], artifacts: { cloudKey: 'k' }, storageBackend: 'local',
      });

      expect(result).toEqual({ ok: true });
    });

    it('bails out without writing the twin or pruning when the CAS is lost (reaper won)', async () => {
      // findById still sees 'processing', but the atomic claim fails because a
      // concurrent reaper already flipped the session to a terminal state.
      mocks.ssFindById.mockResolvedValue(makeSession());
      mocks.ssCompleteIfProcessing.mockResolvedValue(false);

      const result = await service.completeJob({
        sessionId: 'session-1', workerId: 'worker-1', pointCount: 10,
        bounds: [0, 0, 0, 1, 1, 1], artifacts: { cloudKey: 'k' }, storageBackend: 'local',
      });

      expect(result).toEqual({ ok: false });
      expect(mocks.dtUpdate).not.toHaveBeenCalled();      // twin not touched
      expect(mocks.pruneSessionFrames).not.toHaveBeenCalled(); // frames preserved
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
      expect(mocks.ssFailIfActive).toHaveBeenCalledWith('session-1', 'merge exploded');
      expect(mocks.dtUpdate).toHaveBeenCalledWith(
        'twin-1',
        expect.objectContaining({ status: 'failed', errorMessage: 'merge exploded' }),
      );
      expect(events.some((e) => e.type === 'twin:failed')).toBe(true);
    });

    it('does not clobber a session that already reached a terminal state (CAS lost)', async () => {
      mocks.ssFindById.mockResolvedValue(makeSession({ status: 'complete' }));
      mocks.ssFailIfActive.mockResolvedValue(false);
      const events: DigitalTwinEvent[] = [];
      service.onDigitalTwinEvent((e) => events.push(e));

      const result = await service.failJob({
        sessionId: 'session-1', workerId: 'reaper', error: 'worker timeout',
      });

      expect(result).toEqual({ ok: false });
      expect(mocks.dtUpdate).not.toHaveBeenCalled();         // twin left 'ready'
      expect(events.some((e) => e.type === 'twin:failed')).toBe(false);
    });
  });

  describe('deleteTwin', () => {
    it('erases the scans, their blobs, the sim scene and the artifacts of a FAILED build', async () => {
      // The failed-build case: failJob never prunes frames, so the full raw
      // sweep is still there when the user deletes the twin in reaction.
      mocks.dtFindById.mockResolvedValue(
        makeTwin({
          status: 'failed',
          errorMessage: 'merge exploded',
          cloudKey: 'twin-1/cloud.pcd',
          meshKey: 'twin-1/mesh.glb',
          occupancyPgmKey: null,
          simSceneKey: 'twin-1/scene.mjcf.xml',
        }),
      );
      mocks.ssListByTwin.mockResolvedValue([
        makeSession({ id: 'session-1', status: 'failed' }),
        makeSession({ id: 'session-2', status: 'failed' }),
      ]);
      mocks.listScansBySession.mockImplementation((sessionId: string) =>
        Promise.resolve(
          sessionId === 'session-1'
            ? [{ id: 'scan-a' }, { id: 'scan-b' }]
            : [{ id: 'scan-c' }],
        ),
      );

      const result = await service.deleteTwin('twin-1');

      expect(result).toBe(true);

      // Scans were reached through the twin→session index, and each scan's
      // blob + row deleted strictly (a blob failure must not be swallowed).
      expect(mocks.ssListByTwin).toHaveBeenCalledWith('twin-1');
      expect(mocks.deleteScan).toHaveBeenCalledTimes(3);
      for (const id of ['scan-a', 'scan-b', 'scan-c']) {
        expect(mocks.deleteScan).toHaveBeenCalledWith(id, { strictStorage: true });
      }

      // Sim scene and every non-null artifact key are gone.
      expect(mocks.simSceneDeleteByTwinId).toHaveBeenCalledWith('twin-1');
      expect(mocks.deleteTwinArtifact).toHaveBeenCalledWith('twin-1/cloud.pcd');
      expect(mocks.deleteTwinArtifact).toHaveBeenCalledWith('twin-1/mesh.glb');
      expect(mocks.deleteTwinArtifact).toHaveBeenCalledWith('twin-1/scene.mjcf.xml');
      expect(mocks.deleteTwinArtifact).toHaveBeenCalledTimes(3); // null keys skipped

      // The row goes last, so ScanSession only cascades once the scans that
      // are indexed by it have been enumerated.
      expect(mocks.dtDelete).toHaveBeenCalledWith('twin-1');
      const scansAt = mocks.deleteScan.mock.invocationCallOrder[0];
      const rowAt = mocks.dtDelete.mock.invocationCallOrder[0];
      expect(scansAt).toBeLessThan(rowAt);
    });

    it('returns false without touching storage when the twin does not exist', async () => {
      mocks.dtFindById.mockResolvedValue(null);

      expect(await service.deleteTwin('nope')).toBe(false);
      expect(mocks.ssListByTwin).not.toHaveBeenCalled();
      expect(mocks.simSceneDeleteByTwinId).not.toHaveBeenCalled();
      expect(mocks.dtDelete).not.toHaveBeenCalled();
    });

    it('propagates a blob-delete rejection instead of swallowing it, and keeps the row', async () => {
      mocks.dtFindById.mockResolvedValue(makeTwin({ cloudKey: 'twin-1/cloud.pcd' }));
      mocks.ssListByTwin.mockResolvedValue([makeSession()]);
      mocks.listScansBySession.mockResolvedValue([{ id: 'scan-a' }]);
      mocks.deleteScan.mockRejectedValue(new Error('bucket unreachable'));

      await expect(service.deleteTwin('twin-1')).rejects.toThrow('bucket unreachable');

      // A half-finished cascade must not look like a completed one.
      expect(mocks.dtDelete).not.toHaveBeenCalled();
      expect(mocks.deleteTwinArtifact).not.toHaveBeenCalled();
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
      expect(mocks.ssFailIfActive).toHaveBeenCalledTimes(2);
    });

    it('counts only sessions it actually reaped (skips ones already terminal)', async () => {
      mocks.ssListStuck.mockResolvedValue([makeSession(), makeSession({ id: 'session-2', twinId: 'twin-2' })]);
      mocks.ssFindById.mockImplementation((id: string) => Promise.resolve(makeSession({ id })));
      // session-2 was completed by the sidecar between snapshot and reap.
      mocks.ssFailIfActive.mockImplementation((id: string) => Promise.resolve(id === 'session-1'));

      expect(await service.reapStaleRunningJobs()).toBe(1);
    });

    it('names the real cause: never-claimed vs genuine worker timeout', async () => {
      mocks.ssListStuck.mockResolvedValue([
        makeSession({ id: 'never', lastHeartbeat: null }),
        makeSession({ id: 'timed-out', lastHeartbeat: '2026-06-23T00:00:00.000Z' }),
      ]);
      mocks.ssFindById.mockImplementation((id: string) => Promise.resolve(makeSession({ id })));

      await service.reapStaleRunningJobs();

      expect(mocks.ssFailIfActive).toHaveBeenCalledWith('never', expect.stringContaining('no build worker claimed'));
      expect(mocks.ssFailIfActive).toHaveBeenCalledWith('timed-out', expect.stringContaining('worker timeout'));
    });
  });

  describe('reapOrphanedRecordingSessions', () => {
    it('fails sweeps left in recording by a restart, with a re-scan message', async () => {
      mocks.ssListOrphanedRecording.mockResolvedValue([makeSession({ status: 'recording' })]);
      mocks.ssFindById.mockResolvedValue(makeSession({ status: 'recording' }));

      const reaped = await service.reapOrphanedRecordingSessions();

      expect(reaped).toBe(1);
      expect(mocks.ssFailIfActive).toHaveBeenCalledWith(
        'session-1',
        expect.stringContaining('recording interrupted by server restart'),
      );
    });

    it('returns 0 when nothing is orphaned', async () => {
      mocks.ssListOrphanedRecording.mockResolvedValue([]);
      expect(await service.reapOrphanedRecordingSessions()).toBe(0);
    });
  });

  describe('startReaper / stopReaper', () => {
    it('periodically reaps stale processing jobs and is idempotent', async () => {
      vi.useFakeTimers();
      try {
        mocks.ssListStuck.mockResolvedValue([]);
        service.startReaper(1000);
        service.startReaper(1000); // second call is a no-op (idempotent)

        await vi.advanceTimersByTimeAsync(2500);
        // 2 ticks fired (at 1000ms and 2000ms), each sweeping for stale jobs.
        expect(mocks.ssListStuck.mock.calls.length).toBeGreaterThanOrEqual(2);

        service.stopReaper();
        const callsAfterStop = mocks.ssListStuck.mock.calls.length;
        await vi.advanceTimersByTimeAsync(3000);
        expect(mocks.ssListStuck.mock.calls.length).toBe(callsAfterStop);
      } finally {
        service.stopReaper();
        vi.useRealTimers();
      }
    });
  });
});
