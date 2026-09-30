/**
 * @file wait-command.test.ts
 * @description `roboctl move` on a sidecar-backed robot waits for the walk to
 * end instead of printing `executing` (TASK-336).
 * @feature cli
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RobotCommand } from '../api/types.js';
import { isInFlight, waitForCommand, type CommandHistorySource } from './wait-command.js';

function command(status: RobotCommand['status'], id = 'cmd-1'): RobotCommand {
  return {
    id,
    robotId: 'robot-1',
    type: 'move',
    payload: {},
    status,
    priority: 'normal',
    createdAt: '2026-09-30T00:00:00.000Z',
  } as RobotCommand;
}

function history(sequence: RobotCommand[][]): CommandHistorySource & { calls: number } {
  const source = {
    calls: 0,
    async getCommandHistory() {
      const commands = sequence[Math.min(source.calls, sequence.length - 1)]!;
      source.calls++;
      return { commands, pagination: { page: 1, pageSize: 50, total: commands.length, totalPages: 1 } };
    },
  };
  return source;
}

const noSleep = { sleep: async () => {} };

test('a terminal command is not in flight', () => {
  assert.equal(isInFlight(command('completed')), false);
  assert.equal(isInFlight(command('failed')), false);
  assert.equal(isInFlight(command('executing')), true);
});

test('polls until the walk completes', async () => {
  const source = history([[command('executing')], [command('executing')], [command('completed')]]);
  const result = await waitForCommand(source, command('executing'), noSleep);
  assert.equal(result.status, 'completed');
  assert.equal(source.calls, 3);
});

test('finds the command among others by id', async () => {
  const source = history([[command('completed', 'other'), command('failed')]]);
  const result = await waitForCommand(source, command('executing'), noSleep);
  assert.equal(result.status, 'failed');
});

test('returns the command still executing on a timeout — never a made-up ending', async () => {
  let t = 0;
  const source = history([[command('executing')]]);
  const result = await waitForCommand(source, command('executing'), {
    timeoutMs: 3000,
    intervalMs: 1000,
    sleep: async (ms) => {
      t += ms;
    },
    now: () => t,
  });
  assert.equal(result.status, 'executing');
  assert.equal(source.calls, 3);
});
