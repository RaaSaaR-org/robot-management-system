/**
 * @file robotsApi.commands.test.ts
 * @description A command the robot refuses is an error, not a success, and the
 *              command history is read from the server (TASK-502).
 * @feature robots
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const get = vi.fn();
const post = vi.fn();

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
  };
});

import { ApiRequestError } from '@/api/client';
import { getErrorMessage } from '@/shared/utils/error';
import { robotsApi, RobotCommandFailedError } from '../robotsApi';

const apiError = (statusCode: number) =>
  new ApiRequestError({ code: 'X', message: `status ${statusCode}`, statusCode });

const command = (over: Record<string, unknown>) => ({
  id: 'cmd-1',
  robotId: 'r1',
  type: 'charge',
  payload: {},
  status: 'completed',
  priority: 'normal',
  createdAt: '2026-11-14T12:00:00.000Z',
  ...over,
});

describe('robotsApi commands the robot refuses (TASK-502)', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  const REASON = 'Cannot find a charging place: this robot has no registered place graph.';
  const refused = { data: command({ status: 'failed', errorMessage: REASON }) };

  it.each([
    ['sendCommand', () => robotsApi.sendCommand('r1', { type: 'charge' })],
    ['sendToCharge', () => robotsApi.sendToCharge('r1')],
    ['returnHome', () => robotsApi.returnHome('r1')],
    ['emergencyStop', () => robotsApi.emergencyStop('r1')],
  ])('%s throws the robot\'s own reason', async (_name, call) => {
    post.mockResolvedValue(refused);

    const error = await call().then(
      () => null,
      (e: unknown) => e
    );

    expect(error).toBeInstanceOf(RobotCommandFailedError);
    expect((error as RobotCommandFailedError).command).toEqual(refused.data);
    // What every caller's catch block puts in its error toast.
    expect(getErrorMessage(error)).toBe(REASON);
  });

  it('says so when the robot gave no reason', async () => {
    post.mockResolvedValue({ data: command({ status: 'failed' }) });
    await expect(robotsApi.sendToCharge('r1')).rejects.toThrow('The robot rejected the command.');
  });

  it.each(['pending', 'executing', 'completed'])('returns a %s command as before', async (status) => {
    const data = command({ status });
    post.mockResolvedValue({ data });
    await expect(robotsApi.sendToCharge('r1')).resolves.toEqual(data);
    expect(post).toHaveBeenCalledWith('/robots/r1/command', { type: 'charge', priority: 'normal' });
  });
});

describe('robotsApi.getCommands (TASK-502)', () => {
  beforeEach(() => {
    get.mockReset();
  });

  const EMPTY = { commands: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 } };

  it("reads the robot's history from the server", async () => {
    const data = {
      commands: [command({ id: 'cmd-2', status: 'failed' }), command({ id: 'cmd-1' })],
      pagination: { page: 1, pageSize: 10, total: 2, totalPages: 1 },
    };
    get.mockResolvedValue({ data });

    await expect(robotsApi.getCommands('r1', { pageSize: 10 })).resolves.toEqual(data);
    expect(get).toHaveBeenCalledWith('/robots/r1/commands', { params: { page: 1, pageSize: 10 } });
  });

  it.each([404, 502])('reads a %i as no commands', async (status) => {
    get.mockImplementation(() => Promise.reject(apiError(status)));
    await expect(robotsApi.getCommands('r1')).resolves.toEqual(EMPTY);
  });

  it('reads a body without a command list as no commands', async () => {
    get.mockResolvedValue({ data: {} });
    await expect(robotsApi.getCommands('r1')).resolves.toEqual(EMPTY);
  });

  it('still throws on any other failure', async () => {
    get.mockImplementation(() => Promise.reject(apiError(500)));
    await expect(robotsApi.getCommands('r1')).rejects.toBeInstanceOf(ApiRequestError);
  });
});
