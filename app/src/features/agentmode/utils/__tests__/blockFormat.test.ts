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
    expect(formatBlockParams(block('wait', { seconds: 3 }))).toBe('3 s');
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

  it('falls back to key: value pairs for params v1 does not model', () => {
    expect(formatBlockParams(block('greet', { text: 'Hallo!' }))).toBe('Hallo!');
    expect(formatBlockParams(block('speak', { text: 'Ich bin da.' }))).toBe('“Ich bin da.”');
  });
});
