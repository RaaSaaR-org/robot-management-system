/**
 * @file ProcessRepository.ts
 * @description Data access layer for Process, ProcessInstance, and StepInstance entities
 * @feature processes
 */

import { prisma } from '../database/index.js';
import {
  dbProcessDefinitionToDomain,
  dbProcessInstanceToDomain,
  dbStepInstanceToDomain,
  domainStepInstanceToDb,
} from '../database/types.js';
import type {
  ProcessDefinition,
  ProcessDefinitionStatus,
  ProcessInstance,
  ProcessInstanceStatus,
  StepInstance,
  StepInstanceStatus,
  StepTemplate,
  Priority,
  ProcessListFilters,
  ProcessInstanceListFilters,
  PaginationParams,
  PaginatedResponse,
  CreateProcessDefinitionRequest,
  UpdateProcessDefinitionRequest,
  StartProcessRequest,
  StepResult,
} from '../types/process.types.js';
import { v4 as uuidv4 } from 'uuid';

export class ProcessRepository {
  // ============================================================================
  // PROCESS DEFINITION METHODS
  // ============================================================================

  /**
   * Find a process definition by ID
   */
  async findDefinitionById(id: string): Promise<ProcessDefinition | null> {
    const process = await prisma.processDefinition.findUnique({
      where: { id },
    });
    return process ? dbProcessDefinitionToDomain(process) : null;
  }

