/**
 * @file TeleoperationService.test.ts
 * @description Unit tests for TeleoperationService export-to-dataset functionality
 * @feature datacollection
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted so mocks are available when vi.mock factories run
const { mockPrisma, mockDatasetRepository, mockRobotTypeRepository } = vi.hoisted(() => ({
  mockPrisma: {
    teleoperationSession: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    teleoperationFrame: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      aggregate: vi.fn(),
      deleteMany: vi.fn(),
    },
    robot: {
      findUnique: vi.fn(),
    },
  },
  mockDatasetRepository: {
    create: vi.fn().mockResolvedValue({ id: 'ds-created-id' }),
  },
  mockRobotTypeRepository: {
    findById: vi.fn(),
    findAll: vi.fn().mockResolvedValue([
      { id: 'rt-so101', name: 'SO-101 Follower', manufacturer: 'TheRobotStudio', model: 'SO-ARM100', actionDim: 6, proprioceptionDim: 6 },
      { id: 'rt-aloha', name: 'ALOHA', manufacturer: 'Google', model: 'ALOHA', actionDim: 14, proprioceptionDim: 14 },
    ]),
    create: vi.fn().mockResolvedValue({ id: 'rt-new-id' }),
  },
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    teleoperationSession = mockPrisma.teleoperationSession;
    teleoperationFrame = mockPrisma.teleoperationFrame;
    robot = mockPrisma.robot;
  },
}));

vi.mock('../../repositories/index.js', () => ({
  datasetRepository: mockDatasetRepository,
  robotTypeRepository: mockRobotTypeRepository,
}));

const { mockExportSession, mockBuildInfo } = vi.hoisted(() => ({
  mockExportSession: vi.fn().mockResolvedValue({
    datasetId: 'export-storage-id',
    storagePath: 'export-storage-id/',
    episodeCount: 1,
  }),
  mockBuildInfo: vi.fn().mockReturnValue({ codebase_version: 'v3.0', features: {} }),
}));

vi.mock('../LeRobotExportService.js', () => ({
  LeRobotExportService: class {
    exportSession = mockExportSession;
    buildInfo = mockBuildInfo;
  },
}));

// The sim recorder path lazily imports RobotManager for telemetry — stub it out
vi.mock('../RobotManager.js', () => ({
  robotManager: {
    getTelemetry: vi.fn().mockResolvedValue({
      jointStates: [{ name: 'shoulder_pan', position: 0.1, velocity: 0 }],
    }),
  },
}));

vi.mock('../../storage/rustfs-client.js', () => ({
  RustFSClient: class {},
  getRustFSClient: vi.fn(),
  isRustFSInitialized: vi.fn().mockReturnValue(true),
}));

vi.mock('../DataQualityService.js', () => ({
  dataQualityService: {
    computeSmoothnessMetrics: vi.fn().mockReturnValue({ rmsJerk: 0 }),
    computeRMSJerk: vi.fn().mockReturnValue(0),
  },
}));

import { TeleoperationService } from '../TeleoperationService.js';

// ============================================================================
// TEST DATA
// ============================================================================

const COMPLETED_SESSION = {
  id: 'session-1',
  operatorId: 'op-1',
  robotId: 'robot-1',
  type: 'bilateral_aloha',
  status: 'completed',
  startedAt: new Date('2026-03-01T10:00:00Z'),
  endedAt: new Date('2026-03-01T10:05:00Z'),
  frameCount: 150,
  duration: 300,
  fps: 30,
  languageInstr: 'Pick up the cube',
  qualityScore: 85,
  exportedDatasetId: null,
  errorMessage: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const SAMPLE_FRAMES = [
  { frameIndex: 0, timestamp: 0, jointPositions: [0, 0, 0, 0, 0, 0], action: [1, 1, 1, 1, 1, 1], isIntervention: false },
  { frameIndex: 1, timestamp: 33, jointPositions: [1, 1, 1, 1, 1, 1], action: [2, 2, 2, 2, 2, 2], isIntervention: false },
];

// ============================================================================
// TESTS
// ============================================================================

describe('TeleoperationService', () => {
  let service: TeleoperationService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset default mock implementations after clearAllMocks
    mockDatasetRepository.create.mockResolvedValue({ id: 'ds-created-id' });
    mockRobotTypeRepository.findAll.mockResolvedValue([
      { id: 'rt-so101', name: 'SO-101 Follower', manufacturer: 'TheRobotStudio', model: 'SO-ARM100', actionDim: 6, proprioceptionDim: 6 },
      { id: 'rt-aloha', name: 'ALOHA', manufacturer: 'Google', model: 'ALOHA', actionDim: 14, proprioceptionDim: 14 },
    ]);
    mockRobotTypeRepository.create.mockResolvedValue({ id: 'rt-new-id' });
    service = TeleoperationService.getInstance();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // EXPORT TO LEROBOT — DATASET CREATION
  // --------------------------------------------------------------------------

  describe('exportToLeRobot — dataset creation', () => {
    it('creates a Dataset record with correct fields after export', async () => {
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue(COMPLETED_SESSION);
      mockPrisma.teleoperationFrame.findMany.mockResolvedValue(SAMPLE_FRAMES);
      mockPrisma.teleoperationSession.update.mockResolvedValue({});
      mockPrisma.robot.findUnique.mockResolvedValue({ id: 'robot-1', model: 'SO-101' });

      const result = await service.exportToLeRobot('session-1', {});

      // Dataset was created
      expect(mockDatasetRepository.create).toHaveBeenCalledTimes(1);
      const createArg = mockDatasetRepository.create.mock.calls[0][0];
      expect(createArg.name).toBe('teleop_session-');
      expect(createArg.fps).toBe(30);
      expect(createArg.totalFrames).toBe(2);
      expect(createArg.totalDuration).toBe(300);
      expect(createArg.demonstrationCount).toBe(1);
      expect(createArg.lerobotVersion).toBe('v3.0');
      expect(createArg.status).toBe('ready');
      expect(createArg.robotTypeId).toBe('rt-so101');

      // Result uses the DB dataset ID
      expect(result.datasetId).toBe('ds-created-id');
      expect(result.totalFrames).toBe(2);

      // Session updated with the new dataset ID
      expect(mockPrisma.teleoperationSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: { exportedDatasetId: 'ds-created-id' },
      });
    });

    it('resolves robotTypeId correctly for existing robot types', async () => {
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue(COMPLETED_SESSION);
      mockPrisma.teleoperationFrame.findMany.mockResolvedValue(SAMPLE_FRAMES);
      mockPrisma.teleoperationSession.update.mockResolvedValue({});
      mockPrisma.robot.findUnique.mockResolvedValue({ id: 'robot-1', model: 'SO-101' });

      await service.exportToLeRobot('session-1', {});

      const createArg = mockDatasetRepository.create.mock.calls[0][0];
      expect(createArg.robotTypeId).toBe('rt-so101');
      expect(mockRobotTypeRepository.create).not.toHaveBeenCalled();
    });

    it('creates a new RobotType when no match found', async () => {
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue(COMPLETED_SESSION);
      mockPrisma.teleoperationFrame.findMany.mockResolvedValue(SAMPLE_FRAMES);
      mockPrisma.teleoperationSession.update.mockResolvedValue({});
      mockPrisma.robot.findUnique.mockResolvedValue({ id: 'robot-1', model: 'CustomArm-X7' });

      await service.exportToLeRobot('session-1', {});

      expect(mockRobotTypeRepository.create).toHaveBeenCalledWith({
        name: 'CustomArm-X7',
        manufacturer: 'Unknown',
        model: 'CustomArm-X7',
        actionDim: 0,
        proprioceptionDim: 0,
      });

      const createArg = mockDatasetRepository.create.mock.calls[0][0];
      expect(createArg.robotTypeId).toBe('rt-new-id');
    });

    it('uses custom dataset name when provided', async () => {
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue(COMPLETED_SESSION);
      mockPrisma.teleoperationFrame.findMany.mockResolvedValue(SAMPLE_FRAMES);
      mockPrisma.teleoperationSession.update.mockResolvedValue({});
      mockPrisma.robot.findUnique.mockResolvedValue({ id: 'robot-1', model: 'SO-101' });

      const result = await service.exportToLeRobot('session-1', {
        datasetName: 'my-custom-dataset',
      });

      const createArg = mockDatasetRepository.create.mock.calls[0][0];
      expect(createArg.name).toBe('my-custom-dataset');
      expect(result.datasetName).toBe('my-custom-dataset');
    });

    it('passes episodeIndex, task and session fps to the export service', async () => {
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue(COMPLETED_SESSION);
      mockPrisma.teleoperationFrame.findMany.mockResolvedValue([
        { ...SAMPLE_FRAMES[0], episodeIndex: 0 },
        { ...SAMPLE_FRAMES[1], episodeIndex: 1 },
      ]);
      mockPrisma.teleoperationSession.update.mockResolvedValue({});
      mockPrisma.robot.findUnique.mockResolvedValue({ id: 'robot-1', model: 'SO-101' });
      mockExportSession.mockResolvedValueOnce({
        datasetId: 'export-storage-id',
        storagePath: 'export-storage-id/',
        episodeCount: 2,
      });

      const result = await service.exportToLeRobot('session-1', {});

      const [frames, options] = mockExportSession.mock.calls[0];
      expect(frames.map((f: { episodeIndex?: number }) => f.episodeIndex)).toEqual([0, 1]);
      expect(options.task).toBe('Pick up the cube');
      expect(options.sessionFps).toBe(30);
      expect(result.trajectoryCount).toBe(2);

      const createArg = mockDatasetRepository.create.mock.calls[0][0];
      expect(createArg.demonstrationCount).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // EPISODES WITHIN A SESSION
  // --------------------------------------------------------------------------

  describe('episodes', () => {
    const RECORDING_SESSION = {
      ...COMPLETED_SESSION,
      status: 'recording',
      sidecarDatasetPath: null,
    };

    it('nextEpisode rejects when the session is not recording', async () => {
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue(COMPLETED_SESSION);
      await expect(service.nextEpisode('session-1')).rejects.toThrow(
        /Cannot advance episode/,
      );
    });

    it('nextEpisode rejects for sidecar-managed sessions', async () => {
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue({
        ...RECORDING_SESSION,
        sidecarDatasetPath: '/data/lerobot/pick',
      });
      await expect(service.nextEpisode('session-1')).rejects.toThrow(
        /managed by the hardware sidecar/,
      );
    });

    it('nextEpisode derives from stored frames when no live recorder exists', async () => {
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue(RECORDING_SESSION);
      mockPrisma.teleoperationFrame.aggregate.mockResolvedValue({
        _max: { episodeIndex: 2 },
      });

      const result = await service.nextEpisode('session-1');
      expect(result.episodeIndex).toBe(3);
    });

    it('listEpisodes summarizes frames grouped by episodeIndex', async () => {
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue(RECORDING_SESSION);
      mockPrisma.teleoperationFrame.groupBy.mockResolvedValue([
        { episodeIndex: 0, _count: { _all: 20 }, _min: { timestamp: 0 }, _max: { timestamp: 1.9 } },
        { episodeIndex: 1, _count: { _all: 30 }, _min: { timestamp: 2.5 }, _max: { timestamp: 5.4 } },
      ]);

      const episodes = await service.listEpisodes('session-1');
      expect(episodes).toEqual([
        { episodeIndex: 0, frameCount: 20, startTime: 0, endTime: 1.9, durationS: 1.9 },
        { episodeIndex: 1, frameCount: 30, startTime: 2.5, endTime: 5.4, durationS: 2.9 },
      ]);
    });

    it('listEpisodes throws for a missing session', async () => {
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue(null);
      await expect(service.listEpisodes('nope')).rejects.toThrow('not found');
    });

    it('discardEpisode deletes frames and updates the frame count', async () => {
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue(RECORDING_SESSION);
      mockPrisma.teleoperationFrame.deleteMany.mockResolvedValue({ count: 20 });
      mockPrisma.teleoperationFrame.count.mockResolvedValue(30);
      mockPrisma.teleoperationSession.update.mockResolvedValue({});

      const result = await service.discardEpisode('session-1', 0);

      expect(mockPrisma.teleoperationFrame.deleteMany).toHaveBeenCalledWith({
        where: { sessionId: 'session-1', episodeIndex: 0 },
      });
      expect(mockPrisma.teleoperationSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: { frameCount: 30 },
      });
      expect(result).toEqual({ episodeIndex: 0, deletedFrames: 20, frameCount: 30 });
    });

    it('discardEpisode rejects after the session is completed', async () => {
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue(COMPLETED_SESSION);
      await expect(service.discardEpisode('session-1', 0)).rejects.toThrow(
        /Cannot discard episode/,
      );
      expect(mockPrisma.teleoperationFrame.deleteMany).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // END SESSION — frame-based (sim) path
  // --------------------------------------------------------------------------

  describe('endSession — frame-based sessions', () => {
    const RECORDING_SESSION = {
      ...COMPLETED_SESSION,
      status: 'recording',
      sidecarDatasetPath: null,
      exportedDatasetId: null,
    };

    beforeEach(() => {
      // No sidecar: robot has no agent URL → resolveSidecarUrl returns null
      mockPrisma.robot.findUnique.mockResolvedValue({
        id: 'robot-1',
        model: 'SO-101',
        a2aAgentUrl: null,
      });
      // computeSessionQuality reads frames
      mockPrisma.teleoperationFrame.findMany.mockResolvedValue([]);
      mockPrisma.teleoperationSession.update.mockImplementation(
        async (args: { data: Record<string, unknown> }) => ({
          ...RECORDING_SESSION,
          ...args.data,
        }),
      );
    });

    it('completes with a clear warning (no 500, no dataset) when zero frames were recorded', async () => {
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue(RECORDING_SESSION);
      mockPrisma.teleoperationFrame.count.mockResolvedValue(0);

      const result = await service.endSession('session-1');

      expect(result.status).toBe('completed');
      expect(result.errorMessage).toMatch(/No frames were recorded/);
      expect(mockExportSession).not.toHaveBeenCalled();
      expect(mockDatasetRepository.create).not.toHaveBeenCalled();
    });

    it('auto-exports to LeRobot when frames exist', async () => {
      const frames = [
        { ...SAMPLE_FRAMES[0], episodeIndex: 0 },
        { ...SAMPLE_FRAMES[1], episodeIndex: 0 },
      ];
      // endSession → findUnique (recording), then exportToLeRobot re-reads the
      // session — by then it has been marked completed.
      mockPrisma.teleoperationSession.findUnique
        .mockResolvedValueOnce(RECORDING_SESSION)
        .mockResolvedValue({ ...RECORDING_SESSION, status: 'completed' });
      mockPrisma.teleoperationFrame.count.mockResolvedValue(2);
      mockPrisma.teleoperationFrame.findMany.mockResolvedValue(frames);

      const result = await service.endSession('session-1');

      expect(result.status).toBe('completed');
      expect(mockExportSession).toHaveBeenCalledTimes(1);
      expect(mockDatasetRepository.create).toHaveBeenCalledTimes(1);
    });

    it('keeps the session completed and records the error when auto-export fails', async () => {
      mockPrisma.teleoperationSession.findUnique
        .mockResolvedValueOnce(RECORDING_SESSION)
        .mockResolvedValue({ ...RECORDING_SESSION, status: 'completed' });
      mockPrisma.teleoperationFrame.count.mockResolvedValue(2);
      mockPrisma.teleoperationFrame.findMany.mockResolvedValue(SAMPLE_FRAMES);
      mockExportSession.mockRejectedValueOnce(new Error('rustfs down'));

      const result = await service.endSession('session-1');

      expect(result.status).toBe('completed');
      // errorMessage recorded via a session update
      const updates = mockPrisma.teleoperationSession.update.mock.calls.map((c) => c[0].data);
      expect(
        updates.some(
          (d: Record<string, unknown>) =>
            typeof d.errorMessage === 'string' &&
            (d.errorMessage as string).includes('Auto-export'),
        ),
      ).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // START SESSION — sim recorder wiring
  // --------------------------------------------------------------------------

  describe('startSession — sim frame recorder', () => {
    const CREATED_SESSION = {
      ...COMPLETED_SESSION,
      status: 'created',
      startedAt: null,
      sidecarDatasetPath: null,
      fps: 10,
    };

    afterEach(async () => {
      // Ensure no recorder timer leaks between tests
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue({
        ...CREATED_SESSION,
        status: 'recording',
      });
      mockPrisma.teleoperationFrame.count.mockResolvedValue(0);
      mockPrisma.teleoperationFrame.findMany.mockResolvedValue([]);
      mockPrisma.robot.findUnique.mockResolvedValue({ id: 'robot-1', model: 'SO-101', a2aAgentUrl: null });
      mockPrisma.teleoperationSession.update.mockImplementation(
        async (args: { data: Record<string, unknown> }) => ({
          ...CREATED_SESSION,
          status: 'completed',
          ...args.data,
        }),
      );
      await service.endSession('session-1').catch(() => {});
    });

    it('starts a SimFrameRecorder when the robot has no sidecar', async () => {
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue(CREATED_SESSION);
      // No a2aAgentUrl → no sidecar URL at all
      mockPrisma.robot.findUnique.mockResolvedValue({ id: 'robot-1', model: 'SO-101', a2aAgentUrl: null });
      mockPrisma.teleoperationFrame.aggregate.mockResolvedValue({
        _max: { frameIndex: null, episodeIndex: null },
      });
      mockPrisma.teleoperationSession.update.mockImplementation(
        async (args: { data: Record<string, unknown> }) => ({
          ...CREATED_SESSION,
          ...args.data,
        }),
      );

      const result = await service.startSession('session-1');
      expect(result.status).toBe('recording');
      // Recorder was created and initialized from persisted frames
      expect(mockPrisma.teleoperationFrame.aggregate).toHaveBeenCalledWith({
        where: { sessionId: 'session-1' },
        _max: { frameIndex: true, episodeIndex: true },
      });
    });

    it('does NOT start a SimFrameRecorder when the sidecar recording starts', async () => {
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue(CREATED_SESSION);
      mockPrisma.robot.findUnique.mockResolvedValue({
        id: 'robot-1',
        model: 'SO-101',
        a2aAgentUrl: 'http://pi.local:41243',
      });
      mockPrisma.teleoperationSession.update.mockImplementation(
        async (args: { data: Record<string, unknown> }) => ({
          ...CREATED_SESSION,
          ...args.data,
        }),
      );
      // Sidecar /record/start succeeds → hardware path
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        json: async () => ({ ok: true, dataset_path: '/data/lerobot/pick' }),
      } as Response);

      try {
        await service.startSession('session-1');
        // The sim recorder initializes via teleoperationFrame.aggregate — it must
        // NOT have been created for a sidecar-backed session.
        expect(mockPrisma.teleoperationFrame.aggregate).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
        // Tear down the sidecar poller started by the sidecar path
        mockPrisma.teleoperationSession.findUnique.mockResolvedValue({
          ...CREATED_SESSION,
          status: 'recording',
          sidecarDatasetPath: '/data/lerobot/pick',
        });
        await service.deleteSession('session-1');
      }
    });
  });
});
