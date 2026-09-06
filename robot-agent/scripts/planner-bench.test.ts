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
  BENCH_CASE_IDS,
  VLA_CASES,
  benchHeaderLines,
  openLoopDashes,
  type Case,
} from './planner-bench.js';
import { VLA_SKILL_IDS } from '../src/agent-mode/vla-skills.js';
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

describe('VLA_CASES', () => {
  it('is kept out of the 18-case gate, so the historical score stays comparable', () => {
    // 51/54 on gemma4:e4b (TASK-221, 2026-08-27) is only a baseline while the
    // denominator holds. Folding three cases in would silently make it 63 and
    // every past number unreadable.
    expect(BENCH_CASE_IDS).toHaveLength(18);
    for (const c of VLA_CASES) expect(BENCH_CASE_IDS).not.toContain(c.id);
  });

  it('only ever asks for a skill this robot actually has', () => {
    // The bench grades on an exact id. If the catalogue renames one, this test
    // fails here rather than the bench quietly scoring 0/9 forever and reading
    // as a planner regression.
    const wanted = VLA_CASES.map((c) => c.skill);
    expect(wanted.filter(Boolean)).toHaveLength(VLA_CASES.length);
    for (const id of wanted) expect(VLA_SKILL_IDS).toContain(id);
  });

  it('requires the walk before the rollout, because the block does not walk', () => {
    const approachFirst = VLA_CASES.find((c) => c.id === 'vla-needs-approach');
    expect(approachFirst).toBeDefined();
    const goto = { kind: 'goto', params: { entity: 'table' } };
    const skill = { kind: 'vla_skill', params: { skill: 'g1_apple_pnp' } };
    expect(approachFirst?.check([goto, skill] as never)).toBe(true);
    // The rollout first is the failure mode: the robot grasps at air.
    expect(approachFirst?.check([skill, goto] as never)).toBe(false);
    expect(approachFirst?.check([skill] as never)).toBe(false);
  });
});
