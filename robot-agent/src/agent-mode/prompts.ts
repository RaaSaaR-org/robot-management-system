/**
 * @file prompts.ts
 * @description Planner and vision prompt text for Agent Mode.
 * @feature agentmode
 * @status live
 *
 * WHY NOT `prompts/planner.prompt` + `prompts/vision.prompt` (Dotprompt files),
 * as TASK-194 sketched:
 *
 *  1. Genkit resolves Dotprompt files from a single `promptDir` fixed on the
 *     `ai` instance (`src/prompts`, see agent/genkit.ts). A second directory
 *     would need a second genkit instance, and moving these two into
 *     `src/prompts` would put Agent Mode's prompts outside its own module.
 *  2. `npm run build` is plain `tsc`, which copies no `.prompt` files into
 *     `dist/`. Adding two more non-compiled runtime dependencies would extend
 *     an existing latent packaging gap rather than avoid it.
 *  3. Both calls need things Dotprompt does not give us here: a per-call model
 *     override (planner vs. vision model), a Zod output schema plus a raw-text
 *     reparse fallback, a retry, and a media part built from a runtime data URL.
 *
 * The prompt text itself is still authored in one place and is the only thing a
 * prompt-tuning change has to touch.
 */

import { AgentBlockKinds } from './types.js';

/** The block vocabulary, rendered once so the planner prompt cannot drift. */
const BLOCK_REFERENCE = `
- walk       {"distanceM": 0.1..10, "direction": "forward"|"backward"|"left"|"right"}
- turn       {"angleDeg": -180..180}          (+ = left / counter-clockwise)
- goto       {"entity": "<bare English noun, e.g. table, chair, shelf, person>"}
- look       {}                                (one camera frame → scene memory)
- scan_room  {"steps": 4..12}                  (default 8; full 360° sweep)
- wave       {"turn": true|false}              (right arm only — the G1 wave has
                                                no hand selector; "turn" turns
                                                the torso toward the person)
- greet      {"text": "<what to say>"}         (speak + wave)
- posture    {"pose": "stand"|"high"|"low"|"sit"|"damp"}
- speak      {"text": "<what to say>"}
- wait       {"seconds": 0.1..30}
`.trim();

export interface PlannerPromptInput {
  /** The user's utterance, verbatim. */
  command: string;
  /** Compact scene-memory rendering (SceneMemoryStore.summary()). */
  sceneSummary: string;
  /**
   * Blocks of the currently running plan that have NOT executed yet. Present
   * only when re-planning after an interrupting command; completed blocks are
   * frozen and are never shown to the planner.
   */
  remainingPlan?: Array<{ kind: string; params: Record<string, unknown> }>;
  /** Set on the retry attempt so the model is told what went wrong. */
  repairHint?: string;
}

