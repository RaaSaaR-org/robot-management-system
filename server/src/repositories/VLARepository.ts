/**
 * @file VLARepository.ts
 * @description Data access layer for VLA (Vision-Language-Action) training entities
 * @feature vla
 *
 * Provides CRUD operations and specialized queries for:
 * - RobotType - Robot embodiment configurations
 * - SkillDefinition - Learnable robot skills
 * - Dataset - Training datasets (LeRobot v3 format)
 * - TrainingJob - Training job queue
 * - ModelVersion - Trained model artifacts
 * - Deployment - Fleet deployment tracking
 */

import { prisma } from '../database/index.js';
import type {
  RobotType as PrismaRobotType,
  SkillDefinition as PrismaSkillDefinition,
  Dataset as PrismaDataset,
  TrainingJob as PrismaTrainingJob,
  ModelVersion as PrismaModelVersion,
  Deployment as PrismaDeployment,
  SkillChain as PrismaSkillChain,
  SkillChainStep as PrismaSkillChainStep,
} from '@prisma/client';
import type {
  RobotType,
  CreateRobotTypeInput,
  UpdateRobotTypeInput,
  SkillDefinition,
  CreateSkillDefinitionInput,
  UpdateSkillDefinitionInput,
  SkillDefinitionQueryParams,
  Condition,
  Dataset,
  CreateDatasetInput,
  UpdateDatasetInput,
  DatasetQueryParams,
  TrainingJob,
  CreateTrainingJobInput,
  UpdateTrainingJobInput,
  TrainingJobQueryParams,
  ModelVersion,
  CreateModelVersionInput,
  UpdateModelVersionInput,
  ModelVersionQueryParams,
  Deployment,
  CreateDeploymentInput,
  UpdateDeploymentInput,
  DeploymentQueryParams,
  CameraConfig,
  JointLimits,
  Hyperparameters,
  GpuRequirements,
  TrainingMetrics,
  CanaryConfig,
  RollbackThresholds,
  LeRobotInfo,
  LeRobotStats,
  PaginatedResult,
  SkillStatus,
  DatasetStatus,
  TrainingJobStatus,
  ModelDeploymentStatus,
  DeploymentStatus,
} from '../types/vla.types.js';
import type {
  SkillChain,
  SkillChainStep,
  CreateSkillChainInput,
  UpdateSkillChainInput,
  SkillChainQueryParams,
  SkillChainStatus,
  FailureStrategy,
} from '../types/skill.types.js';

// ============================================================================
// HELPER FUNCTIONS - RobotType
// ============================================================================

function dbRobotTypeToDomain(db: PrismaRobotType): RobotType {
  return {
    id: db.id,
    name: db.name,
    manufacturer: db.manufacturer,
    model: db.model,
    actionDim: db.actionDim,
    proprioceptionDim: db.proprioceptionDim,
    cameras: JSON.parse(db.cameras) as CameraConfig[],
    capabilities: db.capabilities,
    limits: JSON.parse(db.limits) as JointLimits,
    createdAt: db.createdAt,
    updatedAt: db.updatedAt,
  };
}

// ============================================================================
// HELPER FUNCTIONS - SkillDefinition
// ============================================================================

function dbSkillDefinitionToDomain(db: PrismaSkillDefinition): SkillDefinition {
  return {
    id: db.id,
    name: db.name,
    version: db.version,
    description: db.description ?? undefined,
    parametersSchema: JSON.parse(db.parametersSchema) as Record<string, unknown>,
    defaultParameters: JSON.parse(db.defaultParameters) as Record<string, unknown>,
    preconditions: JSON.parse(db.preconditions) as Condition[],
    postconditions: JSON.parse(db.postconditions) as Condition[],
    requiredCapabilities: db.requiredCapabilities,
    timeout: db.timeout ?? undefined,
    maxRetries: db.maxRetries,
    status: db.status as SkillStatus,
    linkedModelVersionId: db.linkedModelVersionId ?? undefined,
    createdAt: db.createdAt,
    updatedAt: db.updatedAt,
  };
}

// Helper for SkillChain
function dbSkillChainToDomain(
  db: PrismaSkillChain & { steps?: (PrismaSkillChainStep & { skill?: PrismaSkillDefinition })[] }
): SkillChain {
  return {
    id: db.id,
    name: db.name,
    description: db.description ?? undefined,
    status: db.status as SkillChainStatus,
    estimatedDuration: db.estimatedDuration ?? undefined,
    steps: (db.steps ?? [])
      .sort((a, b) => a.order - b.order)
      .map((step) => dbSkillChainStepToDomain(step)),
    createdAt: db.createdAt,
    updatedAt: db.updatedAt,
  };
}

