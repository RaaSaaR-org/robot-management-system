/**
 * @file bilateral-teleop.test.ts
 * @description Tests for the bilateral (ALOHA-style) teleop module. Only the
 *              leader→follower mapping table is exported; mapLeaderToFollower /
 *              clamp are module-private and the WebSocket handler is deprecated
 *              (TASK-117), so we assert the contract of the exported mapping
 *              that the private mapper relies on.
 * @feature teleop
 * @status test
 */

import { describe, it, expect } from 'vitest';
import { LEADER_FOLLOWER_MAPPING } from '../bilateral-teleop.js';

describe('LEADER_FOLLOWER_MAPPING', () => {
  it('covers the six SO-101 joints', () => {
    const leaders = LEADER_FOLLOWER_MAPPING.map((m) => m.leader);
    expect(leaders).toEqual([
      'shoulder_pan',
      'shoulder_lift',
      'elbow_flex',
      'wrist_flex',
      'wrist_roll',
      'gripper',
    ]);
  });

  it('maps each leader joint 1:1 to the same follower joint', () => {
    for (const m of LEADER_FOLLOWER_MAPPING) {
      expect(m.follower).toBe(m.leader);
    }
  });

  it('uses only valid sign values (+1 or -1)', () => {
    for (const m of LEADER_FOLLOWER_MAPPING) {
      expect([1, -1]).toContain(m.sign);
    }
  });

  it('has no duplicate follower targets', () => {
    const followers = LEADER_FOLLOWER_MAPPING.map((m) => m.follower);
    expect(new Set(followers).size).toBe(followers.length);
  });
});