export function buildPlannerPrompt(input: PlannerPromptInput): string {
  const sections: string[] = [
    'You plan the actions of a Unitree G1 humanoid robot.',
    '',
    'Translate the operator command into an ordered list of executable blocks.',
    'Answer with JSON only — no prose, no markdown fence.',
    '',
    'Schema: {"blocks": [{"kind": "<one of the kinds below>", "reasoning": "<one short sentence>", ...params}]}',
    'Put the block parameters as FLAT sibling keys next to "kind", not nested.',
    '',
    `Available kinds: ${AgentBlockKinds.join(', ')}`,
    '',
    'Block reference:',
    BLOCK_REFERENCE,
    '',
    // Small local models get this wrong constantly: gemma3:4b answered
    // "dreh dich nach links" with angleDeg -90 and turned the robot RIGHT.
    // Stating the convention once inline was not enough, so it gets its own
    // section with worked examples in both languages. A robot that turns the
    // wrong way on a plain-language command is not a cosmetic failure.
    'DIRECTION CONVENTION — get this right, it is the most common mistake:',
    '  angleDeg is POSITIVE to turn LEFT (counter-clockwise).',
    '  angleDeg is NEGATIVE to turn RIGHT (clockwise).',
    // The German variants stay: they are what the wrong-way turn was measured
    // on, and an operator may still type them even though the robot answers in
    // English. Dropping them would retire a fix without retiring its cause.
    'Worked examples:',
    '  "turn left"       / "dreh dich nach links"   -> {"kind":"turn","angleDeg":90}',
    '  "turn right"      / "dreh dich nach rechts"  -> {"kind":"turn","angleDeg":-90}',
    '  "turn around"     / "dreh dich um"           -> {"kind":"turn","angleDeg":180}',
    '  "look a bit to the right"                    -> {"kind":"turn","angleDeg":-30}',
    'For `walk`, "left"/"right" is a sideways step, NOT a turn. To go somewhere to',
    'the left, turn first and then walk forward.',
    // NOT stated here on purpose: "after turning around, 'back' means forward".
    // gemma4:e2b ignored that instruction in 2 of 2 runs, planning turn-180 +
    // walk-BACKWARD for "turn around and walk 2 m back" and ending 3.89 m from
    // the start it was told to return to. Prompt text that does not change the
    // output is not documentation, it is dead weight on every plan — see
    // TASK-194 for the measurement and the deterministic options.
    '',
    'Rules:',
    '- Use at most 12 blocks. Prefer the shortest plan that does the job.',
    '- `goto` only works for an entity that is already in the scene memory. If the',
    '  target is unknown, plan `scan_room` first, then `goto`.',
    // The vision model labels everything in English (see VISION_PROMPT); an
    // entity in any other language therefore matches nothing and the plan dies
    // with "not in the scene memory" after the scan already succeeded.
    '- `goto.entity` MUST be a bare English noun, matching how the scene memory',
    '  labels things: table, chair, shelf, door, person. Not another language',
    '  ("Tisch"), and not a phrase ("table with the hat") — just "table".',
    '  This holds even when the operator speaks another language: translate the',
    '  target to its English noun before putting it in `goto.entity`.',
    '- Never invent a distance or a bearing you were not given; use `look` or',
    '  `scan_room` to find out instead.',
    '- The robot waves with its RIGHT arm only — there is no left-hand wave. If the',
    '  operator asks for the left hand, `wave` anyway and add a `speak` block that',
    '  says the gesture is right-arm only.',
    '- If the command cannot be carried out with these blocks, answer with a single',
    '  `speak` block that says plainly what is not possible.',
    '- `reasoning` is one short sentence in English.',
    '- Spoken text (`speak`, `greet`) must be in English, whatever language the',
    '  operator used.',
    '',
    'Scene memory:',
    input.sceneSummary,
  ];

  if (input.remainingPlan && input.remainingPlan.length > 0) {
    sections.push(
      '',
      'A plan is already running. These blocks have NOT started yet — rewrite,',
      'keep or drop them as the new command requires. Blocks that already ran are',
      'frozen and are not shown:',
      JSON.stringify(input.remainingPlan)
    );
  }

  if (input.repairHint) {
    sections.push(
      '',
      `Your previous answer was rejected: ${input.repairHint}`,
      'Answer again with valid JSON that matches the schema exactly.'
    );
  }

  sections.push('', `Operator command: ${input.command}`);
  return sections.join('\n');
}

/**
 * Vision prompt.
 *
 * The model is asked WHERE something sits in the picture, not at what angle it
 * lies — `x` is a fraction of the image width, and {@link bearingFromImageX}
 * turns it into a bearing with the camera's own FOV. Asking for the angle
 * directly was measured against the MJCF room scene, where every landmark has
 * an exact world position: 131° mean absolute error (qwen2.5vl:7b answers ±180
 * or ±60 and is not doing the projection at all) versus 7.2° for `x` over the
 * same four poses and frames. Bearings drive `goto`, so this is the difference
 * between navigation working and not.
 *
 * `bearingDeg` is still accepted on the way in — see `parseVisionAnswer` — so a
 * model that ignores the schema and answers in degrees degrades instead of
 * landing everything at bearing 0.
 */
export const VISION_PROMPT = `
You are the eyes of a Unitree G1 humanoid robot. Describe ONLY what is actually
visible in this camera frame. Never guess objects that are not in the picture.

Answer with JSON only — no prose, no markdown fence:

{
  "currentView": "<one sentence describing the frame>",
  "personVisible": true|false,
  "entities": [
    {
      "label": "<short English noun, e.g. table, chair, hat, person>",
      "x": <0.0..1.0, the horizontal centre of the object IN THE IMAGE: 0.0 = left edge, 0.5 = middle, 1.0 = right edge>,
      "distanceEstM": <rough distance in metres, or null if you cannot tell>,
      "confidence": <0.0..1.0>,
      "note": "<optional extra detail, e.g. 'a hat lies on it'>"
    }
  ]
}

Rules:
- List at most 8 entities, the most salient first.
- "x" is a position in the picture, not an angle. Do not convert it to degrees,
  do not guess a compass heading — just say how far across the frame the object
  is. Something in the left third is around 0.2, dead centre is 0.5.
- LABELS MUST BE ENGLISH, always, and always the same word for the same thing:
  table, chair, hat, person, door, wall, floor, ceiling, shelf.
  Never another language ("Tisch", "Stuhl"), never a compound description
  ("table with hat"), never a plural ("chairs") — just the bare singular noun.
- "personVisible" is true only if a human being is visible in this frame.
- Do not identify people, do not describe faces, do not guess names or ages.
- If you see nothing recognisable, return an empty "entities" list and say so in
  "currentView".
`.trim();
