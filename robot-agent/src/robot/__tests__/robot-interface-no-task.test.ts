/**
 * @file robot-interface-no-task.test.ts
 * @description "No task" travels to the fleet server as a value (TASK-499).
 *              The agent cleared its task name when a charge ended, but an
 *              `undefined` field is dropped by JSON, so the server could not
 *              tell "nothing running" from "this agent does not say" and went
 *              on showing "Charging" on a robot that was back online.
 * @feature robot
 * @status test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RobotConfig } from '../types.js';

const TEST_ROBOT_ID = 'no-task-test-robot';

// Same resolution RobotStateManager uses for its per-robot state file.
const STATE_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  `../../../data/state-${TEST_ROBOT_ID}.json`,
);

vi.mock('../../config/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/config.js')>();
  return { ...actual, config: { ...actual.config, robotId: TEST_ROBOT_ID } };
});

const { RobotStateManager } = await import('../state.js');

function makeConfig(): RobotConfig {
  return {
    id: 'robot-1',
    name: 'TestBot',
    model: 'TestModel',
    robotClass: 'standard',
    robotType: 'g1',
    maxPayloadKg: 10,
    description: 'Test robot',
    initialLocation: { x: 0, y: 0, floor: '1' },
    capabilities: ['navigation'],
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  fs.rmSync(STATE_FILE, { force: true });
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(STATE_FILE, { force: true });
});

describe('RobotStateManager.getRobotInterface — the task fields on the wire', () => {
  it('says null, not nothing, when no task is running', () => {
    const mgr = new RobotStateManager(makeConfig());
    const wire = JSON.parse(JSON.stringify(mgr.getRobotInterface())) as Record<string, unknown>;

    // Present and null: the keys survive JSON, which is the whole point.
    expect(wire).toHaveProperty('currentTaskId', null);
    expect(wire).toHaveProperty('currentTaskName', null);
  });

  it('names the task while one is running, and null again once it is cleared', () => {
    const mgr = new RobotStateManager(makeConfig());
    const state = (mgr as unknown as { state: { status: string; currentTaskName?: string } }).state;
    state.status = 'charging';
    state.currentTaskName = 'Charging';
    expect(mgr.getRobotInterface().currentTaskName).toBe('Charging');

    // What the simulation does when the battery is full (TASK-497).
    state.status = 'online';
    state.currentTaskName = undefined;
    expect(JSON.parse(JSON.stringify(mgr.getRobotInterface()))).toHaveProperty('currentTaskName', null);
  });
});