  /**
   * Find all process definitions with optional filters and pagination
   */
  async findAllDefinitions(
    filters?: ProcessListFilters,
    pagination?: PaginationParams
  ): Promise<PaginatedResponse<ProcessDefinition>> {
    const page = pagination?.page ?? 1;
    const limit = pagination?.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (filters?.status) {
      where.status = filters.status;
    }
    if (filters?.search) {
      where.OR = [
        { name: { contains: filters.search } },
        { description: { contains: filters.search } },
      ];
    }
    if (filters?.tags && filters.tags.length > 0) {
      // SQLite doesn't support array contains, so we check if tags JSON contains any of the filter tags
      // This is a simplified approach - for production, consider a join table
      where.tags = { contains: filters.tags[0] };
    }

    const [total, definitions] = await Promise.all([
      prisma.processDefinition.count({ where }),
      prisma.processDefinition.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [pagination?.sortBy ?? 'updatedAt']: pagination?.sortOrder ?? 'desc' },
      }),
    ]);

    return {
      data: definitions.map(dbProcessDefinitionToDomain),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Create a new process definition
   */
  async createDefinition(
    data: CreateProcessDefinitionRequest,
    createdBy: string
  ): Promise<ProcessDefinition> {
    const id = uuidv4();
    const stepTemplates: StepTemplate[] = data.stepTemplates.map((st, index) => ({
      ...st,
      id: uuidv4(),
      order: index,
    }));

    const process = await prisma.processDefinition.create({
      data: {
        id,
        name: data.name,
        description: data.description,
        version: 1,
        status: 'draft',
        stepTemplates: JSON.stringify(stepTemplates),
        requiredCapabilities: JSON.stringify(data.requiredCapabilities ?? []),
        estimatedDurationMinutes: data.estimatedDurationMinutes,
        maxConcurrentInstances: data.maxConcurrentInstances,
        tags: JSON.stringify(data.tags ?? []),
        createdBy,
      },
    });

    return dbProcessDefinitionToDomain(process);
  }

  /**
   * Update a process definition
   */
  async updateDefinition(
    id: string,
    data: UpdateProcessDefinitionRequest
  ): Promise<ProcessDefinition | null> {
    try {
      const existing = await prisma.processDefinition.findUnique({ where: { id } });
      if (!existing) return null;

      const updateData: Record<string, unknown> = {};
      if (data.name !== undefined) updateData.name = data.name;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.status !== undefined) updateData.status = data.status;
      if (data.estimatedDurationMinutes !== undefined)
        updateData.estimatedDurationMinutes = data.estimatedDurationMinutes;
      if (data.maxConcurrentInstances !== undefined)
        updateData.maxConcurrentInstances = data.maxConcurrentInstances;
      if (data.requiredCapabilities !== undefined)
        updateData.requiredCapabilities = JSON.stringify(data.requiredCapabilities);
      if (data.tags !== undefined) updateData.tags = JSON.stringify(data.tags);
      if (data.stepTemplates !== undefined) {
        const stepTemplates: StepTemplate[] = data.stepTemplates.map((st, index) => ({
          ...st,
          id: uuidv4(),
          order: index,
        }));
        updateData.stepTemplates = JSON.stringify(stepTemplates);
        updateData.version = existing.version + 1;
      }

      const updated = await prisma.processDefinition.update({
        where: { id },
        data: updateData,
      });

      return dbProcessDefinitionToDomain(updated);
    } catch {
      return null;
    }
  }

  /**
   * Delete a process definition (archive it)
   */
  async deleteDefinition(id: string): Promise<boolean> {
    try {
      await prisma.processDefinition.update({
        where: { id },
        data: { status: 'archived' },
      });
      return true;
    } catch {
      return false;
    }
  }

  // ============================================================================
  // PROCESS INSTANCE METHODS
  // ============================================================================

  /**
   * Find a process instance by ID
   */
  async findInstanceById(id: string): Promise<ProcessInstance | null> {
    const instance = await prisma.processInstance.findUnique({
      where: { id },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
    return instance ? dbProcessInstanceToDomain(instance) : null;
  }

  /**
   * Find all process instances with optional filters and pagination
   */
  async findAllInstances(
    filters?: ProcessInstanceListFilters,
    pagination?: PaginationParams
  ): Promise<PaginatedResponse<ProcessInstance>> {
    const page = pagination?.page ?? 1;
    const limit = pagination?.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (filters?.status) {
      where.status = Array.isArray(filters.status) ? { in: filters.status } : filters.status;
    }
    if (filters?.priority) {
      where.priority = Array.isArray(filters.priority) ? { in: filters.priority } : filters.priority;
    }
    if (filters?.processDefinitionId) {
      where.processDefinitionId = filters.processDefinitionId;
    }
    if (filters?.createdBy) {
      where.createdBy = filters.createdBy;
    }
    if (filters?.dateRange) {
      where.createdAt = {
        gte: new Date(filters.dateRange.start),
        lte: new Date(filters.dateRange.end),
      };
    }
    if (filters?.robotId) {
      where.assignedRobotIds = { contains: filters.robotId };
    }

    const [total, instances] = await Promise.all([
      prisma.processInstance.count({ where }),
      prisma.processInstance.findMany({
        where,
        include: { steps: { orderBy: { order: 'asc' } } },
        skip,
        take: limit,
        orderBy: { [pagination?.sortBy ?? 'createdAt']: pagination?.sortOrder ?? 'desc' },
      }),
    ]);

    return {
      data: instances.map(dbProcessInstanceToDomain),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Create a new process instance from a definition
   */
  async createInstance(
    definitionId: string,
    request: StartProcessRequest,
    createdBy: string
  ): Promise<ProcessInstance | null> {
    const definition = await this.findDefinitionById(definitionId);
    if (!definition || definition.status !== 'ready') {
      return null;
    }

    const instanceId = uuidv4();
    const now = new Date().toISOString();

    // Create step instances from templates
    const stepInstances: StepInstance[] = definition.stepTemplates.map((template) => ({
      id: uuidv4(),
      processInstanceId: instanceId,
      stepTemplateId: template.id,
      order: template.order,
      name: template.name,
      description: template.description,
      actionType: template.actionType,
      actionConfig: template.actionConfig,
      status: 'pending' as StepInstanceStatus,
      retryCount: 0,
      maxRetries: 3,
    }));

    const instance = await prisma.processInstance.create({
      data: {
        id: instanceId,
        processDefinitionId: definitionId,
        processName: definition.name,
        description: definition.description,
        status: 'pending',
        priority: request.priority ?? 'normal',
        currentStepIndex: 0,
        progress: 0,
        preferredRobotIds: JSON.stringify(request.preferredRobotIds ?? []),
        assignedRobotIds: JSON.stringify([]),
        scheduledAt: request.scheduledAt ? new Date(request.scheduledAt) : undefined,
        inputData: request.inputData ? JSON.stringify(request.inputData) : undefined,
        createdBy,
        steps: {
          create: stepInstances.map((s) => {
            const dbStep = domainStepInstanceToDb(s);
            // Remove id from create since Prisma will generate it
            const { id, processInstanceId, ...rest } = dbStep;
            return { id, ...rest };
          }),
        },
      },
      include: { steps: { orderBy: { order: 'asc' } } },
    });

    return dbProcessInstanceToDomain(instance);
  }

  /**
   * Update process instance status
   */
  async updateInstanceStatus(
    id: string,
    status: ProcessInstanceStatus,
    errorMessage?: string
  ): Promise<ProcessInstance | null> {
    try {
      const updateData: Record<string, unknown> = { status };

      if (status === 'in_progress') {
        updateData.startedAt = new Date();
      } else if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        updateData.completedAt = new Date();
      }
      if (errorMessage !== undefined) {
        updateData.errorMessage = errorMessage;
      }

      const updated = await prisma.processInstance.update({
        where: { id },
        data: updateData,
        include: { steps: { orderBy: { order: 'asc' } } },
      });

      return dbProcessInstanceToDomain(updated);
    } catch {
      return null;
    }
  }

  /**
   * Update process instance progress
   */
  async updateInstanceProgress(
    id: string,
    progress: number,
    currentStepIndex?: number
  ): Promise<boolean> {
    try {
      const updateData: Record<string, unknown> = { progress };
      if (currentStepIndex !== undefined) {
        updateData.currentStepIndex = currentStepIndex;
      }

      await prisma.processInstance.update({
        where: { id },
        data: updateData,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Add assigned robot to instance
   */
  async addAssignedRobot(id: string, robotId: string): Promise<boolean> {
    try {
      const instance = await prisma.processInstance.findUnique({ where: { id } });
      if (!instance) return false;

      const assignedRobots: string[] = JSON.parse(instance.assignedRobotIds);
      if (!assignedRobots.includes(robotId)) {
        assignedRobots.push(robotId);
        await prisma.processInstance.update({
          where: { id },
          data: { assignedRobotIds: JSON.stringify(assignedRobots) },
        });
      }
      return true;
    } catch {
      return false;
    }
  }

  // ============================================================================
  // STEP INSTANCE METHODS
  // ============================================================================

  /**
   * Find a step instance by ID
   */
  async findStepById(id: string): Promise<StepInstance | null> {
    const step = await prisma.stepInstance.findUnique({ where: { id } });
    return step ? dbStepInstanceToDomain(step) : null;
  }

  /**
   * Find steps by process instance ID
   */
  async findStepsByInstanceId(processInstanceId: string): Promise<StepInstance[]> {
    const steps = await prisma.stepInstance.findMany({
      where: { processInstanceId },
      orderBy: { order: 'asc' },
    });
    return steps.map(dbStepInstanceToDomain);
  }

  /**
   * Update step instance status
   */
  async updateStepStatus(
    id: string,
    status: StepInstanceStatus,
    assignedRobotId?: string,
    error?: string
  ): Promise<StepInstance | null> {
    try {
      const updateData: Record<string, unknown> = { status };

      if (status === 'in_progress') {
        updateData.startedAt = new Date();
      } else if (status === 'completed' || status === 'failed' || status === 'skipped') {
        updateData.completedAt = new Date();
      }
      if (assignedRobotId !== undefined) {
        updateData.assignedRobotId = assignedRobotId;
      }
      if (error !== undefined) {
        updateData.error = error;
      }

      const updated = await prisma.stepInstance.update({
        where: { id },
        data: updateData,
      });

      return dbStepInstanceToDomain(updated);
    } catch {
      return null;
    }
  }

  /**
   * Update step instance result
   */
  async updateStepResult(id: string, result: StepResult): Promise<boolean> {
    try {
      await prisma.stepInstance.update({
        where: { id },
        data: {
          result: JSON.stringify(result),
          status: result.success ? 'completed' : 'failed',
          completedAt: new Date(),
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Increment step retry count
   */
  async incrementStepRetry(id: string): Promise<number> {
    try {
      const updated = await prisma.stepInstance.update({
        where: { id },
        data: { retryCount: { increment: 1 }, status: 'pending' },
      });
      return updated.retryCount;
    } catch {
      return -1;
    }
  }

  /**
   * Get the next pending step for a process instance
   */
  async getNextPendingStep(processInstanceId: string): Promise<StepInstance | null> {
    const step = await prisma.stepInstance.findFirst({
      where: { processInstanceId, status: 'pending' },
      orderBy: { order: 'asc' },
    });
    return step ? dbStepInstanceToDomain(step) : null;
  }

  /**
   * Count steps by status for a process instance
   */
  async countStepsByStatus(processInstanceId: string): Promise<Record<StepInstanceStatus, number>> {
    const steps = await prisma.stepInstance.findMany({
      where: { processInstanceId },
      select: { status: true },
    });

    const counts: Record<StepInstanceStatus, number> = {
      pending: 0,
      queued: 0,
      in_progress: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      cancelled: 0,
    };

    for (const step of steps) {
      counts[step.status as StepInstanceStatus]++;
    }

    return counts;
  }

  // ============================================================================
  // STEP REASSIGNMENT METHODS
  // ============================================================================

  /**
   * Add a robot to the step's failed robots list
   */
  async addFailedRobotToStep(stepId: string, robotId: string): Promise<boolean> {
    try {
      const step = await prisma.stepInstance.findUnique({ where: { id: stepId } });
      if (!step) return false;

      const failedRobotIds: string[] = JSON.parse(step.failedRobotIds || '[]');
      if (!failedRobotIds.includes(robotId)) {
        failedRobotIds.push(robotId);
        await prisma.stepInstance.update({
          where: { id: stepId },
          data: { failedRobotIds: JSON.stringify(failedRobotIds) },
        });
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Reset step retry count (for reassignment to new robot)
   */
  async resetStepRetryCount(stepId: string): Promise<boolean> {
    try {
      await prisma.stepInstance.update({
        where: { id: stepId },
        data: { retryCount: 0, status: 'pending' },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get failed robot IDs for a step
   */
  async getStepFailedRobotIds(stepId: string): Promise<string[]> {
    const step = await prisma.stepInstance.findUnique({ where: { id: stepId } });
    if (!step) return [];
    return JSON.parse(step.failedRobotIds || '[]');
  }

  /**
   * Clear failed robot IDs for a step (for retry)
   */
  async clearStepFailedRobots(stepId: string): Promise<boolean> {
    try {
      await prisma.stepInstance.update({
        where: { id: stepId },
        data: { failedRobotIds: '[]', error: null },
      });
      return true;
    } catch {
      return false;
    }
  }
}

export const processRepository = new ProcessRepository();
