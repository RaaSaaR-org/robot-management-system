/**
 * @file ProcessRepository.test.ts
 * @description Unit tests for ProcessRepository — Prisma-backed CRUD for process definitions,
 *              instances, and step instances, with the real domain<->db mappers running live.
 * @feature processes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock for the Prisma singleton (the I/O boundary).
// Mappers from ../../database/types.js are NOT mocked — they run for real.
// ---------------------------------------------------------------------------

type MockModel = {
  findUnique: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
};

const { mockPrisma } = vi.hoisted(() => {
  const model = (): MockModel => ({
    findUnique: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  });
  return {
    mockPrisma: {
      processDefinition: model(),
      processInstance: model(),
      stepInstance: model(),
    } as {
      processDefinition: MockModel;
      processInstance: MockModel;
      stepInstance: MockModel;
    },
  };
});

vi.mock('../../database/index.js', () => ({
  prisma: mockPrisma,
}));

import { ProcessRepository, processRepository } from '../ProcessRepository.js';
import type {
  CreateProcessDefinitionRequest,
  StartProcessRequest,
  StepResult,
} from '../../types/process.types.js';

// ---------------------------------------------------------------------------
// Fixtures — db-row shapes that the real mappers accept
// ---------------------------------------------------------------------------

const NOW = new Date('2026-01-01T00:00:00.000Z');

function makeDbDefinition(overrides: Record<string, unknown> = {}) {
  return {
    id: 'def-1',
    name: 'Pick and place',
    description: 'A demo process',
    version: 1,
    status: 'ready',
    stepTemplates: JSON.stringify([
      {
        id: 'tmpl-1',
        order: 0,
        name: 'Move',
        description: 'go there',
        actionType: 'move_to_location',
        actionConfig: { location: 'A' },
      },
    ]),
    requiredCapabilities: JSON.stringify(['nav']),
    estimatedDurationMinutes: 10,
    maxConcurrentInstances: 2,
    tags: JSON.stringify(['demo']),
    triggerType: 'manual',
    cronExpression: null,
    enabled: true,
    nextRunAt: null,
    lastScheduledRunAt: null,
    createdBy: 'user-1',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeDbStep(overrides: Record<string, unknown> = {}) {
  return {
    id: 'step-1',
    processInstanceId: 'inst-1',
    stepTemplateId: 'tmpl-1',
    order: 0,
    name: 'Move',
    description: 'go there',
    actionType: 'move_to_location',
    actionConfig: JSON.stringify({ location: 'A' }),
    status: 'pending',
    assignedRobotId: null,
    startedAt: null,
    completedAt: null,
    result: null,
    error: null,
    retryCount: 0,
    maxRetries: 3,
    failedRobotIds: JSON.stringify([]),
    ...overrides,
  };
}

function makeDbInstance(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inst-1',
    processDefinitionId: 'def-1',
    processName: 'Pick and place',
    description: 'A demo process',
    status: 'pending',
    priority: 'normal',
    currentStepIndex: 0,
    progress: 0,
    preferredRobotIds: JSON.stringify(['robot-a']),
    assignedRobotIds: JSON.stringify([]),
    scheduledAt: null,
    startedAt: null,
    completedAt: null,
    estimatedCompletionAt: null,
    inputData: null,
    outputData: null,
    errorMessage: null,
    createdBy: 'user-1',
    createdAt: NOW,
    updatedAt: NOW,
    steps: [makeDbStep()],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// PROCESS DEFINITION METHODS
// ===========================================================================

describe('ProcessRepository — process definitions', () => {
  describe('findDefinitionById', () => {
    it('returns mapped definition on hit', async () => {
      mockPrisma.processDefinition.findUnique.mockResolvedValue(makeDbDefinition());

      const result = await processRepository.findDefinitionById('def-1');

      expect(mockPrisma.processDefinition.findUnique).toHaveBeenCalledWith({
        where: { id: 'def-1' },
      });
      expect(result).not.toBeNull();
      expect(result?.id).toBe('def-1');
      expect(result?.stepTemplates).toHaveLength(1);
      expect(result?.requiredCapabilities).toEqual(['nav']);
      expect(result?.tags).toEqual(['demo']);
      expect(result?.createdAt).toBe(NOW.toISOString());
    });

    it('returns null when prisma returns null', async () => {
      mockPrisma.processDefinition.findUnique.mockResolvedValue(null);
      const result = await processRepository.findDefinitionById('nope');
      expect(result).toBeNull();
    });
  });

  describe('findAllDefinitions', () => {
    it('applies filters, pagination, orderBy and maps results', async () => {
      mockPrisma.processDefinition.count.mockResolvedValue(1);
      mockPrisma.processDefinition.findMany.mockResolvedValue([makeDbDefinition()]);

      const result = await processRepository.findAllDefinitions(
        { status: 'ready', search: 'pick', tags: ['demo', 'extra'] },
        { page: 2, limit: 5, sortBy: 'name', sortOrder: 'asc' }
      );

      const expectedWhere = {
        status: 'ready',
        OR: [{ name: { contains: 'pick' } }, { description: { contains: 'pick' } }],
        tags: { contains: 'demo' },
      };
      expect(mockPrisma.processDefinition.count).toHaveBeenCalledWith({ where: expectedWhere });
      expect(mockPrisma.processDefinition.findMany).toHaveBeenCalledWith({
        where: expectedWhere,
        skip: 5,
        take: 5,
        orderBy: { name: 'asc' },
      });
      expect(result.data).toHaveLength(1);
      expect(result.pagination).toEqual({ page: 2, limit: 5, total: 1, totalPages: 1 });
    });

    it('uses defaults (page 1, limit 20, updatedAt desc) and empty where', async () => {
      mockPrisma.processDefinition.count.mockResolvedValue(0);
      mockPrisma.processDefinition.findMany.mockResolvedValue([]);

      const result = await processRepository.findAllDefinitions();

      expect(mockPrisma.processDefinition.findMany).toHaveBeenCalledWith({
        where: {},
        skip: 0,
        take: 20,
        orderBy: { updatedAt: 'desc' },
      });
      expect(result.data).toEqual([]);
      expect(result.pagination).toEqual({ page: 1, limit: 20, total: 0, totalPages: 0 });
    });
  });

  describe('createDefinition', () => {
    it('creates with serialized JSON fields, version 1, draft status and generated ids', async () => {
      mockPrisma.processDefinition.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
        makeDbDefinition({ ...data })
      );

      const req: CreateProcessDefinitionRequest = {
        name: 'New process',
        description: 'desc',
        stepTemplates: [
          {
            order: 0,
            name: 'Step A',
            actionType: 'wait',
            actionConfig: { ms: 100 },
          },
          {
            order: 1,
            name: 'Step B',
            actionType: 'inspect',
            actionConfig: {},
          },
        ],
        requiredCapabilities: ['cap1'],
        estimatedDurationMinutes: 30,
        maxConcurrentInstances: 1,
        tags: ['t1'],
        triggerType: 'scheduled',
        cronExpression: '* * * * *',
        enabled: false,
      };

      const result = await processRepository.createDefinition(req, 'creator-1');

      expect(mockPrisma.processDefinition.create).toHaveBeenCalledTimes(1);
      const arg = mockPrisma.processDefinition.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(arg.data.name).toBe('New process');
      expect(arg.data.version).toBe(1);
      expect(arg.data.status).toBe('draft');
      expect(arg.data.createdBy).toBe('creator-1');
      expect(arg.data.triggerType).toBe('scheduled');
      expect(arg.data.cronExpression).toBe('* * * * *');
      expect(arg.data.enabled).toBe(false);
      expect(arg.data.requiredCapabilities).toBe(JSON.stringify(['cap1']));
      expect(arg.data.tags).toBe(JSON.stringify(['t1']));

      // step templates serialized with order + generated ids
      const stepTemplates = JSON.parse(arg.data.stepTemplates as string);
      expect(stepTemplates).toHaveLength(2);
      expect(stepTemplates[0].order).toBe(0);
      expect(stepTemplates[1].order).toBe(1);
      expect(typeof stepTemplates[0].id).toBe('string');
      expect(stepTemplates[0].id).not.toBe(stepTemplates[1].id);

      expect(result.name).toBeDefined();
    });

    it('applies defaults for optional fields', async () => {
      mockPrisma.processDefinition.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
        makeDbDefinition({ ...data })
      );

      await processRepository.createDefinition(
        { name: 'Minimal', stepTemplates: [] },
        'creator-1'
      );

      const arg = mockPrisma.processDefinition.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(arg.data.requiredCapabilities).toBe(JSON.stringify([]));
      expect(arg.data.tags).toBe(JSON.stringify([]));
      expect(arg.data.triggerType).toBe('manual');
      expect(arg.data.cronExpression).toBeNull();
      expect(arg.data.enabled).toBe(true);
    });
  });

  describe('updateSchedule', () => {
    it('only writes defined fields', async () => {
      mockPrisma.processDefinition.update.mockResolvedValue(makeDbDefinition({ enabled: false }));

      const result = await processRepository.updateSchedule(
        'def-1',
        'scheduled',
        '0 0 * * *',
        undefined,
        NOW
      );

      expect(mockPrisma.processDefinition.update).toHaveBeenCalledWith({
        where: { id: 'def-1' },
        data: { triggerType: 'scheduled', cronExpression: '0 0 * * *', nextRunAt: NOW },
      });
      expect(result?.id).toBe('def-1');
    });

    it('allows null cronExpression / nextRunAt to be written', async () => {
      mockPrisma.processDefinition.update.mockResolvedValue(makeDbDefinition());

      await processRepository.updateSchedule('def-1', undefined, null, true, null);

      expect(mockPrisma.processDefinition.update).toHaveBeenCalledWith({
        where: { id: 'def-1' },
        data: { cronExpression: null, enabled: true, nextRunAt: null },
      });
    });

    it('returns null when prisma throws', async () => {
      mockPrisma.processDefinition.update.mockRejectedValue(new Error('not found'));
      const result = await processRepository.updateSchedule('x', 'manual', null, true, null);
      expect(result).toBeNull();
    });
  });

  describe('findSchedulableDefinitions', () => {
    it('queries enabled scheduled ready defs with cron set', async () => {
      mockPrisma.processDefinition.findMany.mockResolvedValue([
        makeDbDefinition({ triggerType: 'scheduled', cronExpression: '* * * * *' }),
      ]);

      const result = await processRepository.findSchedulableDefinitions();

      expect(mockPrisma.processDefinition.findMany).toHaveBeenCalledWith({
        where: {
          triggerType: 'scheduled',
          enabled: true,
          status: 'ready',
          cronExpression: { not: null },
        },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('recordScheduledRun', () => {
    it('updates lastScheduledRunAt and nextRunAt', async () => {
      mockPrisma.processDefinition.update.mockResolvedValue(makeDbDefinition());
      const next = new Date('2026-02-01T00:00:00.000Z');

      await processRepository.recordScheduledRun('def-1', NOW, next);

      expect(mockPrisma.processDefinition.update).toHaveBeenCalledWith({
        where: { id: 'def-1' },
        data: { lastScheduledRunAt: NOW, nextRunAt: next },
      });
    });
  });

  describe('updateDefinition', () => {
    it('returns null when definition does not exist', async () => {
      mockPrisma.processDefinition.findUnique.mockResolvedValue(null);
      const result = await processRepository.updateDefinition('nope', { name: 'x' });
      expect(result).toBeNull();
      expect(mockPrisma.processDefinition.update).not.toHaveBeenCalled();
    });

    it('updates scalar + JSON fields and bumps version when stepTemplates change', async () => {
      mockPrisma.processDefinition.findUnique.mockResolvedValue(makeDbDefinition({ version: 3 }));
      mockPrisma.processDefinition.update.mockResolvedValue(makeDbDefinition({ version: 4 }));

      const result = await processRepository.updateDefinition('def-1', {
        name: 'Renamed',
        requiredCapabilities: ['c2'],
        tags: ['tag2'],
        stepTemplates: [{ order: 0, name: 'S1', actionType: 'wait', actionConfig: {} }],
      });

      const arg = mockPrisma.processDefinition.update.mock.calls[0][0] as {
        where: { id: string };
        data: Record<string, unknown>;
      };
      expect(arg.where).toEqual({ id: 'def-1' });
      expect(arg.data.name).toBe('Renamed');
      expect(arg.data.requiredCapabilities).toBe(JSON.stringify(['c2']));
      expect(arg.data.tags).toBe(JSON.stringify(['tag2']));
      expect(arg.data.version).toBe(4); // existing.version (3) + 1
      const tmpls = JSON.parse(arg.data.stepTemplates as string);
      expect(tmpls[0].order).toBe(0);
      expect(result?.version).toBe(4);
    });

    it('does not bump version when stepTemplates omitted', async () => {
      mockPrisma.processDefinition.findUnique.mockResolvedValue(makeDbDefinition({ version: 5 }));
      mockPrisma.processDefinition.update.mockResolvedValue(makeDbDefinition({ version: 5 }));

      await processRepository.updateDefinition('def-1', { status: 'ready' });

      const arg = mockPrisma.processDefinition.update.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(arg.data).not.toHaveProperty('version');
      expect(arg.data.status).toBe('ready');
    });

    it('returns null when update throws', async () => {
      mockPrisma.processDefinition.findUnique.mockResolvedValue(makeDbDefinition());
      mockPrisma.processDefinition.update.mockRejectedValue(new Error('db'));
      const result = await processRepository.updateDefinition('def-1', { name: 'x' });
      expect(result).toBeNull();
    });
  });

  describe('deleteDefinition', () => {
    it('archives and returns true', async () => {
      mockPrisma.processDefinition.update.mockResolvedValue(makeDbDefinition({ status: 'archived' }));
      const ok = await processRepository.deleteDefinition('def-1');
      expect(ok).toBe(true);
      expect(mockPrisma.processDefinition.update).toHaveBeenCalledWith({
        where: { id: 'def-1' },
        data: { status: 'archived' },
      });
    });

    it('returns false when prisma throws', async () => {
      mockPrisma.processDefinition.update.mockRejectedValue(new Error('missing'));
      const ok = await processRepository.deleteDefinition('nope');
      expect(ok).toBe(false);
    });
  });
});

// ===========================================================================
// PROCESS INSTANCE METHODS
// ===========================================================================

describe('ProcessRepository — process instances', () => {
  describe('findInstanceById', () => {
    it('includes ordered steps and maps the instance', async () => {
      mockPrisma.processInstance.findUnique.mockResolvedValue(makeDbInstance());

      const result = await processRepository.findInstanceById('inst-1');

      expect(mockPrisma.processInstance.findUnique).toHaveBeenCalledWith({
        where: { id: 'inst-1' },
        include: { steps: { orderBy: { order: 'asc' } } },
      });
      expect(result?.id).toBe('inst-1');
      expect(result?.steps).toHaveLength(1);
      expect(result?.preferredRobotIds).toEqual(['robot-a']);
    });

    it('returns null when not found', async () => {
      mockPrisma.processInstance.findUnique.mockResolvedValue(null);
      expect(await processRepository.findInstanceById('x')).toBeNull();
    });
  });

  describe('findAllInstances', () => {
    it('builds where with array in-clauses, dateRange and robotId contains', async () => {
      mockPrisma.processInstance.count.mockResolvedValue(1);
      mockPrisma.processInstance.findMany.mockResolvedValue([makeDbInstance()]);

      const result = await processRepository.findAllInstances(
        {
          status: ['pending', 'queued'],
          priority: 'high',
          processDefinitionId: 'def-1',
          createdBy: 'user-1',
          dateRange: { start: '2026-01-01', end: '2026-02-01' },
          robotId: 'robot-a',
        },
        { page: 1, limit: 10 }
      );

      const arg = mockPrisma.processInstance.findMany.mock.calls[0][0] as {
        where: Record<string, unknown>;
        include: unknown;
        skip: number;
        take: number;
        orderBy: unknown;
      };
      expect(arg.where.status).toEqual({ in: ['pending', 'queued'] });
      expect(arg.where.priority).toBe('high');
      expect(arg.where.processDefinitionId).toBe('def-1');
      expect(arg.where.createdBy).toBe('user-1');
      expect(arg.where.createdAt).toEqual({
        gte: new Date('2026-01-01'),
        lte: new Date('2026-02-01'),
      });
      expect(arg.where.assignedRobotIds).toEqual({ contains: 'robot-a' });
      expect(arg.include).toEqual({ steps: { orderBy: { order: 'asc' } } });
      expect(arg.skip).toBe(0);
      expect(arg.take).toBe(10);
      expect(arg.orderBy).toEqual({ createdAt: 'desc' });
      expect(result.data).toHaveLength(1);
    });

    it('defaults to empty where and createdAt desc', async () => {
      mockPrisma.processInstance.count.mockResolvedValue(0);
      mockPrisma.processInstance.findMany.mockResolvedValue([]);

      await processRepository.findAllInstances();

      const arg = mockPrisma.processInstance.findMany.mock.calls[0][0] as {
        where: Record<string, unknown>;
        orderBy: unknown;
      };
      expect(arg.where).toEqual({});
      expect(arg.orderBy).toEqual({ createdAt: 'desc' });
    });
  });

  describe('createInstance', () => {
    it('returns null when definition missing or not ready', async () => {
      mockPrisma.processDefinition.findUnique.mockResolvedValue(makeDbDefinition({ status: 'draft' }));
      const result = await processRepository.createInstance('def-1', {}, 'user-1');
      expect(result).toBeNull();
      expect(mockPrisma.processInstance.create).not.toHaveBeenCalled();
    });

    it('creates instance + nested steps from a ready definition', async () => {
      mockPrisma.processDefinition.findUnique.mockResolvedValue(makeDbDefinition({ status: 'ready' }));
      mockPrisma.processInstance.create.mockResolvedValue(makeDbInstance());

      const req: StartProcessRequest = {
        priority: 'high',
        preferredRobotIds: ['robot-a'],
        scheduledAt: '2026-03-01T00:00:00.000Z',
        inputData: { foo: 'bar' },
      };

      const result = await processRepository.createInstance('def-1', req, 'user-1');

      const arg = mockPrisma.processInstance.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
        include: unknown;
      };
      expect(arg.data.processDefinitionId).toBe('def-1');
      expect(arg.data.processName).toBe('Pick and place');
      expect(arg.data.status).toBe('pending');
      expect(arg.data.priority).toBe('high');
      expect(arg.data.preferredRobotIds).toBe(JSON.stringify(['robot-a']));
      expect(arg.data.assignedRobotIds).toBe(JSON.stringify([]));
      expect(arg.data.scheduledAt).toEqual(new Date('2026-03-01T00:00:00.000Z'));
      expect(arg.data.inputData).toBe(JSON.stringify({ foo: 'bar' }));
      expect(arg.data.createdBy).toBe('user-1');

      const stepsCreate = (arg.data.steps as { create: Array<Record<string, unknown>> }).create;
      expect(stepsCreate).toHaveLength(1);
      // processInstanceId is stripped from the nested create payload
      expect(stepsCreate[0]).not.toHaveProperty('processInstanceId');
      expect(stepsCreate[0].status).toBe('pending');
      expect(typeof stepsCreate[0].id).toBe('string');

      expect(arg.include).toEqual({ steps: { orderBy: { order: 'asc' } } });
      expect(result?.id).toBe('inst-1');
    });

    it('uses defaults for priority and omits optional fields', async () => {
      mockPrisma.processDefinition.findUnique.mockResolvedValue(makeDbDefinition({ status: 'ready' }));
      mockPrisma.processInstance.create.mockResolvedValue(makeDbInstance());

      await processRepository.createInstance('def-1', {}, 'user-1');

      const arg = mockPrisma.processInstance.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(arg.data.priority).toBe('normal');
      expect(arg.data.preferredRobotIds).toBe(JSON.stringify([]));
      expect(arg.data.scheduledAt).toBeUndefined();
      expect(arg.data.inputData).toBeUndefined();
    });
  });

  describe('updateInstanceStatus', () => {
    it('sets startedAt for in_progress', async () => {
      mockPrisma.processInstance.update.mockResolvedValue(makeDbInstance({ status: 'in_progress' }));
      const result = await processRepository.updateInstanceStatus('inst-1', 'in_progress');

      const arg = mockPrisma.processInstance.update.mock.calls[0][0] as {
        where: unknown;
        data: Record<string, unknown>;
        include: unknown;
      };
      expect(arg.where).toEqual({ id: 'inst-1' });
      expect(arg.data.status).toBe('in_progress');
      expect(arg.data.startedAt).toBeInstanceOf(Date);
      expect(arg.data).not.toHaveProperty('completedAt');
      expect(arg.include).toEqual({ steps: { orderBy: { order: 'asc' } } });
      expect(result?.id).toBe('inst-1');
    });

    it('sets completedAt and errorMessage for failed', async () => {
      mockPrisma.processInstance.update.mockResolvedValue(makeDbInstance({ status: 'failed' }));
      await processRepository.updateInstanceStatus('inst-1', 'failed', 'boom');

      const arg = mockPrisma.processInstance.update.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(arg.data.completedAt).toBeInstanceOf(Date);
      expect(arg.data.errorMessage).toBe('boom');
      expect(arg.data).not.toHaveProperty('startedAt');
    });

    it('returns null on throw', async () => {
      mockPrisma.processInstance.update.mockRejectedValue(new Error('db'));
      expect(await processRepository.updateInstanceStatus('x', 'completed')).toBeNull();
    });
  });

  describe('updateInstanceProgress', () => {
    it('updates progress and optional currentStepIndex, returns true', async () => {
      mockPrisma.processInstance.update.mockResolvedValue(makeDbInstance());
      const ok = await processRepository.updateInstanceProgress('inst-1', 50, 2);
      expect(ok).toBe(true);
      expect(mockPrisma.processInstance.update).toHaveBeenCalledWith({
        where: { id: 'inst-1' },
        data: { progress: 50, currentStepIndex: 2 },
      });
    });

    it('omits currentStepIndex when undefined', async () => {
      mockPrisma.processInstance.update.mockResolvedValue(makeDbInstance());
      await processRepository.updateInstanceProgress('inst-1', 10);
      const arg = mockPrisma.processInstance.update.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(arg.data).toEqual({ progress: 10 });
    });

    it('returns false on throw', async () => {
      mockPrisma.processInstance.update.mockRejectedValue(new Error('db'));
      expect(await processRepository.updateInstanceProgress('x', 1)).toBe(false);
    });
  });

  describe('addAssignedRobot', () => {
    it('returns false when instance missing', async () => {
      mockPrisma.processInstance.findUnique.mockResolvedValue(null);
      expect(await processRepository.addAssignedRobot('x', 'robot-a')).toBe(false);
      expect(mockPrisma.processInstance.update).not.toHaveBeenCalled();
    });

    it('appends robot and persists when not already present', async () => {
      mockPrisma.processInstance.findUnique.mockResolvedValue(
        makeDbInstance({ assignedRobotIds: JSON.stringify(['robot-x']) })
      );
      mockPrisma.processInstance.update.mockResolvedValue(makeDbInstance());

      const ok = await processRepository.addAssignedRobot('inst-1', 'robot-a');
      expect(ok).toBe(true);
      expect(mockPrisma.processInstance.update).toHaveBeenCalledWith({
        where: { id: 'inst-1' },
        data: { assignedRobotIds: JSON.stringify(['robot-x', 'robot-a']) },
      });
    });

    it('does not update when robot already assigned but still returns true', async () => {
      mockPrisma.processInstance.findUnique.mockResolvedValue(
        makeDbInstance({ assignedRobotIds: JSON.stringify(['robot-a']) })
      );
      const ok = await processRepository.addAssignedRobot('inst-1', 'robot-a');
      expect(ok).toBe(true);
      expect(mockPrisma.processInstance.update).not.toHaveBeenCalled();
    });

    it('returns false on throw', async () => {
      mockPrisma.processInstance.findUnique.mockRejectedValue(new Error('db'));
      expect(await processRepository.addAssignedRobot('x', 'r')).toBe(false);
    });
  });
});

// ===========================================================================
// STEP INSTANCE METHODS
// ===========================================================================

describe('ProcessRepository — step instances', () => {
  describe('findStepById', () => {
    it('maps the step on hit', async () => {
      mockPrisma.stepInstance.findUnique.mockResolvedValue(makeDbStep());
      const result = await processRepository.findStepById('step-1');
      expect(mockPrisma.stepInstance.findUnique).toHaveBeenCalledWith({ where: { id: 'step-1' } });
      expect(result?.id).toBe('step-1');
      expect(result?.actionConfig).toEqual({ location: 'A' });
      expect(result?.failedRobotIds).toEqual([]);
    });

    it('returns null when missing', async () => {
      mockPrisma.stepInstance.findUnique.mockResolvedValue(null);
      expect(await processRepository.findStepById('x')).toBeNull();
    });
  });

  describe('findStepsByInstanceId', () => {
    it('queries ordered steps and maps them', async () => {
      mockPrisma.stepInstance.findMany.mockResolvedValue([makeDbStep(), makeDbStep({ id: 'step-2', order: 1 })]);
      const result = await processRepository.findStepsByInstanceId('inst-1');
      expect(mockPrisma.stepInstance.findMany).toHaveBeenCalledWith({
        where: { processInstanceId: 'inst-1' },
        orderBy: { order: 'asc' },
      });
      expect(result).toHaveLength(2);
    });
  });

  describe('updateStepStatus', () => {
    it('sets startedAt + assignedRobotId for in_progress', async () => {
      mockPrisma.stepInstance.update.mockResolvedValue(makeDbStep({ status: 'in_progress' }));
      const result = await processRepository.updateStepStatus('step-1', 'in_progress', 'robot-a');

      const arg = mockPrisma.stepInstance.update.mock.calls[0][0] as {
        where: unknown;
        data: Record<string, unknown>;
      };
      expect(arg.where).toEqual({ id: 'step-1' });
      expect(arg.data.status).toBe('in_progress');
      expect(arg.data.startedAt).toBeInstanceOf(Date);
      expect(arg.data.assignedRobotId).toBe('robot-a');
      expect(result?.id).toBe('step-1');
    });

    it('sets completedAt + error for failed', async () => {
      mockPrisma.stepInstance.update.mockResolvedValue(makeDbStep({ status: 'failed' }));
      await processRepository.updateStepStatus('step-1', 'failed', undefined, 'oops');
      const arg = mockPrisma.stepInstance.update.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(arg.data.completedAt).toBeInstanceOf(Date);
      expect(arg.data.error).toBe('oops');
      expect(arg.data).not.toHaveProperty('startedAt');
      expect(arg.data).not.toHaveProperty('assignedRobotId');
    });

    it('returns null on throw', async () => {
      mockPrisma.stepInstance.update.mockRejectedValue(new Error('db'));
      expect(await processRepository.updateStepStatus('x', 'completed')).toBeNull();
    });
  });

  describe('updateStepResult', () => {
    it('serializes result and sets status from success flag, returns true', async () => {
      mockPrisma.stepInstance.update.mockResolvedValue(makeDbStep());
      const result: StepResult = { success: true, data: { ok: 1 } };
      const ok = await processRepository.updateStepResult('step-1', result);
      expect(ok).toBe(true);
      const arg = mockPrisma.stepInstance.update.mock.calls[0][0] as {
        where: unknown;
        data: Record<string, unknown>;
      };
      expect(arg.where).toEqual({ id: 'step-1' });
      expect(arg.data.result).toBe(JSON.stringify(result));
      expect(arg.data.status).toBe('completed');
      expect(arg.data.completedAt).toBeInstanceOf(Date);
    });

    it('sets failed status when result.success is false', async () => {
      mockPrisma.stepInstance.update.mockResolvedValue(makeDbStep());
      await processRepository.updateStepResult('step-1', { success: false });
      const arg = mockPrisma.stepInstance.update.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(arg.data.status).toBe('failed');
    });

    it('returns false on throw', async () => {
      mockPrisma.stepInstance.update.mockRejectedValue(new Error('db'));
      expect(await processRepository.updateStepResult('x', { success: true })).toBe(false);
    });
  });

  describe('incrementStepRetry', () => {
    it('increments retryCount and resets to pending, returns new count', async () => {
      mockPrisma.stepInstance.update.mockResolvedValue(makeDbStep({ retryCount: 2 }));
      const count = await processRepository.incrementStepRetry('step-1');
      expect(count).toBe(2);
      expect(mockPrisma.stepInstance.update).toHaveBeenCalledWith({
        where: { id: 'step-1' },
        data: { retryCount: { increment: 1 }, status: 'pending' },
      });
    });

    it('returns -1 on throw', async () => {
      mockPrisma.stepInstance.update.mockRejectedValue(new Error('db'));
      expect(await processRepository.incrementStepRetry('x')).toBe(-1);
    });
  });

  describe('getNextPendingStep', () => {
    it('finds first pending step ordered by order', async () => {
      mockPrisma.stepInstance.findFirst.mockResolvedValue(makeDbStep());
      const result = await processRepository.getNextPendingStep('inst-1');
      expect(mockPrisma.stepInstance.findFirst).toHaveBeenCalledWith({
        where: { processInstanceId: 'inst-1', status: 'pending' },
        orderBy: { order: 'asc' },
      });
      expect(result?.id).toBe('step-1');
    });

    it('returns null when none pending', async () => {
      mockPrisma.stepInstance.findFirst.mockResolvedValue(null);
      expect(await processRepository.getNextPendingStep('inst-1')).toBeNull();
    });
  });

  describe('countStepsByStatus', () => {
    it('tallies statuses into a full counts record', async () => {
      mockPrisma.stepInstance.findMany.mockResolvedValue([
        { status: 'pending' },
        { status: 'pending' },
        { status: 'completed' },
        { status: 'failed' },
      ]);

      const counts = await processRepository.countStepsByStatus('inst-1');

      expect(mockPrisma.stepInstance.findMany).toHaveBeenCalledWith({
        where: { processInstanceId: 'inst-1' },
        select: { status: true },
      });
      expect(counts).toEqual({
        pending: 2,
        queued: 0,
        in_progress: 0,
        completed: 1,
        failed: 1,
        skipped: 0,
        cancelled: 0,
      });
    });
  });
});

// ===========================================================================
// STEP REASSIGNMENT METHODS
// ===========================================================================

describe('ProcessRepository — step reassignment', () => {
  describe('addFailedRobotToStep', () => {
    it('returns false when step missing', async () => {
      mockPrisma.stepInstance.findUnique.mockResolvedValue(null);
      expect(await processRepository.addFailedRobotToStep('x', 'robot-a')).toBe(false);
    });

    it('appends failed robot when not present', async () => {
      mockPrisma.stepInstance.findUnique.mockResolvedValue(
        makeDbStep({ failedRobotIds: JSON.stringify(['robot-x']) })
      );
      mockPrisma.stepInstance.update.mockResolvedValue(makeDbStep());

      const ok = await processRepository.addFailedRobotToStep('step-1', 'robot-a');
      expect(ok).toBe(true);
      expect(mockPrisma.stepInstance.update).toHaveBeenCalledWith({
        where: { id: 'step-1' },
        data: { failedRobotIds: JSON.stringify(['robot-x', 'robot-a']) },
      });
    });

    it('handles null failedRobotIds column via fallback', async () => {
      mockPrisma.stepInstance.findUnique.mockResolvedValue(makeDbStep({ failedRobotIds: null }));
      mockPrisma.stepInstance.update.mockResolvedValue(makeDbStep());
      const ok = await processRepository.addFailedRobotToStep('step-1', 'robot-a');
      expect(ok).toBe(true);
      const arg = mockPrisma.stepInstance.update.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(arg.data.failedRobotIds).toBe(JSON.stringify(['robot-a']));
    });

    it('no update when already present but returns true', async () => {
      mockPrisma.stepInstance.findUnique.mockResolvedValue(
        makeDbStep({ failedRobotIds: JSON.stringify(['robot-a']) })
      );
      const ok = await processRepository.addFailedRobotToStep('step-1', 'robot-a');
      expect(ok).toBe(true);
      expect(mockPrisma.stepInstance.update).not.toHaveBeenCalled();
    });

    it('returns false on throw', async () => {
      mockPrisma.stepInstance.findUnique.mockRejectedValue(new Error('db'));
      expect(await processRepository.addFailedRobotToStep('x', 'r')).toBe(false);
    });
  });

  describe('resetStepRetryCount', () => {
    it('resets retryCount + status to pending, returns true', async () => {
      mockPrisma.stepInstance.update.mockResolvedValue(makeDbStep());
      const ok = await processRepository.resetStepRetryCount('step-1');
      expect(ok).toBe(true);
      expect(mockPrisma.stepInstance.update).toHaveBeenCalledWith({
        where: { id: 'step-1' },
        data: { retryCount: 0, status: 'pending' },
      });
    });

    it('returns false on throw', async () => {
      mockPrisma.stepInstance.update.mockRejectedValue(new Error('db'));
      expect(await processRepository.resetStepRetryCount('x')).toBe(false);
    });
  });

  describe('getStepFailedRobotIds', () => {
    it('returns [] when step missing', async () => {
      mockPrisma.stepInstance.findUnique.mockResolvedValue(null);
      expect(await processRepository.getStepFailedRobotIds('x')).toEqual([]);
    });

    it('parses the failedRobotIds column', async () => {
      mockPrisma.stepInstance.findUnique.mockResolvedValue(
        makeDbStep({ failedRobotIds: JSON.stringify(['robot-a', 'robot-b']) })
      );
      expect(await processRepository.getStepFailedRobotIds('step-1')).toEqual(['robot-a', 'robot-b']);
    });

    it('falls back to [] when column is null', async () => {
      mockPrisma.stepInstance.findUnique.mockResolvedValue(makeDbStep({ failedRobotIds: null }));
      expect(await processRepository.getStepFailedRobotIds('step-1')).toEqual([]);
    });
  });

  describe('clearStepFailedRobots', () => {
    it('clears list + error and returns true', async () => {
      mockPrisma.stepInstance.update.mockResolvedValue(makeDbStep());
      const ok = await processRepository.clearStepFailedRobots('step-1');
      expect(ok).toBe(true);
      expect(mockPrisma.stepInstance.update).toHaveBeenCalledWith({
        where: { id: 'step-1' },
        data: { failedRobotIds: '[]', error: null },
      });
    });

    it('returns false on throw', async () => {
      mockPrisma.stepInstance.update.mockRejectedValue(new Error('db'));
      expect(await processRepository.clearStepFailedRobots('x')).toBe(false);
    });
  });
});

// A direct instantiation also works since it shares the mocked prisma singleton.
describe('ProcessRepository — direct instance', () => {
  it('new ProcessRepository() uses the same mocked prisma', async () => {
    const repo = new ProcessRepository();
    mockPrisma.processDefinition.findUnique.mockResolvedValue(makeDbDefinition());
    const result = await repo.findDefinitionById('def-1');
    expect(result?.id).toBe('def-1');
  });
});
