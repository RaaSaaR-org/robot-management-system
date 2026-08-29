/**
 * @file vla-skills.test.ts
 * @description The skill catalogue (TASK-226): the trained task strings match
 *              the server's `VLA_EVAL_PROFILES` character for character, an
 *              unknown skill name resolves to nothing, and `coerceParams` fills
 *              the block from the catalogue rather than from the model.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveVlaSkill,
  skillTimeoutMs,
  VLA_SKILL_IDS,
  VLA_SKILL_PROFILES,
} from '../vla-skills.js';
import { coerceParams } from '../planner.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SIM_SERVICE = path.resolve(HERE, '../../../../server/src/services/SimulationService.ts');

describe('the trained task strings', () => {
  it('are the exact strings the policies were trained on', () => {
    // Pinned as literals as well as diffed against the server below: this is
    // the assertion that survives the server file being renamed or moved, and
    // the strings are the whole point of the catalogue. No trailing period on
    // the apple task — it is the dataset's `annotation.human.task_description`.
    expect(VLA_SKILL_PROFILES.g1_apple_pnp.task).toBe('move the apple to the plate');
    expect(VLA_SKILL_PROFILES.g1_apple_pnp.maxSteps).toBe(600);
    expect(VLA_SKILL_PROFILES.g1_dex3.task).toBe('Put the bottle into the plate.');
    expect(VLA_SKILL_PROFILES.g1_dex3.maxSteps).toBe(600);
  });

  it('has not drifted from the server’s VLA_EVAL_PROFILES', () => {
    // The robot agent is a separate package and cannot import from the server,
    // so the table is duplicated. This is the guard on that duplication — a
    // drifted task string has NO symptom at runtime, the policy just gets
    // quietly worse. Skipped rather than failed when the server is not checked
    // out beside us, so "not checked" stays distinguishable from "broken".
    if (!fs.existsSync(SIM_SERVICE)) {
      console.warn(`[vla-skills.test] ${SIM_SERVICE} not found — drift check skipped`);
      return;
    }
    const source = fs.readFileSync(SIM_SERVICE, 'utf8');
    const table = source.slice(
      source.indexOf('const VLA_EVAL_PROFILES'),
      source.indexOf('// ============================================================================\n// PATHS'),
    );
    expect(table).not.toBe('');

    for (const profile of Object.values(VLA_SKILL_PROFILES)) {
      const entry = table.slice(table.indexOf(`${profile.id}: {`));
      expect(entry, `${profile.id} is missing from VLA_EVAL_PROFILES`).not.toBe('');
      const task = /task:\s*'([^']*)'/.exec(entry)?.[1];
      const maxSteps = /maxSteps:\s*(\d+)/.exec(entry)?.[1];
      expect(task, `${profile.id}.task`).toBe(profile.task);
      expect(Number(maxSteps), `${profile.id}.maxSteps`).toBe(profile.maxSteps);
    }
  });
});

describe('resolveVlaSkill', () => {
  it('is tolerant about shape and strict about identity', () => {
    expect(resolveVlaSkill('g1_apple_pnp')?.id).toBe('g1_apple_pnp');
    expect(resolveVlaSkill('  G1-Apple-PnP ')?.id).toBe('g1_apple_pnp');
    expect(resolveVlaSkill('g1 apple pnp')?.id).toBe('g1_apple_pnp');
  });

  it('resolves a near-miss to NOTHING rather than to another policy', () => {
    // Asserted as `null` and not as "some profile": the wrong policy runs just
    // as happily as the right one, and the operator would read the name they
    // asked for on the block card while a different checkpoint drove the arms.
    expect(resolveVlaSkill('apple')).toBeNull();
    expect(resolveVlaSkill('g1_apple')).toBeNull();
    expect(resolveVlaSkill('')).toBeNull();
    expect(resolveVlaSkill('open_door')).toBeNull();
  });

  it('does not offer the locomotion profile as a skill', () => {
    // `VLA_EVAL_PROFILES.g1` is "Walk to the goal zone…". Locomotion belongs to
    // `goto` and the navigator, which measure, plan on the map and refuse
    // keepouts — none of which a VLA rollout does.
    expect(resolveVlaSkill('g1')).toBeNull();
    expect(resolveVlaSkill('unitree_g1')).toBeNull();
    expect(VLA_SKILL_IDS).toEqual(['g1_apple_pnp', 'g1_dex3']);
  });
});

describe('skillTimeoutMs', () => {
  it('covers the checkpoint’s whole horizon, not the 60 s `demo` assumed', () => {
    // 600 steps at the 200 ms default loop period is two minutes of rollout;
    // a fixed 60 s budget cut every apple attempt in half and reported it as a
    // timeout failure.
    const ms = skillTimeoutMs(VLA_SKILL_PROFILES.g1_apple_pnp);
    expect(ms).toBeGreaterThanOrEqual(120_000);
    expect(ms).toBeLessThanOrEqual(600_000);
  });
});

describe('coerceParams for `vla_skill`', () => {
  it('fills the instruction from the CATALOGUE, never from the model', () => {
    const params = coerceParams({ kind: 'vla_skill', skill: 'g1_apple_pnp' });
    expect(params).toEqual({
      skill: 'g1_apple_pnp',
      label: 'apple pick and place',
      instruction: 'move the apple to the plate',
      maxSteps: 600,
      timeoutMs: expect.any(Number),
    });
  });

  it('rejects a missing skill rather than guessing one', () => {
    expect(() => coerceParams({ kind: 'vla_skill' })).toThrow(/missing "skill"/);
  });

  it('names the skills this robot actually has when the model invents one', () => {
    expect(() => coerceParams({ kind: 'vla_skill', skill: 'open_the_door' })).toThrow(
      /unknown skill "open_the_door".*g1_apple_pnp/s,
    );
  });

  it('has no `instruction` field for the model to write', () => {
    // The planner schema carries no `instruction`, so even a model that emits
    // one cannot reach the policy with it. Asserted through `coerceParams`,
    // which is the only path from a model answer to block params.
    const params = coerceParams({
      kind: 'vla_skill',
      skill: 'g1_apple_pnp',
      // @ts-expect-error — deliberately not in PlannedBlockRaw; this is the
      // point of the assertion.
      instruction: 'grab the apple really hard',
    });
    expect(params.instruction).toBe('move the apple to the plate');
  });
});
