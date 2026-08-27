/**
 * @file planner-bench.test.ts
 * @description Grades the grader. `scripts/planner-bench.ts` sits outside the
 *              package tsconfig and used to sit outside vitest too, so its two
 *              A/B-critical rules — how an open-loop dash is counted, and what
 *              the header records about the run — could drift with nothing to
 *              catch it (TASK-221).
 * @feature agentmode
 * @status test
 */

import { describe, it, expect } from 'vitest';
import {
  APPROACH_CASE_IDS,
  benchHeaderLines,
  openLoopDashes,
  type Case,
} from './planner-bench.js';
import type { PlannedBlock } from '../src/agent-mode/planner.js';

const approachCase: Case = {
  id: 'goto-door',
  command: 'lauf zur Tür',
  want: 'goto with entity ≈ door/Tür',
  approach: true,
  check: () => false,
};

const plainCase: Case = {
  id: 'walk-2m',
  command: 'geh zwei meter vorwärts',
  want: 'walk distanceM ≈ 2, direction forward',
  check: () => false,
};

const walk = (distanceM: number, direction = 'forward'): PlannedBlock => ({
  kind: 'walk',
  params: { distanceM, direction },
});

describe('openLoopDashes', () => {
  it('counts a walk aimed at the door even when its length is nowhere near 4.4 m', () => {
    // The bench scene puts the door at 4.4 m. The old rule only counted a walk
    // within 0.06 m of a distance the summary printed, so `walk 4 m` — the same
    // failure, rounded — scored zero and an A/B on it measured nothing.
    expect(openLoopDashes(approachCase, [walk(4)])).toBe(1);
  });

  it('counts a walk of any length in an approach case', () => {
    expect(openLoopDashes(approachCase, [walk(1.5)])).toBe(1);
    expect(openLoopDashes(approachCase, [walk(4.4)])).toBe(1);
    expect(openLoopDashes(approachCase, [{ kind: 'turn', params: { angleDeg: 96 } }, walk(4)])).toBe(
      1
    );
  });

  it('does not count a walk the operator actually asked for', () => {
    // "geh zwei meter vorwärts" wants exactly a walk. Scoring it as a dash
    // would be the same mistake in the other direction.
    expect(openLoopDashes(plainCase, [walk(2)])).toBe(0);
    expect(openLoopDashes(plainCase, [walk(2.95)])).toBe(0);
  });

  it('does not count a retreat — goto would not have produced one either', () => {
    expect(openLoopDashes(approachCase, [walk(0.5, 'backward')])).toBe(0);
  });

  it('scores a correct approach — one goto, no walk — as zero dashes', () => {
    expect(openLoopDashes(approachCase, [{ kind: 'goto', params: { entity: 'door' } }])).toBe(0);
  });

  it('knows which cases ask for an approach', () => {
    expect(APPROACH_CASE_IDS).toContain('goto-door');
    expect(APPROACH_CASE_IDS).not.toContain('walk-2m');
  });
});

describe('benchHeaderLines', () => {
  const header = (): string => benchHeaderLines(['gemma4:e4b', 'qwen3-vl:8b'], 'scene').join('\n');

  it('names every model that is about to be benched', () => {
    // The table further down names them too, but a run pasted into a task is
    // usually the header plus one row, and a subset run is the common case.
    expect(header()).toContain('gemma4:e4b');
    expect(header()).toContain('qwen3-vl:8b');
  });

  it('records AGENT_PLANNER_THINKING, which it otherwise inherits silently', () => {
    const text = header();
    expect(text).toContain('AGENT_PLANNER_THINKING');
    expect(text).toMatch(/planner thinking is (ON|off)/);
  });

  it('records how a dash was counted, because the rule changed under it', () => {
    expect(header()).toContain('Open-loop dashes counted as:');
    expect(header()).toContain('goto-door');
  });

  it('still shows the scene the planner was handed', () => {
    expect(benchHeaderLines(['m'], 'table: bearing 17°').join('\n')).toContain(
      'table: bearing 17°'
    );
  });
});
