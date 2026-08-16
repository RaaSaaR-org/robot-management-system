/**
 * @file planner.ts
 * @description Turns an operator utterance into a validated block list using
 *              the local `AGENT_PLANNER_MODEL`. The planner never sees pixels —
 *              only the scene memory's text summary. Retries ONCE on a schema
 *              failure, then falls back to a single `speak` block that says
 *              honestly that it could not plan.
 * @feature agentmode
 * @status live
 */

import { z } from 'genkit';
import { config } from '../config/config.js';
import { extractJsonObject, genkitGenerate, agentModelRef, type GenerateFn } from './llm.js';
import { buildPlannerPrompt } from './prompts.js';
import { REMEMBER_MAX_CHARS } from './workspace.js';
import {
  AgentBlockKinds,
  type AgentBlock,
  type AgentBlockKind,
  type SpokenLanguage,
} from './types.js';

/**
 * Flat schema (params as siblings of `kind`) rather than a discriminated union.
 * Small local models handle a flat object with optional keys far more reliably
 * than the `anyOf` a per-kind union compiles to, and `coerceParams` below does
 * the real per-kind validation anyway.
 */
const PlannedBlockSchema = z.object({
  kind: z.enum(AgentBlockKinds),
  reasoning: z.string().optional(),
  distanceM: z.number().optional(),
  direction: z.enum(['forward', 'backward', 'left', 'right']).optional(),
  angleDeg: z.number().optional(),
  entity: z.string().optional(),
  // `goto` only: a room/area of the place graph, instead of a seen entity (TASK-209).
  place: z.string().optional(),
  steps: z.number().optional(),
  // `wave` has NO hand selector — the G1 gesture is right-arm only. Its single
  // argument is the sidecar's documented `turn` (turn the torso toward the
  // person). See BlockExecutor.wave().
  turn: z.boolean().optional(),
  // `look` only: say out loud what the frame shows. The planner cannot know
  // the answer to "what is on the table" when it plans, so it must not put an
  // answer (or the question) into `speak` — it asks the look to speak instead.
  speak: z.boolean().optional(),
  pose: z.enum(['stand', 'high', 'low', 'sit', 'damp']).optional(),
  text: z.string().optional(),
  seconds: z.number().optional(),
  // `remember` only. Kept flat like every other param — see the schema note.
  scope: z.enum(['place', 'global']).optional(),
});

export const PlanSchema = z.object({
  blocks: z.array(PlannedBlockSchema).min(1).max(20),
});

export type PlannedBlockRaw = z.infer<typeof PlannedBlockSchema>;

/** A block the planner produced, already validated and normalized. */
export interface PlannedBlock {
  kind: AgentBlockKind;
  params: Record<string, unknown>;
  reasoning?: string;
}

export interface PlannerInput {
  command: string;
  sceneSummary: string;
  /** Not-yet-started blocks of a running plan, when re-planning. */
  remainingPlan?: AgentBlock[];
  /**
   * Language the operator SPOKE, when the command arrived by voice. Only the
   * `speak`/`greet` text follows it; `goto.entity` stays an English noun
   * whatever happens, because that is the key the scene memory is stored under.
   */
  language?: SpokenLanguage;
}

export interface PlannerResult {
  blocks: PlannedBlock[];
  /** True when both attempts failed and the honest `speak` fallback was used. */
  fallback: boolean;
  /** Why it fell back — surfaced in logs and in the spoken text. */
  error?: string;
  /** Number of model calls made (1 or 2). 0 when no call was possible. */
  attempts: number;
}

export interface PlannerDeps {
  generate?: GenerateFn;
  /** Override the model ref (tests). Default: `<prefix>/<AGENT_PLANNER_MODEL>`. */
  modelRef?: string;
}

const MAX_BLOCKS = 12;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

class PlanValidationError extends Error {}

/**
 * Per-kind parameter validation + clamping. Throws {@link PlanValidationError}
 * when a required parameter is missing — a `walk` without a distance is not
 * something to guess at, it is a schema failure worth a retry.
 */
