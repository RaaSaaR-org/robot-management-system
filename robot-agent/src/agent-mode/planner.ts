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
import {
  extractJsonObject,
  genkitGenerate,
  agentModelRef,
  type GenerateFn,
  type GenerateRequest,
  type GenerateResponse,
} from './llm.js';
import { buildPlannerPrompt } from './prompts.js';
import { REMEMBER_MAX_CHARS } from './workspace.js';
import {
  normalizeDeg,
  PlannerBlockKinds,
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
  kind: z.enum(PlannerBlockKinds),
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

/**
 * One row of the scene memory as NUMBERS, alongside the prose `sceneSummary`
 * that was rendered from it (TASK-221).
 *
 * The planner still reasons only over the text — nothing here reaches the
 * prompt. It exists so the deterministic repairs that run over the model's
 * answer can check a block's arithmetic against the same row the model read,
 * which prose cannot support: see {@link foldTurnWalkIntoGoto}.
 */
export interface PlannerSceneTarget {
  /** The scene-memory key, i.e. what `goto.entity` has to be given. */
  label: string;
  /**
   * Bearing relative to the robot's CURRENT heading, CCW positive — the frame
   * and sign `turn.angleDeg` is in, so the two compare directly.
   *
   * The relative bearing and NOT the world bearing `sceneSummary` prints, even
   * though the printed one is what the model read. A `turn` is executed in this
   * frame, so this is the only bearing a `turn` can be checked against; see
   * {@link foldTurnWalkIntoGoto} for what matching the printed one did instead.
   */
  relativeBearingDeg: number;
  /** Distance in metres, or null when the row carries none. */
  distanceM: number | null;
}

export interface PlannerInput {
  command: string;
  sceneSummary: string;
  /**
   * The rows `sceneSummary` was rendered from. Optional: a caller that has no
   * scene store (tests, the bench) simply omits them, and every repair that
   * reads them is then a no-op rather than a guess.
   */
  sceneTargets?: readonly PlannerSceneTarget[];
  /** Not-yet-started blocks of a running plan, when re-planning. */
  remainingPlan?: AgentBlock[];
  /**
   * Language the operator SPOKE, when the command arrived by voice. Only the
   * `speak`/`greet` text follows it; `goto.entity` stays an English noun
   * whatever happens, because that is the key the scene memory is stored under.
   */
  language?: SpokenLanguage;
  /**
   * Facts a VISITOR may be answered from (TASK-213), when host mode has one in
   * front of the robot. Present only while a tour offer is outstanding: a
   * question asked DURING a tour never reaches the planner at all, it goes to
   * the grounded answerer. Their presence adds one rule to the prompt — answer
   * only from these, or say you do not know.
   */
  visitorFacts?: readonly string[];
}

export interface PlannerResult {
  blocks: PlannedBlock[];
  /** True when both attempts failed and the honest `speak` fallback was used. */
  fallback: boolean;
  /** Why it fell back — surfaced in logs and in the spoken text. */
  error?: string;
  /** Number of model calls made (1 or 2). 0 when no call was possible. */
  attempts: number;
  /**
   * Set when the round ran out of time rather than being answered badly
   * (TASK-202). `error` already carries the sentence; this is here so callers
   * can tell the two apart without matching on prose — "the model gave a bad
   * answer" and "the model gave no answer at all" want different reactions
   * from anything that ever automates on top of a failed plan.
   */
  timedOut?: boolean;
}

export interface PlannerDeps {
  generate?: GenerateFn;
  /** Override the model ref (tests). Default: `<prefix>/<AGENT_PLANNER_MODEL>`. */
  modelRef?: string;
  /**
   * Budget for the WHOLE round, both attempts together (tests; default
   * `config.agentMode.plannerTimeoutMs`). Shared rather than per call on
   * purpose: a per-call deadline lets a wedged model cost 2×, and the second
   * call against a model that just proved it does not answer is a doomed one.
   */
  timeoutMs?: number;
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

/**
 * How far a `turn` may sit from an entity's bearing, and a `walk` from that same
 * entity's distance, and still count as a copy of that scene row.
 *
 * Both are sized off what the SUMMARY hands the model, because a fold only ever
 * claims the two numbers came off one row. Bearings are printed whole
 * (`bearing 96°`) and a 4B planner rounds them to the nearest ten about as often
 * as it copies them, so 12° covers a round-to-ten in either direction while
 * staying well under the 45°/90° granularity a free-standing "turn left" is
 * written at. Distances are printed to one decimal (`~4.4 m`) and get rounded to
 * whole metres, which is at most 0.5 m off — the gemma4:e2b `goto-door` failure
 * this repair exists for emits `walk 4 m` against the 4.4 m row.
 *
 * Neither margin is evidence on its own, and that is the whole design: one
 * number landing inside a window is nothing, two independent numbers off the
 * SAME row is the signal.
 *
 * These are NOT tight enough to make a genuine "turn left and walk 3 m"
 * impossible to fold, and no honest pair of numbers would be: it takes a row
 * sitting at roughly 90° and roughly 3 m, and one will exist in some room. (The
 * reference scene in `scripts/planner-bench.ts` happens to have none — that is
 * a fact about that scene, not about the shape of the plan.) They are left
 * loose anyway, because matching on the RELATIVE bearing bounds what a wrong
 * fold can cost: the `goto` it produces ends within TURN_MATCH_DEG of the
 * heading the operator asked for, and — since a `goto` deliberately stops
 * `ARRIVAL_M` (0.6 m) SHORT of the entity it aimed at — within
 * WALK_MATCH_M + ARRIVAL_M, about 1.1 m, of the range they asked for rather
 * than within WALK_MATCH_M of it. The windows still bound their own worst
 * case, just one arrival gap wider than the walk window alone, and the robot
 * gets there staged and re-bearing rather than blind. Tightening them buys a slightly smaller version of that
 * bounded error and pays for it in missed folds, which is the failure the
 * repair exists to remove: an open-loop dash that measures nothing on the way.
 */
const TURN_MATCH_DEG = 12;
const WALK_MATCH_M = 0.5;

/** One `turn` + `walk` pair rewritten as a `goto`, so the caller can say so. */
export interface TurnWalkFold {
  label: string;
  turnDeg: number;
  walkM: number;
}

/**
 * Fold a `turn` immediately followed by a forward `walk` into a single `goto`
 * when both numbers belong to one scene row (TASK-221).
 *
 * The failure it removes: `goto-door` is answered as `turn 96°, walk 4.4 m` —
 * the model reading the door's bearing and distance straight out of the scene
 * summary and open-loop driving them. That plan is not clamped by what the
 * lidar measured, because the turn is what retires the clearance
 * (`expireClearanceOnTurn`): by the time the walk runs, the measured corridor
 * belongs to a heading the robot has left, so the walk falls back to the blind
 * cap and dashes at a door 4.4 m away one metre at a time, re-bearing nothing.
 * `goto` is the same intent driven properly — staged, re-bearing and re-looking
 * after every stage, each stage clamped by a clearance measured down the
 * heading it is walking.
 *
 * A prompt rule aimed at this was benched and reverted as noise (51/54 → 51/54),
 * which is why the repair is deterministic and lives here with
 * {@link enforceTurnDirection} rather than in the prompt.
 *
 * Deliberately narrow. Only an ADJACENT pair folds, only a FORWARD walk, only
 * against a row that actually carries a distance, and only when exactly ONE row
 * answers to both numbers — two matching rows is an ambiguous signal, not a
 * stronger one, and picking either would choose the robot's destination by array
 * order.
 *
 * And only against the row's RELATIVE bearing. The scene summary prints world
 * bearings next to a separate heading line, so a small planner does sometimes
 * copy the printed number straight into `turn` — but a `turn` is executed
 * relative to where the robot is pointing now, so such a turn does not aim at
 * the row, and matching it against the world bearing would fire this fold on a
 * frame the robot has already left. The two frames coincide only at yaw 0,
 * which is why an earlier world-bearing arm here looked harmless and was in
 * fact unsound: with the robot turned 50° off, "dreh dich 96 Grad nach links
 * und geh 4,4 Meter" — an angle the operator named outright — matched a door
 * stored at world 96° and was silently rewritten into a 146° turn (TASK-221).
 * Matching relative keeps the fold destination-preserving: it only ever fires
 * on a pair that was already heading for that row, and replaces the blind drive
 * there with a measured one. A missed fold costs a dash; a wrong fold walks the
 * robot somewhere nobody asked for.
 */
export function foldTurnWalkIntoGoto(
  blocks: PlannedBlock[],
  targets: readonly PlannerSceneTarget[] | undefined
): { blocks: PlannedBlock[]; folds: TurnWalkFold[] } {
  if (!targets || targets.length === 0) return { blocks, folds: [] };

  const out: PlannedBlock[] = [];
  const folds: TurnWalkFold[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const cur = blocks[i]!;
    const next = blocks[i + 1];
    const turnDeg = cur.kind === 'turn' ? Number(cur.params.angleDeg) : Number.NaN;
    const walkM =
      next !== undefined && next.kind === 'walk' && next.params.direction === 'forward'
        ? Number(next.params.distanceM)
        : Number.NaN;
    if (!Number.isFinite(turnDeg) || !Number.isFinite(walkM)) {
      out.push(cur);
      continue;
    }

    const matches = targets.filter(
      (t) =>
        t.distanceM !== null &&
        Math.abs(walkM - t.distanceM) <= WALK_MATCH_M &&
        Math.abs(normalizeDeg(turnDeg - t.relativeBearingDeg)) <= TURN_MATCH_DEG
    );
    if (matches.length !== 1) {
      out.push(cur);
      continue;
    }

    const target = matches[0]!;
    // Keep whatever the model said about the pair — it explained the intent
    // correctly, it only chose the wrong two blocks to express it with — and
    // append what was done to it, because the operator sees this line.
    const said = cur.reasoning ?? next!.reasoning;
    const folded: PlannedBlock = {
      kind: 'goto',
      params: { entity: target.label },
      reasoning:
        `${said ? `${said} ` : ''}(Turning ${Math.round(turnDeg)}° and walking ` +
        `${walkM.toFixed(2)} m is an open-loop approach to "${target.label}", which the scene ` +
        `memory has at that bearing and that distance — walking there measured instead.)`,
    };
    out.push(folded);
    folds.push({ label: target.label, turnDeg, walkM });
    i++; // the walk is consumed by the goto
  }

  return { blocks: out, folds };
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
  language?: SpokenLanguage,
  timedOut = false
): PlannedBlock[] {
  // The technical reason stays out of the German text on purpose: it is an
  // English model/schema error, and a German voice reading it aloud is noise
  // where a plain "I did not understand that" is information. The full reason
  // is logged and shown in the block result either way.
  //
  // A timeout is the one case that gets its own sentence in both languages,
  // because the advice differs: "say it differently" is useless when the model
  // never answered at all — nothing about the phrasing was the problem.
  const text =
    language === 'de'
      ? timedOut
        ? `Ich konnte daraus keinen Plan machen: "${command}". ` +
          `Das Planungsmodell hat nicht rechtzeitig geantwortet.`
        : `Ich konnte daraus keinen Plan machen: "${command}". ` +
          `Bitte sag es noch einmal anders.`
      : timedOut
        ? `I could not build a plan for "${command}": ${reason}.`
        : `I could not build a plan for "${command}". ` +
          `The local planning model gave no valid answer (${reason}). ` +
          `Please phrase the command differently.`;
  return [
    {
      kind: 'speak',
      params: { text },
      reasoning: timedOut
        ? 'Planner did not answer in time — reporting the failure instead of moving.'
        : 'Planner failed twice — reporting the failure instead of moving.',
    },
  ];
}

/**
 * What a timeout says, in one sentence: what did not happen, to which model,
 * after how long, and what to look at. The planner is a local model on this
 * box, so naming it and the command that shows its health is the difference
 * between a failure an operator can act on and a generic "planning failed".
 *
 * Seen live (GPU_BOX 2026-08-02): `ollama ps` listed the model as loaded with
 * `size_vram=1.77GB` while its worker had died and every request hung — so the
 * check to suggest is not "is it listed" but "does it answer".
 */
function timeoutMessage(model: string, timeoutMs: number): string {
  const seconds = Math.round(timeoutMs / 100) / 10;
  return (
    `the planner (${model}) did not answer within ${seconds} s — ` +
    `check that it still answers (\`ollama ps\` can list a model whose worker has died; ` +
    `restarting the Ollama server clears that)`
  );
}

/**
 * The planning round ran out of time. Distinct from a schema failure so
 * {@link Planner.plan} can word its answer differently and set `timedOut`
 * without matching on prose.
 */
export class PlannerTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlannerTimeoutError';
  }
}

