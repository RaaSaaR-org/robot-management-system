/**
 * @file VLARepository.test.ts
 * @description Unit tests for the VLA data-access repositories (RobotType,
 *   SkillDefinition, Dataset, TrainingJob, ModelVersion, Deployment, SkillChain).
 *   The Prisma client (the I/O boundary) is mocked via vi.hoisted; the pure
 *   domain<->db mapper functions defined in VLARepository.ts run for REAL so the
 *   tests also exercise JSON-string parsing, nullable mapping, and date passthrough.
 * @feature vla
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted Prisma mock (the only mocked boundary). Typed via the factory so
// member access on the vi.fn() mocks (mockResolvedValue / mockRejectedValue)
// typechecks without implicit-any errors.
// ---------------------------------------------------------------------------

const prismaMock = vi.hoisted(() => ({
  robotType: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  skillDefinition: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  dataset: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  trainingJob: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  modelVersion: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  deployment: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  skillChain: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  skillChainStep: {
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
}));

vi.mock('../../database/index.js', () => ({
  prisma: prismaMock,
}));

import {
  RobotTypeRepository,
  SkillDefinitionRepository,
  DatasetRepository,
  TrainingJobRepository,
  ModelVersionRepository,
  DeploymentRepository,
  SkillChainRepository,
  robotTypeRepository,
  skillDefinitionRepository,
  datasetRepository,
  trainingJobRepository,
  modelVersionRepository,
  deploymentRepository,
  skillChainRepository,
} from '../VLARepository.js';

// ---------------------------------------------------------------------------
// Fixtures — valid Prisma db-row shapes that the inline mappers accept.
// ---------------------------------------------------------------------------

const FIXED_DATE = new Date('2026-06-22T12:00:00.000Z');

function makeDbRobotType(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rt-1',
    name: 'SO-ARM100',
    manufacturer: 'TheRobotStudio',
    model: 'SO-101',
    actionDim: 6,
    proprioceptionDim: 6,
    cameras: JSON.stringify([{ name: 'wrist', resolution: { width: 640, height: 480 }, fov: 90 }]),
    capabilities: JSON.stringify(['grasp', 'navigate']),
    limits: JSON.stringify({ position: { min: [0], max: [1] }, velocity: [1], torque: [1] }),
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  };
}

function makeDbSkill(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sk-1',
    name: 'pick_object',
    version: '1.0.0',
    description: 'Pick an object',
    parametersSchema: JSON.stringify({ type: 'object' }),
    defaultParameters: JSON.stringify({ force: 1 }),
    preconditions: JSON.stringify([{ type: 'state', name: 'gripper_empty', check: 'x' }]),
    postconditions: JSON.stringify([]),
    requiredCapabilities: JSON.stringify(['grasp']),
    timeout: 60,
    maxRetries: 3,
    status: 'published',
    linkedModelVersionId: null,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  };
}

function makeDbDataset(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ds-1',
    name: 'pick-dataset',
    description: 'Pick demonstrations',
    robotTypeId: 'rt-1',
    skillId: 'sk-1',
    storagePath: 's3://bucket/ds-1',
    lerobotVersion: 'v3.0',
    fps: 30,
    totalFrames: 1000,
    totalDuration: 33.3,
    demonstrationCount: 10,
    qualityScore: 0.9,
    infoJson: JSON.stringify({ fps: 30 }),
    statsJson: JSON.stringify({ action: { mean: [0] } }),
    status: 'ready',
    huggingFaceRepoId: 'org/repo',
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  };
}

function makeDbTrainingJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tj-1',
    datasetId: 'ds-1',
    baseModel: 'smolvla',
    fineTuneMethod: 'lora',
    hyperparameters: JSON.stringify({ learning_rate: 1e-4, batch_size: 32, epochs: 100 }),
    gpuRequirements: JSON.stringify({ count: 1, memory: 40 }),
    status: 'pending',
    progress: 0,
    currentEpoch: null,
    totalEpochs: 100,
    metrics: JSON.stringify({}),
    bullmqJobId: null,
    startedAt: null,
    completedAt: null,
    errorMessage: null,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  };
}

function makeDbModelVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mv-1',
    skillId: 'sk-1',
    trainingJobId: 'tj-1',
    version: '1.0.0',
    artifactUri: 's3://models/mv-1',
    checkpointUri: null,
    trainingMetrics: JSON.stringify({ final_loss: 0.1 }),
    validationMetrics: JSON.stringify({}),
    deploymentStatus: 'staging',
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  };
}

function makeDbDeployment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dp-1',
    modelVersionId: 'mv-1',
    strategy: 'canary',
    targetRobotTypes: JSON.stringify(['rt-1']),
    targetZones: JSON.stringify(['zone-a']),
    trafficPercentage: 0,
    canaryConfig: JSON.stringify({ stages: [], successThreshold: 0.95 }),
    rollbackThresholds: JSON.stringify({ errorRate: 0.05, latencyP99: 1000, failureRate: 0.1 }),
    status: 'deploying',
    deployedRobotIds: JSON.stringify([]),
    failedRobotIds: JSON.stringify([]),
    startedAt: null,
    completedAt: null,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  };
}

function makeDbSkillChainStep(overrides: Record<string, unknown> = {}) {
  return {
    id: 'step-1',
    chainId: 'sc-1',
    skillId: 'sk-1',
    order: 0,
    parameters: JSON.stringify({ force: 1 }),
    inputMapping: JSON.stringify({}),
    onFailure: 'abort',
    maxRetries: null,
    timeoutOverride: null,
    ...overrides,
  };
}

function makeDbSkillChain(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sc-1',
    name: 'pick-and-place',
    description: 'Pick then place',
    status: 'active',
    estimatedDuration: null,
    steps: [makeDbSkillChainStep()],
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// RobotTypeRepository
// ===========================================================================

describe('RobotTypeRepository', () => {
  const repo = new RobotTypeRepository();

  it('exports a singleton instance', () => {
    expect(robotTypeRepository).toBeInstanceOf(RobotTypeRepository);
  });

  it('create() serializes JSON columns and maps the result', async () => {
    prismaMock.robotType.create.mockResolvedValue(makeDbRobotType());

    const result = await repo.create({
      name: 'SO-ARM100',
      manufacturer: 'TheRobotStudio',
      model: 'SO-101',
      actionDim: 6,
      proprioceptionDim: 6,
      cameras: [{ name: 'wrist', resolution: { width: 640, height: 480 }, fov: 90 }],
      capabilities: ['grasp', 'navigate'],
      limits: { position: { min: [0], max: [1] }, velocity: [1], torque: [1] },
    });

    expect(prismaMock.robotType.create).toHaveBeenCalledWith({
      data: {
        name: 'SO-ARM100',
        manufacturer: 'TheRobotStudio',
        model: 'SO-101',
        actionDim: 6,
        proprioceptionDim: 6,
        cameras: JSON.stringify([{ name: 'wrist', resolution: { width: 640, height: 480 }, fov: 90 }]),
        capabilities: JSON.stringify(['grasp', 'navigate']),
        limits: JSON.stringify({ position: { min: [0], max: [1] }, velocity: [1], torque: [1] }),
      },
    });
    expect(result.id).toBe('rt-1');
    expect(result.cameras).toEqual([{ name: 'wrist', resolution: { width: 640, height: 480 }, fov: 90 }]);
    expect(result.capabilities).toEqual(['grasp', 'navigate']);
    expect(result.limits.velocity).toEqual([1]);
    expect(result.createdAt).toBe(FIXED_DATE);
  });

  it('create() defaults optional JSON columns to empty structures', async () => {
    prismaMock.robotType.create.mockResolvedValue(
      makeDbRobotType({ cameras: '[]', capabilities: '[]' }),
    );

    await repo.create({
      name: 'X',
      manufacturer: 'Y',
      model: 'Z',
      actionDim: 1,
      proprioceptionDim: 1,
    });

    expect(prismaMock.robotType.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cameras: JSON.stringify([]),
        capabilities: JSON.stringify([]),
        limits: JSON.stringify({ position: { min: [], max: [] }, velocity: [], torque: [] }),
      }),
    });
  });

  it('findById() returns the mapped robot type', async () => {
    prismaMock.robotType.findUnique.mockResolvedValue(makeDbRobotType());
    const result = await repo.findById('rt-1');
    expect(prismaMock.robotType.findUnique).toHaveBeenCalledWith({ where: { id: 'rt-1' } });
    expect(result?.id).toBe('rt-1');
  });

  it('findById() returns null when prisma returns null', async () => {
    prismaMock.robotType.findUnique.mockResolvedValue(null);
    expect(await repo.findById('missing')).toBeNull();
  });

  it('findByName() queries on the name column', async () => {
    prismaMock.robotType.findUnique.mockResolvedValue(makeDbRobotType());
    await repo.findByName('SO-ARM100');
    expect(prismaMock.robotType.findUnique).toHaveBeenCalledWith({ where: { name: 'SO-ARM100' } });
  });

  it('findByName() returns null when missing', async () => {
    prismaMock.robotType.findUnique.mockResolvedValue(null);
    expect(await repo.findByName('nope')).toBeNull();
  });

  it('findAll() orders by name asc and maps all rows', async () => {
    prismaMock.robotType.findMany.mockResolvedValue([makeDbRobotType(), makeDbRobotType({ id: 'rt-2' })]);
    const result = await repo.findAll();
    expect(prismaMock.robotType.findMany).toHaveBeenCalledWith({ orderBy: { name: 'asc' } });
    expect(result).toHaveLength(2);
    expect(result[1].id).toBe('rt-2');
  });

  it('findByManufacturer() filters by manufacturer', async () => {
    prismaMock.robotType.findMany.mockResolvedValue([]);
    const result = await repo.findByManufacturer('Unitree');
    expect(prismaMock.robotType.findMany).toHaveBeenCalledWith({
      where: { manufacturer: 'Unitree' },
      orderBy: { name: 'asc' },
    });
    expect(result).toEqual([]);
  });

  it('update() only sends provided fields and serializes JSON ones', async () => {
    prismaMock.robotType.update.mockResolvedValue(makeDbRobotType({ name: 'Renamed' }));
    const result = await repo.update('rt-1', {
      name: 'Renamed',
      capabilities: ['grasp'],
    });
    expect(prismaMock.robotType.update).toHaveBeenCalledWith({
      where: { id: 'rt-1' },
      data: { name: 'Renamed', capabilities: JSON.stringify(['grasp']) },
    });
    expect(result?.name).toBe('Renamed');
  });

  it('update() returns null when prisma throws', async () => {
    prismaMock.robotType.update.mockRejectedValue(new Error('not found'));
    expect(await repo.update('rt-1', { name: 'X' })).toBeNull();
  });

  it('delete() returns true on success', async () => {
    prismaMock.robotType.delete.mockResolvedValue(makeDbRobotType());
    expect(await repo.delete('rt-1')).toBe(true);
    expect(prismaMock.robotType.delete).toHaveBeenCalledWith({ where: { id: 'rt-1' } });
  });

  it('delete() returns false when prisma throws', async () => {
    prismaMock.robotType.delete.mockRejectedValue(new Error('fk constraint'));
    expect(await repo.delete('rt-1')).toBe(false);
  });
});

// ===========================================================================
// SkillDefinitionRepository
// ===========================================================================

describe('SkillDefinitionRepository', () => {
  const repo = new SkillDefinitionRepository();

  it('exports a singleton instance', () => {
    expect(skillDefinitionRepository).toBeInstanceOf(SkillDefinitionRepository);
  });

  it('create() serializes JSON, applies defaults, and connects robot types', async () => {
    prismaMock.skillDefinition.create.mockResolvedValue(makeDbSkill());
    const result = await repo.create({
      name: 'pick_object',
      version: '1.0.0',
      description: 'Pick an object',
      requiredCapabilities: ['grasp'],
      compatibleRobotTypeIds: ['rt-1', 'rt-2'],
    });

    expect(prismaMock.skillDefinition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'pick_object',
        version: '1.0.0',
        description: 'Pick an object',
        parametersSchema: JSON.stringify({}),
        defaultParameters: JSON.stringify({}),
        preconditions: JSON.stringify([]),
        postconditions: JSON.stringify([]),
        requiredCapabilities: JSON.stringify(['grasp']),
        maxRetries: 3,
        status: 'draft',
        compatibleRobotTypes: { connect: [{ id: 'rt-1' }, { id: 'rt-2' }] },
      }),
    });
    expect(result.id).toBe('sk-1');
    expect(result.requiredCapabilities).toEqual(['grasp']);
    expect(result.status).toBe('published');
  });

  it('create() leaves compatibleRobotTypes undefined when no ids provided', async () => {
    prismaMock.skillDefinition.create.mockResolvedValue(makeDbSkill());
    await repo.create({ name: 'a', version: '1.0.0' });
    const call = prismaMock.skillDefinition.create.mock.calls[0][0];
    expect(call.data.compatibleRobotTypes).toBeUndefined();
  });

  it('findById() maps nullable description/linkedModelVersionId to undefined', async () => {
    prismaMock.skillDefinition.findUnique.mockResolvedValue(
      makeDbSkill({ description: null, linkedModelVersionId: null, timeout: null }),
    );
    const result = await repo.findById('sk-1');
    expect(prismaMock.skillDefinition.findUnique).toHaveBeenCalledWith({ where: { id: 'sk-1' } });
    expect(result?.description).toBeUndefined();
    expect(result?.linkedModelVersionId).toBeUndefined();
    expect(result?.timeout).toBeUndefined();
  });

  it('findById() returns null when missing', async () => {
    prismaMock.skillDefinition.findUnique.mockResolvedValue(null);
    expect(await repo.findById('x')).toBeNull();
  });

  it('findByIdWithRelations() includes compatibleRobotTypes and maps them', async () => {
    prismaMock.skillDefinition.findUnique.mockResolvedValue({
      ...makeDbSkill(),
      compatibleRobotTypes: [makeDbRobotType()],
    });
    const result = await repo.findByIdWithRelations('sk-1');
    expect(prismaMock.skillDefinition.findUnique).toHaveBeenCalledWith({
      where: { id: 'sk-1' },
      include: { compatibleRobotTypes: true },
    });
    expect(result?.compatibleRobotTypes).toHaveLength(1);
    expect(result?.compatibleRobotTypes?.[0].id).toBe('rt-1');
  });

  it('findByIdWithRelations() returns null when missing', async () => {
    prismaMock.skillDefinition.findUnique.mockResolvedValue(null);
    expect(await repo.findByIdWithRelations('x')).toBeNull();
  });

  it('findByNameAndVersion() uses the composite unique key', async () => {
    prismaMock.skillDefinition.findUnique.mockResolvedValue(makeDbSkill());
    await repo.findByNameAndVersion('pick_object', '1.0.0');
    expect(prismaMock.skillDefinition.findUnique).toHaveBeenCalledWith({
      where: { name_version: { name: 'pick_object', version: '1.0.0' } },
    });
  });

  it('findByNameAndVersion() returns null when missing', async () => {
    prismaMock.skillDefinition.findUnique.mockResolvedValue(null);
    expect(await repo.findByNameAndVersion('a', 'b')).toBeNull();
  });

  it('findAll() with no params uses defaults and an empty where, returns pagination', async () => {
    prismaMock.skillDefinition.findMany.mockResolvedValue([makeDbSkill()]);
    prismaMock.skillDefinition.count.mockResolvedValue(1);

    const result = await repo.findAll();

    expect(prismaMock.skillDefinition.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ name: 'asc' }, { version: 'desc' }],
      skip: 0,
      take: 50,
    });
    expect(prismaMock.skillDefinition.count).toHaveBeenCalledWith({ where: {} });
    expect(result.pagination).toEqual({ page: 1, pageSize: 50, total: 1, totalPages: 1 });
    expect(result.data).toHaveLength(1);
  });

  it('findAll() builds where clause and pagination from params', async () => {
    prismaMock.skillDefinition.findMany.mockResolvedValue([]);
    prismaMock.skillDefinition.count.mockResolvedValue(25);

    const result = await repo.findAll({
      page: 2,
      pageSize: 10,
      name: 'pick',
      status: ['published', 'draft'],
      robotTypeId: 'rt-1',
      capability: 'grasp',
      linkedModelVersionId: 'mv-1',
    });

    expect(prismaMock.skillDefinition.findMany).toHaveBeenCalledWith({
      where: {
        name: { contains: 'pick', mode: 'insensitive' },
        status: { in: ['published', 'draft'] },
        compatibleRobotTypes: { some: { id: 'rt-1' } },
        requiredCapabilities: { contains: 'grasp' },
        linkedModelVersionId: 'mv-1',
      },
      orderBy: [{ name: 'asc' }, { version: 'desc' }],
      skip: 10,
      take: 10,
    });
    expect(result.pagination).toEqual({ page: 2, pageSize: 10, total: 25, totalPages: 3 });
  });

  it('findByStatus() filters by status', async () => {
    prismaMock.skillDefinition.findMany.mockResolvedValue([makeDbSkill()]);
    await repo.findByStatus('published');
    expect(prismaMock.skillDefinition.findMany).toHaveBeenCalledWith({
      where: { status: 'published' },
      orderBy: { name: 'asc' },
    });
  });

  it('findPublished() delegates to findByStatus(published)', async () => {
    prismaMock.skillDefinition.findMany.mockResolvedValue([]);
    await repo.findPublished();
    expect(prismaMock.skillDefinition.findMany).toHaveBeenCalledWith({
      where: { status: 'published' },
      orderBy: { name: 'asc' },
    });
  });

  it('findByRobotType() filters via the relation', async () => {
    prismaMock.skillDefinition.findMany.mockResolvedValue([]);
    await repo.findByRobotType('rt-1');
    expect(prismaMock.skillDefinition.findMany).toHaveBeenCalledWith({
      where: { compatibleRobotTypes: { some: { id: 'rt-1' } } },
      orderBy: { name: 'asc' },
    });
  });

  it('findByCapability() uses contains on requiredCapabilities', async () => {
    prismaMock.skillDefinition.findMany.mockResolvedValue([]);
    await repo.findByCapability('grasp');
    expect(prismaMock.skillDefinition.findMany).toHaveBeenCalledWith({
      where: { requiredCapabilities: { contains: 'grasp' } },
      orderBy: { name: 'asc' },
    });
  });

  it('findCompatibleSkills() queries published+robotType then filters by capabilities', async () => {
    prismaMock.skillDefinition.findMany.mockResolvedValue([
      makeDbSkill({ id: 'sk-needs-grasp', requiredCapabilities: JSON.stringify(['grasp']) }),
      makeDbSkill({ id: 'sk-needs-fly', requiredCapabilities: JSON.stringify(['fly']) }),
    ]);

    const result = await repo.findCompatibleSkills('rt-1', ['grasp', 'navigate']);

    expect(prismaMock.skillDefinition.findMany).toHaveBeenCalledWith({
      where: { status: 'published', compatibleRobotTypes: { some: { id: 'rt-1' } } },
      orderBy: { name: 'asc' },
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('sk-needs-grasp');
  });

  it('update() serializes JSON fields and uses set for robot types', async () => {
    prismaMock.skillDefinition.update.mockResolvedValue(makeDbSkill({ status: 'archived' }));
    const result = await repo.update('sk-1', {
      status: 'archived',
      preconditions: [{ type: 'state', name: 'a', check: 'b' }],
      compatibleRobotTypeIds: ['rt-1'],
    });
    expect(prismaMock.skillDefinition.update).toHaveBeenCalledWith({
      where: { id: 'sk-1' },
      data: {
        status: 'archived',
        preconditions: JSON.stringify([{ type: 'state', name: 'a', check: 'b' }]),
        compatibleRobotTypes: { set: [{ id: 'rt-1' }] },
      },
    });
    expect(result?.status).toBe('archived');
  });

  it('update() returns null when prisma throws', async () => {
    prismaMock.skillDefinition.update.mockRejectedValue(new Error('boom'));
    expect(await repo.update('sk-1', { name: 'X' })).toBeNull();
  });

  it('delete() returns true / false', async () => {
    prismaMock.skillDefinition.delete.mockResolvedValue(makeDbSkill());
    expect(await repo.delete('sk-1')).toBe(true);
    prismaMock.skillDefinition.delete.mockRejectedValue(new Error('x'));
    expect(await repo.delete('sk-1')).toBe(false);
  });
});

// ===========================================================================
// DatasetRepository
// ===========================================================================

describe('DatasetRepository', () => {
  const repo = new DatasetRepository();

  it('exports a singleton instance', () => {
    expect(datasetRepository).toBeInstanceOf(DatasetRepository);
  });

  it('create() serializes info/stats and defaults status to uploading', async () => {
    prismaMock.dataset.create.mockResolvedValue(makeDbDataset());
    const result = await repo.create({
      name: 'pick-dataset',
      robotTypeId: 'rt-1',
      storagePath: 's3://bucket/ds-1',
      lerobotVersion: 'v3.0',
      fps: 30,
      totalFrames: 1000,
      totalDuration: 33.3,
      demonstrationCount: 10,
    });
    expect(prismaMock.dataset.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'pick-dataset',
        robotTypeId: 'rt-1',
        infoJson: JSON.stringify({}),
        statsJson: JSON.stringify({}),
        status: 'uploading',
      }),
    });
    expect(result.id).toBe('ds-1');
    expect(result.infoJson).toEqual({ fps: 30 });
  });

  it('findById() maps a row, including nullable skillId/qualityScore', async () => {
    prismaMock.dataset.findUnique.mockResolvedValue(
      makeDbDataset({ skillId: null, qualityScore: null, description: null, huggingFaceRepoId: null }),
    );
    const result = await repo.findById('ds-1');
    expect(prismaMock.dataset.findUnique).toHaveBeenCalledWith({ where: { id: 'ds-1' } });
    expect(result?.skillId).toBeUndefined();
    expect(result?.qualityScore).toBeUndefined();
  });

  it('findById() returns null when missing', async () => {
    prismaMock.dataset.findUnique.mockResolvedValue(null);
    expect(await repo.findById('x')).toBeNull();
  });

  it('findAll() builds where clause with minQualityScore gte and paginates', async () => {
    prismaMock.dataset.findMany.mockResolvedValue([makeDbDataset()]);
    prismaMock.dataset.count.mockResolvedValue(1);
    const result = await repo.findAll({
      robotTypeId: 'rt-1',
      skillId: 'sk-1',
      status: 'ready',
      minQualityScore: 0.5,
    });
    expect(prismaMock.dataset.findMany).toHaveBeenCalledWith({
      where: {
        robotTypeId: 'rt-1',
        skillId: 'sk-1',
        status: 'ready',
        qualityScore: { gte: 0.5 },
      },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 50,
    });
    expect(result.pagination.total).toBe(1);
  });

  it('findReady() filters status=ready', async () => {
    prismaMock.dataset.findMany.mockResolvedValue([]);
    await repo.findReady();
    expect(prismaMock.dataset.findMany).toHaveBeenCalledWith({
      where: { status: 'ready' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('findByRobotType() and findBySkill() filter correctly', async () => {
    prismaMock.dataset.findMany.mockResolvedValue([]);
    await repo.findByRobotType('rt-1');
    expect(prismaMock.dataset.findMany).toHaveBeenLastCalledWith({
      where: { robotTypeId: 'rt-1' },
      orderBy: { createdAt: 'desc' },
    });
    await repo.findBySkill('sk-1');
    expect(prismaMock.dataset.findMany).toHaveBeenLastCalledWith({
      where: { skillId: 'sk-1' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('update() serializes statsJson and only sends provided fields', async () => {
    prismaMock.dataset.update.mockResolvedValue(makeDbDataset({ status: 'failed' }));
    const result = await repo.update('ds-1', { status: 'failed', statsJson: { action: { mean: [1] } } });
    expect(prismaMock.dataset.update).toHaveBeenCalledWith({
      where: { id: 'ds-1' },
      data: { status: 'failed', statsJson: JSON.stringify({ action: { mean: [1] } }) },
    });
    expect(result?.status).toBe('failed');
  });

  it('update() returns null when prisma throws', async () => {
    prismaMock.dataset.update.mockRejectedValue(new Error('x'));
    expect(await repo.update('ds-1', { name: 'x' })).toBeNull();
  });

  it('delete() returns true / false', async () => {
    prismaMock.dataset.delete.mockResolvedValue(makeDbDataset());
    expect(await repo.delete('ds-1')).toBe(true);
    prismaMock.dataset.delete.mockRejectedValue(new Error('x'));
    expect(await repo.delete('ds-1')).toBe(false);
  });
});

// ===========================================================================
// TrainingJobRepository
// ===========================================================================

describe('TrainingJobRepository', () => {
  const repo = new TrainingJobRepository();

  it('exports a singleton instance', () => {
    expect(trainingJobRepository).toBeInstanceOf(TrainingJobRepository);
  });

  it('create() applies default hyperparameters and gpu requirements', async () => {
    prismaMock.trainingJob.create.mockResolvedValue(makeDbTrainingJob());
    const result = await repo.create({
      datasetId: 'ds-1',
      baseModel: 'smolvla',
      fineTuneMethod: 'lora',
      totalEpochs: 100,
    });
    expect(prismaMock.trainingJob.create).toHaveBeenCalledWith({
      data: {
        kind: 'supervised',
        datasetId: 'ds-1',
        baseModel: 'smolvla',
        fineTuneMethod: 'lora',
        sceneId: null,
        twinId: null,
        hyperparameters: JSON.stringify({ learning_rate: 1e-4, batch_size: 32, epochs: 100 }),
        gpuRequirements: JSON.stringify({ count: 1, memory: 40 }),
        totalEpochs: 100,
        // TASK-239: written as explicit nulls for a run that starts from its
        // foundation model, which is what this input is.
        initFromModelVersionId: null,
        initFromCheckpointId: null,
      },
    });
    expect(result.id).toBe('tj-1');
    expect(result.hyperparameters.batch_size).toBe(32);
    expect(result.modelVersionId).toBeUndefined();
  });

  it('findById() includes latest modelVersion and surfaces its id as modelVersionId', async () => {
    prismaMock.trainingJob.findUnique.mockResolvedValue({
      ...makeDbTrainingJob(),
      modelVersions: [makeDbModelVersion({ id: 'mv-latest' })],
    });
    const result = await repo.findById('tj-1');
    expect(prismaMock.trainingJob.findUnique).toHaveBeenCalledWith({
      where: { id: 'tj-1' },
      include: { modelVersions: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    expect(result?.modelVersionId).toBe('mv-latest');
  });

  it('findById() returns null when missing', async () => {
    prismaMock.trainingJob.findUnique.mockResolvedValue(null);
    expect(await repo.findById('x')).toBeNull();
  });

  it('findAll() builds where with array filters and includes modelVersions', async () => {
    prismaMock.trainingJob.findMany.mockResolvedValue([makeDbTrainingJob()]);
    prismaMock.trainingJob.count.mockResolvedValue(1);
    const result = await repo.findAll({
      datasetId: 'ds-1',
      baseModel: ['smolvla', 'pi0'] as never,
      fineTuneMethod: 'lora',
      status: ['pending', 'running'],
    });
    expect(prismaMock.trainingJob.findMany).toHaveBeenCalledWith({
      where: {
        datasetId: 'ds-1',
        baseModel: { in: ['smolvla', 'pi0'] },
        fineTuneMethod: 'lora',
        status: { in: ['pending', 'running'] },
      },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 50,
      include: { modelVersions: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    expect(result.pagination.total).toBe(1);
  });

  it('findPending() orders asc and filters status=pending', async () => {
    prismaMock.trainingJob.findMany.mockResolvedValue([]);
    await repo.findPending();
    expect(prismaMock.trainingJob.findMany).toHaveBeenCalledWith({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('findByStatus() and findRunning() filter by status', async () => {
    prismaMock.trainingJob.findMany.mockResolvedValue([]);
    await repo.findByStatus('failed');
    expect(prismaMock.trainingJob.findMany).toHaveBeenLastCalledWith({
      where: { status: 'failed' },
      orderBy: { createdAt: 'desc' },
    });
    await repo.findRunning();
    expect(prismaMock.trainingJob.findMany).toHaveBeenLastCalledWith({
      where: { status: 'running' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('update() serializes metrics and passes Date fields through', async () => {
    prismaMock.trainingJob.update.mockResolvedValue(makeDbTrainingJob({ status: 'running' }));
    const started = new Date('2026-06-22T10:00:00.000Z');
    const result = await repo.update('tj-1', {
      status: 'running',
      progress: 0.5,
      metrics: { final_loss: 0.2 },
      startedAt: started,
    });
    expect(prismaMock.trainingJob.update).toHaveBeenCalledWith({
      where: { id: 'tj-1' },
      data: {
        status: 'running',
        progress: 0.5,
        metrics: JSON.stringify({ final_loss: 0.2 }),
        startedAt: started,
      },
    });
    expect(result?.status).toBe('running');
  });

  it('update() returns null when prisma throws', async () => {
    prismaMock.trainingJob.update.mockRejectedValue(new Error('x'));
    expect(await repo.update('tj-1', { progress: 1 })).toBeNull();
  });

  it('updateProgress() delegates to update with progress + currentEpoch', async () => {
    prismaMock.trainingJob.update.mockResolvedValue(makeDbTrainingJob({ progress: 0.75 }));
    await repo.updateProgress('tj-1', 0.75, 7);
    expect(prismaMock.trainingJob.update).toHaveBeenCalledWith({
      where: { id: 'tj-1' },
      data: { progress: 0.75, currentEpoch: 7 },
    });
  });

  it('delete() returns true / false', async () => {
    prismaMock.trainingJob.delete.mockResolvedValue(makeDbTrainingJob());
    expect(await repo.delete('tj-1')).toBe(true);
    prismaMock.trainingJob.delete.mockRejectedValue(new Error('x'));
    expect(await repo.delete('tj-1')).toBe(false);
  });
});

// ===========================================================================
// ModelVersionRepository
// ===========================================================================

describe('ModelVersionRepository', () => {
  const repo = new ModelVersionRepository();

  it('exports a singleton instance', () => {
    expect(modelVersionRepository).toBeInstanceOf(ModelVersionRepository);
  });

  it('create() serializes metrics and defaults deploymentStatus to staging', async () => {
    prismaMock.modelVersion.create.mockResolvedValue(makeDbModelVersion());
    const result = await repo.create({
      skillId: 'sk-1',
      trainingJobId: 'tj-1',
      version: '1.0.0',
      artifactUri: 's3://models/mv-1',
    });
    expect(prismaMock.modelVersion.create).toHaveBeenCalledWith({
      data: {
        skillId: 'sk-1',
        trainingJobId: 'tj-1',
        // TASK-238 columns: a create that names none of them registers a model
        // this server trained itself, unnamed and with no parent.
        name: null,
        sourceKind: 'training',
        parentModelVersionId: null,
        modelType: 'vla',
        version: '1.0.0',
        artifactUri: 's3://models/mv-1',
        checkpointUri: undefined,
        trainingMetrics: JSON.stringify({}),
        validationMetrics: JSON.stringify({}),
        deploymentStatus: 'staging',
      },
    });
    expect(result.id).toBe('mv-1');
    expect(result.checkpointUri).toBeUndefined();
  });

  it('findById() maps a row', async () => {
    prismaMock.modelVersion.findUnique.mockResolvedValue(makeDbModelVersion());
    const result = await repo.findById('mv-1');
    expect(prismaMock.modelVersion.findUnique).toHaveBeenCalledWith({ where: { id: 'mv-1' } });
    expect(result?.trainingMetrics.final_loss).toBe(0.1);
  });

  it('findById() returns null when missing', async () => {
    prismaMock.modelVersion.findUnique.mockResolvedValue(null);
    expect(await repo.findById('x')).toBeNull();
  });

  it('findBySkillAndVersion() uses composite unique key', async () => {
    prismaMock.modelVersion.findUnique.mockResolvedValue(makeDbModelVersion());
    await repo.findBySkillAndVersion('sk-1', '1.0.0');
    expect(prismaMock.modelVersion.findUnique).toHaveBeenCalledWith({
      where: { skillId_version: { skillId: 'sk-1', version: '1.0.0' } },
    });
  });

  it('findBySkillAndVersion() returns null when missing', async () => {
    prismaMock.modelVersion.findUnique.mockResolvedValue(null);
    expect(await repo.findBySkillAndVersion('a', 'b')).toBeNull();
  });

  it('findAll() builds where with array deploymentStatus and paginates', async () => {
    prismaMock.modelVersion.findMany.mockResolvedValue([makeDbModelVersion()]);
    prismaMock.modelVersion.count.mockResolvedValue(1);
    const result = await repo.findAll({
      skillId: 'sk-1',
      trainingJobId: 'tj-1',
      deploymentStatus: ['staging', 'production'],
      page: 1,
      pageSize: 20,
    });
    expect(prismaMock.modelVersion.findMany).toHaveBeenCalledWith({
      where: {
        skillId: 'sk-1',
        trainingJobId: 'tj-1',
        deploymentStatus: { in: ['staging', 'production'] },
      },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 20,
    });
    expect(result.data).toHaveLength(1);
  });

  it('findBySkill() filters by skillId', async () => {
    prismaMock.modelVersion.findMany.mockResolvedValue([]);
    await repo.findBySkill('sk-1');
    expect(prismaMock.modelVersion.findMany).toHaveBeenCalledWith({
      where: { skillId: 'sk-1' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('findByDeploymentStatus() and findProduction() filter correctly', async () => {
    prismaMock.modelVersion.findMany.mockResolvedValue([]);
    await repo.findByDeploymentStatus('staging');
    expect(prismaMock.modelVersion.findMany).toHaveBeenLastCalledWith({
      where: { deploymentStatus: 'staging' },
      orderBy: { createdAt: 'desc' },
    });
    await repo.findProduction();
    expect(prismaMock.modelVersion.findMany).toHaveBeenLastCalledWith({
      where: { deploymentStatus: 'production' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('update() serializes metrics and only sends provided fields', async () => {
    prismaMock.modelVersion.update.mockResolvedValue(makeDbModelVersion({ deploymentStatus: 'production' }));
    const result = await repo.update('mv-1', {
      deploymentStatus: 'production',
      validationMetrics: { final_loss: 0.05 },
    });
    expect(prismaMock.modelVersion.update).toHaveBeenCalledWith({
      where: { id: 'mv-1' },
      data: {
        deploymentStatus: 'production',
        validationMetrics: JSON.stringify({ final_loss: 0.05 }),
      },
    });
    expect(result?.deploymentStatus).toBe('production');
  });

  it('update() returns null when prisma throws', async () => {
    prismaMock.modelVersion.update.mockRejectedValue(new Error('x'));
    expect(await repo.update('mv-1', { artifactUri: 'y' })).toBeNull();
  });

  it('delete() returns true / false', async () => {
    prismaMock.modelVersion.delete.mockResolvedValue(makeDbModelVersion());
    expect(await repo.delete('mv-1')).toBe(true);
    prismaMock.modelVersion.delete.mockRejectedValue(new Error('x'));
    expect(await repo.delete('mv-1')).toBe(false);
  });
});

// ===========================================================================
// DeploymentRepository
// ===========================================================================

describe('DeploymentRepository', () => {
  const repo = new DeploymentRepository();
  /** Mirror of the repository's shared include: every deployment read/write loads modelVersion + skill */
  const deploymentInclude = { modelVersion: { include: { skill: true } } };

  it('exports a singleton instance', () => {
    expect(deploymentRepository).toBeInstanceOf(DeploymentRepository);
  });

  it('create() serializes arrays/config and applies defaults', async () => {
    prismaMock.deployment.create.mockResolvedValue(makeDbDeployment());
    const result = await repo.create({
      modelVersionId: 'mv-1',
      strategy: 'canary',
      targetRobotTypes: ['rt-1'],
      targetZones: ['zone-a'],
    });
    expect(prismaMock.deployment.create).toHaveBeenCalledWith({
      data: {
        modelVersionId: 'mv-1',
        strategy: 'canary',
        targetRobotTypes: JSON.stringify(['rt-1']),
        targetZones: JSON.stringify(['zone-a']),
        canaryConfig: JSON.stringify({ stages: [], successThreshold: 0.95 }),
        rollbackThresholds: JSON.stringify({ errorRate: 0.05, latencyP99: 1000, failureRate: 0.1 }),
      },
      include: deploymentInclude,
    });
    expect(result.id).toBe('dp-1');
    expect(result.targetRobotTypes).toEqual(['rt-1']);
    expect(result.deployedRobotIds).toEqual([]);
  });

  it('findById() maps a row and parses array columns', async () => {
    prismaMock.deployment.findUnique.mockResolvedValue(
      makeDbDeployment({ deployedRobotIds: JSON.stringify(['r1', 'r2']) }),
    );
    const result = await repo.findById('dp-1');
    expect(prismaMock.deployment.findUnique).toHaveBeenCalledWith({
      where: { id: 'dp-1' },
      include: deploymentInclude,
    });
    expect(result?.deployedRobotIds).toEqual(['r1', 'r2']);
    // Row without the modelVersion relation loaded still maps fine
    expect(result?.modelVersion).toBeUndefined();
  });

  it('findById() maps the nested modelVersion and skill when the relation is loaded', async () => {
    prismaMock.deployment.findUnique.mockResolvedValue(
      makeDbDeployment({ modelVersion: { ...makeDbModelVersion(), skill: makeDbSkill() } }),
    );
    const result = await repo.findById('dp-1');
    expect(result?.modelVersion?.id).toBe('mv-1');
    expect(result?.modelVersion?.trainingMetrics).toEqual({ final_loss: 0.1 });
    expect(result?.modelVersion?.skill?.id).toBe('sk-1');
    expect(result?.modelVersion?.skill?.name).toBe('pick_object');
  });

  it('findById() maps modelVersion without skill when skill relation is null', async () => {
    prismaMock.deployment.findUnique.mockResolvedValue(
      makeDbDeployment({ modelVersion: { ...makeDbModelVersion(), skill: null } }),
    );
    const result = await repo.findById('dp-1');
    expect(result?.modelVersion?.id).toBe('mv-1');
    expect(result?.modelVersion?.skill).toBeUndefined();
  });

  it('findById() returns null when missing', async () => {
    prismaMock.deployment.findUnique.mockResolvedValue(null);
    expect(await repo.findById('x')).toBeNull();
  });

  it('findAll() builds where with array filters and paginates', async () => {
    prismaMock.deployment.findMany.mockResolvedValue([makeDbDeployment()]);
    prismaMock.deployment.count.mockResolvedValue(1);
    const result = await repo.findAll({
      modelVersionId: 'mv-1',
      strategy: ['canary', 'blue_green'] as never,
      status: 'deploying',
    });
    expect(prismaMock.deployment.findMany).toHaveBeenCalledWith({
      where: {
        modelVersionId: 'mv-1',
        strategy: { in: ['canary', 'blue_green'] },
        status: 'deploying',
      },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 50,
      include: deploymentInclude,
    });
    expect(result.pagination.total).toBe(1);
  });

  it('findActive() filters status in deploying/canary/production', async () => {
    prismaMock.deployment.findMany.mockResolvedValue([]);
    await repo.findActive();
    expect(prismaMock.deployment.findMany).toHaveBeenCalledWith({
      where: { status: { in: ['deploying', 'canary', 'production'] } },
      orderBy: { createdAt: 'desc' },
      include: deploymentInclude,
    });
  });

  it('findByModelVersion() and findByStatus() filter correctly', async () => {
    prismaMock.deployment.findMany.mockResolvedValue([]);
    await repo.findByModelVersion('mv-1');
    expect(prismaMock.deployment.findMany).toHaveBeenLastCalledWith({
      where: { modelVersionId: 'mv-1' },
      orderBy: { createdAt: 'desc' },
      include: deploymentInclude,
    });
    await repo.findByStatus('rolled_back' as never);
    expect(prismaMock.deployment.findMany).toHaveBeenLastCalledWith({
      where: { status: 'rolled_back' },
      orderBy: { createdAt: 'desc' },
      include: deploymentInclude,
    });
  });

  it('update() serializes arrays/config and only sends provided fields', async () => {
    prismaMock.deployment.update.mockResolvedValue(makeDbDeployment({ status: 'production' }));
    const result = await repo.update('dp-1', {
      status: 'production',
      trafficPercentage: 100,
      deployedRobotIds: ['r1'],
    });
    expect(prismaMock.deployment.update).toHaveBeenCalledWith({
      where: { id: 'dp-1' },
      data: {
        status: 'production',
        trafficPercentage: 100,
        deployedRobotIds: JSON.stringify(['r1']),
      },
      include: deploymentInclude,
    });
    expect(result?.status).toBe('production');
  });

  it('update() returns null when prisma throws', async () => {
    prismaMock.deployment.update.mockRejectedValue(new Error('x'));
    expect(await repo.update('dp-1', { trafficPercentage: 1 })).toBeNull();
  });

  it('delete() returns true / false', async () => {
    prismaMock.deployment.delete.mockResolvedValue(makeDbDeployment());
    expect(await repo.delete('dp-1')).toBe(true);
    prismaMock.deployment.delete.mockRejectedValue(new Error('x'));
    expect(await repo.delete('dp-1')).toBe(false);
  });
});

