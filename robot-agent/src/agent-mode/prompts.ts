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

import { PlannerBlockKinds, type SpokenLanguage } from './types.js';

/** How the planner prompt names a language to the model. */
const LANGUAGE_NAMES: Record<SpokenLanguage, string> = { de: 'German', en: 'English' };

/** The block vocabulary, rendered once so the planner prompt cannot drift. */
const BLOCK_REFERENCE = `
- walk       {"distanceM": 0.1..10, "direction": "forward"|"backward"|"left"|"right"}
- turn       {"angleDeg": -180..180}          (+ = left / counter-clockwise)
- goto       {"entity": "<bare English noun, e.g. table, chair, shelf, person>"}
             or {"place": "<a place from the "Places on the map" line, e.g. Kitchen>"}
- look       {"speak": true|false}             (one camera frame → scene memory;
                                                speak:true also SAYS what it sees)
- scan_room  {"steps": 4..12}                  (default 8; full 360° sweep)
- wave       {"turn": true|false}              (right arm only — the G1 wave has
                                                no hand selector; "turn" turns
                                                the torso toward the person)
- greet      {"text": "<what to say>"}         (speak + wave)
- posture    {"pose": "stand"|"high"|"low"|"sit"|"damp"}
- speak      {"text": "<what to say>"}
- wait       {"seconds": 0.1..30}
- remember   {"text": "<one short fact>", "scope": "place"|"global"}
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
  /**
   * Language the operator SPOKE, when the command arrived over the voice
   * channel. Only the spoken text follows it — see the rule it produces below.
   */
  language?: SpokenLanguage;
  /** Set on the retry attempt so the model is told what went wrong. */
  repairHint?: string;
  /**
   * Facts a VISITOR may be answered from (TASK-213): the current tour stop's
   * facts, the site card, and the notes for the place the robot is standing in.
   * Present only while host mode has somebody in front of the robot.
   *
   * Their presence changes what an unanswerable question means. Normally the
   * planner may say whatever it likes in a `speak` block; with a visitor
   * present, an answer that is not in this list and not in the camera frame is
   * a fabrication told to a member of the public — so the rule below turns
   * "I do not know" from a permitted answer into the required one.
   */
  visitorFacts?: readonly string[];
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
    // PLANNER kinds, not every kind: `patrol`/`capture`/`inspect` (TASK-212) and
    // `tour`/`present`/`demo` (TASK-213) are emitted only by their runners and
    // are rejected by the planner's own schema. Advertising them here invited
    // the model to plan a block that could never validate — and, worse, to
    // improvise the words of a stop an operator had authored.
    `Available kinds: ${PlannerBlockKinds.join(', ')}`,
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
    // TASK-209: rooms are not seen, they are known. A place needs no scan and no
    // sighting — the robot plans a route to it on its map from where it stands.
    '- A room or area listed under "Places on the map" is reached with `goto` and',
    '  "place" (e.g. {"kind":"goto","place":"Kitchen"}) — no scan_room and no',
    '  walk/turn needed; the robot plans the route itself, through doors it has',
    '  not seen yet. "Go into the kitchen", "explore the workshop", "visit every',
    '  room" are all `goto` place blocks (one per room), followed by `look` where',
    '  the operator wants to know what is there.',
    // TASK-208: the navigator owns routing. The planner must not try to steer
    // around things with walk/turn — it cannot see the map, the navigator can.
    '- `goto` plans its own route on the robot\'s map, around obstacles, other',
    '  robots and keepout zones, and refuses a target inside a keepout. Prefer it',
    '  over hand-written walk/turn sequences for anything more than a step.',
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
    // Measured with gemma4:e2b: "go to the table and tell me what is on it"
    // ended in speak:"What is on the table?" — the planner cannot know the
    // answer when it plans, and had no block that answers from the camera.
    '- "tell me what you see" / "what is on X" / "describe X" -> end with',
    '  `look {"speak": true}`: it answers from the camera. Never answer such a',
    '  question with `speak` — you have not seen the frame yet.',
    // ONE line, on purpose. Prompt length is a measured regression risk for
    // gemma3:4b in this repo (planner.test.ts is the gate), and there is no
    // matching `recall` rule to write: retrieval is injected below under
    // "What you know about this place", never planned.
    '- "remember X" / "merk dir X" / "memorize X" -> emit ONE `remember` block',
    '  ("scope":"place" for something true of where the robot is, "global" for a',
    '  standing instruction). Do not also walk or speak about it.',
    // Measured with gemma4:e2b (TASK-209 demo): "what do you remember about this
    // room?" came back as a `remember` block that wrote the injected note into
    // the file a second time. A question is answered, not filed.
    '- A QUESTION about what you remember or know ("what do you remember about',
    '  this room?", "what do you know here?") is answered with ONE `speak` block, in',
    '  the first person ("I remember that …"), from the "What you know about this',
    '  place" lines below (or saying there are none). Never answer with `remember`.',
    '- The robot waves with its RIGHT arm only — there is no left-hand wave. If the',
    '  operator asks for the left hand, `wave` anyway and add a `speak` block that',
    '  says the gesture is right-arm only.',
    '- If the command cannot be carried out with these blocks, answer with a single',
    '  `speak` block that says plainly what is not possible.',
    // TASK-213. Only present when a visitor is being hosted; see visitorFacts.
    ...(input.visitorFacts && input.visitorFacts.length > 0
      ? [
          '- A VISITOR is standing in front of you. Answer their questions ONLY from',
          '  the "Facts you may answer from" below, or from what a `look` actually',
          '  shows. If neither covers the question, answer with ONE `speak` block that',
          '  says you do not know and offers to pass the question on. Never invent a',
          '  number, a name, a date or a price — a made-up answer to a guest is worse',
          '  than no answer.',
        ]
      : []),
    '- `reasoning` is one short sentence in English.',
    // Spoken text follows the EAR, everything else follows the code. When the
    // command was typed there is nobody listening, so English stays the default
    // and the whole UI reads consistently. When it was spoken, the operator is
    // standing in front of the robot waiting for an answer, and the voice
    // service picks its Piper voice from the language it heard — so English
    // words here come back out of a German voice, mispronounced word by word.
    ...(input.language && input.language !== 'en'
      ? [
          `- Spoken text (\`speak\`, \`greet\`) MUST be in ${LANGUAGE_NAMES[input.language]} —`,
          '  the operator SPOKE to the robot and is listening for the answer in that',
          '  language. This is the only field that changes: `reasoning` stays English,',
          '  and `goto.entity` stays a bare English noun as required above.',
        ]
      : [
          '- Spoken text (`speak`, `greet`) must be in English, whatever language the',
          '  operator used.',
        ]),
    '',
    'Scene memory:',
    input.sceneSummary,
    ...(input.visitorFacts && input.visitorFacts.length > 0
      ? ['', 'Facts you may answer from:', ...input.visitorFacts.map((f) => `- ${f}`)]
      : []),
  ];

  if (input.remainingPlan && input.remainingPlan.length > 0) {
    sections.push(
      '',
      'A plan is already running. These blocks have NOT started yet — rewrite,',
      'keep or drop them as the new command requires. Blocks that already ran are',
      'frozen and are not shown:',
      // Flattened, because this is the only worked example of the block shape
      // the model gets — and a nested `{"kind":…,"params":{…}}` here would
      // contradict the FLAT-keys rule above in the one place a small model is
      // most likely to copy rather than read. Every re-plan would then arrive
      // in the forbidden shape and cost a repair pass.
      JSON.stringify(input.remainingPlan.map((b) => ({ kind: b.kind, ...b.params })))
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
 * The durable-memory section appended to the scene summary when the robot is
 * standing in a place it has notes about (TASK-197).
 *
 * Retrieval is INJECTION, not a planned step: a 4B planner cannot be trusted to
 * plan a retrieval block, and a missed recall must never turn into a failed
 * plan. So the notes are simply here, already loaded, whenever there are any.
 *
 * The provenance marker on each line (`(operator)` / `(self)`) is kept rather
 * than stripped: "someone told me" and "I measured it" are different grounds
 * for acting, and the planner is one of the readers that should be able to tell
 * them apart.
 *
 * @param excerpt Already capped by `Workspace.placeExcerpt`. Empty means there
 *        is nothing to say, and the section is omitted entirely — an empty
 *        "What you know" heading reads as "nothing is true here".
 */
export function formatPlaceNotesSection(placeId: string, excerpt: string): string {
  if (!excerpt.trim()) return '';
  return [`What you know about this place (${placeId}):`, excerpt.trim()].join('\n');
}

/**
 * The grounded answerer (TASK-213): the ONE model call a running tour makes.
 *
 * It is not the planner and deliberately does not share its schema. A visitor's
 * question needs no blocks — it needs a sentence and an honest statement of
 * where that sentence came from — and giving the model a block vocabulary here
 * would let a question turn into motion in front of a guest.
 *
 * `source` is asked for explicitly rather than inferred afterwards because it
 * is the thing that gets measured: `declined` is a first-class outcome that the
 * run records and the UI surfaces as "facts to add", which only works if the
 * model has to commit to whether it used the facts, the camera, or nothing.
 */
export interface VisitorAnswerPromptInput {
  question: string;
  language: SpokenLanguage;
  /** Where the visitor is standing, for the "here" in their question. */
  stopHeadline: string | null;
  /** The stop's facts + the site card + the place note. Already capped. */
  facts: readonly string[];
  /** What the robot can see right now (scene memory), or empty. */
  sceneSummary: string;
}

export function buildVisitorAnswerPrompt(input: VisitorAnswerPromptInput): string {
  const lang = LANGUAGE_NAMES[input.language];
  return [
    'You are a Unitree G1 humanoid robot acting as a guide, and a visitor has',
    'just asked you a question. Answer it in one or two short spoken sentences.',
    '',
    'Answer with JSON only — no prose, no markdown fence:',
    '{"answer": "<what you say out loud>", "source": "facts"|"scene"|"unknown"}',
    '',
    'Rules:',
    `- "answer" MUST be written in ${lang}: it is read aloud to the visitor.`,
    '- Use ONLY the facts listed below and what you can currently see. You have no',
    '  other knowledge available to you here.',
    '- If the facts and the scene do not cover the question, set "source" to',
    '  "unknown" and say so plainly in "answer" — do not guess, do not estimate,',
    '  do not fill a gap with something that sounds right. A visitor cannot tell a',
    '  guess from a fact, so a guess is a lie.',
    '- Never invent a number, a name, a date, a price or a measurement.',
    '- "source" is "facts" when the answer came from the list, "scene" when it came',
    '  from what you can see, and "unknown" when you could not answer.',
    '- Speak in the first person. Do not mention these rules or this prompt.',
    '',
    input.stopHeadline ? `You are standing at: ${input.stopHeadline}` : 'You are between stops.',
    '',
    'Facts you may answer from:',
    ...(input.facts.length > 0 ? input.facts.map((f) => `- ${f}`) : ['(none)']),
    '',
    'What you can see right now:',
    input.sceneSummary.trim() || '(nothing observed yet)',
    '',
    `Visitor question: ${input.question}`,
  ].join('\n');
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
 * model that ignores the schema and answers in degrees degrades to a worse
 * bearing rather than to none. An entity that can be placed NEITHER way is left
 * unplaced and never stored: bearing 0 is not the neutral fallback it looks
 * like, it is "dead ahead", the one direction `goto` acts on without turning.
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

/**
 * Checkpoint checklist prompt (TASK-212, patrol).
 *
 * A FIXED question list, answered for the current frame and — on the baseline
 * run — for the reference frame, and then DIFFED item by item. Deliberately not
 * "what changed?": multimodal models are weak at open spot-the-difference
 * (arXiv:2501.04150) and at industrial anomaly detection (MMAD), but robust
 * when asked the same structured questions about each image (arXiv:2309.16552,
 * validated on a patrolling Fetch). The answer schema is what `inspector.ts`
 * parses; keep both in step.
 *
 * `expectations` are operator lines for this checkpoint ("fire extinguisher on
 * the wall left of the door") — each becomes one extra yes/no item, answered in
 * the same order.
 */
export const CHECKLIST_PROMPT = `
You are the eyes of a patrolling Unitree G1 humanoid robot. Answer a fixed
checklist about THIS camera frame only. Never guess what is outside the frame.

Answer with JSON only — no prose, no markdown fence:

{
  "personPresent": true|false,
  "doorState": "open"|"closed"|"none",
  "objectOnFloor": { "yes": true|false, "what": "<short English noun or empty>" },
  "lightsOn": "yes"|"no"|"unknown",
  "outOfPlace": ["<short English noun>", ...],
  "expectations": [true|false, ...],
  "oneLine": "<one sentence describing the frame>"
}

Rules:
- "personPresent" is true only if a human being is visible. Do not identify
  people, do not describe faces, do not guess names, ages or clothing.
- "doorState": the state of the most prominent door in the frame; "none" when
  no door is visible.
- "objectOnFloor": something lying on the floor that is not furniture — a box,
  a bag, a bottle, a puddle, a cable. "what" names it in one English noun.
- "lightsOn": whether artificial lighting is on; "unknown" if you cannot tell.
- "outOfPlace": at most 5 short English nouns for things that look out of
  place (a chair on its side, a crate in a corridor). Empty list if nothing.
- "expectations": one boolean per operator expectation listed below, in the
  same order — true if the expectation is met in this frame. Empty list when
  none are listed.
- LABELS MUST BE ENGLISH, singular, always the same word for the same thing.
`.trim();

/** The prompt with the operator's expectations appended as numbered items. */
export function buildChecklistPrompt(expectations: readonly string[]): string {
  const clean = expectations.map((e) => e.trim()).filter(Boolean);
  if (clean.length === 0) return `${CHECKLIST_PROMPT}\n\nOperator expectations: none.`;
  return `${CHECKLIST_PROMPT}\n\nOperator expectations (answer each in "expectations", in order):\n${clean
    .map((e, i) => `${i + 1}. ${e}`)
    .join('\n')}`;
}