export class Planner {
  private readonly generate: GenerateFn;
  private readonly modelRefOverride: string | undefined;
  private readonly timeoutMs: number;

  constructor(deps: PlannerDeps = {}) {
    this.generate = deps.generate ?? genkitGenerate;
    this.modelRefOverride = deps.modelRef;
    this.timeoutMs = deps.timeoutMs ?? config.agentMode.plannerTimeoutMs;
  }

  /**
   * One generate call, cancelled when the round's remaining budget runs out.
   *
   * Both halves are load-bearing. The `AbortSignal` is what actually cancels
   * the request, so a wedged model does not keep a socket for the rest of the
   * process; the race is what guarantees this promise settles even so, because
   * the thing being raced may be a transport that ignores the signal (and, in
   * tests, a double that never resolves at all). Abandoning the call with only
   * a race would leave a request in flight per timed-out plan.
   */
  private async generateWithin(
    req: GenerateRequest,
    remainingMs: number,
    model: string
  ): Promise<GenerateResponse> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.generate({ ...req, signal: controller.signal }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new PlannerTimeoutError(timeoutMessage(model, this.timeoutMs)));
          }, remainingMs);
          // Never hold the process open for a deadline nobody is waiting on.
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async plan(input: PlannerInput): Promise<PlannerResult> {
    const model = this.modelRefOverride ?? (await agentModelRef(config.agentMode.plannerModel));
    const remainingPlan = input.remainingPlan?.map((b) => ({ kind: b.kind, params: b.params }));

    let lastError = 'unknown error';
    let attempts = 0;
    let timedOut = false;
    // ONE budget for the whole round. A per-call deadline would let a wedged
    // model cost 2× the configured timeout, and the operator was told one
    // number. The repair attempt is cheap against a healthy model (~1 s), so a
    // shared budget almost never costs a legitimate retry.
    const deadline = Date.now() + this.timeoutMs;

    // Attempt 1, then exactly one repair attempt. No third try: a model that
    // fails twice is not going to succeed on the third, and the operator is
    // better served by an honest "I could not plan this".
    for (let attempt = 0; attempt < 2; attempt++) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        // Out of time before this attempt started. Reached either because the
        // previous attempt consumed the whole budget or because the knob is
        // configured to zero; in both cases the honest thing is not to open a
        // call we already know we will not wait for.
        timedOut = true;
        lastError = timeoutMessage(model, this.timeoutMs);
        break;
      }

      const prompt = buildPlannerPrompt({
        command: input.command,
        sceneSummary: input.sceneSummary,
        ...(remainingPlan && remainingPlan.length > 0 ? { remainingPlan } : {}),
        ...(input.language ? { language: input.language } : {}),
        ...(input.visitorFacts && input.visitorFacts.length > 0 ? { visitorFacts: input.visitorFacts } : {}),
        ...(attempt > 0 ? { repairHint: lastError } : {}),
      });

      attempts++;
      let candidateForLog: unknown;
      try {
        const res = await this.generateWithin(
          {
            model,
            prompt: [{ text: prompt }],
            outputSchema: PlanSchema,
            temperature: 0,
            thinking: config.agentMode.plannerThinking,
          },
          remainingMs,
          model
        );
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
        // Deterministic repair, after the sign correction so it reads the turns
        // the robot will actually make — see foldTurnWalkIntoGoto.
        const { blocks: folded, folds } = foldTurnWalkIntoGoto(blocks, input.sceneTargets);
        for (const f of folds) {
          console.warn(
            `[AgentMode/Planner] folded turn ${Math.round(f.turnDeg)}° + walk ` +
              `${f.walkM.toFixed(2)} m into goto "${f.label}" — both numbers are that scene ` +
              `row's, so the pair was an open-loop approach to it.`
          );
        }
        return { blocks: folded, fallback: false, attempts };
      } catch (err) {
        lastError =
          err instanceof PlanValidationError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        if (err instanceof PlannerTimeoutError) {
          // Nothing to repair: the model produced no answer to repair FROM,
          // and the budget it just consumed is the whole round's.
          timedOut = true;
          console.warn(`[AgentMode/Planner] attempt ${attempt + 1} timed out: ${lastError}`);
          break;
        }
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
      blocks: plannerFallback(input.command, lastError, input.language, timedOut),
      fallback: true,
      error: lastError,
      attempts,
      ...(timedOut ? { timedOut: true } : {}),
    };
  }
}