// ===========================================================================
// SkillChainRepository
// ===========================================================================

describe('SkillChainRepository', () => {
  const repo = new SkillChainRepository();

  it('exports a singleton instance', () => {
    expect(skillChainRepository).toBeInstanceOf(SkillChainRepository);
  });

  it('create() builds nested step create with order index and defaults, includes ordered steps', async () => {
    prismaMock.skillChain.create.mockResolvedValue(makeDbSkillChain());
    const result = await repo.create({
      name: 'pick-and-place',
      description: 'Pick then place',
      steps: [
        { skillId: 'sk-1', parameters: { force: 1 } },
        { skillId: 'sk-2', onFailure: 'skip' },
      ],
    });

    expect(prismaMock.skillChain.create).toHaveBeenCalledWith({
      data: {
        name: 'pick-and-place',
        description: 'Pick then place',
        steps: {
          create: [
            {
              skillId: 'sk-1',
              order: 0,
              parameters: JSON.stringify({ force: 1 }),
              inputMapping: JSON.stringify({}),
              onFailure: 'abort',
              maxRetries: undefined,
              timeoutOverride: undefined,
            },
            {
              skillId: 'sk-2',
              order: 1,
              parameters: JSON.stringify({}),
              inputMapping: JSON.stringify({}),
              onFailure: 'skip',
              maxRetries: undefined,
              timeoutOverride: undefined,
            },
          ],
        },
      },
      include: { steps: { orderBy: { order: 'asc' }, include: { skill: true } } },
    });
    expect(result.id).toBe('sc-1');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].skillId).toBe('sk-1');
  });

  it('findById() includes ordered steps and maps nested skill when present', async () => {
    prismaMock.skillChain.findUnique.mockResolvedValue(
      makeDbSkillChain({ steps: [makeDbSkillChainStep({ skill: makeDbSkill() })] }),
    );
    const result = await repo.findById('sc-1');
    expect(prismaMock.skillChain.findUnique).toHaveBeenCalledWith({
      where: { id: 'sc-1' },
      include: { steps: { orderBy: { order: 'asc' }, include: { skill: true } } },
    });
    expect(result?.steps[0].skill?.id).toBe('sk-1');
  });

  it('findById() returns null when missing', async () => {
    prismaMock.skillChain.findUnique.mockResolvedValue(null);
    expect(await repo.findById('x')).toBeNull();
  });

  it('dbSkillChainToDomain sorts steps by order ascending', async () => {
    prismaMock.skillChain.findUnique.mockResolvedValue(
      makeDbSkillChain({
        steps: [
          makeDbSkillChainStep({ id: 'b', order: 1 }),
          makeDbSkillChainStep({ id: 'a', order: 0 }),
        ],
      }),
    );
    const result = await repo.findById('sc-1');
    expect(result?.steps.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('findByName() uses findFirst with the name filter', async () => {
    prismaMock.skillChain.findFirst.mockResolvedValue(makeDbSkillChain());
    await repo.findByName('pick-and-place');
    expect(prismaMock.skillChain.findFirst).toHaveBeenCalledWith({
      where: { name: 'pick-and-place' },
      include: { steps: { orderBy: { order: 'asc' }, include: { skill: true } } },
    });
  });

  it('findByName() returns null when missing', async () => {
    prismaMock.skillChain.findFirst.mockResolvedValue(null);
    expect(await repo.findByName('x')).toBeNull();
  });

  it('findAll() builds where clause and paginates with included steps', async () => {
    prismaMock.skillChain.findMany.mockResolvedValue([makeDbSkillChain()]);
    prismaMock.skillChain.count.mockResolvedValue(1);
    const result = await repo.findAll({ name: 'pick', status: ['active', 'draft'], page: 1, pageSize: 25 });
    expect(prismaMock.skillChain.findMany).toHaveBeenCalledWith({
      where: { name: { contains: 'pick', mode: 'insensitive' }, status: { in: ['active', 'draft'] } },
      orderBy: { name: 'asc' },
      skip: 0,
      take: 25,
      include: { steps: { orderBy: { order: 'asc' }, include: { skill: true } } },
    });
    expect(result.pagination.total).toBe(1);
  });

  it('findByStatus() and findActive() filter by status', async () => {
    prismaMock.skillChain.findMany.mockResolvedValue([]);
    await repo.findByStatus('draft');
    expect(prismaMock.skillChain.findMany).toHaveBeenLastCalledWith({
      where: { status: 'draft' },
      orderBy: { name: 'asc' },
      include: { steps: { orderBy: { order: 'asc' }, include: { skill: true } } },
    });
    await repo.findActive();
    expect(prismaMock.skillChain.findMany).toHaveBeenLastCalledWith({
      where: { status: 'active' },
      orderBy: { name: 'asc' },
      include: { steps: { orderBy: { order: 'asc' }, include: { skill: true } } },
    });
  });

  it('update() replaces steps (deleteMany + createMany) then updates chain fields', async () => {
    prismaMock.skillChainStep.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.skillChainStep.createMany.mockResolvedValue({ count: 1 });
    prismaMock.skillChain.update.mockResolvedValue(makeDbSkillChain({ name: 'renamed' }));

    const result = await repo.update('sc-1', {
      name: 'renamed',
      steps: [{ skillId: 'sk-9', parameters: { a: 1 } }],
    });

    expect(prismaMock.skillChainStep.deleteMany).toHaveBeenCalledWith({ where: { chainId: 'sc-1' } });
    expect(prismaMock.skillChainStep.createMany).toHaveBeenCalledWith({
      data: [
        {
          chainId: 'sc-1',
          skillId: 'sk-9',
          order: 0,
          parameters: JSON.stringify({ a: 1 }),
          inputMapping: JSON.stringify({}),
          onFailure: 'abort',
          maxRetries: undefined,
          timeoutOverride: undefined,
        },
      ],
    });
    expect(prismaMock.skillChain.update).toHaveBeenCalledWith({
      where: { id: 'sc-1' },
      data: { name: 'renamed' },
      include: { steps: { orderBy: { order: 'asc' }, include: { skill: true } } },
    });
    expect(result?.name).toBe('renamed');
  });

  it('update() without steps does not touch the step table', async () => {
    prismaMock.skillChain.update.mockResolvedValue(makeDbSkillChain({ status: 'archived' }));
    await repo.update('sc-1', { status: 'archived' });
    expect(prismaMock.skillChainStep.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.skillChainStep.createMany).not.toHaveBeenCalled();
    expect(prismaMock.skillChain.update).toHaveBeenCalledWith({
      where: { id: 'sc-1' },
      data: { status: 'archived' },
      include: { steps: { orderBy: { order: 'asc' }, include: { skill: true } } },
    });
  });

  it('update() returns null when prisma throws', async () => {
    prismaMock.skillChain.update.mockRejectedValue(new Error('x'));
    expect(await repo.update('sc-1', { name: 'x' })).toBeNull();
  });

  it('updateStatus() delegates to update with status', async () => {
    prismaMock.skillChain.update.mockResolvedValue(makeDbSkillChain({ status: 'active' }));
    await repo.updateStatus('sc-1', 'active');
    expect(prismaMock.skillChain.update).toHaveBeenCalledWith({
      where: { id: 'sc-1' },
      data: { status: 'active' },
      include: { steps: { orderBy: { order: 'asc' }, include: { skill: true } } },
    });
  });

  it('delete() returns true / false', async () => {
    prismaMock.skillChain.delete.mockResolvedValue(makeDbSkillChain());
    expect(await repo.delete('sc-1')).toBe(true);
    prismaMock.skillChain.delete.mockRejectedValue(new Error('x'));
    expect(await repo.delete('sc-1')).toBe(false);
  });

  it('calculateEstimatedDuration() sums timeoutOverride/skill.timeout per step', async () => {
    prismaMock.skillChain.findUnique.mockResolvedValue(
      makeDbSkillChain({
        steps: [
          makeDbSkillChainStep({ id: 's1', order: 0, timeoutOverride: 30, skill: makeDbSkill({ timeout: 100 }) }),
          makeDbSkillChainStep({ id: 's2', order: 1, timeoutOverride: null, skill: makeDbSkill({ timeout: 45 }) }),
        ],
      }),
    );
    // 30 (override) + 45 (skill.timeout) = 75
    expect(await repo.calculateEstimatedDuration('sc-1')).toBe(75);
  });

  it('calculateEstimatedDuration() falls back to 60 when timeout absent and 0 when chain missing', async () => {
    prismaMock.skillChain.findUnique.mockResolvedValueOnce(
      makeDbSkillChain({
        steps: [makeDbSkillChainStep({ timeoutOverride: null, skill: makeDbSkill({ timeout: null }) })],
      }),
    );
    expect(await repo.calculateEstimatedDuration('sc-1')).toBe(60);

    prismaMock.skillChain.findUnique.mockResolvedValueOnce(null);
    expect(await repo.calculateEstimatedDuration('missing')).toBe(0);
  });
});
