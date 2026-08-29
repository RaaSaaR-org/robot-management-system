/**
 * @file vla-skills.ts
 * @description The named manipulation skills a `vla_skill` block may call, and
 *              the EXACT prompt each policy was trained on (TASK-226).
 * @feature agentmode
 * @status live
 *
 * ## Why a catalogue and not a free-text field
 *
 * The block is a NAMED, PARAMETERISED call. The name is what carries the
 * trained prompt, the step budget, the retry policy, the gating and the
 * logging; the natural-language instruction is one FIELD of it. A planner that
 * could write its own instruction would silently walk off the policy's training
 * distribution — which is not an error, it is a quality cliff nobody sees.
 *
 * ## Why the strings are duplicated from the server
 *
 * These profiles mirror `VLA_EVAL_PROFILES` in
 * `server/src/services/SimulationService.ts`, which is where the sim evaluator
 * reads them. The robot agent is a separate package and cannot import from the
 * server, so the table is duplicated — and pinned by
 * `__tests__/vla-skills.test.ts`, which parses the server file and fails when
 * the two drift. A `task` string that drifts is exactly the defect that has no
 * symptom: the policy just gets quietly worse.
 *
 * The strings are DATA, copied character for character from the dataset's
 * `annotation.human.task_description`. `move the apple to the plate` has no
 * trailing period and no capital M on purpose. Do not "fix" them.
 */

import { config } from '../config/config.js';
import type { VlaSkillOutcome } from './types.js';

/** One callable skill: a name, the prompt its policy was trained on, a budget. */
export interface VlaSkillProfile {
  /** Stable id — what a `vla_skill` block's `skill` param names. */
  id: string;
  /** Short human label for the UI card and the spoken line. */
  label: string;
  /**
   * The string handed to the policy, verbatim. Copied from the dataset the
   * checkpoint was trained on; never generated, never templated, and never
   * `Execute skill <name>`.
   */
  task: string;
  /** Step budget for one rollout — the horizon the checkpoint was trained at. */
  maxSteps: number;
  /** Steps of each action chunk executed before re-querying the policy. */
  execHorizon?: number;
  /** One sentence for the planner prompt, so the model knows when to pick it. */
  hint: string;
}

/**
 * The catalogue. Keys are the ids the planner may write.
 *
 * `g1` / `unitree_g1` from `VLA_EVAL_PROFILES` are deliberately ABSENT: that
 * profile's task is "Walk to the goal zone while avoiding keep-out areas",
 * which is locomotion, and locomotion belongs to `goto` and the navigator —
 * they measure, plan on the map and refuse keepouts, none of which a VLA
 * rollout does. Advertising a walking "skill" next to `goto` would give the
 * planner two ways to cross a room and no way to choose between them.
 */
export const VLA_SKILL_PROFILES: Readonly<Record<string, VlaSkillProfile>> = {
  g1_apple_pnp: {
    id: 'g1_apple_pnp',
    label: 'apple pick and place',
    // NVIDIA GR00T E2E apple workflow (GR00T-N1.7-AppleToPlate contract): the
    // dataset's exact annotation.human.task_description.
    task: 'move the apple to the plate',
    maxSteps: 600,
    execHorizon: 8,
    hint: 'pick up an apple and put it on a plate',
  },
  g1_dex3: {
    id: 'g1_dex3',
    label: 'bottle into the plate',
    // GR00T-N1.7 checkpoint contract (n187_real_only_14k).
    task: 'Put the bottle into the plate.',
    maxSteps: 600,
    execHorizon: 8,
    hint: 'put a bottle into a plate',
  },
};

/** Every id the planner may write, in a stable order (the prompt renders it). */
export const VLA_SKILL_IDS: readonly string[] = Object.keys(VLA_SKILL_PROFILES);

/**
 * Resolve a skill name to its profile, or null.
 *
 * Tolerant about SHAPE (case, spaces, hyphens) and strict about IDENTITY: a
 * name that is not in the catalogue resolves to nothing, and the caller says
 * which names exist. A near-miss must never fall through to "some other
 * policy", because the wrong policy runs just as happily as the right one.
 */
export function resolveVlaSkill(name: string): VlaSkillProfile | null {
  const key = name.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!key) return null;
  return VLA_SKILL_PROFILES[key] ?? null;
}

/**
 * Wall-clock budget for one rollout of `profile`, ms.
 *
 * Derived from the step budget and the loop period the executor will actually
 * pace at (`VLA_LOOP_PERIOD_MS`, 200 ms by default) rather than pinned at the
 * 60 s that `demo` used: 600 steps at 5 Hz is two minutes, so a fixed 60 s
 * timeout would have cut every apple rollout in half and reported it as a
 * timeout failure. The 1.5x is head-room for `/predict` round trips, which are
 * not free and are not in the loop period.
 */
export function skillTimeoutMs(profile: VlaSkillProfile): number {
  const period = config.vla.loopPeriodMs > 0 ? config.vla.loopPeriodMs : 200;
  return Math.min(600_000, Math.max(30_000, Math.round(profile.maxSteps * period * 1.5)));
}

// ── The runner contract ─────────────────────────────────────────────────────

/** One rollout, as the block asks for it. */
export interface SkillRunRequest {
  skillId: string;
  skillName: string;
  /**
   * The prompt handed to the policy, VERBATIM. `vla_skill` always fills this in
   * from {@link VLA_SKILL_PROFILES}; a host-authored `demo` (TASK-213) has no
   * catalogue entry and leaves it absent, which is the one case the runner
   * still has to fall back for.
   */
  taskPrompt?: string;
  /** Step budget for the rollout. Absent = the runner's own default. */
  maxSteps?: number;
  timeoutMs?: number;
}

/**
 * What one rollout reported back.
 *
 * `ok` and `outcome` are DIFFERENT questions and are kept apart on purpose.
 * `ok` is "the rollout ran to its end without erroring" — the only thing
 * `SkillExecutor` can actually answer, and what `demo` has always meant by it.
 * `outcome` is "did the robot achieve the task", which nothing inside the
 * policy can answer: see {@link VlaSkillOutcome}.
 */
export interface SkillRunReport {
  ok: boolean;
  /** The three-way verdict. Never `succeeded` on the strength of `ok`. */
  outcome: VlaSkillOutcome;
  /**
   * WHERE the verdict came from, so an operator reading the block can tell a
   * checked outcome from an unchecked one. `'rollout'` means nothing looked at
   * the world and the answer is `unknown` by construction.
   */
  verdictSource: string;
  steps?: number;
  durationMs?: number;
  message: string;
}
