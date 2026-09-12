/**
 * @file tasksApi.test.ts
 * @description Creating an automation sends the steps the user actually picked
 *              (TASK-293). It used to hardcode `actionType: 'custom'`, which the
 *              robot agent has no code for — every step came back green anyway.
 * @feature processes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/api/client', () => ({
  apiClient: { post: vi.fn(), get: vi.fn(), put: vi.fn() },
}));

import { apiClient } from '@/api/client';
import { tasksApi } from '../tasksApi';
import type { CreateProcessRequest } from '../../types';

/** definition create → publish → start */
function mockCreateFlow(): void {
  vi.mocked(apiClient.post)
    .mockResolvedValueOnce({ data: { id: 'def-1' } } as never)
    .mockResolvedValueOnce({ data: {} } as never)
    .mockResolvedValueOnce({
      data: { id: 'inst-1', processName: 'Shelf scan', assignedRobotIds: ['robot-1'] },
    } as never);
}

const REQUEST: CreateProcessRequest = {
  name: 'Shelf scan',
  robotId: 'robot-1',
  priority: 'normal',
  steps: [
    {
      name: 'Drive to aisle 3',
      actionType: 'move_to_location',
      actionConfig: { location: { x: 12, y: 8, floor: '1', zone: 'Aisle 3' } },
    },
    { name: 'Hold still', actionType: 'wait', actionConfig: { durationMs: 3000 } },
  ],
};

describe('tasksApi.createTask', () => {
  beforeEach(() => {
    vi.mocked(apiClient.post).mockReset();
  });

  it('sends one stepTemplate per step, carrying the chosen action and its parameters', async () => {
    mockCreateFlow();

    await tasksApi.createTask(REQUEST);

    const [endpoint, body] = vi.mocked(apiClient.post).mock.calls[0] as [string, Record<string, unknown>];
    expect(endpoint).toBe('/processes');
    expect(body.stepTemplates).toEqual([
      {
        order: 1,
        name: 'Drive to aisle 3',
        description: undefined,
        actionType: 'move_to_location',
        actionConfig: { location: { x: 12, y: 8, floor: '1', zone: 'Aisle 3' } },
      },
      {
        order: 2,
        name: 'Hold still',
        description: undefined,
        actionType: 'wait',
        actionConfig: { durationMs: 3000 },
      },
    ]);
  });

  it('puts no "custom" action type in any request body', async () => {
    mockCreateFlow();

    await tasksApi.createTask(REQUEST);

    for (const call of vi.mocked(apiClient.post).mock.calls) {
      expect(JSON.stringify(call[1] ?? {})).not.toContain('custom');
    }
  });

  it('refuses an automation with no steps instead of inventing one', async () => {
    await expect(tasksApi.createTask({ ...REQUEST, steps: [] })).rejects.toThrow(
      'An automation needs at least one step'
    );
    await expect(tasksApi.createTask({ ...REQUEST, steps: undefined })).rejects.toThrow(
      'An automation needs at least one step'
    );
    // Nothing was created server-side, so there is no orphan definition.
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});