export function coerceParams(block: PlannedBlockRaw): Record<string, unknown> {
  switch (block.kind) {
    case 'walk': {
      if (block.distanceM === undefined || !Number.isFinite(block.distanceM)) {
        throw new PlanValidationError('block "walk" is missing "distanceM"');
      }
      return {
        distanceM: clamp(block.distanceM, 0.1, 10),
        direction: block.direction ?? 'forward',
      };
    }
    case 'turn': {
      if (block.angleDeg === undefined || !Number.isFinite(block.angleDeg)) {
        throw new PlanValidationError('block "turn" is missing "angleDeg"');
      }
      return { angleDeg: clamp(block.angleDeg, -180, 180) };
    }
    case 'goto': {
      const entity = block.entity?.trim();
      const place = block.place?.trim();
      // One or the other, never both: a block that names a thing AND a room
      // is two orders, and the navigator would silently obey only one.
      if (entity && place) {
        throw new PlanValidationError('block "goto" has both "entity" and "place" — give exactly one');
      }
      if (place) return { place };
      if (!entity) throw new PlanValidationError('block "goto" is missing "entity" (or "place")');
      return { entity };
    }
    case 'look':
      return block.speak === true ? { speak: true } : {};
    case 'scan_room': {
      const steps =
        block.steps === undefined || !Number.isFinite(block.steps)
          ? 8
          : Math.round(clamp(block.steps, 4, 12));
      return { steps };
    }
    case 'wave':
      return { turn: block.turn === true };
    case 'greet':
      return block.text?.trim() ? { text: block.text.trim() } : {};
    case 'posture': {
      if (!block.pose) throw new PlanValidationError('block "posture" is missing "pose"');
      return { pose: block.pose };
    }
    case 'speak': {
      const text = block.text?.trim();
      if (!text) throw new PlanValidationError('block "speak" is missing "text"');
      return { text };
    }
    case 'wait': {
      if (block.seconds === undefined || !Number.isFinite(block.seconds)) {
        throw new PlanValidationError('block "wait" is missing "seconds"');
      }
      return { seconds: clamp(block.seconds, 0.1, 30) };
    }
    case 'remember': {
      const text = block.text?.trim();
      if (!text) throw new PlanValidationError('block "remember" is missing "text"');
      // NOT clamped to the cap the way a distance is clamped to 10 m: a
      // truncated memory is a sentence that changed meaning, and a robot that
      // durably remembers half of what it was told is worse than one that says
      // the line was too long.
      if (text.length > REMEMBER_MAX_CHARS) {
        throw new PlanValidationError(
          `block "remember" text is ${text.length} characters, over the ` +
            `${REMEMBER_MAX_CHARS}-character limit — say it in one shorter sentence`,
        );
      }
      // Read as `unknown`: the value comes from a 4B model, and the schema is
      // only one of two ways into this function (the raw-text reparse is the
      // other). An unrecognised scope is a validation failure worth a retry,
      // never a silent default to the wider one.
      const rawScope: unknown = block.scope;
      const scope = rawScope === undefined ? 'place' : rawScope;
      if (scope !== 'place' && scope !== 'global') {
        throw new PlanValidationError(
          `block "remember" has an unknown scope ${JSON.stringify(rawScope)} — ` +
            'use "place" or "global"',
        );
      }
      return { text, scope };
    }
  }
}

/**
 * Validate a candidate answer. Throws PlanValidationError on any problem.
 * `dropped` lists reasoning-only blocks removed by mergeSplitReasoningBlocks.
 */
/**
 * Direction words that unambiguously fix the sign of a turn, per language.
 * Deliberately only the plain ones — "im Uhrzeigersinn" and friends are left
 * to the model, because a half-right guess here would be worse than none.
 */
const LEFT_WORDS = /\b(links|left|counter-?clockwise|gegen den uhrzeigersinn)\b/i;
const RIGHT_WORDS = /\b(rechts|right|clockwise|im uhrzeigersinn)\b/i;

