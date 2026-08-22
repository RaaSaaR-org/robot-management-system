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
      delete: vi.fn(),
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
    teleoperationEpisode: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
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
    teleoperationEpisode = mockPrisma.teleoperationEpisode;
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

// The sim recorder path lazily imports RobotManager for telemetry — stub it out.
// AgentRecordingService reaches for `getRegisteredRobot` through the same lazy
// import; returning null there is what makes these tests take the SIM path.
vi.mock('../RobotManager.js', () => ({
  robotManager: {
    getTelemetry: vi.fn().mockResolvedValue({
      jointStates: [{ name: 'shoulder_pan', position: 0.1, velocity: 0 }],
    }),
    getRegisteredRobot: vi.fn().mockResolvedValue(null),
  },
}));

const { mockAgentRecording, mockProvenance } = vi.hoisted(() => ({
  mockAgentRecording: {
    start: vi.fn().mockResolvedValue(null),
    nextEpisode: vi.fn().mockResolvedValue(null),
    discardEpisode: vi.fn().mockResolvedValue(false),
    pause: vi.fn().mockResolvedValue(true),
    resume: vi.fn().mockResolvedValue(true),
    stop: vi.fn().mockResolvedValue(null),
    status: vi.fn().mockResolvedValue(null),
  },
  mockProvenance: { recordProvenance: vi.fn().mockResolvedValue({ id: 'prov-1' }) },
}));

vi.mock('../AgentRecordingService.js', async (importOriginal) => {
  // The real AgentRecordingRefused is kept: startSession branches on
  // `instanceof`, and a stubbed class would make that branch untestable.
  const actual = await importOriginal<typeof import('../AgentRecordingService.js')>();
  return { ...actual, agentRecordingService: mockAgentRecording };
});

