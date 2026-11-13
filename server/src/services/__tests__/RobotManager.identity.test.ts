/**
 * @file RobotManager.identity.test.ts
 * @description The fleet's half of the identity-ownership decision (TASK-198):
 *              the robot is authoritative for its own name and the server
 *              ADOPTS it, without a blank report ever being able to erase one.
 * @feature core
 * @status test
 */

import { describe, it, expect } from 'vitest';
import {
  applyTaskUpdate,
  buildIdentityUpdate,
  buildTaskUpdate,
  clearedTaskFields,
  type ReportedRobot,
  type Robot,
} from '../RobotManager.js';

function robot(over: Partial<Robot> = {}): Robot {
  return {
    id: 'sim-robot-g1-edu',
    name: 'G1-EDU-Bot',
    model: 'Unitree G1 EDU (Dex3-1)',
    status: 'online',
    batteryLevel: 90,
    location: { x: 0, y: 0 },
    capabilities: ['navigation'],
    lastSeen: '2026-08-02T10:00:00.000Z',
    createdAt: '2026-08-02T09:00:00.000Z',
    updatedAt: '2026-08-02T10:00:00.000Z',
    ...over,
  } as Robot;
}

describe('buildIdentityUpdate', () => {
  it('adopts the name the robot reports — the robot owns its own identity', () => {
    // The naming ritual happened on the robot: an operator standing in front of
    // it said "your name is Nova", and it wrote IDENTITY.md. The fleet learns
    // it here, on the next 30 s identity sync.
    const update = buildIdentityUpdate(robot(), robot({ name: 'Nova' }));
    expect(update).toEqual({ name: 'Nova' });
  });

  it('never lets a blank report erase a stored identity field', () => {
    // The bug this guard closes: an agent booting with an unset ROBOT_NAME used
    // to report `''`, which was written straight through and blanked the fleet's
    // record of a robot that has a perfectly good name on its own disk.
    expect(buildIdentityUpdate(robot(), robot({ name: '' }))).toBeNull();
    expect(buildIdentityUpdate(robot(), robot({ name: '   ' }))).toBeNull();
    expect(
      buildIdentityUpdate(robot({ serialNumber: 'SIM-1' }), robot({ serialNumber: '' })),
    ).toBeNull();
  });

  it('leaves fields the agent does not report alone', () => {
    const current = robot({ serialNumber: 'SIM-1', firmware: 'sim-v1.0.0', ipAddress: '10.0.0.5' });
    const reported = { ...robot(), serialNumber: undefined, firmware: undefined, ipAddress: undefined };
    expect(buildIdentityUpdate(current, reported as Robot)).toBeNull();
  });

  it('returns null when nothing changed', () => {
    expect(buildIdentityUpdate(robot(), robot())).toBeNull();
  });

  it('still adopts the structured fields, where an empty value is a real assertion', () => {
    // `capabilities: []` is the agent saying it has none — unlike `name: ''`,
    // which is never a legitimate claim about an identity.
    const update = buildIdentityUpdate(robot(), robot({ capabilities: [] }));
    expect(update).toEqual({ capabilities: [] });
  });

  it('adopts several identity fields at once', () => {
    const update = buildIdentityUpdate(
      robot({ serialNumber: 'SIM-1' }),
      robot({ name: 'Nova', serialNumber: 'G1EDU-0042', firmware: 'v2.1.0' }),
    );
    expect(update).toEqual({ name: 'Nova', serialNumber: 'G1EDU-0042', firmware: 'v2.1.0' });
  });
});

/**
 * TASK-499: the task a robot is on is synced like its identity, with one more
 * state — an explicit `null` clears. The demo's simulated robot registered
 * while charging and read "Charging · Running now" from then on, online and
 * draining, because the task fields were written at registration only.
 */
describe('buildTaskUpdate', () => {
  const reported = (over: Partial<ReportedRobot>): ReportedRobot => ({ ...robot(), ...over });

  it('clears a stored task when the agent reports null', () => {
    const update = buildTaskUpdate(
      robot({ currentTaskName: 'Charging' }),
      reported({ currentTaskId: null, currentTaskName: null }),
    );
    // Only what changed: there was no task id to clear.
    expect(update).toEqual({ currentTaskName: null });
  });

  it('leaves a stored task alone when the payload omits the field', () => {
    // An older agent, or a partial payload: silence is not "no task".
    const wire = JSON.parse(JSON.stringify(robot({ currentTaskName: undefined }))) as ReportedRobot;
    expect(wire).not.toHaveProperty('currentTaskName');
    expect(buildTaskUpdate(robot({ currentTaskName: 'Pick item', currentTaskId: 't-1' }), wire)).toBeNull();
  });

  it('adopts a task that started or changed', () => {
    expect(buildTaskUpdate(robot(), reported({ currentTaskId: 't-2', currentTaskName: 'Charging' }))).toEqual({
      currentTaskId: 't-2',
      currentTaskName: 'Charging',
    });
    expect(
      buildTaskUpdate(robot({ currentTaskName: 'Charging' }), reported({ currentTaskName: 'Moving to (1.0, 2.0)' })),
    ).toEqual({ currentTaskName: 'Moving to (1.0, 2.0)' });
  });

  it('reads a blank name as no task', () => {
    expect(buildTaskUpdate(robot({ currentTaskName: 'Charging' }), reported({ currentTaskName: '  ' }))).toEqual({
      currentTaskName: null,
    });
  });

  it('returns null when nothing changed, cleared or not', () => {
    expect(buildTaskUpdate(robot(), reported({ currentTaskId: null, currentTaskName: null }))).toBeNull();
    expect(
      buildTaskUpdate(robot({ currentTaskName: 'Charging' }), reported({ currentTaskName: 'Charging' })),
    ).toBeNull();
  });
});

describe('applyTaskUpdate', () => {
  it('removes a cleared field from the cached robot instead of storing null', () => {
    const cached = robot({ currentTaskId: 't-1', currentTaskName: 'Charging' });
    applyTaskUpdate(cached, { currentTaskName: null });
    expect(cached).not.toHaveProperty('currentTaskName');
    expect(cached.currentTaskId).toBe('t-1');

    applyTaskUpdate(cached, { currentTaskName: 'Pick item' });
    expect(cached.currentTaskName).toBe('Pick item');
  });
});

describe('clearedTaskFields', () => {
  it('names only the fields reported as null', () => {
    expect(clearedTaskFields({ ...robot(), currentTaskId: null, currentTaskName: 'Charging' })).toEqual({
      currentTaskId: null,
    });
    expect(clearedTaskFields(robot())).toEqual({});
  });
});