export interface TurnSignCorrection {
  from: number;
  to: number;
  direction: 'left' | 'right';
}

/**
 * Force a `turn` to match the direction the operator actually said.
 *
 * gemma3:4b emits `angleDeg: -90` for "dreh dich nach links" in 5 of 5 runs —
 * while writing "Ich drehe mich nach links" as its own reasoning — even though
 * the prompt carries that exact string as a worked example mapping to +90. The
 * prompt cannot be made to fix this, and a humanoid that turns the opposite way
 * from a plain-language instruction is not something to leave to a 4B model's
 * grasp of a sign convention.
 *
 * Only fires when the command names exactly ONE direction, so "erst links, dann
 * rechts" is left alone rather than half-corrected. What it corrects is the
 * model's sign CONVENTION — read once off the first directional turn, then
 * applied to the whole plan — so the relative structure survives: a plan that
 * turns and turns back still turns back. Returns the correction so the caller
 * can surface it instead of silently rewriting the operator's plan.
 */
export function enforceTurnDirection(
  command: string,
  blocks: PlannedBlock[]
): { blocks: PlannedBlock[]; corrections: TurnSignCorrection[] } {
  const wantsLeft = LEFT_WORDS.test(command);
  const wantsRight = RIGHT_WORDS.test(command);
  if (wantsLeft === wantsRight) return { blocks, corrections: [] };

  const sign = wantsLeft ? 1 : -1;
  const corrections: TurnSignCorrection[] = [];

  /** A turn that carries a direction: not a no-op, not a direction-free 180. */
  const directional = (block: PlannedBlock): block is PlannedBlock & { params: { angleDeg: number } } =>
    block.kind === 'turn' &&
    typeof block.params.angleDeg === 'number' &&
    block.params.angleDeg !== 0 &&
    Math.abs(block.params.angleDeg) !== 180;

  // What this repairs is the MODEL'S SIGN CONVENTION, which is a property of
  // the plan as a whole — so it is decided once, from the first directional
  // turn, and then applied to every turn.
  //
  // Judging each turn on its own was wrong in both directions. "turn left, look,
  // then turn back" -> [+90, look, -90] is a correct plan naming one direction,
  // and per-block correction flipped the RETURN leg to +90: 180° from where the
  // operator asked, logged as "turn direction corrected", and every later walk
  // in the plan then ran backwards. A genuinely inverted model emitting
  // [-90, look, +90] fared no better — only the first was flipped, giving
  // [+90, look, +90], equally 180° off. No counter-turn plan survived.
  const reference = blocks.find(directional);
  if (reference === undefined || Math.sign(reference.params.angleDeg) === sign) {
    // The convention agrees with the operator (or there is nothing to judge it
    // by), so any opposite-signed turn later in the plan is a deliberate
    // counter-turn and must be left alone.
    return { blocks, corrections: [] };
  }

  const next = blocks.map((block) => {
    if (!directional(block)) return block;
    const angle = block.params.angleDeg;
    const corrected = -angle;
    corrections.push({ from: angle, to: corrected, direction: wantsLeft ? 'left' : 'right' });
    return { ...block, params: { ...block.params, angleDeg: corrected } };
  });

  return { blocks: next, corrections };
}

/**
 * Fold a `wave` that sits right next to a `greet` into the `greet`.
 *
 * `greet` already waves and speaks. Small planners answer "wave and say hello"
 * with BOTH — `wave` then `greet` — and the robot waves twice in a row, ~8 s of
 * arm-waving for a two-second request (measured with gemma4:e2b in the sim).
 * Deterministic here rather than another prompt rule: prompt text that a
 * small model ignores is dead weight on every plan, a merge is not. Only the
 * adjacent case is touched; "wave, walk over, then greet" keeps both. When the
 * `wave` asked for the torso turn, the merged `greet` does not lose it: its
 * `turn` is copied onto the greet, which the executor honours.
 */
