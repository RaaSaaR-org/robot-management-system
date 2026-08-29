/**
 * @file vla-skill-block.test.ts
 * @description The `vla_skill` handler in isolation (TASK-226): what it sends
 *              to the runner, what each of the three outcomes means for the
 *              plan, and the refusals it makes before a policy is ever started.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, vi } from 'vitest';
import { runVlaSkillBlock } from '../vla-skill-block.js';
import type { BlockExecutorDeps } from '../block-executor.js';
import type { AgentBlock, VlaSkillOutcome } from '../types.js';

/** A block exactly as `coerceParams` produces it. */
function appleBlock(overrides: Record<string, unknown> = {}): AgentBlock {
  return {
    id: 'b1',
    kind: 'vla_skill',
    params: {
      skill: 'g1_apple_pnp',
      label: 'apple pick and place',
      instruction: 'move the apple to the plate',
      maxSteps: 600,
      timeoutMs: 180_000,
      ...overrides,
    },
    status: 'running',
  };
}

function deps(over: Partial<BlockExecutorDeps> = {}): BlockExecutorDeps {
  return {
    isAborted: () => false,
    runSkill: async () => ({
      ok: true,
      outcome: 'unknown' as VlaSkillOutcome,
      verdictSource: 'rollout',
      steps: 600,
      durationMs: 120_000,
      message: 'Ran "apple pick and place": 600 step(s) in 120.0 s. Outcome unknown — nothing checked whether the task actually succeeded.',
    }),
    ...over,
  } as unknown as BlockExecutorDeps;
}

describe('what reaches the runner', () => {
  it('passes the catalogue’s prompt and budget through UNCHANGED', async () => {
    const runSkill = vi.fn(deps().runSkill!);
    await runVlaSkillBlock(appleBlock(), deps({ runSkill }));

    expect(runSkill).toHaveBeenCalledWith({
      skillId: 'g1_apple_pnp',
      skillName: 'apple pick and place',
      taskPrompt: 'move the apple to the plate',
      maxSteps: 600,
      timeoutMs: 180_000,
    });
  });
});

describe('the three-way outcome decides what the plan does', () => {
  it('`unknown` does not fail the plan, and says nobody checked', async () => {
    const block = appleBlock();
    const outcome = await runVlaSkillBlock(block, deps());

    // A block kind that always fails is one nobody can use, and with no success
    // classifier wired up every rollout is `unknown`. What must not happen is
    // the block claiming success — and the message is where that is prevented.
    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain('Outcome unknown');
    expect(block.params.outcome).toBe('unknown');
    expect(block.params.verdictSource).toBe('rollout');
  });

  it('`failed` fails the block', async () => {
    const block = appleBlock();
    const outcome = await runVlaSkillBlock(
      block,
      deps({
        runSkill: async () => ({
          ok: false,
          outcome: 'failed',
          verdictSource: 'executor:timeout',
          message: '"apple pick and place" did not finish: timeout',
        }),
      }),
    );
    expect(outcome.ok).toBe(false);
    expect(block.params.outcome).toBe('failed');
  });

  it('`succeeded` is carried through with its source', async () => {
    const block = appleBlock();
    const outcome = await runVlaSkillBlock(
      block,
      deps({
        runSkill: async () => ({
          ok: true,
          outcome: 'succeeded',
          verdictSource: 'success-classifier',
          message: '"apple pick and place" succeeded (success-classifier).',
        }),
      }),
    );
    expect(outcome.ok).toBe(true);
    expect(block.params.outcome).toBe('succeeded');
    expect(block.params.verdictSource).toBe('success-classifier');
  });

  it('a runner that says ok:true but outcome:failed still fails the block', async () => {
    // The two fields answer different questions, and it is `outcome` that the
    // plan follows: a rollout that ran cleanly while the apple never moved is a
    // failure, however smoothly the loop executed.
    const block = appleBlock();
    const outcome = await runVlaSkillBlock(
      block,
      deps({
        runSkill: async () => ({
          ok: true,
          outcome: 'failed',
          verdictSource: 'success-classifier',
          message: 'the apple is still on the table',
        }),
      }),
    );
    expect(outcome.ok).toBe(false);
  });
});

describe('refusals, before a policy is ever started', () => {
  it('refuses a block with no skill', async () => {
    const runSkill = vi.fn();
    const outcome = await runVlaSkillBlock(
      appleBlock({ skill: '' }),
      deps({ runSkill: runSkill as unknown as BlockExecutorDeps['runSkill'] }),
    );
    expect(outcome.ok).toBe(false);
    expect(runSkill).not.toHaveBeenCalled();
  });

  it('refuses a block with no trained instruction rather than inventing one', async () => {
    // `Execute skill <name>` is the exact fallback TASK-226 deletes. A
    // validation gap must reach a refusal here, not a re-invented prompt.
    const runSkill = vi.fn();
    const outcome = await runVlaSkillBlock(
      appleBlock({ instruction: '' }),
      deps({ runSkill: runSkill as unknown as BlockExecutorDeps['runSkill'] }),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('no trained instruction');
    expect(runSkill).not.toHaveBeenCalled();
  });

  it('says so when this agent cannot run skills at all', async () => {
    const outcome = await runVlaSkillBlock(appleBlock(), { isAborted: () => false } as unknown as BlockExecutorDeps);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('cannot run skills');
  });

  it('does not START a rollout while the plan is stopping', async () => {
    // The abort flag is checked BEFORE dispatch: a policy that has begun
    // reaching cannot be stopped between two action chunks without leaving the
    // arm somewhere nobody planned, so the cheap moment to refuse is here.
    const runSkill = vi.fn();
    const outcome = await runVlaSkillBlock(
      appleBlock(),
      deps({ isAborted: () => true, runSkill: runSkill as unknown as BlockExecutorDeps['runSkill'] }),
    );
    expect(outcome.ok).toBe(false);
    expect(runSkill).not.toHaveBeenCalled();
  });
});
