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

const { mockExportSession } = vi.hoisted(() => ({
  mockExportSession: vi.fn().mockResolvedValue({
    datasetId: 'export-storage-id',
    storagePath: 'datasets/export-storage-id/',
  }),
}));

vi.mock('../LeRobotExportService.js', () => ({
  LeRobotExportService: class {
    exportSession = mockExportSession;
  },
}));

vi.mock('../../storage/rustfs-client.js', () => ({
  RustFSClient: class {},
  getRustFSClient: vi.fn(),
  isRustFSInitialized: vi.fn().mockReturnValue(true),
}));

vi.mock('../DataQualityService.js', () => ({
  dataQualityService: {},
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
      expect(createArg.lerobotVersion).toBe('v2.0');
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
  });
});
