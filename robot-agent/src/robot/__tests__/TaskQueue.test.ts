/**
 * @file TaskQueue.test.ts
 * @description Tests for TaskQueue
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskQueue, type CommandExecuteFn, type StateGetter, type StateUpdater, type ChangeNotifier } from '../TaskQueue.js';
import type { SimulatedRobotState, PushedTask } from '../types.js';

// Mock fetch for reportTaskStatus
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

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