// Helper for SkillChainStep
function dbSkillChainStepToDomain(
  db: PrismaSkillChainStep & { skill?: PrismaSkillDefinition }
): SkillChainStep {
  return {
    id: db.id,
    skillId: db.skillId,
    order: db.order,
    parameters: JSON.parse(db.parameters) as Record<string, unknown>,
    inputMapping: JSON.parse(db.inputMapping) as Record<string, string>,
    onFailure: db.onFailure as FailureStrategy,
    maxRetries: db.maxRetries ?? undefined,
    timeoutOverride: db.timeoutOverride ?? undefined,
    skill: db.skill ? dbSkillDefinitionToDomain(db.skill) : undefined,
  };
}

// ============================================================================
// HELPER FUNCTIONS - Dataset
// ============================================================================

function dbDatasetToDomain(db: PrismaDataset): Dataset {
  return {
    id: db.id,
    name: db.name,
    description: db.description ?? undefined,
    robotTypeId: db.robotTypeId,
    skillId: db.skillId ?? undefined,
    storagePath: db.storagePath,
    lerobotVersion: db.lerobotVersion,
    fps: db.fps,
    totalFrames: db.totalFrames,
    totalDuration: db.totalDuration,
    demonstrationCount: db.demonstrationCount,
    qualityScore: db.qualityScore ?? undefined,
    infoJson: JSON.parse(db.infoJson) as LeRobotInfo,
    statsJson: JSON.parse(db.statsJson) as LeRobotStats,
    status: db.status as DatasetStatus,
    createdAt: db.createdAt,
    updatedAt: db.updatedAt,
  };
}

// ============================================================================
// HELPER FUNCTIONS - TrainingJob
// ============================================================================

function dbTrainingJobToDomain(db: PrismaTrainingJob): TrainingJob {
  return {
    id: db.id,
    datasetId: db.datasetId,
    baseModel: db.baseModel as TrainingJob['baseModel'],
    fineTuneMethod: db.fineTuneMethod as TrainingJob['fineTuneMethod'],
    hyperparameters: JSON.parse(db.hyperparameters) as Hyperparameters,
    gpuRequirements: JSON.parse(db.gpuRequirements) as GpuRequirements,
    status: db.status as TrainingJobStatus,
    progress: db.progress,
    currentEpoch: db.currentEpoch ?? undefined,
    totalEpochs: db.totalEpochs ?? undefined,
    metrics: JSON.parse(db.metrics) as TrainingMetrics,
    mlflowRunId: db.mlflowRunId ?? undefined,
    mlflowExperimentId: db.mlflowExperimentId ?? undefined,
    bullmqJobId: db.bullmqJobId ?? undefined,
    startedAt: db.startedAt ?? undefined,
    completedAt: db.completedAt ?? undefined,
    errorMessage: db.errorMessage ?? undefined,
    createdAt: db.createdAt,
    updatedAt: db.updatedAt,
  };
}

// ============================================================================
// HELPER FUNCTIONS - ModelVersion
// ============================================================================

function dbModelVersionToDomain(db: PrismaModelVersion): ModelVersion {
  return {
    id: db.id,
    skillId: db.skillId,
    trainingJobId: db.trainingJobId,
    version: db.version,
    artifactUri: db.artifactUri,
    checkpointUri: db.checkpointUri ?? undefined,
    trainingMetrics: JSON.parse(db.trainingMetrics) as TrainingMetrics,
    validationMetrics: JSON.parse(db.validationMetrics) as TrainingMetrics,
    deploymentStatus: db.deploymentStatus as ModelDeploymentStatus,
    mlflowModelName: db.mlflowModelName ?? undefined,
    mlflowModelVersion: db.mlflowModelVersion ?? undefined,
    createdAt: db.createdAt,
    updatedAt: db.updatedAt,
  };
}

// ============================================================================
// HELPER FUNCTIONS - Deployment
// ============================================================================

function dbDeploymentToDomain(db: PrismaDeployment): Deployment {
  return {
    id: db.id,
    modelVersionId: db.modelVersionId,
    strategy: db.strategy as Deployment['strategy'],
    targetRobotTypes: db.targetRobotTypes,
    targetZones: db.targetZones,
    trafficPercentage: db.trafficPercentage,
    canaryConfig: JSON.parse(db.canaryConfig) as CanaryConfig,
    rollbackThresholds: JSON.parse(db.rollbackThresholds) as RollbackThresholds,
    status: db.status as DeploymentStatus,
    deployedRobotIds: db.deployedRobotIds,
    failedRobotIds: db.failedRobotIds,
    startedAt: db.startedAt ?? undefined,
    completedAt: db.completedAt ?? undefined,
    createdAt: db.createdAt,
    updatedAt: db.updatedAt,
  };
}

// ============================================================================
// ROBOT TYPE REPOSITORY
// ============================================================================

export class RobotTypeRepository {
  async create(input: CreateRobotTypeInput): Promise<RobotType> {
    const robotType = await prisma.robotType.create({
      data: {
        name: input.name,
        manufacturer: input.manufacturer,
        model: input.model,
        actionDim: input.actionDim,
        proprioceptionDim: input.proprioceptionDim,
        cameras: JSON.stringify(input.cameras ?? []),
        capabilities: input.capabilities ?? [],
        limits: JSON.stringify(input.limits ?? { position: { min: [], max: [] }, velocity: [], torque: [] }),
      },
    });
    return dbRobotTypeToDomain(robotType);
  }

