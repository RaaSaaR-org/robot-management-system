/**
 * @file blockFormat.test.ts
 * @description Tests for the block label/param formatting shown on the block
 *              cards and the timeline chips.
 * @feature agentmode
 */

import { describe, it, expect } from 'vitest';
import {
  blockKindLabel,
  demoMode,
  formatBlockParams,
  formatDuration,
  presentProgress,
} from '../blockFormat';
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
    // Arrived: the navigator's last re-plan is from the goal, so it has no
    // segments left. The card must not read "planned 0.0 m in 0 segments"
    // (seen live on 2026-08-16 after a `walk into the kitchen` finished).
    const arrived: AgentBlock = {
      ...block('goto', { place: 'Kitchen' }),
      nav: { planned: true, lengthM: 0, segments: 0, reason: null },
    };
    expect(formatBlockParams(arrived)).toBe('into Kitchen');
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

  it('summarises the host-mode blocks (TASK-213) and never implies a grasp that did not happen', () => {
    expect(blockKindLabel('tour')).toBe('Tour');
    expect(blockKindLabel('present')).toBe('Present');
    expect(blockKindLabel('demo')).toBe('Demo');
    expect(formatBlockParams(block('tour', { routeId: 'r-1', routeName: 'ZeMA visitor tour', stops: 4 }))).toBe(
      'ZeMA visitor tour · 4 stops'
    );
    expect(formatBlockParams(block('present', { text: 'Hier arbeite ich.', chunk: 2, of: 3 }))).toBe('“Hier arbeite ich.”');
    expect(presentProgress(block('present', { text: 'x', chunk: 2, of: 3 }))).toEqual({ chunk: 2, of: 3 });
    // A `present` without a counter reports "no counter" rather than "part 1 of 1".
    expect(presentProgress(block('present', { text: 'x' }))).toBeNull();
    expect(presentProgress(block('speak', { text: 'x' }))).toBeNull();

    expect(formatBlockParams(block('demo', { skillName: 'Apple pick', mode: 'execute' }))).toBe('runs “Apple pick”');
    expect(formatBlockParams(block('demo', { skillName: 'Apple pick', mode: 'narrate' }))).toBe(
      'describes “Apple pick” (not executed)'
    );
    expect(demoMode(block('demo', { mode: 'narrate' }))).toBe('narrate');
    // A missing mode must NOT read as 'execute': claiming a grasp happened is
    // the one mistake this block kind exists to prevent.
    expect(demoMode(block('demo', {}))).toBeNull();
    expect(formatBlockParams(block('demo', { skillId: 'sk-1' }))).toBe('describes “sk-1” (not executed)');
  });
});

describe('formatDuration', () => {
  it('renders sub-second, seconds and minute forms', () => {
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(812)).toBe('812ms');
    expect(formatDuration(1_000)).toBe('1.0s');
    expect(formatDuration(12_400)).toBe('12.4s');
    expect(formatDuration(65_000)).toBe('1m 05s');
    expect(formatDuration(3_600_000)).toBe('60m 00s');
  });

  // REGRESSION (TASK-202). The Planning counter re-renders a growing number
  // once a second, so a rounding seam that a finished block's fixed duration
  // hit ~0.8% of the time is now on screen once a minute for the whole
  // deadline. Both of these used to carry a 60 into a field that only goes to
  // 59.
  it('never renders a sixtieth second', () => {
    expect(formatDuration(119_700)).toBe('2m 00s'); // was '1m 60s'
    expect(formatDuration(59_999)).toBe('1m 00s'); // was '60.0s'
    expect(formatDuration(179_500)).toBe('3m 00s'); // was '2m 60s'
  });

  it('still rounds the ordinary remainder the short way', () => {
    expect(formatDuration(119_400)).toBe('1m 59s');
    expect(formatDuration(59_800)).toBe('59.8s');
    // The seconds branch keeps everything `toFixed(1)` can render honestly;
    // 59.95 is the first value that would round up to a 60.
    expect(formatDuration(59_940)).toBe('59.9s');
    expect(formatDuration(59_950)).toBe('1m 00s');
  });
});