vi.mock('../TrainingDataDocService.js', () => ({
  trainingDataDocService: mockProvenance,
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
import { AgentRecordingRefused } from '../AgentRecordingService.js';

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
    mockPrisma.teleoperationEpisode.findMany.mockResolvedValue([]);
    mockAgentRecording.start.mockResolvedValue(null);
    mockAgentRecording.stop.mockResolvedValue(null);
    mockAgentRecording.status.mockResolvedValue(null);
    mockAgentRecording.nextEpisode.mockResolvedValue(null);
    mockAgentRecording.pause.mockResolvedValue(true);
    mockAgentRecording.resume.mockResolvedValue(true);
    mockProvenance.recordProvenance.mockResolvedValue({ id: 'prov-1' });
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

  // --------------------------------------------------------------------------
  // Agent-side recording (TASK-215)
  // --------------------------------------------------------------------------

  describe('recording on the robot agent', () => {
    const AGENT_STATUS = {
      ok: true,
      recording: true,
      sessionId: 'session-1',
      episodeIndex: 0,
      frames: 0,
      totalFrames: 0,
      dropped: 0,
      totalDropped: 0,
      fpsTarget: 30,
      fpsActual: 0,
      degraded: false,
      lastDropReason: null,
      cameras: [{ camera: 'head_camera', key: 'cam_right_high' }],
      scene: 'g1_dex3_house_scene.xml',
      behindS: 0,
      episodes: [],
    };

    const AGENT_RESULT = {
      ok: true,
      datasetPath: '/robot/data/datasets/session-1',
      robotType: 'Unitree_G1_Dex3',
      totalEpisodes: 2,
      totalFrames: 240,
      totalDropped: 3,
      fpsActual: 29.85,
      episodes: [
        { episodeIndex: 0, frames: 120, dropped: 1, durationS: 4.01, fpsActual: 29.9 },
        { episodeIndex: 1, frames: 120, dropped: 2, durationS: 4.03, fpsActual: 29.8 },
      ],
      videoFeatures: ['observation.images.cam_right_high'],
      scene: 'g1_dex3_house_scene.xml',
      bootId: 'boot-1',
    };

    const CREATED = {
      ...COMPLETED_SESSION,
      status: 'created',
      startedAt: null,
      sidecarDatasetPath: null,
      recorderKind: null,
      type: 'vr_quest',
      fps: 30,
    };

    function updatePassesThrough(base: Record<string, unknown>) {
      mockPrisma.teleoperationSession.update.mockImplementation(
        async (args: { data: Record<string, unknown> }) => ({ ...base, ...args.data }),
      );
    }

    beforeEach(() => {
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue(CREATED);
      mockPrisma.robot.findUnique.mockResolvedValue({
        id: 'robot-1',
        model: 'G1 EDU',
        a2aAgentUrl: null,
      });
      mockPrisma.teleoperationFrame.aggregate.mockResolvedValue({
        _max: { frameIndex: null, episodeIndex: null },
      });
      mockPrisma.teleoperationFrame.count.mockResolvedValue(0);
      updatePassesThrough(CREATED);
    });

    afterEach(async () => {
      // The agent poller is an interval; ending the session clears it.
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue({
        ...CREATED,
        status: 'recording',
        recorderKind: 'agent',
      });
      await service.endSession('session-1').catch(() => {});
    });

    it('records on the agent when the agent can, and does not also start the sim recorder', async () => {
      mockAgentRecording.start.mockResolvedValue(AGENT_STATUS);
      const result = await service.startSession('session-1');
      expect(result.status).toBe('recording');
      expect(mockAgentRecording.start).toHaveBeenCalledWith('robot-1', {
        sessionId: 'session-1',
        fps: 30,
        task: 'Pick up the cube',
        inputMode: 'vr_quest',
      });
      // The sim recorder seeds itself from persisted frames; it must not have run.
      expect(mockPrisma.teleoperationFrame.aggregate).not.toHaveBeenCalled();
    });

    it('writes down WHICH recorder ran, because endSession has to ask the same one to stop', async () => {
      mockAgentRecording.start.mockResolvedValue(AGENT_STATUS);
      await service.startSession('session-1');
      const data = mockPrisma.teleoperationSession.update.mock.calls[0]![0].data;
      expect(data.recorderKind).toBe('agent');
    });

    it('falls back to the sim recorder when the agent cannot record', async () => {
      mockAgentRecording.start.mockResolvedValue(null);
      await service.startSession('session-1');
      expect(mockPrisma.teleoperationFrame.aggregate).toHaveBeenCalled();
      const data = mockPrisma.teleoperationSession.update.mock.calls[0]![0].data;
      expect(data.recorderKind).toBe('sim');
    });

    it('refuses to start at all when the robot understood and said no', async () => {
      // Silently falling back would hide a recording left running by a session
      // that ended badly, behind a dataset with no video.
      mockAgentRecording.start.mockRejectedValue(
        new AgentRecordingRefused('busy recording session other-1', 409, 'RECORDING_REFUSED'),
      );
      await expect(service.startSession('session-1')).rejects.toThrow(
        /busy recording session other-1.*Stop the recording on robot-1/s,
      );
      expect(mockPrisma.teleoperationFrame.aggregate).not.toHaveBeenCalled();
    });

    it('draws the episode boundary on the robot, where the frames are', async () => {
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue({
        ...CREATED,
        status: 'recording',
        recorderKind: 'agent',
      });
      mockAgentRecording.nextEpisode.mockResolvedValue(4);
      expect(await service.nextEpisode('session-1')).toEqual({ episodeIndex: 4 });
      expect(mockAgentRecording.nextEpisode).toHaveBeenCalledWith('robot-1');
      // No local index was invented alongside it.
      expect(mockPrisma.teleoperationFrame.aggregate).not.toHaveBeenCalled();
    });

    it('says so rather than inventing an index when the robot will not advance', async () => {
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue({
        ...CREATED,
        status: 'recording',
        recorderKind: 'agent',
      });
      mockAgentRecording.nextEpisode.mockResolvedValue(null);
      await expect(service.nextEpisode('session-1')).rejects.toThrow(
        /did not accept the episode boundary/,
      );
    });

    it('persists what the recorder reported about each episode', async () => {
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue({
        ...CREATED,
        status: 'recording',
        recorderKind: 'agent',
        startedAt: new Date('2026-08-22T10:00:00Z'),
      });
      mockAgentRecording.stop.mockResolvedValue(AGENT_RESULT);
      updatePassesThrough({ ...CREATED, status: 'completed' });

      await service.endSession('session-1');

      expect(mockPrisma.teleoperationEpisode.upsert).toHaveBeenCalledTimes(2);
      const first = mockPrisma.teleoperationEpisode.upsert.mock.calls[0]![0];
      expect(first.where).toEqual({
        sessionId_episodeIndex: { sessionId: 'session-1', episodeIndex: 0 },
      });
      expect(first.create).toMatchObject({ frameCount: 120, droppedFrames: 1, fpsActual: 29.9 });
    });

    it('registers the dataset the robot wrote, by path, with its measured numbers', async () => {
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue({
        ...CREATED,
        status: 'recording',
        recorderKind: 'agent',
        startedAt: new Date('2026-08-22T10:00:00Z'),
      });
      mockAgentRecording.stop.mockResolvedValue(AGENT_RESULT);
      updatePassesThrough({ ...CREATED, status: 'completed' });

      await service.endSession('session-1');

      expect(mockDatasetRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          storagePath: '/robot/data/datasets/session-1',
          lerobotVersion: 'v3.0',
          totalFrames: 240,
          demonstrationCount: 2,
          status: 'ready',
          fps: 30,
        }),
      );
    });

    it('writes a DatasetProvenance row naming the scene and the operator', async () => {
      // The model has existed since the EU AI Act work and nothing had ever
      // written one.
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue({
        ...CREATED,
        status: 'recording',
        recorderKind: 'agent',
        startedAt: new Date('2026-08-22T10:00:00Z'),
      });
      mockAgentRecording.stop.mockResolvedValue(AGENT_RESULT);
      updatePassesThrough({ ...CREATED, status: 'completed' });

      await service.endSession('session-1');

      expect(mockProvenance.recordProvenance).toHaveBeenCalledWith(
        'ds-created-id',
        expect.objectContaining({
          sourceType: 'collected',
          sourceName: 'MuJoCo sim — g1_dex3_house_scene.xml',
        }),
        'op-1',
      );
      const dto = mockProvenance.recordProvenance.mock.calls[0]![1];
      expect(dto.collectionMethod).toMatch(/29\.85 fps, 3 dropped frames/);
    });

    it('does not auto-export the empty frame table next to the real dataset', async () => {
      // An agent-recorded session's frames are a parquet file on the robot.
      // Treating it as frame-based would export a second, hollow dataset.
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue({
        ...CREATED,
        status: 'recording',
        recorderKind: 'agent',
        startedAt: new Date('2026-08-22T10:00:00Z'),
      });
      mockAgentRecording.stop.mockResolvedValue(AGENT_RESULT);
      updatePassesThrough({ ...CREATED, status: 'completed' });

      await service.endSession('session-1');
      expect(mockExportSession).not.toHaveBeenCalled();
    });

    it('says why there is no dataset when the robot recorded nothing', async () => {
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue({
        ...CREATED,
        status: 'recording',
        recorderKind: 'agent',
        startedAt: new Date('2026-08-22T10:00:00Z'),
      });
      mockAgentRecording.stop.mockResolvedValue({
        ...AGENT_RESULT,
        ok: false,
        datasetPath: null,
        totalFrames: 0,
        totalEpisodes: 0,
        episodes: [],
        error: 'no frames recorded — teleop is not engaged',
      });
      updatePassesThrough({ ...CREATED, status: 'completed' });

      await service.endSession('session-1');
      const data = mockPrisma.teleoperationSession.update.mock.calls.at(-1)![0].data;
      expect(data.errorMessage).toMatch(/teleop is not engaged/);
      expect(mockDatasetRepository.create).not.toHaveBeenCalled();
    });

    it('pauses the recorder that holds the frames, not just the one that does not', async () => {
      // Without this the dataset kept growing while the console said the
      // session was parked, and the pause landed in the data as a stretch of
      // whatever the arms did while nobody was driving them.
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue({
        ...CREATED,
        status: 'recording',
        recorderKind: 'agent',
      });
      updatePassesThrough({ ...CREATED, status: 'paused' });
      await service.pauseSession('session-1');
      expect(mockAgentRecording.pause).toHaveBeenCalledWith('robot-1');
    });

    it('resumes the agent instead of starting a second, joints-only recorder', async () => {
      // There is never a `simRecorders` entry for an agent session, so the old
      // `else` branch fell through to `startSimRecorder` — a second recorder
      // writing TeleoperationFrame rows that then look like a frame-based
      // session to endSession.
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue({
        ...CREATED,
        status: 'paused',
        recorderKind: 'agent',
      });
      updatePassesThrough({ ...CREATED, status: 'recording' });
      await service.resumeSession('session-1');
      expect(mockAgentRecording.resume).toHaveBeenCalledWith('robot-1');
      expect(mockPrisma.teleoperationFrame.aggregate).not.toHaveBeenCalled();
    });

    it('tells the robot to stop when the session it is recording is deleted', async () => {
      // The robot has no other way to find out. It would keep filming, and
      // refuse the next session as "busy", until the agent was restarted.
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue({
        ...CREATED,
        status: 'recording',
        recorderKind: 'agent',
      });
      mockPrisma.teleoperationSession.delete.mockResolvedValue({});
      expect(await service.deleteSession('session-1')).toBe(true);
      expect(mockAgentRecording.stop).toHaveBeenCalledWith('robot-1');
    });

    it('lays the episodes out on the session timeline instead of starting all of them at zero', async () => {
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue({
        ...CREATED,
        status: 'completed',
        recorderKind: 'agent',
      });
      mockPrisma.teleoperationEpisode.findMany.mockResolvedValue([
        { episodeIndex: 0, frameCount: 120, droppedFrames: 0, durationS: 4, fpsActual: 30 },
        { episodeIndex: 1, frameCount: 90, droppedFrames: 0, durationS: 3, fpsActual: 30 },
      ]);
      const episodes = await service.listEpisodes('session-1');
      expect(episodes.map((e) => [e.startTime, e.endTime])).toEqual([
        [0, 4],
        [4, 7],
      ]);
    });

    it('does not file the simulation boot under copyright compliance', async () => {
      // An AI Act report renders that field under a heading about rights
      // clearance; "Simulation boot 585f1c…" there teaches a reviewer nothing
      // and makes them mistrust the rest of the record.
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue({
        ...CREATED,
        status: 'recording',
        recorderKind: 'agent',
        startedAt: new Date('2026-08-22T10:00:00Z'),
      });
      mockAgentRecording.stop.mockResolvedValue(AGENT_RESULT);
      updatePassesThrough({ ...CREATED, status: 'completed' });

      await service.endSession('session-1');
      const dto = mockProvenance.recordProvenance.mock.calls[0]![1];
      expect(dto.copyrightCompliance).not.toMatch(/boot-1/);
      expect(dto.collectionMethod).toMatch(/simulation boot boot-1/);
    });

    it('prefers persisted episode summaries, which carry drops the frames never could', async () => {
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue({
        ...CREATED,
        status: 'completed',
        recorderKind: 'agent',
      });
      mockPrisma.teleoperationEpisode.findMany.mockResolvedValue([
        { episodeIndex: 0, frameCount: 120, droppedFrames: 1, durationS: 4.01, fpsActual: 29.9 },
      ]);
      const episodes = await service.listEpisodes('session-1');
      expect(episodes).toEqual([
        {
          episodeIndex: 0,
          frameCount: 120,
          startTime: 0,
          endTime: 4.01,
          durationS: 4.01,
          droppedFrames: 1,
          fpsActual: 29.9,
        },
      ]);
      expect(mockPrisma.teleoperationFrame.groupBy).not.toHaveBeenCalled();
    });

    it('reports an episode recorded before the column existed as "not recorded"', async () => {
      // THE BUG THIS PINS. A row without the column has `retargetModes`
      // UNDEFINED, not null — which is what a row looks like anywhere but a
      // fresh Prisma read against the new schema — and a guard that checked
      // only `null` let a `.split` of undefined escape into `listEpisodes`,
      // 500ing the episode list of every session recorded before TASK-216.
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue({
        ...CREATED, status: 'completed', recorderKind: 'agent',
      });
      mockPrisma.teleoperationEpisode.findMany.mockResolvedValue([
        { episodeIndex: 0, frameCount: 10, droppedFrames: 0, durationS: 1, fpsActual: 10 },
      ]);
      const episodes = await service.listEpisodes('session-1');
      // Undefined, NOT [] and NOT ['orientation']: "we do not know" is a
      // different fact from "nothing drove it", and labelling an old
      // demonstration with a mode nobody observed is the trap the field exists
      // to close.
      expect(episodes[0]!.retargetModes).toBeUndefined();
    });

    it('round-trips a label, and keeps "none" apart from "not recorded"', async () => {
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue({
        ...CREATED, status: 'completed', recorderKind: 'agent',
      });
      mockPrisma.teleoperationEpisode.findMany.mockResolvedValue([
        { episodeIndex: 0, frameCount: 10, droppedFrames: 0, durationS: 1, fpsActual: 10, retargetModes: 'ik' },
        { episodeIndex: 1, frameCount: 10, droppedFrames: 0, durationS: 1, fpsActual: 10, retargetModes: 'hand-tracking+ik' },
        { episodeIndex: 2, frameCount: 10, droppedFrames: 0, durationS: 1, fpsActual: 10, retargetModes: '' },
        { episodeIndex: 3, frameCount: 10, droppedFrames: 0, durationS: 1, fpsActual: 10, retargetModes: null },
      ]);
      const episodes = await service.listEpisodes('session-1');
      expect(episodes[0]!.retargetModes).toEqual(['ik']);
      expect(episodes[1]!.retargetModes).toEqual(['hand-tracking', 'ik']);
      // An episode the operator opened and never touched.
      expect(episodes[2]!.retargetModes).toEqual([]);
      // An episode the robot could not say anything about.
      expect(episodes[3]!.retargetModes).toBeUndefined();
    });

    it('still lists the episodes of a PAUSED session', async () => {
      // The rows are only written when the session ends, so gating the live
      // query on `status === 'recording'` made the panel go empty the moment an
      // operator paused — which reads as "your takes are gone".
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue({
        ...CREATED,
        status: 'paused',
        recorderKind: 'agent',
      });
      mockPrisma.teleoperationEpisode.findMany.mockResolvedValue([]);
      mockAgentRecording.status.mockResolvedValue({
        ...AGENT_STATUS,
        recording: false,
        episodes: [{ episodeIndex: 0, frames: 42, dropped: 0, durationS: 1.4, fpsActual: 30 }],
      });
      const episodes = await service.listEpisodes('session-1');
      expect(episodes).toHaveLength(1);
      expect(episodes[0]!.frameCount).toBe(42);
    });

    it('asks the robot for live episode numbers while it is still recording', async () => {
      mockPrisma.teleoperationSession.findUnique.mockResolvedValue({
        ...CREATED,
        status: 'recording',
        recorderKind: 'agent',
      });
      mockPrisma.teleoperationEpisode.findMany.mockResolvedValue([]);
      mockAgentRecording.status.mockResolvedValue({
        ...AGENT_STATUS,
        episodes: [{ episodeIndex: 0, frames: 42, dropped: 2, durationS: 1.4, fpsActual: 29.3 }],
      });
      const episodes = await service.listEpisodes('session-1');
      expect(episodes).toEqual([
        {
          episodeIndex: 0,
          frameCount: 42,
          startTime: 0,
          endTime: 1.4,
          durationS: 1.4,
          droppedFrames: 2,
          fpsActual: 29.3,
        },
      ]);
    });
  });
});
