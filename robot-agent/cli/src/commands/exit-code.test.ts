/**
 * @file exit-code.test.ts
 * @description roboctl exits non-zero when the robot fails or cancels the
 * command, so scripts and CI can tell (TASK-389).
 * @feature cli
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandExitCode } from './exit-code.js';

test('a failed command exits 1', () => {
  assert.equal(commandExitCode({ status: 'failed' }), 1);
});

test('a cancelled command exits 1', () => {
  assert.equal(commandExitCode({ status: 'cancelled' }), 1);
});

test('a completed command exits 0', () => {
  assert.equal(commandExitCode({ status: 'completed' }), 0);
});

test('a command still in flight is not a failure', () => {
  assert.equal(commandExitCode({ status: 'executing' }), 0);
  assert.equal(commandExitCode({ status: 'pending' }), 0);
});
