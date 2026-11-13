/**
 * @file robotTypeLink.test.ts
 * @description Which robot type a fleet robot is one of (TASK-485): the
 *              explicit link wins, the model string is the fallback, and an
 *              ambiguous model answers nothing.
 * @feature robots
 */

import { describe, it, expect } from 'vitest';
import { linkRobotToType, parseRobotMetadata } from '../robotTypeLink.js';
import type { RobotType } from '../../types/vla.types.js';

function type(id: string, name: string, model: string, dim: number): RobotType {
  return {
    id, name, model, manufacturer: 'x', actionDim: dim, proprioceptionDim: dim,
    cameras: [], capabilities: [], limits: { position: { min: [], max: [] }, velocity: [], torque: [] },
    createdAt: new Date(0), updatedAt: new Date(0),
  } as RobotType;
}

const TYPES = [
  type('rt-g1', 'Unitree G1 EDU (Dex3-1)', 'unitree_g1_edu_dex3', 43),
  type('rt-arms', 'Unitree G1 arms + Dex3-1 hands', 'unitree_g1_dex3_arms', 28),
  type('rt-so101', 'SO-101 Follower', 'so101_follower', 6),
  type('rt-duck', 'Microduck', 'microduck', 15),
  type('rt-stale', 'Unitree_G1', 'unitree_g1', 28),
];

describe('linkRobotToType', () => {
  it('links the MicroDuck although its model is not its type name', () => {
    const link = linkRobotToType({ model: 'Pollen Robotics Microduck' }, TYPES);
    expect(link).toMatchObject({ linkedBy: 'model', robotType: { id: 'rt-duck' } });
  });

  it('prefers the type the metadata names over what the model suggests', () => {
    const byName = linkRobotToType({ model: 'SO-101 Follower', metadata: { robotTypeName: 'microduck' } }, TYPES);
    expect(byName).toMatchObject({ linkedBy: 'explicit', robotType: { id: 'rt-duck' } });
    const byId = linkRobotToType({ model: 'whatever', metadata: { robotTypeId: 'rt-arms', robotTypeName: 'Microduck' } }, TYPES);
    expect(byId).toMatchObject({ linkedBy: 'explicit', robotType: { id: 'rt-arms' } });
  });

  it('falls back to the model when the metadata names a type that does not exist', () => {
    const link = linkRobotToType({ model: 'SO-101 Follower', metadata: { robotTypeName: 'Gone' } }, TYPES);
    expect(link).toMatchObject({ linkedBy: 'model', robotType: { id: 'rt-so101' } });
  });

  it('matches the model against a type name or model key, ignoring case and punctuation', () => {
    expect(linkRobotToType({ model: 'unitree g1 edu dex3-1' }, TYPES)?.robotType.id).toBe('rt-g1');
    expect(linkRobotToType({ model: 'so101_follower' }, TYPES)?.robotType.id).toBe('rt-so101');
  });

  it('takes the longest type name found in the model', () => {
    // "Unitree G1" (the stale type) is in the model too; the longer name is the better fit.
    const link = linkRobotToType({ model: 'Lab 2: Unitree G1 EDU (Dex3-1), unit B' }, TYPES);
    expect(link?.robotType.id).toBe('rt-g1');
  });

  it('answers nothing for an unknown model, an empty one, or a tie', () => {
    expect(linkRobotToType({ model: 'Acme Walker 9' }, TYPES)).toBeNull();
    expect(linkRobotToType({ model: '' }, TYPES)).toBeNull();
    expect(linkRobotToType({}, TYPES)).toBeNull();
    const tie = [type('a', 'Alpha', 'alpha', 1), type('b', 'Beta', 'beta', 1)];
    expect(linkRobotToType({ model: 'Alpha Beta rig' }, tie)).toBeNull();
  });

  it('does not match a type name inside a longer word', () => {
    expect(linkRobotToType({ model: 'Microducky 3000' }, TYPES)).toBeNull();
  });
});

describe('parseRobotMetadata', () => {
  it('reads the JSON column and an already parsed object alike', () => {
    expect(parseRobotMetadata('{"robotTypeName":"Microduck"}')).toEqual({ robotTypeName: 'Microduck' });
    expect(parseRobotMetadata({ a: 1 })).toEqual({ a: 1 });
    expect(parseRobotMetadata('not json')).toEqual({});
    expect(parseRobotMetadata(null)).toEqual({});
    expect(parseRobotMetadata('[1]')).toEqual({});
  });
});
