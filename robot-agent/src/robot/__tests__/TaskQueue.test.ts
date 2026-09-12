/**
 * @file TaskQueue.test.ts
 * @description Tests for TaskQueue
 * @status test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskQueue, type CommandExecuteFn, type StateGetter, type StateUpdater, type ChangeNotifier } from '../TaskQueue.js';
import type { SimulatedRobotState, PushedTask } from '../types.js';

// Mock fetch for reportTaskStatus — this is the seam every status report goes
// through, so it is also how the tests read what the queue told the server.
const fetchMock = vi.fn().mockResolvedValue({ ok: true });
vi.stubGlobal('fetch', fetchMock);

/** The JSON body of one `fetch` call (`PUT .../status`). */
function reportBody(call: unknown[]): {
  status: string;
  error?: string;
  result?: { success: boolean; message?: string };
} {
  const init = call[1] as { body?: string };
  return JSON.parse(String(init.body));
}

// Mock config
vi.mock('../../config/config.js', () => ({
  config: { serverUrl: 'http://localhost:3001' },
}));

function createMockState(overrides: Partial<SimulatedRobotState> = {}): SimulatedRobotState {
  return {
    id: 'test-robot-1',
    name: 'TestBot',
    model: 'TestModel',
    serialNumber: 'SN001',
    robotClass: 'standard',
    robotType: 'generic',
    maxPayloadKg: 10,
    description: 'Test robot',
    status: 'online',
    batteryLevel: 80,
    location: { x: 0, y: 0, floor: '1' },
    capabilities: ['navigation'],
    firmware: '1.0.0',
    ipAddress: '127.0.0.1',
    speed: 0,
    lastSeen: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    errors: [],
    warnings: [],
    heldObject: undefined,
    currentTaskId: undefined,
    currentTaskName: undefined,
    ...overrides,
  };
}

function createMockTask(overrides: Partial<PushedTask> = {}): PushedTask {
  return {
    id: `task-${Math.random().toString(36).slice(2, 8)}`,
    actionType: 'move_to_location',
    actionConfig: { location: { x: 10, y: 20 } },
    instruction: 'Move to location',
    priority: 'normal',
    source: 'command',
    ...overrides,
  };
}

