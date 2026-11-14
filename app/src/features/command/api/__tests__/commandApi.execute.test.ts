/**
 * @file commandApi.execute.test.ts
 * @description Executing an interpretation (TASK-502): a target-less "Return
 *              home" / "Charge" maps to the matching robot action, and a
 *              command the robot refuses is recorded as failed, never executed.
 * @feature command
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    apiClient: {
      get: (...a: unknown[]) => get(...a),
      post: (...a: unknown[]) => post(...a),
      patch: (...a: unknown[]) => patch(...a),
    },
  };
});

import { clearNamedLocationCache, commandApi, targetlessAction } from '../commandApi';
import { RobotCommandFailedError } from '@/features/robots/api';
import type { CommandInterpretation } from '../../types/command.types';

function interpretation(overrides: Record<string, unknown>): CommandInterpretation {
  return {
    id: 'int-1',
    originalText: '',
    commandType: 'navigation',
    parameters: {},
    confidence: 0.75,
    safetyClassification: 'safe',
    timestamp: '2026-11-14T12:00:00.000Z',
    ...overrides,
  } as unknown as CommandInterpretation;
}

const command = (over: Record<string, unknown>) => ({
  id: 'cmd-1',
  robotId: 'r1',
  type: 'move',
  payload: {},
  status: 'completed',
  priority: 'normal',
  createdAt: '2026-11-14T12:00:00.000Z',
  ...over,
});

describe('targetlessAction (TASK-502)', () => {
  it.each([
    ['Return home', 'navigation', 'return_home'],
    ['go home', 'custom', 'return_home'],
    ['Come back home please', 'navigation', 'return_home'],
    ['Charge', 'custom', 'charge'],
    ['Go recharge', 'custom', 'charge'],
    ['return and start charging', 'navigation', 'charge'],
  ])('"%s" (%s) means %s', (originalText, commandType, expected) => {
    expect(targetlessAction(interpretation({ originalText, commandType }))).toBe(expected);
  });

  it('leaves a command with a target, a destination or objects alone', () => {
    expect(
      targetlessAction(interpretation({ originalText: 'Go to DOCK-1 then home', parameters: { target: 'DOCK-1' } }))
    ).toBeNull();
    expect(
      targetlessAction(interpretation({ originalText: 'move home', parameters: { destination: { x: 1, y: 2 } } }))
    ).toBeNull();
    expect(
      targetlessAction(
        interpretation({ originalText: 'take the box home', commandType: 'manipulation', parameters: { objects: ['box'] } })
      )
    ).toBeNull();
  });

  it('never reroutes a status question or an emergency', () => {
    expect(targetlessAction(interpretation({ originalText: 'is the robot home?', commandType: 'status' }))).toBeNull();
    expect(targetlessAction(interpretation({ originalText: 'stop charging', commandType: 'emergency' }))).toBeNull();
  });

  it.each([
    ["don't return home", 'navigation'],
    ['do not go home', 'custom'],
    ['never charge', 'custom'],
    ['how much charge is left?', 'custom'],
    ['cancel the return home', 'navigation'],
  ])('a negation or a question never becomes motion: "%s"', (originalText, commandType) => {
    expect(targetlessAction(interpretation({ originalText, commandType }))).toBeNull();
  });

  it('matches whole words only', () => {
    expect(targetlessAction(interpretation({ originalText: 'move to the homestead' }))).toBeNull();
    expect(targetlessAction(interpretation({ originalText: 'move forward' }))).toBeNull();
  });
});

describe('commandApi.executeCommand (TASK-502)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearNamedLocationCache();
    patch.mockResolvedValue({ data: {} });
    get.mockResolvedValue({ data: { places: [] } });
  });

  it('"Return home" without a target sends return_home and marks the interpretation executed', async () => {
    post.mockResolvedValue({ data: command({ id: 'cmd-9', type: 'return_home' }) });

    const result = await commandApi.executeCommand(
      'r1',
      interpretation({ originalText: 'Return home', parameters: { speed: 'normal' } })
    );

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/robots/r1/command', { type: 'return_home', priority: 'normal' });
    expect(result.id).toBe('cmd-9');
    expect(patch).toHaveBeenCalledWith('/command/int-1/status', { status: 'executed', executedCommandId: 'cmd-9' });
  });

  it('"Charge" without a target sends charge', async () => {
    post.mockResolvedValue({ data: command({ type: 'charge' }) });

    await commandApi.executeCommand('r1', interpretation({ originalText: 'Charge', commandType: 'custom' }));

    expect(post).toHaveBeenCalledWith('/robots/r1/command', { type: 'charge', priority: 'normal' });
  });

  it('a move with a target is still a move', async () => {
    post.mockResolvedValue({ data: command({}) });

    await commandApi.executeCommand(
      'r1',
      interpretation({ originalText: 'Go to DOCK-1', parameters: { target: 'DOCK-1' } })
    );

    expect(post.mock.calls[0][1]).toMatchObject({ type: 'move' });
  });

  it('a command the robot refuses throws its reason and is recorded as failed, not executed', async () => {
    post.mockResolvedValue({
      data: command({ id: 'cmd-7', type: 'charge', status: 'failed', errorMessage: 'Cannot find a charging place' }),
    });

    const run = commandApi.executeCommand('r1', interpretation({ originalText: 'Charge', commandType: 'custom' }));

    await expect(run).rejects.toBeInstanceOf(RobotCommandFailedError);
    await expect(run).rejects.toThrow('Cannot find a charging place');
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith('/command/int-1/status', { status: 'failed', executedCommandId: 'cmd-7' });
  });

  it('a transport failure is rethrown without touching the interpretation status', async () => {
    post.mockRejectedValue(new Error('Network Error'));

    await expect(
      commandApi.executeCommand('r1', interpretation({ originalText: 'Return home' }))
    ).rejects.toThrow('Network Error');
    expect(patch).not.toHaveBeenCalled();
  });
});