export function mergeAdjacentWaveIntoGreet(blocks: PlannedBlock[]): {
  blocks: PlannedBlock[];
  merged: number;
} {
  const out: PlannedBlock[] = [];
  let merged = 0;
  for (let i = 0; i < blocks.length; i++) {
    const cur = blocks[i]!;
    const next = blocks[i + 1];
    const prev = out[out.length - 1];
    if (cur.kind === 'wave' && next?.kind === 'greet') {
      merged++;
      if (cur.params.turn === true) next.params = { ...next.params, turn: true };
      continue; // the greet that follows waves anyway
    }
    if (cur.kind === 'wave' && prev?.kind === 'greet') {
      merged++;
      if (cur.params.turn === true) prev.params = { ...prev.params, turn: true };
      continue; // the greet before it already waved
    }
    out.push(cur);
  }
  return { blocks: out, merged };
}

/** True when a block cannot be executed as written (missing required params). */
function isUnexecutable(raw: PlannedBlockRaw): boolean {
  try {
    coerceParams(raw);
    return false;
  } catch {
    return true;
  }
}

/**
 * Drop a block that carries only `kind` + `reasoning` when the very next block
 * has the SAME kind and is executable.
 *
 * gemma3:4b splits reasoning away from parameters — at temperature 0 it answers
 * "dreh dich nach links" with, every single time:
 *
 *   [{"kind":"turn","reasoning":"The operator wants to turn left."},
 *    {"kind":"turn","angleDeg":90}]
 *
 * The first block is not a plan step, it is the second block's justification.
 * Rejecting the whole plan over it threw away a correct `turn` that was sitting
 * right there, and the operator got "I could not plan this" for the simplest
 * command in the vocabulary.
 *
 * Deliberately narrow: only an unexecutable block immediately followed by an
 * executable one of the same kind is dropped, and its reasoning is carried over
 * rather than discarded. A lone `turn` with no angle stays a hard failure —
 * there is nothing to recover it from, and guessing a magnitude is not our call.
 */
export function mergeSplitReasoningBlocks(blocks: PlannedBlockRaw[]): {
  blocks: PlannedBlockRaw[];
  dropped: AgentBlockKind[];
} {
  const kept: PlannedBlockRaw[] = [];
  const dropped: AgentBlockKind[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const next = blocks[i + 1];
    if (next && next.kind === block.kind && isUnexecutable(block) && !isUnexecutable(next)) {
      const reasoning = block.reasoning?.trim();
      if (reasoning && !next.reasoning?.trim()) {
        blocks[i + 1] = { ...next, reasoning };
      }
      dropped.push(block.kind);
      continue;
    }
    kept.push(block);
  }

  return { blocks: kept, dropped };
}

function validate(candidate: unknown): { blocks: PlannedBlock[]; dropped: AgentBlockKind[] } {
  const parsed = PlanSchema.safeParse(candidate);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new PlanValidationError(
      first ? `${first.path.join('.') || 'blocks'}: ${first.message}` : 'output did not match schema'
    );
  }
  const { blocks: raws, dropped } = mergeSplitReasoningBlocks(parsed.data.blocks);
  const blocks = raws.slice(0, MAX_BLOCKS).map((raw): PlannedBlock => {
    const block: PlannedBlock = { kind: raw.kind, params: coerceParams(raw) };
    const reasoning = raw.reasoning?.trim();
    if (reasoning) block.reasoning = reasoning;
    return block;
  });
  if (blocks.length === 0) throw new PlanValidationError('plan contained no blocks');
  return { blocks, dropped };
}

/**
 * The honest fallback: one `speak` block that states the planner failed. It
 * never guesses at motion — a robot that could not understand must say so, not
 * start walking.
 */