describe('TaskQueue', () => {
  let state: SimulatedRobotState;
  let stateGetter: StateGetter;
  let stateUpdater: StateUpdater;
  let changeNotifier: ChangeNotifier;
  let commands: CommandExecuteFn;
  let queue: TaskQueue;

  beforeEach(() => {
    state = createMockState();
    stateGetter = () => state;
    stateUpdater = (updater) => updater(state);
    changeNotifier = vi.fn();
    commands = {
      moveTo: vi.fn().mockResolvedValue({ success: true, message: 'Moved' }),
      pickup: vi.fn().mockResolvedValue({ success: true, message: 'Picked up' }),
      drop: vi.fn().mockResolvedValue({ success: true, message: 'Dropped' }),
      goToCharge: vi.fn().mockResolvedValue({ success: true, message: 'Charging' }),
      returnHome: vi.fn().mockResolvedValue({ success: true, message: 'Returned' }),
      stop: vi.fn().mockResolvedValue({ success: true, message: 'Stopped' }),
    };
    queue = new TaskQueue(stateGetter, stateUpdater, changeNotifier, commands);
    fetchMock.mockClear();
  });

  /**
   * These leave `state.status` as 'online' on purpose — every other test in this
   * file sets it to 'busy' so nothing executes, which is exactly why the
   * fallthrough that reported every unimplemented action as `completed` was
   * never seen by a test.
   */
  describe('executeAction', () => {
    /** Wait until the queue has reported the terminal status for one task. */
    async function drain(): Promise<ReturnType<typeof reportBody>> {
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      return reportBody(fetchMock.mock.calls[1]);
    }

    function expectNoCommandRan(): void {
      expect(commands.moveTo).not.toHaveBeenCalled();
      expect(commands.pickup).not.toHaveBeenCalled();
      expect(commands.drop).not.toHaveBeenCalled();
      expect(commands.goToCharge).not.toHaveBeenCalled();
      expect(commands.returnHome).not.toHaveBeenCalled();
    }

    it.each(['custom', 'inspect'] as const)(
      'reports %s as failed, naming the action type, and runs no command',
      async (actionType) => {
        await queue.accept(createMockTask({ actionType, actionConfig: {} }));

        const body = await drain();
        expect(body.status).toBe('failed');
        expect(body.error).toContain(actionType);
        expect(body.error).toContain('not implemented');
        expectNoCommandRan();
      }
    );

    it('refuses immediately instead of sleeping 2 seconds first', async () => {
      const startedAt = Date.now();
      await queue.accept(createMockTask({ actionType: 'custom', actionConfig: {} }));
      await drain();

      // The old fallthrough slept 2000 ms before claiming success.
      expect(Date.now() - startedAt).toBeLessThan(500);
    });

    it('reports an action type outside the agent union as failed', async () => {
      // `execute_skill` exists in the server's union only, and nothing on the
      // wire is typed — it must fail, not fall through to success.
      await queue.accept(
        createMockTask({ actionType: 'execute_skill' as PushedTask['actionType'], actionConfig: {} })
      );

      const body = await drain();
      expect(body.status).toBe('failed');
      expect(body.error).toContain('execute_skill');
      expectNoCommandRan();
    });

    it('still really waits and completes a wait task', async () => {
      await queue.accept(createMockTask({ actionType: 'wait', actionConfig: { durationMs: 5 } }));

      const body = await drain();
      expect(body.status).toBe('completed');
      expect(body.result?.message).toContain('5ms');
    });

    it('still delegates an implemented action to the command executor', async () => {
      await queue.accept(
        createMockTask({ actionType: 'move_to_location', actionConfig: { location: { x: 3, y: 4 } } })
      );

      const body = await drain();
      expect(body.status).toBe('completed');
      expect(commands.moveTo).toHaveBeenCalledWith({ x: 3, y: 4 });
    });
  });

  describe('accept', () => {
    it('accepts a task when queue has space', async () => {
      const task = createMockTask();
      const accepted = await queue.accept(task);

      expect(accepted).toBe(true);
    });

    it('rejects task when robot is in error state', async () => {
      state.status = 'error';
      const task = createMockTask();
      const accepted = await queue.accept(task);

      expect(accepted).toBe(false);
    });

    it('rejects task when robot is in maintenance state', async () => {
      state.status = 'maintenance';
      const task = createMockTask();
      const accepted = await queue.accept(task);

      expect(accepted).toBe(false);
    });

    it('rejects task when queue is full', async () => {
      // Fill queue (max 5 by default) — set state to busy so tasks queue instead of execute
      state.status = 'busy';
      for (let i = 0; i < 5; i++) {
        await queue.accept(createMockTask());
      }

      const task = createMockTask();
      const accepted = await queue.accept(task);

      expect(accepted).toBe(false);
    });
  });

  describe('getTasks', () => {
    it('returns empty array initially', () => {
      expect(queue.getTasks()).toEqual([]);
    });

    it('returns queued tasks', async () => {
      state.status = 'busy'; // Prevent auto-execution
      await queue.accept(createMockTask({ id: 't1' }));
      await queue.accept(createMockTask({ id: 't2' }));

      expect(queue.getTasks()).toHaveLength(2);
    });
  });

  describe('length', () => {
    it('returns 0 initially', () => {
      expect(queue.length).toBe(0);
    });
  });

  describe('getCurrentTask', () => {
    it('returns null when no task is executing', () => {
      expect(queue.getCurrentTask()).toBeNull();
    });
  });

  describe('restoreQueue', () => {
    it('restores tasks from persisted state', () => {
      const tasks = [
        createMockTask({ id: 't1', priority: 'low' }),
        createMockTask({ id: 't2', priority: 'high' }),
      ];

      queue.restoreQueue(tasks);

      const restored = queue.getTasks();
      expect(restored).toHaveLength(2);
      // Should be sorted by priority (high first)
      expect(restored[0].priority).toBe('high');
      expect(restored[1].priority).toBe('low');
    });
  });

  describe('cancel', () => {
    it('cancels a queued task by ID', async () => {
      state.status = 'busy'; // Prevent auto-execution
      await queue.accept(createMockTask({ id: 'cancel-me' }));

      const cancelled = await queue.cancel('cancel-me');
      expect(cancelled).toBe(true);
      expect(queue.length).toBe(0);
    });

    it('returns false for unknown task ID', async () => {
      const cancelled = await queue.cancel('nonexistent');
      expect(cancelled).toBe(false);
    });
  });

  describe('priority sorting', () => {
    it('sorts tasks by priority (critical > high > normal > low)', async () => {
      state.status = 'busy'; // Prevent auto-execution
      await queue.accept(createMockTask({ id: 't-low', priority: 'low' }));
      await queue.accept(createMockTask({ id: 't-critical', priority: 'critical' }));
      await queue.accept(createMockTask({ id: 't-normal', priority: 'normal' }));
      await queue.accept(createMockTask({ id: 't-high', priority: 'high' }));

      const tasks = queue.getTasks();
      expect(tasks[0].id).toBe('t-critical');
      expect(tasks[1].id).toBe('t-high');
      expect(tasks[2].id).toBe('t-normal');
      expect(tasks[3].id).toBe('t-low');
    });
  });
});
