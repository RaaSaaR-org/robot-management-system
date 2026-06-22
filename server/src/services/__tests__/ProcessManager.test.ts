/**
 * @file ProcessManager.test.ts
 * @description Unit tests for ProcessManager — process/instance lifecycle, step
 *   orchestration, execute_skill dispatch, retry/reassign, and completion logic.
 * @feature processes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  ProcessDefinition,
  ProcessInstance,
  StepInstance,
  StepInstanceStatus,
} from '../../types/process.types.js';

// ---------------------------------------------------------------------------
// Mocks for external boundaries (every repo / service the SUT imports)
// ---------------------------------------------------------------------------

vi.mock('../../repositories/ProcessRepository.js', () => ({
  processRepository: {
    findDefinitionById: vi.fn(),
    findAllDefinitions: vi.fn(),
    createDefinition: vi.fn(),
    updateDefinition: vi.fn(),
    deleteDefinition: vi.fn(),
    findInstanceById: vi.fn(),
    findAllInstances: vi.fn(),
    createInstance: vi.fn(),
    updateInstanceStatus: vi.fn(),
    updateInstanceProgress: vi.fn(),
    getNextPendingStep: vi.fn(),
    updateStepStatus: vi.fn(),
    updateStepResult: vi.fn(),
    findStepById: vi.fn(),
    incrementStepRetry: vi.fn(),
    resetStepRetryCount: vi.fn(),
    clearStepFailedRobots: vi.fn(),
    addFailedRobotToStep: vi.fn(),
    getStepFailedRobotIds: vi.fn(),
    countStepsByStatus: vi.fn(),
  },
}));

vi.mock('../../repositories/RobotTaskRepository.js', () => ({
  robotTaskRepository: {
    findByProcessInstanceId: vi.fn(),
    create: vi.fn(),
    cancel: vi.fn(),
  },
}));

vi.mock('../SkillExecutionService.js', () => ({
  skillExecutionService: {
    executeSkill: vi.fn(),
  },
}));

// TaskDistributor is dynamically imported (lazy, to avoid a circular dep).
const findEligibleRobotsForReassignment = vi.fn();
vi.mock('../TaskDistributor.js', () => ({
  taskDistributor: {
    findEligibleRobotsForReassignment,
  },
}));

import { ProcessManager } from '../ProcessManager.js';
import { processRepository } from '../../repositories/ProcessRepository.js';
import { robotTaskRepository } from '../../repositories/RobotTaskRepository.js';
import { skillExecutionService } from '../SkillExecutionService.js';

// Fresh instance per test (it extends EventEmitter; the exported singleton would
// otherwise accumulate listeners across tests).
let manager: ProcessManager;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDefinition(overrides: Partial<ProcessDefinition> = {}): ProcessDefinition {
  return {
    id: 'def1',
    name: 'Pick and Place',
    version: 1,
    status: 'ready',
    stepTemplates: [],
    triggerType: 'manual',
    enabled: true,
    createdBy: 'user1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeStep(overrides: Partial<StepInstance> = {}): StepInstance {
  return {
    id: 'step1',
    processInstanceId: 'inst1',
    stepTemplateId: 'tmpl1',
    order: 0,
    name: 'Move',
    actionType: 'move_to_location',
    actionConfig: {},
    status: 'pending',
    retryCount: 0,
    maxRetries: 2,
    ...overrides,
  };
}

function makeInstance(overrides: Partial<ProcessInstance> = {}): ProcessInstance {
  return {
    id: 'inst1',
    processDefinitionId: 'def1',
    processName: 'Pick and Place',
    status: 'pending',
    priority: 'normal',
    steps: [],
    currentStepIndex: 0,
    progress: 0,
    assignedRobotIds: [],
    createdBy: 'user1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function emptyStepCounts(
  overrides: Partial<Record<StepInstanceStatus, number>> = {}
): Record<StepInstanceStatus, number> {
  return {
    pending: 0,
    queued: 0,
    in_progress: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    cancelled: 0,
    ...overrides,
  };
}

const repo = vi.mocked(processRepository);
const taskRepo = vi.mocked(robotTaskRepository);
const skillSvc = vi.mocked(skillExecutionService);

beforeEach(() => {
  vi.clearAllMocks();
  // getInstance() returns a singleton; reset it so each test starts clean.
  // @ts-expect-error — accessing private static for test isolation
  ProcessManager.instance = undefined;
  manager = ProcessManager.getInstance();
});

// ===========================================================================
// Process Definition CRUD (thin pass-throughs)
// ===========================================================================

describe('definition management', () => {
  it('getDefinition returns the repository result', async () => {
    const def = makeDefinition();
    repo.findDefinitionById.mockResolvedValue(def);
    await expect(manager.getDefinition('def1')).resolves.toBe(def);
    expect(repo.findDefinitionById).toHaveBeenCalledWith('def1');
  });

  it('getDefinition returns null when not found', async () => {
    repo.findDefinitionById.mockResolvedValue(null);
    await expect(manager.getDefinition('missing')).resolves.toBeNull();
  });

  it('listDefinitions forwards filters and pagination', async () => {
    const page = { data: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 0 } };
    repo.findAllDefinitions.mockResolvedValue(page);
    const filters = { status: 'ready' as const };
    const pagination = { page: 1, limit: 10 };
    await expect(manager.listDefinitions(filters, pagination)).resolves.toBe(page);
    expect(repo.findAllDefinitions).toHaveBeenCalledWith(filters, pagination);
  });

  it('createDefinition delegates with createdBy', async () => {
    const def = makeDefinition();
    repo.createDefinition.mockResolvedValue(def);
    const request = { name: 'X', stepTemplates: [] };
    await expect(manager.createDefinition(request, 'alice')).resolves.toBe(def);
    expect(repo.createDefinition).toHaveBeenCalledWith(request, 'alice');
  });

  it('updateDefinition returns null when the definition is missing', async () => {
    repo.updateDefinition.mockResolvedValue(null);
    await expect(manager.updateDefinition('nope', { name: 'Y' })).resolves.toBeNull();
  });

  it('updateDefinition returns the updated definition', async () => {
    const def = makeDefinition({ name: 'Updated' });
    repo.updateDefinition.mockResolvedValue(def);
    await expect(manager.updateDefinition('def1', { name: 'Updated' })).resolves.toBe(def);
  });

  it('publishDefinition sets status to ready', async () => {
    const def = makeDefinition({ status: 'ready' });
    repo.updateDefinition.mockResolvedValue(def);
    await expect(manager.publishDefinition('def1')).resolves.toBe(def);
    expect(repo.updateDefinition).toHaveBeenCalledWith('def1', { status: 'ready' });
  });

  it('archiveDefinition delegates to deleteDefinition', async () => {
    repo.deleteDefinition.mockResolvedValue(true);
    await expect(manager.archiveDefinition('def1')).resolves.toBe(true);
    expect(repo.deleteDefinition).toHaveBeenCalledWith('def1');
  });
});

// ===========================================================================
// Process Instance read + listing
// ===========================================================================

describe('instance read', () => {
  it('getInstance returns the repo result', async () => {
    const inst = makeInstance();
    repo.findInstanceById.mockResolvedValue(inst);
    await expect(manager.getInstance('inst1')).resolves.toBe(inst);
  });

  it('listInstances forwards filters', async () => {
    const page = { data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
    repo.findAllInstances.mockResolvedValue(page);
    await expect(manager.listInstances({ status: 'pending' })).resolves.toBe(page);
    expect(repo.findAllInstances).toHaveBeenCalledWith({ status: 'pending' }, undefined);
  });
});

// ===========================================================================
// startProcess
// ===========================================================================

describe('startProcess', () => {
  it('returns null and does not begin execution when creation fails', async () => {
    repo.createInstance.mockResolvedValue(null);
    const result = await manager.startProcess('def1', {}, 'alice');
    expect(result).toBeNull();
    expect(repo.updateInstanceStatus).not.toHaveBeenCalled();
  });

  it('emits process:created and begins execution immediately when not scheduled', async () => {
    const inst = makeInstance({ status: 'pending' });
    repo.createInstance.mockResolvedValue(inst);
    // beginExecution path:
    repo.findInstanceById.mockResolvedValue(inst);
    repo.updateInstanceStatus.mockResolvedValue({ ...inst, status: 'in_progress' });
    // executeNextStep: instance must be in_progress to proceed; return one with that status
    repo.getNextPendingStep.mockResolvedValue(null);
    repo.countStepsByStatus.mockResolvedValue(emptyStepCounts());

    const created = vi.fn();
    manager.on('process:created', created);

    const result = await manager.startProcess('def1', {}, 'alice');

    expect(result).toBe(inst);
    expect(created).toHaveBeenCalledTimes(1);
    expect(repo.createInstance).toHaveBeenCalledWith('def1', {}, 'alice');
  });

  it('does not begin execution when scheduled for the future', async () => {
    const inst = makeInstance({ status: 'pending' });
    repo.createInstance.mockResolvedValue(inst);
    const future = new Date(Date.now() + 60_000).toISOString();

    const result = await manager.startProcess('def1', { scheduledAt: future }, 'alice');

    expect(result).toBe(inst);
    // beginExecution would call updateInstanceStatus; it must not run
    expect(repo.updateInstanceStatus).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// beginExecution
// ===========================================================================

describe('beginExecution', () => {
  it('returns false when the instance does not exist', async () => {
    repo.findInstanceById.mockResolvedValue(null);
    await expect(manager.beginExecution('x')).resolves.toBe(false);
  });

  it('returns false when the instance is not pending', async () => {
    repo.findInstanceById.mockResolvedValue(makeInstance({ status: 'in_progress' }));
    await expect(manager.beginExecution('inst1')).resolves.toBe(false);
    expect(repo.updateInstanceStatus).not.toHaveBeenCalled();
  });

  it('returns false when the status update fails', async () => {
    repo.findInstanceById.mockResolvedValue(makeInstance({ status: 'pending' }));
    repo.updateInstanceStatus.mockResolvedValue(null);
    await expect(manager.beginExecution('inst1')).resolves.toBe(false);
  });

  it('transitions to in_progress, emits update, and executes next step', async () => {
    const pending = makeInstance({ status: 'pending' });
    const running = makeInstance({ status: 'in_progress' });
    // first findInstanceById (beginExecution) -> pending; executeNextStep -> running
    repo.findInstanceById
      .mockResolvedValueOnce(pending)
      .mockResolvedValue(running);
    repo.updateInstanceStatus.mockResolvedValue(running);
    repo.getNextPendingStep.mockResolvedValue(null);
    repo.countStepsByStatus.mockResolvedValue(emptyStepCounts());

    const updated = vi.fn();
    manager.on('process:updated', updated);

    await expect(manager.beginExecution('inst1')).resolves.toBe(true);
    expect(repo.updateInstanceStatus).toHaveBeenCalledWith('inst1', 'in_progress');
    expect(updated).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// pause / resume / cancel
// ===========================================================================

describe('pauseProcess', () => {
  it('returns null when not in_progress', async () => {
    repo.findInstanceById.mockResolvedValue(makeInstance({ status: 'pending' }));
    await expect(manager.pauseProcess('inst1')).resolves.toBeNull();
  });

  it('pauses an in_progress process and emits update', async () => {
    repo.findInstanceById.mockResolvedValue(makeInstance({ status: 'in_progress' }));
    const paused = makeInstance({ status: 'paused' });
    repo.updateInstanceStatus.mockResolvedValue(paused);

    const updated = vi.fn();
    manager.on('process:updated', updated);

    await expect(manager.pauseProcess('inst1')).resolves.toBe(paused);
    expect(repo.updateInstanceStatus).toHaveBeenCalledWith('inst1', 'paused');
    expect(updated).toHaveBeenCalledTimes(1);
  });
});

describe('resumeProcess', () => {
  it('returns null when not paused', async () => {
    repo.findInstanceById.mockResolvedValue(makeInstance({ status: 'in_progress' }));
    await expect(manager.resumeProcess('inst1')).resolves.toBeNull();
  });

  it('resumes a paused process and continues execution', async () => {
    const paused = makeInstance({ status: 'paused' });
    const running = makeInstance({ status: 'in_progress' });
    repo.findInstanceById
      .mockResolvedValueOnce(paused)
      .mockResolvedValue(running);
    repo.updateInstanceStatus.mockResolvedValue(running);
    repo.getNextPendingStep.mockResolvedValue(null);
    repo.countStepsByStatus.mockResolvedValue(emptyStepCounts());

    await expect(manager.resumeProcess('inst1')).resolves.toBe(running);
    expect(repo.updateInstanceStatus).toHaveBeenCalledWith('inst1', 'in_progress');
  });
});

describe('cancelProcess', () => {
  it('returns null when already terminal', async () => {
    repo.findInstanceById.mockResolvedValue(makeInstance({ status: 'completed' }));
    await expect(manager.cancelProcess('inst1')).resolves.toBeNull();
    expect(repo.updateInstanceStatus).not.toHaveBeenCalled();
  });

  it('cancels active steps and associated robot tasks', async () => {
    const inst = makeInstance({
      status: 'in_progress',
      steps: [
        makeStep({ id: 's1', status: 'in_progress' }),
        makeStep({ id: 's2', status: 'completed' }),
        makeStep({ id: 's3', status: 'pending' }),
      ],
    });
    repo.findInstanceById.mockResolvedValue(inst);
    repo.updateStepStatus.mockResolvedValue(makeStep());
    taskRepo.findByProcessInstanceId.mockResolvedValue([
      { id: 't1', status: 'executing' } as never,
      { id: 't2', status: 'completed' } as never,
    ]);
    taskRepo.cancel.mockResolvedValue({} as never);
    const cancelled = makeInstance({ status: 'cancelled' });
    repo.updateInstanceStatus.mockResolvedValue(cancelled);

    const result = await manager.cancelProcess('inst1');

    expect(result).toBe(cancelled);
    // only s1 (in_progress) and s3 (pending) get cancelled, not the completed s2
    expect(repo.updateStepStatus).toHaveBeenCalledWith('s1', 'cancelled');
    expect(repo.updateStepStatus).toHaveBeenCalledWith('s3', 'cancelled');
    expect(repo.updateStepStatus).not.toHaveBeenCalledWith('s2', 'cancelled');
    // only the executing task is cancelled
    expect(taskRepo.cancel).toHaveBeenCalledTimes(1);
    expect(taskRepo.cancel).toHaveBeenCalledWith('t1', 'Process cancelled');
  });
});

// ===========================================================================
// retryProcess
// ===========================================================================

describe('retryProcess', () => {
  it('returns null when the instance is not failed or cancelled', async () => {
    repo.findInstanceById.mockResolvedValue(makeInstance({ status: 'in_progress' }));
    await expect(manager.retryProcess('inst1')).resolves.toBeNull();
  });

  it('resets steps from the first failed step and re-begins execution', async () => {
    const failedInst = makeInstance({
      status: 'failed',
      steps: [
        makeStep({ id: 's1', status: 'completed' }),
        makeStep({ id: 's2', status: 'failed' }),
        makeStep({ id: 's3', status: 'pending' }),
      ],
    });
    // first call (retryProcess) -> failed; later findInstanceById calls -> a
    // pending instance so beginExecution can be a no-op-ish but exercised path,
    // and the final return reflects the refetched instance.
    const afterReset = makeInstance({ status: 'pending', steps: failedInst.steps });
    repo.findInstanceById
      .mockResolvedValueOnce(failedInst) // retryProcess top
      .mockResolvedValue(afterReset); // beginExecution + final return
    repo.updateStepStatus.mockResolvedValue(makeStep());
    repo.resetStepRetryCount.mockResolvedValue(true);
    repo.clearStepFailedRobots.mockResolvedValue(true);
    repo.updateInstanceProgress.mockResolvedValue(undefined as never);
    repo.updateInstanceStatus.mockResolvedValue(afterReset);
    repo.getNextPendingStep.mockResolvedValue(null);
    repo.countStepsByStatus.mockResolvedValue(emptyStepCounts());

    const result = await manager.retryProcess('inst1');

    // Steps from index 1 (s2) onward are reset to pending; s1 untouched
    expect(repo.updateStepStatus).toHaveBeenCalledWith('s2', 'pending');
    expect(repo.updateStepStatus).toHaveBeenCalledWith('s3', 'pending');
    expect(repo.updateStepStatus).not.toHaveBeenCalledWith('s1', 'pending');
    // progress reflects 1 completed of 3 steps = 33%
    expect(repo.updateInstanceProgress).toHaveBeenCalledWith('inst1', 33, 1);
    expect(repo.updateInstanceStatus).toHaveBeenCalledWith('inst1', 'pending', undefined);
    expect(result).toBe(afterReset);
  });
});

// ===========================================================================
// executeNextStep — generic (TaskDistributor) path
// ===========================================================================

describe('executeNextStep', () => {
  it('does nothing when the instance is not in_progress', async () => {
    repo.findInstanceById.mockResolvedValue(makeInstance({ status: 'pending' }));
    await manager.executeNextStep('inst1');
    expect(repo.getNextPendingStep).not.toHaveBeenCalled();
  });

  it('checks completion when there are no more pending steps', async () => {
    repo.findInstanceById.mockResolvedValue(makeInstance({ status: 'in_progress' }));
    repo.getNextPendingStep.mockResolvedValue(null);
    repo.countStepsByStatus.mockResolvedValue(emptyStepCounts({ completed: 2 }));
    repo.updateInstanceProgress.mockResolvedValue(undefined as never);
    repo.updateInstanceStatus.mockResolvedValue(makeInstance({ status: 'completed' }));

    await manager.executeNextStep('inst1');

    // checkProcessCompletion ran: all completed -> mark process completed
    expect(repo.updateInstanceStatus).toHaveBeenCalledWith('inst1', 'completed');
  });

  it('queues the next step, creates a robot task, and emits task:created', async () => {
    repo.findInstanceById.mockResolvedValue(makeInstance({ status: 'in_progress', priority: 'high' }));
    const step = makeStep({ id: 's1', actionType: 'move_to_location' });
    repo.getNextPendingStep.mockResolvedValue(step);
    repo.updateStepStatus.mockResolvedValue(makeStep());
    repo.getStepFailedRobotIds.mockResolvedValue([]);
    const task = { id: 'task1' };
    taskRepo.create.mockResolvedValue(task as never);

    const taskCreated = vi.fn();
    const stepStarted = vi.fn();
    manager.on('task:created', taskCreated);
    manager.on('step:started', stepStarted);

    await manager.executeNextStep('inst1');

    expect(repo.updateStepStatus).toHaveBeenCalledWith('s1', 'queued');
    expect(stepStarted).toHaveBeenCalledTimes(1);
    expect(taskRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'move_to_location',
        priority: 'high',
        actionConfig: expect.objectContaining({ excludeRobotIds: [] }),
      }),
      'process',
      'inst1',
      's1'
    );
    expect(taskCreated).toHaveBeenCalledWith(task);
  });

  it('passes failed robot ids to the task config for exclusion', async () => {
    repo.findInstanceById.mockResolvedValue(makeInstance({ status: 'in_progress' }));
    repo.getNextPendingStep.mockResolvedValue(makeStep({ id: 's1' }));
    repo.updateStepStatus.mockResolvedValue(makeStep());
    repo.getStepFailedRobotIds.mockResolvedValue(['failedBot']);
    taskRepo.create.mockResolvedValue({ id: 'task1' } as never);

    await manager.executeNextStep('inst1');

    expect(taskRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        actionConfig: expect.objectContaining({ excludeRobotIds: ['failedBot'] }),
      }),
      'process',
      'inst1',
      's1'
    );
  });
});

// ===========================================================================
// executeNextStep — execute_skill path (private executeSkillStep via dispatch)
// ===========================================================================

describe('execute_skill steps', () => {
  it('fails the step when skillId is missing', async () => {
    repo.findInstanceById.mockResolvedValue(makeInstance({ status: 'in_progress' }));
    const step = makeStep({
      id: 's1',
      actionType: 'execute_skill',
      actionConfig: {},
      // exhaust retries + no robot so the failure path does not re-enter
      // executeNextStep with the same step (which would loop forever).
      retryCount: 2,
      maxRetries: 2,
    });
    // First dispatch returns the skill step; once it has failed there are no
    // more pending steps (mirrors the repo marking it failed in production).
    repo.getNextPendingStep.mockResolvedValueOnce(step).mockResolvedValue(null);
    repo.updateStepStatus.mockResolvedValue(makeStep());
    // onStepCompleted reads the step back:
    repo.findStepById.mockResolvedValue(step);
    repo.updateStepResult.mockResolvedValue(true);
    // failure -> handleStepFailure -> canReassignStep (no robots) -> failProcess
    findEligibleRobotsForReassignment.mockResolvedValue([]);
    repo.addFailedRobotToStep.mockResolvedValue(true);
    repo.updateInstanceStatus.mockResolvedValue(makeInstance({ status: 'failed' }));

    await manager.executeNextStep('inst1');

    expect(skillSvc.executeSkill).not.toHaveBeenCalled();
    expect(repo.updateStepResult).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ success: false, message: expect.stringContaining('skillId') })
    );
  });

  it('fails the step when no robot can be resolved', async () => {
    repo.findInstanceById.mockResolvedValue(
      makeInstance({ status: 'in_progress', preferredRobotIds: [], assignedRobotIds: [] })
    );
    const step = makeStep({
      id: 's1',
      actionType: 'execute_skill',
      actionConfig: { skillId: 'sk1' },
      retryCount: 2,
      maxRetries: 2,
    });
    repo.getNextPendingStep.mockResolvedValueOnce(step).mockResolvedValue(null);
    repo.updateStepStatus.mockResolvedValue(makeStep());
    repo.findStepById.mockResolvedValue(step);
    repo.updateStepResult.mockResolvedValue(true);
    findEligibleRobotsForReassignment.mockResolvedValue([]);
    repo.addFailedRobotToStep.mockResolvedValue(true);
    repo.updateInstanceStatus.mockResolvedValue(makeInstance({ status: 'failed' }));

    await manager.executeNextStep('inst1');

    expect(skillSvc.executeSkill).not.toHaveBeenCalled();
    expect(repo.updateStepResult).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ success: false, message: expect.stringContaining('no robot') })
    );
  });

  it('executes the skill on the explicit per-step robot and marks success', async () => {
    repo.findInstanceById.mockResolvedValue(
      makeInstance({ status: 'in_progress', preferredRobotIds: ['pref'] })
    );
    const step = makeStep({
      id: 's1',
      actionType: 'execute_skill',
      actionConfig: { skillId: 'sk1', robotId: 'pinned', parameters: { p: 1 } },
    });
    repo.getNextPendingStep.mockResolvedValue(step);
    repo.updateStepStatus.mockResolvedValue(makeStep());
    skillSvc.executeSkill.mockResolvedValue({
      status: 'completed',
      output: { ok: true },
    } as never);
    // onStepCompleted + the success branch's executeNextStep:
    const completedStep = makeStep({ id: 's1', status: 'completed' });
    repo.findStepById.mockResolvedValue(completedStep);
    repo.updateStepResult.mockResolvedValue(true);
    repo.countStepsByStatus.mockResolvedValue(emptyStepCounts({ completed: 1 }));
    repo.updateInstanceProgress.mockResolvedValue(undefined as never);
    // After progress update, executeNextStep re-reads instance; keep it in_progress
    // then return null next step so it finalises.
    repo.getNextPendingStep.mockResolvedValueOnce(step).mockResolvedValue(null);
    repo.updateInstanceStatus.mockResolvedValue(makeInstance({ status: 'completed' }));

    await manager.executeNextStep('inst1');

    expect(skillSvc.executeSkill).toHaveBeenCalledWith({
      skillId: 'sk1',
      robotId: 'pinned',
      parameters: { p: 1 },
    });
    expect(repo.updateStepStatus).toHaveBeenCalledWith('s1', 'in_progress');
    expect(repo.updateStepResult).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ success: true })
    );
  });

  it('falls back to preferredRobotIds[0] when no per-step robot is given', async () => {
    repo.findInstanceById.mockResolvedValue(
      makeInstance({ status: 'in_progress', preferredRobotIds: ['prefBot'] })
    );
    const step = makeStep({
      id: 's1',
      actionType: 'execute_skill',
      actionConfig: { skillId: 'sk1' },
    });
    repo.getNextPendingStep.mockResolvedValueOnce(step).mockResolvedValue(null);
    repo.updateStepStatus.mockResolvedValue(makeStep());
    skillSvc.executeSkill.mockResolvedValue({ status: 'completed' } as never);
    repo.findStepById.mockResolvedValue(makeStep({ id: 's1', status: 'completed' }));
    repo.updateStepResult.mockResolvedValue(true);
    repo.countStepsByStatus.mockResolvedValue(emptyStepCounts({ completed: 1 }));
    repo.updateInstanceProgress.mockResolvedValue(undefined as never);
    repo.updateInstanceStatus.mockResolvedValue(makeInstance({ status: 'completed' }));

    await manager.executeNextStep('inst1');

    expect(skillSvc.executeSkill).toHaveBeenCalledWith(
      expect.objectContaining({ robotId: 'prefBot' })
    );
  });

  it('records a failure result when executeSkill throws', async () => {
    repo.findInstanceById.mockResolvedValue(
      makeInstance({ status: 'in_progress', preferredRobotIds: ['bot'] })
    );
    const step = makeStep({
      id: 's1',
      actionType: 'execute_skill',
      actionConfig: { skillId: 'sk1' },
      retryCount: 5,
      maxRetries: 0, // force failure handling, not retry, but no current robot to add
    });
    repo.getNextPendingStep.mockResolvedValue(step);
    repo.updateStepStatus.mockResolvedValue(makeStep());
    skillSvc.executeSkill.mockRejectedValue(new Error('robot offline'));
    repo.findStepById.mockResolvedValue({ ...step, status: 'failed' });
    repo.updateStepResult.mockResolvedValue(true);
    // failure branch -> handleStepFailure -> canReassignStep (no robots) -> failProcess
    repo.findInstanceById.mockResolvedValue(
      makeInstance({ status: 'in_progress', preferredRobotIds: ['bot'] })
    );
    findEligibleRobotsForReassignment.mockResolvedValue([]);
    repo.updateInstanceStatus.mockResolvedValue(makeInstance({ status: 'failed' }));

    await manager.executeNextStep('inst1');

    expect(repo.updateStepResult).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ success: false, message: 'robot offline' })
    );
  });
});

// ===========================================================================
// onStepCompleted
// ===========================================================================

describe('onStepCompleted', () => {
  it('returns early when the step does not exist', async () => {
    repo.findStepById.mockResolvedValue(null);
    await manager.onStepCompleted('missing', { success: true });
    expect(repo.updateStepResult).not.toHaveBeenCalled();
  });

  it('returns early when updateStepResult fails', async () => {
    repo.findStepById.mockResolvedValue(makeStep());
    repo.updateStepResult.mockResolvedValue(false);
    await manager.onStepCompleted('step1', { success: true });
    // no progress update should happen
    expect(repo.updateInstanceProgress).not.toHaveBeenCalled();
  });

  it('on success: emits step:completed, updates progress and advances', async () => {
    const step = makeStep({ id: 's1', processInstanceId: 'inst1' });
    const updatedStep = makeStep({ id: 's1', status: 'completed', processInstanceId: 'inst1' });
    repo.findStepById.mockResolvedValueOnce(step).mockResolvedValue(updatedStep);
    repo.updateStepResult.mockResolvedValue(true);
    // updateProcessProgress:
    repo.countStepsByStatus.mockResolvedValue(emptyStepCounts({ completed: 1 }));
    repo.findInstanceById.mockResolvedValue(
      makeInstance({ status: 'in_progress', steps: [updatedStep] })
    );
    repo.updateInstanceProgress.mockResolvedValue(undefined as never);
    // executeNextStep:
    repo.getNextPendingStep.mockResolvedValue(null);
    repo.updateInstanceStatus.mockResolvedValue(makeInstance({ status: 'completed' }));

    const stepCompleted = vi.fn();
    manager.on('step:completed', stepCompleted);

    await manager.onStepCompleted('s1', { success: true });

    expect(stepCompleted).toHaveBeenCalledTimes(1);
    expect(repo.updateInstanceProgress).toHaveBeenCalled();
  });

  it('on failure with retries left: increments retry and re-executes', async () => {
    const step = makeStep({
      id: 's1',
      processInstanceId: 'inst1',
      retryCount: 0,
      maxRetries: 2,
    });
    repo.findStepById.mockResolvedValue(step);
    repo.updateStepResult.mockResolvedValue(true);
    repo.incrementStepRetry.mockResolvedValue(1);
    // handleStepFailure -> executeNextStep
    repo.findInstanceById.mockResolvedValue(makeInstance({ status: 'in_progress' }));
    repo.getNextPendingStep.mockResolvedValue(null);
    repo.countStepsByStatus.mockResolvedValue(emptyStepCounts());

    const stepFailed = vi.fn();
    manager.on('step:failed', stepFailed);

    await manager.onStepCompleted('s1', { success: false, message: 'glitch' });

    expect(stepFailed).toHaveBeenCalledTimes(1);
    expect(repo.incrementStepRetry).toHaveBeenCalledWith('s1');
  });

  it('on failure with retries exhausted and no reassignment: fails the process', async () => {
    const step = makeStep({
      id: 's1',
      processInstanceId: 'inst1',
      assignedRobotId: 'botA',
      retryCount: 2,
      maxRetries: 2,
      failedRobotIds: [],
    });
    repo.findStepById.mockResolvedValue(step);
    repo.updateStepResult.mockResolvedValue(true);
    repo.addFailedRobotToStep.mockResolvedValue(true);
    // canReassignStep:
    repo.findInstanceById.mockResolvedValue(makeInstance({ status: 'in_progress' }));
    findEligibleRobotsForReassignment.mockResolvedValue([]);
    // failProcess:
    const failedInst = makeInstance({ status: 'failed' });
    repo.updateInstanceStatus.mockResolvedValue(failedInst);

    const processFailed = vi.fn();
    manager.on('process:failed', processFailed);

    await manager.onStepCompleted('s1', { success: false, message: 'boom' });

    expect(repo.addFailedRobotToStep).toHaveBeenCalledWith('s1', 'botA');
    expect(repo.updateInstanceStatus).toHaveBeenCalledWith(
      'inst1',
      'failed',
      expect.stringContaining('failed on all eligible robots')
    );
    expect(processFailed).toHaveBeenCalledTimes(1);
  });

  it('on failure with retries exhausted but reassignment possible: resets and re-executes', async () => {
    const step = makeStep({
      id: 's1',
      processInstanceId: 'inst1',
      assignedRobotId: 'botA',
      retryCount: 2,
      maxRetries: 2,
      failedRobotIds: [],
    });
    repo.findStepById.mockResolvedValue(step);
    repo.updateStepResult.mockResolvedValue(true);
    repo.addFailedRobotToStep.mockResolvedValue(true);
    repo.resetStepRetryCount.mockResolvedValue(true);
    // canReassignStep: an eligible robot exists
    repo.findInstanceById.mockResolvedValue(makeInstance({ status: 'in_progress' }));
    findEligibleRobotsForReassignment.mockResolvedValue([{ id: 'botB' }]);
    // re-execute path:
    repo.getNextPendingStep.mockResolvedValue(null);
    repo.countStepsByStatus.mockResolvedValue(emptyStepCounts());

    const reassigned = vi.fn();
    manager.on('step:reassigned', reassigned);

    await manager.onStepCompleted('s1', { success: false, message: 'boom' });

    expect(repo.resetStepRetryCount).toHaveBeenCalledWith('s1');
    expect(reassigned).toHaveBeenCalledTimes(1);
    expect(repo.updateInstanceStatus).not.toHaveBeenCalledWith(
      'inst1',
      'failed',
      expect.anything()
    );
  });
});

// ===========================================================================
// checkProcessCompletion (via executeNextStep with null next step)
// ===========================================================================

describe('process completion', () => {
  it('marks the process failed when some steps failed and none are running', async () => {
    repo.findInstanceById.mockResolvedValue(makeInstance({ status: 'in_progress' }));
    repo.getNextPendingStep.mockResolvedValue(null);
    repo.countStepsByStatus.mockResolvedValue(
      emptyStepCounts({ completed: 1, failed: 1 })
    );
    const failed = makeInstance({ status: 'failed' });
    repo.updateInstanceStatus.mockResolvedValue(failed);

    const processFailed = vi.fn();
    manager.on('process:failed', processFailed);

    await manager.executeNextStep('inst1');

    expect(repo.updateInstanceStatus).toHaveBeenCalledWith('inst1', 'failed');
    expect(processFailed).toHaveBeenCalledTimes(1);
  });

  it('does nothing when work is still running', async () => {
    repo.findInstanceById.mockResolvedValue(makeInstance({ status: 'in_progress' }));
    repo.getNextPendingStep.mockResolvedValue(null);
    repo.countStepsByStatus.mockResolvedValue(emptyStepCounts({ in_progress: 1 }));

    await manager.executeNextStep('inst1');

    expect(repo.updateInstanceStatus).not.toHaveBeenCalled();
  });

  it('completes the process and sets progress to 100 when all done', async () => {
    repo.findInstanceById.mockResolvedValue(makeInstance({ status: 'in_progress' }));
    repo.getNextPendingStep.mockResolvedValue(null);
    repo.countStepsByStatus.mockResolvedValue(emptyStepCounts({ completed: 3 }));
    repo.updateInstanceProgress.mockResolvedValue(undefined as never);
    const completed = makeInstance({ status: 'completed' });
    repo.updateInstanceStatus.mockResolvedValue(completed);

    const processCompleted = vi.fn();
    manager.on('process:completed', processCompleted);

    await manager.executeNextStep('inst1');

    expect(repo.updateInstanceProgress).toHaveBeenCalledWith('inst1', 100);
    expect(repo.updateInstanceStatus).toHaveBeenCalledWith('inst1', 'completed');
    expect(processCompleted).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// onProcessEvent subscription
// ===========================================================================

describe('onProcessEvent', () => {
  it('receives every emitted process event via the aggregate channel', async () => {
    const handler = vi.fn();
    manager.onProcessEvent(handler);

    repo.findInstanceById.mockResolvedValue(makeInstance({ status: 'in_progress' }));
    const paused = makeInstance({ status: 'paused' });
    repo.updateInstanceStatus.mockResolvedValue(paused);

    await manager.pauseProcess('inst1');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({ type: 'process:updated' });
  });
});