export function plannerFallback(
  command: string,
  reason: string,
  language?: SpokenLanguage
): PlannedBlock[] {
  // The technical reason stays out of the German text on purpose: it is an
  // English model/schema error, and a German voice reading it aloud is noise
  // where a plain "I did not understand that" is information. The full reason
  // is logged and shown in the block result either way.
  const text =
    language === 'de'
      ? `Ich konnte daraus keinen Plan machen: "${command}". ` +
        `Bitte sag es noch einmal anders.`
      : `I could not build a plan for "${command}". ` +
        `The local planning model gave no valid answer (${reason}). ` +
        `Please phrase the command differently.`;
  return [
    {
      kind: 'speak',
      params: { text },
      reasoning: 'Planner failed twice — reporting the failure instead of moving.',
    },
  ];
}

export class Planner {
  private readonly generate: GenerateFn;
  private readonly modelRefOverride: string | undefined;

  constructor(deps: PlannerDeps = {}) {
    this.generate = deps.generate ?? genkitGenerate;
    this.modelRefOverride = deps.modelRef;
  }

  async plan(input: PlannerInput): Promise<PlannerResult> {
    const model = this.modelRefOverride ?? (await agentModelRef(config.agentMode.plannerModel));
    const remainingPlan = input.remainingPlan?.map((b) => ({ kind: b.kind, params: b.params }));

    let lastError = 'unknown error';
    let attempts = 0;

    // Attempt 1, then exactly one repair attempt. No third try: a model that
    // fails twice is not going to succeed on the third, and the operator is
    // better served by an honest "I could not plan this".
    for (let attempt = 0; attempt < 2; attempt++) {
      const prompt = buildPlannerPrompt({
        command: input.command,
        sceneSummary: input.sceneSummary,
        ...(remainingPlan && remainingPlan.length > 0 ? { remainingPlan } : {}),
        ...(input.language ? { language: input.language } : {}),
        ...(attempt > 0 ? { repairHint: lastError } : {}),
      });

      attempts++;
      let candidateForLog: unknown;
      try {
        const res = await this.generate({
          model,
          prompt: [{ text: prompt }],
          outputSchema: PlanSchema,
          temperature: 0,
          thinking: config.agentMode.plannerThinking,
        });
        // Prefer Genkit's structured output; small models often ignore the
        // constrained-decoding request, so fall back to parsing the raw text.
        const candidate = res.output ?? extractJsonObject(res.text ?? '');
        candidateForLog = candidate ?? res.text;
        const { blocks: validated, dropped } = validate(candidate);
        if (dropped.length > 0) {
          console.warn(
            `[AgentMode/Planner] dropped ${dropped.length} reasoning-only block(s) ` +
              `(${dropped.join(', ')}) that duplicated the following block's kind.`
          );
        }
        const { blocks: deduped, merged } = mergeAdjacentWaveIntoGreet(validated);
        if (merged > 0) {
          console.warn(
            `[AgentMode/Planner] dropped ${merged} wave block(s) adjacent to a greet — greet waves already.`
          );
        }
        // Last line of defence on the turn direction — see enforceTurnDirection.
        const { blocks, corrections } = enforceTurnDirection(input.command, deduped);
        for (const c of corrections) {
          console.warn(
            `[AgentMode/Planner] turn direction corrected: the command says ` +
              `"${c.direction}" but the model emitted ${c.from}° — using ${c.to}°.`
          );
        }
        return { blocks, fallback: false, attempts };
      } catch (err) {
        lastError =
          err instanceof PlanValidationError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        // Include what was actually rejected: with a local model the answer
        // shape is the thing you need to see, and it is otherwise unrecoverable.
        // When the call itself threw there is no candidate — say so rather than
        // printing "undefined".
        const rejected =
          candidateForLog === undefined
            ? '(no answer — the model call failed)'
            : (JSON.stringify(candidateForLog) ?? String(candidateForLog)).slice(0, 600);
        console.warn(
          `[AgentMode/Planner] attempt ${attempt + 1} failed: ${lastError}\n` +
            `  rejected candidate: ${rejected}`
        );
      }
    }

    return {
      blocks: plannerFallback(input.command, lastError, input.language),
      fallback: true,
      error: lastError,
      attempts,
    };
  }
}