  async findById(id: string): Promise<RobotType | null> {
    const robotType = await prisma.robotType.findUnique({
      where: { id },
    });
    return robotType ? dbRobotTypeToDomain(robotType) : null;
  }

  async findByName(name: string): Promise<RobotType | null> {
    const robotType = await prisma.robotType.findUnique({
      where: { name },
    });
    return robotType ? dbRobotTypeToDomain(robotType) : null;
  }

  async findAll(): Promise<RobotType[]> {
    const robotTypes = await prisma.robotType.findMany({
      orderBy: { name: 'asc' },
    });
    return robotTypes.map(dbRobotTypeToDomain);
  }

  async findByManufacturer(manufacturer: string): Promise<RobotType[]> {
    const robotTypes = await prisma.robotType.findMany({
      where: { manufacturer },
      orderBy: { name: 'asc' },
    });
    return robotTypes.map(dbRobotTypeToDomain);
  }

  async update(id: string, input: UpdateRobotTypeInput): Promise<RobotType | null> {
    try {
      const updateData: Record<string, unknown> = {};

      if (input.name !== undefined) updateData.name = input.name;
      if (input.manufacturer !== undefined) updateData.manufacturer = input.manufacturer;
      if (input.model !== undefined) updateData.model = input.model;
      if (input.actionDim !== undefined) updateData.actionDim = input.actionDim;
      if (input.proprioceptionDim !== undefined) updateData.proprioceptionDim = input.proprioceptionDim;
      if (input.cameras !== undefined) updateData.cameras = JSON.stringify(input.cameras);
      if (input.capabilities !== undefined) updateData.capabilities = input.capabilities;
      if (input.limits !== undefined) updateData.limits = JSON.stringify(input.limits);

      const robotType = await prisma.robotType.update({
        where: { id },
        data: updateData,
      });
      return dbRobotTypeToDomain(robotType);
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await prisma.robotType.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================================================
// SKILL DEFINITION REPOSITORY
// ============================================================================

export class SkillDefinitionRepository {
  async create(input: CreateSkillDefinitionInput): Promise<SkillDefinition> {
    const skill = await prisma.skillDefinition.create({
      data: {
        name: input.name,
        version: input.version,
        description: input.description,
        parametersSchema: JSON.stringify(input.parametersSchema ?? {}),
        defaultParameters: JSON.stringify(input.defaultParameters ?? {}),
        preconditions: JSON.stringify(input.preconditions ?? []),
        postconditions: JSON.stringify(input.postconditions ?? []),
        requiredCapabilities: input.requiredCapabilities ?? [],
        timeout: input.timeout,
        maxRetries: input.maxRetries ?? 3,
        status: input.status ?? 'draft',
        linkedModelVersionId: input.linkedModelVersionId,
        compatibleRobotTypes: input.compatibleRobotTypeIds
          ? { connect: input.compatibleRobotTypeIds.map((id) => ({ id })) }
          : undefined,
      },
    });
    return dbSkillDefinitionToDomain(skill);
  }

  async findById(id: string): Promise<SkillDefinition | null> {
    const skill = await prisma.skillDefinition.findUnique({
      where: { id },
    });
    return skill ? dbSkillDefinitionToDomain(skill) : null;
  }

  async findByIdWithRelations(id: string): Promise<SkillDefinition | null> {
    const skill = await prisma.skillDefinition.findUnique({
      where: { id },
      include: {
        compatibleRobotTypes: true,
      },
    });
    if (!skill) return null;
    const domain = dbSkillDefinitionToDomain(skill);
    domain.compatibleRobotTypes = skill.compatibleRobotTypes.map(dbRobotTypeToDomain);
    return domain;
  }

  async findByNameAndVersion(name: string, version: string): Promise<SkillDefinition | null> {
    const skill = await prisma.skillDefinition.findUnique({
      where: { name_version: { name, version } },
    });
    return skill ? dbSkillDefinitionToDomain(skill) : null;
  }

  async findAll(params?: SkillDefinitionQueryParams): Promise<PaginatedResult<SkillDefinition>> {
    const page = params?.page ?? 1;
    const pageSize = params?.pageSize ?? 50;
    const skip = (page - 1) * pageSize;

    const where = this.buildWhereClause(params);

    const [skills, total] = await Promise.all([
      prisma.skillDefinition.findMany({
        where,
        orderBy: [{ name: 'asc' }, { version: 'desc' }],
        skip,
        take: pageSize,
      }),
      prisma.skillDefinition.count({ where }),
    ]);

    return {
      data: skills.map(dbSkillDefinitionToDomain),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async findByStatus(status: SkillStatus): Promise<SkillDefinition[]> {
    const skills = await prisma.skillDefinition.findMany({
      where: { status },
      orderBy: { name: 'asc' },
    });
    return skills.map(dbSkillDefinitionToDomain);
  }

  async findPublished(): Promise<SkillDefinition[]> {
    return this.findByStatus('published');
  }

  async findByRobotType(robotTypeId: string): Promise<SkillDefinition[]> {
    const skills = await prisma.skillDefinition.findMany({
      where: {
        compatibleRobotTypes: {
          some: { id: robotTypeId },
        },
      },
      orderBy: { name: 'asc' },
    });
    return skills.map(dbSkillDefinitionToDomain);
  }

  async findByCapability(capability: string): Promise<SkillDefinition[]> {
    const skills = await prisma.skillDefinition.findMany({
      where: {
        requiredCapabilities: {
          has: capability,
        },
      },
      orderBy: { name: 'asc' },
    });
    return skills.map(dbSkillDefinitionToDomain);
  }

  async findCompatibleSkills(robotTypeId: string, robotCapabilities: string[]): Promise<SkillDefinition[]> {
    // Find skills compatible with the robot type that require only capabilities the robot has
    const skills = await prisma.skillDefinition.findMany({
      where: {
        status: 'published',
        compatibleRobotTypes: {
          some: { id: robotTypeId },
        },
      },
      orderBy: { name: 'asc' },
    });

    // Filter by capabilities (robot must have all required capabilities)
    return skills
      .map(dbSkillDefinitionToDomain)
      .filter((skill) =>
        skill.requiredCapabilities.every((cap) => robotCapabilities.includes(cap))
      );
  }

  async update(id: string, input: UpdateSkillDefinitionInput): Promise<SkillDefinition | null> {
    try {
      const updateData: Record<string, unknown> = {};

      if (input.name !== undefined) updateData.name = input.name;
      if (input.version !== undefined) updateData.version = input.version;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.parametersSchema !== undefined) updateData.parametersSchema = JSON.stringify(input.parametersSchema);
      if (input.defaultParameters !== undefined) updateData.defaultParameters = JSON.stringify(input.defaultParameters);
      if (input.preconditions !== undefined) updateData.preconditions = JSON.stringify(input.preconditions);
      if (input.postconditions !== undefined) updateData.postconditions = JSON.stringify(input.postconditions);
      if (input.requiredCapabilities !== undefined) updateData.requiredCapabilities = input.requiredCapabilities;
      if (input.timeout !== undefined) updateData.timeout = input.timeout;
      if (input.maxRetries !== undefined) updateData.maxRetries = input.maxRetries;
      if (input.status !== undefined) updateData.status = input.status;
      if (input.linkedModelVersionId !== undefined) updateData.linkedModelVersionId = input.linkedModelVersionId;

      if (input.compatibleRobotTypeIds !== undefined) {
        updateData.compatibleRobotTypes = {
          set: input.compatibleRobotTypeIds.map((id) => ({ id })),
        };
      }

      const skill = await prisma.skillDefinition.update({
        where: { id },
        data: updateData,
      });
      return dbSkillDefinitionToDomain(skill);
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await prisma.skillDefinition.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  private buildWhereClause(params?: SkillDefinitionQueryParams): Record<string, unknown> {
    if (!params) return {};

    const where: Record<string, unknown> = {};

    if (params.name) {
      where.name = { contains: params.name, mode: 'insensitive' };
    }

    if (params.status) {
      where.status = Array.isArray(params.status) ? { in: params.status } : params.status;
    }

    if (params.robotTypeId) {
      where.compatibleRobotTypes = { some: { id: params.robotTypeId } };
    }

    if (params.capability) {
      where.requiredCapabilities = { has: params.capability };
    }

    if (params.linkedModelVersionId) {
      where.linkedModelVersionId = params.linkedModelVersionId;
    }

    return where;
  }
}

// ============================================================================
// DATASET REPOSITORY
// ============================================================================

export class DatasetRepository {
  async create(input: CreateDatasetInput): Promise<Dataset> {
    const dataset = await prisma.dataset.create({
      data: {
        name: input.name,
        description: input.description,
        robotTypeId: input.robotTypeId,
        skillId: input.skillId,
        storagePath: input.storagePath,
        lerobotVersion: input.lerobotVersion,
        fps: input.fps,
        totalFrames: input.totalFrames,
        totalDuration: input.totalDuration,
        demonstrationCount: input.demonstrationCount,
        qualityScore: input.qualityScore,
        infoJson: JSON.stringify(input.infoJson ?? {}),
        statsJson: JSON.stringify(input.statsJson ?? {}),
        status: input.status ?? 'uploading',
      },
    });
    return dbDatasetToDomain(dataset);
  }

  async findById(id: string): Promise<Dataset | null> {
    const dataset = await prisma.dataset.findUnique({
      where: { id },
    });
    return dataset ? dbDatasetToDomain(dataset) : null;
  }

  async findAll(params?: DatasetQueryParams): Promise<PaginatedResult<Dataset>> {
    const page = params?.page ?? 1;
    const pageSize = params?.pageSize ?? 50;
    const skip = (page - 1) * pageSize;

    const where = this.buildWhereClause(params);

    const [datasets, total] = await Promise.all([
      prisma.dataset.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.dataset.count({ where }),
    ]);

    return {
      data: datasets.map(dbDatasetToDomain),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async findReady(): Promise<Dataset[]> {
    const datasets = await prisma.dataset.findMany({
      where: { status: 'ready' },
      orderBy: { createdAt: 'desc' },
    });
    return datasets.map(dbDatasetToDomain);
  }

  async findByRobotType(robotTypeId: string): Promise<Dataset[]> {
    const datasets = await prisma.dataset.findMany({
      where: { robotTypeId },
      orderBy: { createdAt: 'desc' },
    });
    return datasets.map(dbDatasetToDomain);
  }

  async findBySkill(skillId: string): Promise<Dataset[]> {
    const datasets = await prisma.dataset.findMany({
      where: { skillId },
      orderBy: { createdAt: 'desc' },
    });
    return datasets.map(dbDatasetToDomain);
  }

  async update(id: string, input: UpdateDatasetInput): Promise<Dataset | null> {
    try {
      const updateData: Record<string, unknown> = {};

      if (input.name !== undefined) updateData.name = input.name;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.skillId !== undefined) updateData.skillId = input.skillId;
      if (input.qualityScore !== undefined) updateData.qualityScore = input.qualityScore;
      if (input.infoJson !== undefined) updateData.infoJson = JSON.stringify(input.infoJson);
      if (input.statsJson !== undefined) updateData.statsJson = JSON.stringify(input.statsJson);
      if (input.status !== undefined) updateData.status = input.status;

      const dataset = await prisma.dataset.update({
        where: { id },
        data: updateData,
      });
      return dbDatasetToDomain(dataset);
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await prisma.dataset.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  private buildWhereClause(params?: DatasetQueryParams): Record<string, unknown> {
    if (!params) return {};

    const where: Record<string, unknown> = {};

    if (params.robotTypeId) {
      where.robotTypeId = params.robotTypeId;
    }

    if (params.skillId) {
      where.skillId = params.skillId;
    }

    if (params.status) {
      where.status = Array.isArray(params.status) ? { in: params.status } : params.status;
    }

    if (params.minQualityScore !== undefined) {
      where.qualityScore = { gte: params.minQualityScore };
    }

    return where;
  }
}

// ============================================================================
// TRAINING JOB REPOSITORY
// ============================================================================

export class TrainingJobRepository {
  async create(input: CreateTrainingJobInput): Promise<TrainingJob> {
    const job = await prisma.trainingJob.create({
      data: {
        datasetId: input.datasetId,
        baseModel: input.baseModel,
        fineTuneMethod: input.fineTuneMethod,
        hyperparameters: JSON.stringify(input.hyperparameters ?? {
          learning_rate: 1e-4,
          batch_size: 32,
          epochs: 100,
        }),
        gpuRequirements: JSON.stringify(input.gpuRequirements ?? { count: 1, memory: 40 }),
        totalEpochs: input.totalEpochs,
      },
    });
    return dbTrainingJobToDomain(job);
  }

  async findById(id: string): Promise<TrainingJob | null> {
    const job = await prisma.trainingJob.findUnique({
      where: { id },
    });
    return job ? dbTrainingJobToDomain(job) : null;
  }

  async findAll(params?: TrainingJobQueryParams): Promise<PaginatedResult<TrainingJob>> {
    const page = params?.page ?? 1;
    const pageSize = params?.pageSize ?? 50;
    const skip = (page - 1) * pageSize;

    const where = this.buildWhereClause(params);

    const [jobs, total] = await Promise.all([
      prisma.trainingJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.trainingJob.count({ where }),
    ]);

    return {
      data: jobs.map(dbTrainingJobToDomain),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async findPending(): Promise<TrainingJob[]> {
    const jobs = await prisma.trainingJob.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
    });
    return jobs.map(dbTrainingJobToDomain);
  }

  async findByStatus(status: TrainingJobStatus): Promise<TrainingJob[]> {
    const jobs = await prisma.trainingJob.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
    });
    return jobs.map(dbTrainingJobToDomain);
  }

  async findRunning(): Promise<TrainingJob[]> {
    return this.findByStatus('running');
  }

  async update(id: string, input: UpdateTrainingJobInput): Promise<TrainingJob | null> {
    try {
      const updateData: Record<string, unknown> = {};

      if (input.status !== undefined) updateData.status = input.status;
      if (input.progress !== undefined) updateData.progress = input.progress;
      if (input.currentEpoch !== undefined) updateData.currentEpoch = input.currentEpoch;
      if (input.metrics !== undefined) updateData.metrics = JSON.stringify(input.metrics);
      if (input.mlflowRunId !== undefined) updateData.mlflowRunId = input.mlflowRunId;
      if (input.mlflowExperimentId !== undefined) updateData.mlflowExperimentId = input.mlflowExperimentId;
      if (input.bullmqJobId !== undefined) updateData.bullmqJobId = input.bullmqJobId;
      if (input.startedAt !== undefined) updateData.startedAt = input.startedAt;
      if (input.completedAt !== undefined) updateData.completedAt = input.completedAt;
      if (input.errorMessage !== undefined) updateData.errorMessage = input.errorMessage;

      const job = await prisma.trainingJob.update({
        where: { id },
        data: updateData,
      });
      return dbTrainingJobToDomain(job);
    } catch {
      return null;
    }
  }

  async updateProgress(id: string, progress: number, currentEpoch?: number): Promise<TrainingJob | null> {
    return this.update(id, { progress, currentEpoch });
  }

  async delete(id: string): Promise<boolean> {
    try {
      await prisma.trainingJob.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  private buildWhereClause(params?: TrainingJobQueryParams): Record<string, unknown> {
    if (!params) return {};

    const where: Record<string, unknown> = {};

    if (params.datasetId) {
      where.datasetId = params.datasetId;
    }

    if (params.baseModel) {
      where.baseModel = Array.isArray(params.baseModel) ? { in: params.baseModel } : params.baseModel;
    }

    if (params.fineTuneMethod) {
      where.fineTuneMethod = Array.isArray(params.fineTuneMethod)
        ? { in: params.fineTuneMethod }
        : params.fineTuneMethod;
    }

    if (params.status) {
      where.status = Array.isArray(params.status) ? { in: params.status } : params.status;
    }

    return where;
  }
}

// ============================================================================
// MODEL VERSION REPOSITORY
// ============================================================================

export class ModelVersionRepository {
  async create(input: CreateModelVersionInput): Promise<ModelVersion> {
    const modelVersion = await prisma.modelVersion.create({
      data: {
        skillId: input.skillId,
        trainingJobId: input.trainingJobId,
        version: input.version,
        artifactUri: input.artifactUri,
        checkpointUri: input.checkpointUri,
        trainingMetrics: JSON.stringify(input.trainingMetrics ?? {}),
        validationMetrics: JSON.stringify(input.validationMetrics ?? {}),
        deploymentStatus: input.deploymentStatus ?? 'staging',
        mlflowModelName: input.mlflowModelName,
        mlflowModelVersion: input.mlflowModelVersion,
      },
    });
    return dbModelVersionToDomain(modelVersion);
  }

  async findById(id: string): Promise<ModelVersion | null> {
    const modelVersion = await prisma.modelVersion.findUnique({
      where: { id },
    });
    return modelVersion ? dbModelVersionToDomain(modelVersion) : null;
  }

  async findBySkillAndVersion(skillId: string, version: string): Promise<ModelVersion | null> {
    const modelVersion = await prisma.modelVersion.findUnique({
      where: { skillId_version: { skillId, version } },
    });
    return modelVersion ? dbModelVersionToDomain(modelVersion) : null;
  }

  async findAll(params?: ModelVersionQueryParams): Promise<PaginatedResult<ModelVersion>> {
    const page = params?.page ?? 1;
    const pageSize = params?.pageSize ?? 50;
    const skip = (page - 1) * pageSize;

    const where = this.buildWhereClause(params);

    const [versions, total] = await Promise.all([
      prisma.modelVersion.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.modelVersion.count({ where }),
    ]);

    return {
      data: versions.map(dbModelVersionToDomain),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async findBySkill(skillId: string): Promise<ModelVersion[]> {
    const versions = await prisma.modelVersion.findMany({
      where: { skillId },
      orderBy: { createdAt: 'desc' },
    });
    return versions.map(dbModelVersionToDomain);
  }

  async findByDeploymentStatus(status: ModelDeploymentStatus): Promise<ModelVersion[]> {
    const versions = await prisma.modelVersion.findMany({
      where: { deploymentStatus: status },
      orderBy: { createdAt: 'desc' },
    });
    return versions.map(dbModelVersionToDomain);
  }

  async findProduction(): Promise<ModelVersion[]> {
    return this.findByDeploymentStatus('production');
  }

  async update(id: string, input: UpdateModelVersionInput): Promise<ModelVersion | null> {
    try {
      const updateData: Record<string, unknown> = {};

      if (input.artifactUri !== undefined) updateData.artifactUri = input.artifactUri;
      if (input.checkpointUri !== undefined) updateData.checkpointUri = input.checkpointUri;
      if (input.trainingMetrics !== undefined) updateData.trainingMetrics = JSON.stringify(input.trainingMetrics);
      if (input.validationMetrics !== undefined) updateData.validationMetrics = JSON.stringify(input.validationMetrics);
      if (input.deploymentStatus !== undefined) updateData.deploymentStatus = input.deploymentStatus;
      if (input.mlflowModelName !== undefined) updateData.mlflowModelName = input.mlflowModelName;
      if (input.mlflowModelVersion !== undefined) updateData.mlflowModelVersion = input.mlflowModelVersion;

      const modelVersion = await prisma.modelVersion.update({
        where: { id },
        data: updateData,
      });
      return dbModelVersionToDomain(modelVersion);
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await prisma.modelVersion.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  private buildWhereClause(params?: ModelVersionQueryParams): Record<string, unknown> {
    if (!params) return {};

    const where: Record<string, unknown> = {};

    if (params.skillId) {
      where.skillId = params.skillId;
    }

    if (params.trainingJobId) {
      where.trainingJobId = params.trainingJobId;
    }

    if (params.deploymentStatus) {
      where.deploymentStatus = Array.isArray(params.deploymentStatus)
        ? { in: params.deploymentStatus }
        : params.deploymentStatus;
    }

    return where;
  }
}

// ============================================================================
// DEPLOYMENT REPOSITORY
// ============================================================================

export class DeploymentRepository {
  async create(input: CreateDeploymentInput): Promise<Deployment> {
    const deployment = await prisma.deployment.create({
      data: {
        modelVersionId: input.modelVersionId,
        strategy: input.strategy,
        targetRobotTypes: input.targetRobotTypes ?? [],
        targetZones: input.targetZones ?? [],
        canaryConfig: JSON.stringify(input.canaryConfig ?? { stages: [], successThreshold: 0.95 }),
        rollbackThresholds: JSON.stringify(input.rollbackThresholds ?? {
          errorRate: 0.05,
          latencyP99: 1000,
          failureRate: 0.1,
        }),
      },
    });
    return dbDeploymentToDomain(deployment);
  }

  async findById(id: string): Promise<Deployment | null> {
    const deployment = await prisma.deployment.findUnique({
      where: { id },
    });
    return deployment ? dbDeploymentToDomain(deployment) : null;
  }

  async findAll(params?: DeploymentQueryParams): Promise<PaginatedResult<Deployment>> {
    const page = params?.page ?? 1;
    const pageSize = params?.pageSize ?? 50;
    const skip = (page - 1) * pageSize;

    const where = this.buildWhereClause(params);

    const [deployments, total] = await Promise.all([
      prisma.deployment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.deployment.count({ where }),
    ]);

    return {
      data: deployments.map(dbDeploymentToDomain),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async findActive(): Promise<Deployment[]> {
    const deployments = await prisma.deployment.findMany({
      where: {
        status: { in: ['deploying', 'canary', 'production'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    return deployments.map(dbDeploymentToDomain);
  }

  async findByModelVersion(modelVersionId: string): Promise<Deployment[]> {
    const deployments = await prisma.deployment.findMany({
      where: { modelVersionId },
      orderBy: { createdAt: 'desc' },
    });
    return deployments.map(dbDeploymentToDomain);
  }

  async findByStatus(status: DeploymentStatus): Promise<Deployment[]> {
    const deployments = await prisma.deployment.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
    });
    return deployments.map(dbDeploymentToDomain);
  }

  async update(id: string, input: UpdateDeploymentInput): Promise<Deployment | null> {
    try {
      const updateData: Record<string, unknown> = {};

      if (input.trafficPercentage !== undefined) updateData.trafficPercentage = input.trafficPercentage;
      if (input.canaryConfig !== undefined) updateData.canaryConfig = JSON.stringify(input.canaryConfig);
      if (input.rollbackThresholds !== undefined) updateData.rollbackThresholds = JSON.stringify(input.rollbackThresholds);
      if (input.status !== undefined) updateData.status = input.status;
      if (input.deployedRobotIds !== undefined) updateData.deployedRobotIds = input.deployedRobotIds;
      if (input.failedRobotIds !== undefined) updateData.failedRobotIds = input.failedRobotIds;
      if (input.startedAt !== undefined) updateData.startedAt = input.startedAt;
      if (input.completedAt !== undefined) updateData.completedAt = input.completedAt;

      const deployment = await prisma.deployment.update({
        where: { id },
        data: updateData,
      });
      return dbDeploymentToDomain(deployment);
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await prisma.deployment.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  private buildWhereClause(params?: DeploymentQueryParams): Record<string, unknown> {
    if (!params) return {};

    const where: Record<string, unknown> = {};

    if (params.modelVersionId) {
      where.modelVersionId = params.modelVersionId;
    }

    if (params.strategy) {
      where.strategy = Array.isArray(params.strategy) ? { in: params.strategy } : params.strategy;
    }

    if (params.status) {
      where.status = Array.isArray(params.status) ? { in: params.status } : params.status;
    }

    return where;
  }
}

// ============================================================================
// SKILL CHAIN REPOSITORY
// ============================================================================

export class SkillChainRepository {
  async create(input: CreateSkillChainInput): Promise<SkillChain> {
    const chain = await prisma.skillChain.create({
      data: {
        name: input.name,
        description: input.description,
        steps: {
          create: input.steps.map((step, index) => ({
            skillId: step.skillId,
            order: index,
            parameters: JSON.stringify(step.parameters ?? {}),
            inputMapping: JSON.stringify(step.inputMapping ?? {}),
            onFailure: step.onFailure ?? 'abort',
            maxRetries: step.maxRetries,
            timeoutOverride: step.timeoutOverride,
          })),
        },
      },
      include: {
        steps: {
          orderBy: { order: 'asc' },
          include: { skill: true },
        },
      },
    });
    return dbSkillChainToDomain(chain);
  }

  async findById(id: string): Promise<SkillChain | null> {
    const chain = await prisma.skillChain.findUnique({
      where: { id },
      include: {
        steps: {
          orderBy: { order: 'asc' },
          include: { skill: true },
        },
      },
    });
    return chain ? dbSkillChainToDomain(chain) : null;
  }

  async findByName(name: string): Promise<SkillChain | null> {
    const chain = await prisma.skillChain.findFirst({
      where: { name },
      include: {
        steps: {
          orderBy: { order: 'asc' },
          include: { skill: true },
        },
      },
    });
    return chain ? dbSkillChainToDomain(chain) : null;
  }

  async findAll(params?: SkillChainQueryParams): Promise<PaginatedResult<SkillChain>> {
    const page = params?.page ?? 1;
    const pageSize = params?.pageSize ?? 50;
    const skip = (page - 1) * pageSize;

    const where = this.buildWhereClause(params);

    const [chains, total] = await Promise.all([
      prisma.skillChain.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take: pageSize,
        include: {
          steps: {
            orderBy: { order: 'asc' },
            include: { skill: true },
          },
        },
      }),
      prisma.skillChain.count({ where }),
    ]);

    return {
      data: chains.map(dbSkillChainToDomain),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async findByStatus(status: SkillChainStatus): Promise<SkillChain[]> {
    const chains = await prisma.skillChain.findMany({
      where: { status },
      orderBy: { name: 'asc' },
      include: {
        steps: {
          orderBy: { order: 'asc' },
          include: { skill: true },
        },
      },
    });
    return chains.map(dbSkillChainToDomain);
  }

  async findActive(): Promise<SkillChain[]> {
    return this.findByStatus('active');
  }

  async update(id: string, input: UpdateSkillChainInput): Promise<SkillChain | null> {
    try {
      // If steps are being updated, we need to replace them all
      if (input.steps !== undefined) {
        // Delete existing steps
        await prisma.skillChainStep.deleteMany({
          where: { chainId: id },
        });

        // Create new steps
        await prisma.skillChainStep.createMany({
          data: input.steps.map((step, index) => ({
            chainId: id,
            skillId: step.skillId,
            order: index,
            parameters: JSON.stringify(step.parameters ?? {}),
            inputMapping: JSON.stringify(step.inputMapping ?? {}),
            onFailure: step.onFailure ?? 'abort',
            maxRetries: step.maxRetries,
            timeoutOverride: step.timeoutOverride,
          })),
        });
      }

      // Update chain fields
      const updateData: Record<string, unknown> = {};
      if (input.name !== undefined) updateData.name = input.name;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.status !== undefined) updateData.status = input.status;

      const chain = await prisma.skillChain.update({
        where: { id },
        data: updateData,
        include: {
          steps: {
            orderBy: { order: 'asc' },
            include: { skill: true },
          },
        },
      });
      return dbSkillChainToDomain(chain);
    } catch {
      return null;
    }
  }

  async updateStatus(id: string, status: SkillChainStatus): Promise<SkillChain | null> {
    return this.update(id, { status });
  }

  async delete(id: string): Promise<boolean> {
    try {
      await prisma.skillChain.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  async calculateEstimatedDuration(id: string): Promise<number> {
    const chain = await this.findById(id);
    if (!chain) return 0;

    let totalDuration = 0;
    for (const step of chain.steps) {
      if (step.skill) {
        totalDuration += step.timeoutOverride ?? step.skill.timeout ?? 60;
      }
    }
    return totalDuration;
  }

  private buildWhereClause(params?: SkillChainQueryParams): Record<string, unknown> {
    if (!params) return {};

    const where: Record<string, unknown> = {};

    if (params.name) {
      where.name = { contains: params.name, mode: 'insensitive' };
    }

    if (params.status) {
      where.status = Array.isArray(params.status) ? { in: params.status } : params.status;
    }

    return where;
  }
}

// ============================================================================
// SINGLETON INSTANCES
// ============================================================================

export const robotTypeRepository = new RobotTypeRepository();
export const skillDefinitionRepository = new SkillDefinitionRepository();
export const datasetRepository = new DatasetRepository();
export const trainingJobRepository = new TrainingJobRepository();
export const modelVersionRepository = new ModelVersionRepository();
export const deploymentRepository = new DeploymentRepository();
export const skillChainRepository = new SkillChainRepository();
