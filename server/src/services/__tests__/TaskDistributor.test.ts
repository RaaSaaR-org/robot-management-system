/**
 * @file TaskDistributor.test.ts
 * @description Unit tests for TaskDistributor — task creation, distribution, scoring,
 *   assignment (HTTP push), status updates, cancellation and query methods.
 * @feature processes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Robot } from '../RobotManager.js';
import type {
  RobotTask,
  CreateRobotTaskRequest,
  RobotTaskResult,
} from '../../types/robotTask.types.js';

// ---------------------------------------------------------------------------
// Mocks for external boundaries
// ---------------------------------------------------------------------------

vi.mock('../../repositories/RobotTaskRepository.js', () => ({
  robotTaskRepository: {
    create: vi.fn(),
    findPendingTasks: vi.fn(),
    findById: vi.fn(),
    findByRobotId: vi.fn(),
    assignToRobot: vi.fn(),
    countByRobot: vi.fn(),
    updateStatus: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
    cancel: vi.fn(),
    getQueueStats: vi.fn(),
  },
}));

vi.mock('../../repositories/ProcessRepository.js', () => ({
  processRepository: {
    findInstanceById: vi.fn(),
    addAssignedRobot: vi.fn(),
  },
}));

vi.mock('../ProcessManager.js', () => {
  const { EventEmitter } = require('events');
  return { processManager: Object.assign(new EventEmitter(), { onStepCompleted: vi.fn() }) };
});

vi.mock('../RobotManager.js', () => ({
  robotManager: {
    listRobots: vi.fn(),
    getRobot: vi.fn(),
  },
}));

import { robotTaskRepository as _robotTaskRepository } from '../../repositories/RobotTaskRepository.js';
import { processRepository as _processRepository } from '../../repositories/ProcessRepository.js';
import { processManager as _processManager } from '../ProcessManager.js';
import { robotManager as _robotManager } from '../RobotManager.js';
import { taskDistributor } from '../TaskDistributor.js';

const robotTaskRepository = vi.mocked(_robotTaskRepository, true);
const processRepository = vi.mocked(_processRepository, true);
const robotManager = vi.mocked(_robotManager, true);
// processManager keeps its real EventEmitter; only onStepCompleted is a mock
const processManager = _processManager as typeof _processManager & {
  onStepCompleted: ReturnType<typeof vi.fn>;
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<RobotTask> = {}): RobotTask {
  return {
    id: 't1',
    source: 'manual',
    robotId: null,
    priority: 'normal',
    status: 'pending',
    actionType: 'navigate' as RobotTask['actionType'],
    actionConfig: {},
    instruction: 'do something',
    createdAt: new Date().toISOString(),
    retryCount: 0,
    maxRetries: 3,
    ...overrides,
  };
}

function makeRobot(overrides: Partial<Robot> = {}): Robot {
  return {
    id: 'r1',
    name: 'Robot One',
    model: 'so101',
    status: 'online',
    batteryLevel: 90,
    location: { x: 0, y: 0 },
    lastSeen: new Date().toISOString(),
    capabilities: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);
  // sensible defaults so unrelated branches don't crash
  robotManager.getRobot.mockResolvedValue(undefined as never);
  robotManager.listRobots.mockResolvedValue([]);
  processRepository.addAssignedRobot.mockResolvedValue(true);
  processRepository.findInstanceById.mockResolvedValue(null as never);
  robotTaskRepository.countByRobot.mockResolvedValue(0);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ===========================================================================
// createTask
// ===========================================================================

describe('createTask', () => {
  it('creates the task and assigns directly when robotId is provided', async () => {
    const created = makeTask({ id: 'tc', status: 'pending' });
    robotTaskRepository.create.mockResolvedValue(created);
    const assigned = makeTask({ id: 'tc', status: 'assigned', robotId: 'rX' });
    robotTaskRepository.assignToRobot.mockResolvedValue(assigned);

    const req: CreateRobotTaskRequest = {
      robotId: 'rX',
      actionType: 'navigate' as CreateRobotTaskRequest['actionType'],
      actionConfig: {},
      instruction: 'go',
    };

    const result = await taskDistributor.createTask(req, 'command');

    expect(result).toBe(created);
    expect(robotTaskRepository.create).toHaveBeenCalledWith(req, 'command');
    expect(robotTaskRepository.assignToRobot).toHaveBeenCalledWith('tc', 'rX');
    // no distribution path was taken
    expect(robotManager.listRobots).not.toHaveBeenCalled();
  });

  it('distributes the task when no robotId is provided', async () => {
    const created = makeTask({ id: 'td', status: 'pending' });
    robotTaskRepository.create.mockResolvedValue(created);
    robotManager.listRobots.mockResolvedValue([]); // no eligible -> distribution returns failure

    const result = await taskDistributor.createTask(
      {
        actionType: 'navigate' as CreateRobotTaskRequest['actionType'],
        actionConfig: {},
        instruction: 'go',
      },
      'manual'
    );

    expect(result).toBe(created);
    expect(robotManager.listRobots).toHaveBeenCalled();
    expect(robotTaskRepository.assignToRobot).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// distributeTask
// ===========================================================================

describe('distributeTask', () => {
  it('skips tasks that are not pending', async () => {
    const task = makeTask({ id: 'ts', status: 'assigned', robotId: 'r9' });
    const result = await taskDistributor.distributeTask(task);

    expect(result).toEqual({
      taskId: 'ts',
      robotId: 'r9',
      success: false,
      reason: 'Task is not pending',
    });
    expect(robotManager.listRobots).not.toHaveBeenCalled();
  });

  it('returns failure when no eligible robots are available', async () => {
    robotManager.listRobots.mockResolvedValue([makeRobot({ status: 'offline' })]);
    const result = await taskDistributor.distributeTask(makeTask());

    expect(result.success).toBe(false);
    expect(result.robotId).toBeNull();
    expect(result.reason).toBe('No eligible robots available');
  });

  it('assigns to the highest-scoring eligible robot', async () => {
    const robots = [
      makeRobot({ id: 'low', status: 'busy', batteryLevel: 10 }),
      makeRobot({ id: 'high', status: 'online', batteryLevel: 100 }),
    ];
    robotManager.listRobots.mockResolvedValue(robots);
    robotTaskRepository.assignToRobot.mockResolvedValue(
      makeTask({ status: 'assigned', robotId: 'high' })
    );

    const result = await taskDistributor.distributeTask(makeTask());

    expect(result.success).toBe(true);
    expect(result.robotId).toBe('high');
    expect(result.scores).toBeDefined();
    expect(robotTaskRepository.assignToRobot).toHaveBeenCalledWith('t1', 'high');
  });

  it('excludes robots listed in actionConfig.excludeRobotIds', async () => {
    robotManager.listRobots.mockResolvedValue([
      makeRobot({ id: 'banned', status: 'online' }),
    ]);

    const task = makeTask({ actionConfig: { excludeRobotIds: ['banned'] } });
    const result = await taskDistributor.distributeTask(task);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('No eligible robots available');
  });

  it('filters robots lacking required capabilities', async () => {
    robotManager.listRobots.mockResolvedValue([
      makeRobot({ id: 'noskill', status: 'online', capabilities: ['walk'] }),
    ]);

    const task = makeTask({ actionConfig: { requiredCapabilities: ['grasp'] } });
    const result = await taskDistributor.distributeTask(task);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('No eligible robots available');
  });

  it('returns failure (with scores) when assignment fails', async () => {
    robotManager.listRobots.mockResolvedValue([makeRobot({ id: 'r1', status: 'online' })]);
    robotTaskRepository.assignToRobot.mockResolvedValue(null);

    const result = await taskDistributor.distributeTask(makeTask());

    expect(result.success).toBe(false);
    expect(result.robotId).toBeNull();
    expect(result.reason).toBe('Failed to assign task');
    expect(result.scores).toBeDefined();
  });

  it('prefers a robot listed in the process instance preferredRobotIds', async () => {
    robotManager.listRobots.mockResolvedValue([
      makeRobot({ id: 'plain', status: 'online', batteryLevel: 100 }),
      makeRobot({ id: 'preferred', status: 'busy', batteryLevel: 60 }),
    ]);
    processRepository.findInstanceById.mockResolvedValue({
      id: 'pi1',
      preferredRobotIds: ['preferred'],
    } as never);
    robotTaskRepository.assignToRobot.mockResolvedValue(
      makeTask({ status: 'assigned', robotId: 'preferred' })
    );

    const task = makeTask({ processInstanceId: 'pi1' });
    const result = await taskDistributor.distributeTask(task);

    expect(result.robotId).toBe('preferred');
    const preferredScore = result.scores?.find((s) => s.robotId === 'preferred');
    expect(preferredScore?.reasons).toContain('Preferred robot (+100)');
  });

  it('rejects a robot whose queue is full (score -1)', async () => {
    // single robot but queue full -> still best, assignment proceeds with score -1
    robotManager.listRobots.mockResolvedValue([makeRobot({ id: 'busy', status: 'online' })]);
    robotTaskRepository.countByRobot.mockResolvedValue(5); // MAX_QUEUE_SIZE
    robotTaskRepository.assignToRobot.mockResolvedValue(
      makeTask({ status: 'assigned', robotId: 'busy' })
    );

    const result = await taskDistributor.distributeTask(makeTask());

    const score = result.scores?.find((s) => s.robotId === 'busy');
    expect(score?.score).toBe(-1);
    expect(score?.reasons).toContain('Queue full');
  });
});

// ===========================================================================
// distributePendingTasks
// ===========================================================================

describe('distributePendingTasks', () => {
  it('distributes every pending task and returns a result per task', async () => {
    robotTaskRepository.findPendingTasks.mockResolvedValue([
      makeTask({ id: 'p1' }),
      makeTask({ id: 'p2' }),
    ]);
    robotManager.listRobots.mockResolvedValue([]); // none eligible

    const results = await taskDistributor.distributePendingTasks();

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.taskId)).toEqual(['p1', 'p2']);
    expect(robotTaskRepository.findPendingTasks).toHaveBeenCalledWith(10);
  });

  it('returns an empty array when nothing is pending', async () => {
    robotTaskRepository.findPendingTasks.mockResolvedValue([]);
    const results = await taskDistributor.distributePendingTasks();
    expect(results).toEqual([]);
  });
});

// ===========================================================================
// assignTaskToRobot
// ===========================================================================

describe('assignTaskToRobot', () => {
  it('returns false when the repository cannot assign', async () => {
    robotTaskRepository.assignToRobot.mockResolvedValue(null);
    const ok = await taskDistributor.assignTaskToRobot('tX', 'rX');
    expect(ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pushes the task to the robot HTTP endpoint when a2aAgentUrl is set', async () => {
    const assigned = makeTask({ id: 'ta', status: 'assigned', robotId: 'r1' });
    robotTaskRepository.assignToRobot.mockResolvedValue(assigned);
    robotManager.getRobot.mockResolvedValue(
      makeRobot({ id: 'r1', a2aAgentUrl: 'http://robot.local' })
    );

    const ok = await taskDistributor.assignTaskToRobot('ta', 'r1');

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://robot.local/api/v1/robots/r1/tasks',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('updates the process instance when the task belongs to one', async () => {
    const assigned = makeTask({
      id: 'tb',
      status: 'assigned',
      robotId: 'r1',
      processInstanceId: 'pi9',
    });
    robotTaskRepository.assignToRobot.mockResolvedValue(assigned);

    await taskDistributor.assignTaskToRobot('tb', 'r1');

    expect(processRepository.addAssignedRobot).toHaveBeenCalledWith('pi9', 'r1');
  });

  it('succeeds even if the HTTP push throws', async () => {
    robotTaskRepository.assignToRobot.mockResolvedValue(
      makeTask({ id: 'tc', status: 'assigned', robotId: 'r1' })
    );
    robotManager.getRobot.mockResolvedValue(
      makeRobot({ id: 'r1', a2aAgentUrl: 'http://robot.local' })
    );
    fetchMock.mockRejectedValue(new Error('connection refused'));

    const ok = await taskDistributor.assignTaskToRobot('tc', 'r1');
    expect(ok).toBe(true);
  });

  it('skips the HTTP push when robot has no a2aAgentUrl', async () => {
    robotTaskRepository.assignToRobot.mockResolvedValue(
      makeTask({ id: 'td', status: 'assigned', robotId: 'r1' })
    );
    robotManager.getRobot.mockResolvedValue(makeRobot({ id: 'r1', a2aAgentUrl: undefined }));

    const ok = await taskDistributor.assignTaskToRobot('td', 'r1');
    expect(ok).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// updateTaskStatus
// ===========================================================================

describe('updateTaskStatus', () => {
  it('marks a task executing and emits progress', async () => {
    const task = makeTask({ id: 'te', status: 'executing', robotId: 'r1' });
    robotTaskRepository.updateStatus.mockResolvedValue(task);

    const result = await taskDistributor.updateTaskStatus('te', 'executing', {
      a2aTaskId: 'a2a-1',
    });

    expect(result).toBe(task);
    expect(robotTaskRepository.updateStatus).toHaveBeenCalledWith(
      'te',
      'executing',
      'a2a-1',
      undefined
    );
  });

  it('returns null when completing without a result', async () => {
    const result = await taskDistributor.updateTaskStatus('tf', 'completed');
    expect(result).toBeNull();
    expect(robotTaskRepository.complete).not.toHaveBeenCalled();
  });

  it('completes a task and notifies ProcessManager when linked to a step', async () => {
    const completed = makeTask({ id: 'tg', status: 'completed', stepInstanceId: 'si1' });
    robotTaskRepository.complete.mockResolvedValue(completed);
    const taskResult: RobotTaskResult = { success: true, durationMs: 10, data: { foo: 1 } };

    const result = await taskDistributor.updateTaskStatus('tg', 'completed', {
      result: taskResult,
    });

    expect(result).toBe(completed);
    expect(robotTaskRepository.complete).toHaveBeenCalledWith('tg', taskResult);
    expect(processManager.onStepCompleted).toHaveBeenCalledWith('si1', {
      success: true,
      data: { foo: 1 },
      message: undefined,
    });
  });

  it('fails a task and notifies ProcessManager with the error', async () => {
    const failed = makeTask({ id: 'th', status: 'failed', stepInstanceId: 'si2' });
    robotTaskRepository.fail.mockResolvedValue(failed);

    const result = await taskDistributor.updateTaskStatus('th', 'failed', { error: 'boom' });

    expect(result).toBe(failed);
    expect(robotTaskRepository.fail).toHaveBeenCalledWith('th', 'boom');
    expect(processManager.onStepCompleted).toHaveBeenCalledWith('si2', {
      success: false,
      message: 'boom',
    });
  });

  it('uses a default error message when failing without one', async () => {
    robotTaskRepository.fail.mockResolvedValue(makeTask({ id: 'ti', status: 'failed' }));
    await taskDistributor.updateTaskStatus('ti', 'failed');
    expect(robotTaskRepository.fail).toHaveBeenCalledWith('ti', 'Unknown error');
  });
});

// ===========================================================================
// updateTaskProgress
// ===========================================================================

describe('updateTaskProgress', () => {
  it('emits a progress event when the task exists', async () => {
    robotTaskRepository.findById.mockResolvedValue(makeTask({ id: 'tp', robotId: 'r1' }));
    const events: unknown[] = [];
    const handler = (e: unknown) => events.push(e);
    taskDistributor.on('task:progress', handler);

    await taskDistributor.updateTaskProgress('tp', 42, 'halfway');

    taskDistributor.off('task:progress', handler);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ taskId: 'tp', progress: 42, message: 'halfway' });
  });

  it('does nothing when the task is not found', async () => {
    robotTaskRepository.findById.mockResolvedValue(null);
    const handler = vi.fn();
    taskDistributor.on('task:progress', handler);

    await taskDistributor.updateTaskProgress('missing', 10);

    taskDistributor.off('task:progress', handler);
    expect(handler).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// cancelTask
// ===========================================================================

describe('cancelTask', () => {
  it('cancels the task and emits a work_cancelled event', async () => {
    const cancelled = makeTask({ id: 'tcx', status: 'cancelled', robotId: 'r1' });
    robotTaskRepository.cancel.mockResolvedValue(cancelled);
    const handler = vi.fn();
    taskDistributor.on('robot:work_cancelled', handler);

    const result = await taskDistributor.cancelTask('tcx', 'no longer needed');

    taskDistributor.off('robot:work_cancelled', handler);
    expect(result).toBe(cancelled);
    expect(robotTaskRepository.cancel).toHaveBeenCalledWith('tcx', 'no longer needed');
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ robotId: 'r1', taskId: 'tcx', reason: 'no longer needed' })
    );
  });

  it('returns null when the task cannot be cancelled', async () => {
    robotTaskRepository.cancel.mockResolvedValue(null);
    const result = await taskDistributor.cancelTask('nope');
    expect(result).toBeNull();
  });
});

// ===========================================================================
// findEligibleRobotsForReassignment
// ===========================================================================

describe('findEligibleRobotsForReassignment', () => {
  it('returns online/busy robots excluding the given ids', async () => {
    robotManager.listRobots.mockResolvedValue([
      makeRobot({ id: 'keep', status: 'online' }),
      makeRobot({ id: 'drop', status: 'online' }),
      makeRobot({ id: 'offline', status: 'offline' }),
    ]);

    const robots = await taskDistributor.findEligibleRobotsForReassignment(makeTask(), ['drop']);

    expect(robots.map((r) => r.id)).toEqual(['keep']);
  });
});

// ===========================================================================
// Query methods
// ===========================================================================

describe('query methods', () => {
  it('getTask delegates to findById', async () => {
    const task = makeTask({ id: 'q1' });
    robotTaskRepository.findById.mockResolvedValue(task);
    expect(await taskDistributor.getTask('q1')).toBe(task);
    expect(robotTaskRepository.findById).toHaveBeenCalledWith('q1');
  });

  it('getTasksByRobot delegates to findByRobotId', async () => {
    const tasks = [makeTask({ id: 'q2', robotId: 'r1' })];
    robotTaskRepository.findByRobotId.mockResolvedValue(tasks);
    expect(await taskDistributor.getTasksByRobot('r1')).toBe(tasks);
    expect(robotTaskRepository.findByRobotId).toHaveBeenCalledWith('r1');
  });

  it('getQueueStats delegates to the repository', async () => {
    const stats = { pending: 1 } as Awaited<ReturnType<typeof taskDistributor.getQueueStats>>;
    robotTaskRepository.getQueueStats.mockResolvedValue(stats);
    expect(await taskDistributor.getQueueStats()).toBe(stats);
  });
});

// ===========================================================================
// Lifecycle + events
// ===========================================================================

describe('lifecycle and events', () => {
  it('start/stop are idempotent and manage the interval safely', () => {
    expect(() => {
      taskDistributor.start();
      taskDistributor.start(); // second call is a no-op
      taskDistributor.stop();
      taskDistributor.stop(); // safe to stop twice
    }).not.toThrow();
  });

  it('onTaskEvent receives the aggregated task:event stream', async () => {
    const handler = vi.fn();
    taskDistributor.onTaskEvent(handler);
    robotTaskRepository.findById.mockResolvedValue(makeTask({ id: 'evt', robotId: 'r1' }));

    await taskDistributor.updateTaskProgress('evt', 5);

    taskDistributor.off('task:event', handler);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'task:progress', taskId: 'evt' })
    );
  });
});
