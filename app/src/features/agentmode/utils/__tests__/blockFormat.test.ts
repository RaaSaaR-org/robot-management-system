/**
 * @file blockFormat.test.ts
 * @description Tests for the block label/param formatting shown on the block
 *              cards and the timeline chips.
 * @feature agentmode
 */

import { describe, it, expect } from 'vitest';
import { blockKindLabel, formatBlockParams } from '../blockFormat';
import type { AgentBlock } from '../../types/agentmode.types';

const block = (kind: AgentBlock['kind'], params: Record<string, unknown> = {}): AgentBlock => ({
  id: 'b1',
  kind,
  params,
  status: 'pending',
});

describe('formatBlockParams', () => {
  it('summarises locomotion blocks as an instruction', () => {
    expect(formatBlockParams(block('walk', { distanceM: 2, direction: 'forward' }))).toBe(
      '2.0 m forward'
    );
    expect(formatBlockParams(block('turn', { angleDeg: -34 }))).toBe('-34° right');
    expect(formatBlockParams(block('goto', { entity: 'table' }))).toBe('table');
    // TASK-209: a place is a room of the place graph, and reads as one.
    expect(formatBlockParams(block('goto', { place: 'Kitchen' }))).toBe('into Kitchen');
    expect(formatBlockParams(block('wait', { seconds: 3 }))).toBe('3 s');
    expect(formatBlockParams(block('look', {}))).toBe('camera → scene memory');
    expect(formatBlockParams(block('look', { speak: true }))).toBe(
      'camera → scene memory · says what it sees'
    );
  });

  describe('wave', () => {
    it('never names a hand — the G1 wave is right-arm only', () => {
      // There is no left-hand wave to select (ArmTask 7106 is a fixed
      // right-arm gesture), so printing a hand would offer a choice that
      // does not exist. Even a legacy `hand` param must not resurface.
      expect(formatBlockParams(block('wave'))).toBe('');
      expect(formatBlockParams(block('wave', { hand: 'left' }))).not.toMatch(/hand/i);
      expect(formatBlockParams(block('wave', { hand: 'left' }))).not.toMatch(/left|right/i);
    });

    it('shows the only modifier the block has: turning toward the person', () => {
      expect(blockKindLabel('wave')).toBe('Wave');
      expect(formatBlockParams(block('wave', { turn: true }))).toBe('(turning toward them)');
      expect(formatBlockParams(block('wave', { turn: false }))).toBe('');
    });
  });

  it('says how a goto is being driven once the navigator has reported it (TASK-208)', () => {
    const planned: AgentBlock = {
      ...block('goto', { entity: 'table' }),
      nav: { planned: true, lengthM: 3.24, segments: 2, reason: null },
    };
    expect(formatBlockParams(planned)).toBe('table · planned 3.2 m in 2 segments');
    const one: AgentBlock = {
      ...block('goto', { entity: 'chair' }),
      nav: { planned: true, lengthM: 1.9, segments: 1, reason: null },
    };
    expect(formatBlockParams(one)).toBe('chair · planned 1.9 m in 1 segment');
    const sight: AgentBlock = {
      ...block('goto', { entity: 'table' }),
      nav: { planned: false, lengthM: null, segments: 0, reason: 'no map yet' },
    };
    expect(formatBlockParams(sight)).toBe('table · walking by sight');
  });

  it('falls back to key: value pairs for params v1 does not model', () => {
    expect(formatBlockParams(block('greet', { text: 'Hallo!' }))).toBe('Hallo!');
    expect(formatBlockParams(block('speak', { text: 'Ich bin da.' }))).toBe('“Ich bin da.”');
  });

  it('summarises the patrol blocks (TASK-212) by route / checkpoint name', () => {
    expect(blockKindLabel('patrol')).toBe('Patrol');
    expect(formatBlockParams(block('patrol', { routeId: 'r-1', routeName: 'Night round', mode: 'patrol' }))).toBe(
      'Night round · patrol'
    );
    expect(formatBlockParams(block('patrol', { routeId: 'r-1', mode: 'baseline' }))).toBe('r-1 · baseline run');
    expect(formatBlockParams(block('capture', { checkpointId: 'cp-1', checkpointName: 'Hall', headingDeg: 90.4 }))).toBe(
      'at Hall · heading 90°'
    );
    expect(formatBlockParams(block('capture', { checkpointId: 'cp-1' }))).toBe('at cp-1');
    expect(formatBlockParams(block('capture', {}))).toBe('control photo');
    expect(formatBlockParams(block('inspect', { checkpointId: 'cp-1', checkpointName: 'Hall' }))).toBe('Hall vs baseline');
    expect(formatBlockParams(block('inspect', {}))).toBe('vs baseline');
  });
});
