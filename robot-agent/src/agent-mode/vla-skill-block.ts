/**
 * @file vla-skill-block.ts
 * @description The `vla_skill` block handler (TASK-226) — the one block a
 *              planner may emit that hands the arms to a learned policy.
 * @feature agentmode
 * @status live
 *
 * Its own module rather than another method on `BlockExecutor`: that class is
 * ~1200 lines of locomotion, and this block commands no base motion at all. It
 * is dispatched from the executor's `execute` switch and reads the same
 * `BlockExecutorDeps`, so nothing about the block contract changes.
 */

import type { BlockExecutorDeps } from './block-executor.js';
import type { AgentBlock, BlockOutcome } from './types.js';

/**
 * Run one planned VLA skill.
 *
 * `coerceParams` (planner.ts) has already resolved the skill name against the
 * catalogue, so `instruction`, `maxSteps` and `timeoutMs` arrive filled in and
 * are passed through UNCHANGED. Nothing here invents a prompt: a policy fed a
 * string it was not trained on degrades silently, which is worse than a
 * refusal.
 *
 * The three-way outcome is the runner's answer, not this block's. What this
 * block decides is what each outcome MEANS for the plan:
 *
 * - `failed` fails the block, so `runPlan` stops and the reason reaches the
 *   planner's next context.
 * - `succeeded` is a `done` block, and can only ever come from a check on the
 *   world outside the policy (`AgentModeDeps.skillVerdict`).
 * - `unknown` is a `done` block whose message says, in the first words an
 *   operator reads, that nobody checked. It does NOT fail the plan: with no
 *   success signal wired up every rollout would be `unknown`, and a block kind
 *   that always fails is one nobody can use. The dishonesty this block exists
 *   to prevent is claiming success, not declining to claim it.
 */
export async function runVlaSkillBlock(
  block: AgentBlock,
  deps: BlockExecutorDeps,
): Promise<BlockOutcome> {
  const p = block.params;
  const skillId = typeof p.skill === 'string' ? p.skill : '';
  const label = typeof p.label === 'string' && p.label ? p.label : skillId;
  const instruction = typeof p.instruction === 'string' ? p.instruction : '';

  if (!skillId) return { ok: false, message: 'vla_skill: no skill named' };
  if (!instruction) {
    // Unreachable through `coerceParams`, and deliberately fatal rather than
    // defaulted: `Execute skill <name>` is the exact fallback TASK-226 exists
    // to delete, and re-introducing it here would put it back on the one path
    // a validation gap can take.
    return { ok: false, message: `vla_skill: "${skillId}" has no trained instruction` };
  }
  if (!deps.runSkill) {
    return { ok: false, message: `vla_skill: this agent cannot run skills, so "${label}" did not run.` };
  }
  // Refused BEFORE the rollout, not cut short during it: a policy that has
  // already begun reaching cannot be stopped between two action chunks without
  // leaving the arm somewhere nobody planned. Once it HAS started, the abort
  // path is `skillExecutorRegistry` — see `AgentModeController.runVlaSkill`.
  if (deps.isAborted()) {
    return { ok: false, message: `vla_skill: "${label}" was not started — the plan is stopping.` };
  }

  const maxSteps = Number(p.maxSteps);
  const timeoutMs = Number(p.timeoutMs);
  const report = await deps.runSkill({
    skillId,
    skillName: label,
    taskPrompt: instruction,
    ...(Number.isFinite(maxSteps) ? { maxSteps } : {}),
    ...(Number.isFinite(timeoutMs) ? { timeoutMs } : {}),
  });

  // Carried on the block so the UI card and anything reading finished blocks
  // can render the verdict without parsing the message.
  p.outcome = report.outcome;
  p.verdictSource = report.verdictSource;
  if (typeof report.steps === 'number') p.steps = report.steps;

  return { ok: report.outcome !== 'failed', message: report.message };
}
