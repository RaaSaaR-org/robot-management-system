/**
 * @file cockpitPick.test.ts
 * @description The control center's auto-pick: reachable robots win the opening
 *   choice, and the choice then holds steady while statuses change under it.
 * @feature robots
 */

import { describe, it, expect } from 'vitest';
import { pickCockpitRobot } from '../cockpitPick';
import type { Robot } from '../../types/robots.types';

function robot(id: string, status: string, model: string, lastSeen: string): Robot {
  return { id, name: id, model, status, lastSeen } as unknown as Robot;
}

const NOTHING_SKIPPED = new Set<string>();

describe('pickCockpitRobot', () => {
  it('returns null when the fleet is empty', () => {
    expect(pickCockpitRobot([], NOTHING_SKIPPED, null)).toBeNull();
  });

  it('opens on a reachable robot rather than an offline G1', () => {
    const robots = [
      robot('g1', 'offline', 'Unitree G1', '2026-09-12T10:00:00Z'),
      robot('sim', 'online', 'SimBot Light', '2026-09-12T09:00:00Z'),
    ];

    expect(pickCockpitRobot(robots, NOTHING_SKIPPED, null)?.id).toBe('sim');
  });

  it('still prefers the G1 among robots that are reachable', () => {
    const robots = [
      robot('sim', 'online', 'SimBot Light', '2026-09-12T10:00:00Z'),
      robot('g1', 'busy', 'Unitree G1 EDU', '2026-09-12T09:00:00Z'),
    ];

    expect(pickCockpitRobot(robots, NOTHING_SKIPPED, null)?.id).toBe('g1');
  });

  it('holds the current pick when its status changes under the operator', () => {
    // Pressing Charge in the cockpit's own command dock takes the bound robot
    // out of `isRobotAvailable`. Re-ranking here would hand the operator a
    // different machine without them touching anything.
    const charging = [
      robot('g1', 'charging', 'Unitree G1', '2026-09-12T10:00:00Z'),
      robot('sim', 'online', 'SimBot Light', '2026-09-12T09:00:00Z'),
    ];

    expect(pickCockpitRobot(charging, NOTHING_SKIPPED, 'g1')?.id).toBe('g1');
  });

  it('holds the pick through a fault or a missed health check', () => {
    for (const status of ['error', 'protective_stop', 'offline', 'maintenance']) {
      const robots = [
        robot('g1', status, 'Unitree G1', '2026-09-12T10:00:00Z'),
        robot('sim', 'online', 'SimBot Light', '2026-09-12T09:00:00Z'),
      ];

      expect(pickCockpitRobot(robots, NOTHING_SKIPPED, 'g1')?.id).toBe('g1');
    }
  });

  it('advances once the self-heal parks the held robot', () => {
    const robots = [
      robot('g1', 'offline', 'Unitree G1', '2026-09-12T10:00:00Z'),
      robot('sim', 'online', 'SimBot Light', '2026-09-12T09:00:00Z'),
    ];

    expect(pickCockpitRobot(robots, new Set(['g1']), 'g1')?.id).toBe('sim');
  });

  it('re-picks when the held robot leaves the fleet', () => {
    const robots = [robot('sim', 'online', 'SimBot Light', '2026-09-12T09:00:00Z')];

    expect(pickCockpitRobot(robots, NOTHING_SKIPPED, 'gone')?.id).toBe('sim');
  });

  it('falls back to the full list when every robot has been parked', () => {
    const robots = [
      robot('g1', 'offline', 'Unitree G1', '2026-09-12T10:00:00Z'),
      robot('sim', 'offline', 'SimBot Light', '2026-09-12T09:00:00Z'),
    ];

    expect(pickCockpitRobot(robots, new Set(['g1', 'sim']), null)?.id).toBe('g1');
  });
});
