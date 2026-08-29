/**
 * @file voice-narrator.ts
 * @description What Agent Mode says out loud when the command arrived by voice:
 *              the spoken acknowledgement of a fresh plan, the spoken outcome
 *              when it ends, and the one HTTP call that reaches the voice
 *              service. Bilingual (de/en), templated — no LLM call.
 * @feature agentmode
 * @status live
 *
 * WHY TEMPLATES AND NOT THE PLANNER'S OWN WORDS:
 *
 *  1. Latency. This sentence is spoken in the gap between "the operator stopped
 *     talking" and "the robot starts moving". A second local-LLM call would put
 *     several seconds of silence exactly there, which is the one place a spoken
 *     interface cannot afford it.
 *  2. The GPU is shared. The planner and the vision model already contend for
 *     it; narration must not add a third consumer for a sentence that has ten
 *     possible shapes.
 *  3. It cannot be wrong. A template built from the blocks that were actually
 *     planned says what will actually happen. A model asked to summarise them
 *     can quietly add a step that is not in the plan — and the operator would
 *     then hear a promise the robot never executes.
 *
 * The block *labels* are English nouns on purpose even in the German sentences
 * (`goto` entity names come from the vision model, which labels everything in
 * English by design — see VISION_PROMPT). "Ich gehe zu table" is the honest
 * rendering: it is the word the scene memory actually holds, and translating it
 * for the ear would name something the robot cannot then look up.
 */

import { config } from '../config/config.js';
import type {
  AgentBlock,
  AgentCommandOutcome,
  AgentModeEvent,
  AgentPlan,
  SpokenLanguage,
} from './types.js';

/** Give up on a plan that never reports finishing (a lost event must not leak). */
const NARRATION_TIMEOUT_MS = 15 * 60_000;

/**
 * Longest the voice span is held open for one closing utterance.
 *
 * `say` is an HTTP POST with its own 10 s timeout, so this only fires if the
 * voice service accepts the request and never answers. It exists because the
 * span MUTES the microphone: a promise that never settles would take the
 * operator's stop word away permanently, which is worse than a heartbeat
 * talking over the tail of a sentence.
 */
export const SPOKEN_OUTCOME_MAX_MS = 30_000;

/** Longest the spoken acknowledgement waits for the planner to produce blocks. */
export const PLAN_ACK_TIMEOUT_MS = 12_000;

/** Actions named in the acknowledgement before it degrades to "and more". */
const MAX_SPOKEN_ACTIONS = 3;

/**
 * POST to the voice service's `/say`. Returns false — never throws — when the
 * service is not running, because a robot with no voice must still execute the
 * plan; the same text always reaches the operator as block results in the UI.
 */
export async function speakThroughVoiceService(
  text: string,
  language?: SpokenLanguage
): Promise<boolean> {
  try {
    const res = await fetch(`${config.agentMode.voiceServiceUrl}/say`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(language ? { text, language } : { text }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Phrasebook
// ---------------------------------------------------------------------------

interface Phrases {
  ackPrefix: string;
  /** Joins the last two actions: "a, b und c". */
  and: string;
  more: string;
  done: string;
  doneNothing: string;
  aborted: string;
  failedPrefix: string;
  detail: string;
  /** Fallbacks for a block kind with no better phrasing. */
  kinds: Record<string, string>;
  /** One short spoken line per {@link AgentCommandOutcome} that is not a fresh plan. */
  outcomes: Partial<Record<AgentCommandOutcome, string>>;
  /** Appended to `outcomes.folded` when the interrupt displaced an earlier one. */
  replacedSuffix: string;
  /** E-Stop where the hardware never confirmed StopMove/Damp. */
  estopUnconfirmed: string;
  /**
   * The robot saying its own name (TASK-198). `{name}` is the ONLY
   * substitution — a template, so the name can be spoken with no LLM call on
   * the 12 s plan-ack path, and so nothing else about the robot's persona can
   * leak into a sentence the planner never saw.
   */
  selfName: string;
}

const PHRASES: Record<SpokenLanguage, Phrases> = {
  de: {
    ackPrefix: 'Alles klar, ich',
    and: 'und',
    more: 'und mache dann weiter',
    done: 'Fertig.',
    doneNothing: 'Fertig, es war nichts zu tun.',
    aborted: 'Abgebrochen.',
    failedPrefix: 'Das hat nicht geklappt:',
    detail: 'Die Einzelheiten stehen in der Zeitleiste.',
    kinds: {
      walk: 'gehe ein Stück',
      turn: 'drehe mich',
      goto: 'gehe zum Ziel',
      look: 'schaue mich um',
      scan_room: 'sehe mich im Raum um',
      wave: 'winke',
      greet: 'begrüße dich',
      posture: 'ändere meine Haltung',
      speak: 'sage etwas',
      wait: 'warte kurz',
      patrol: 'gehe die Patrouille ab',
      capture: 'mache ein Kontrollfoto',
      inspect: 'vergleiche mit der Referenz',
      vla_skill: 'führe eine gelernte Fertigkeit aus',
    },
    outcomes: {
      estop: 'Gestoppt.',
      folded: 'Alles klar, das mache ich nach dem aktuellen Schritt.',
      disabled: 'Der Agent-Modus ist ausgeschaltet.',
      estop_latched: 'Der Not-Aus ist noch aktiv — setz ihn erst zurück.',
      winding_down: 'Der gestoppte Plan läuft noch aus. Sag es gleich noch einmal.',
      busy: 'Die Steuerung ist gerade von jemand anderem belegt.',
    },
    replacedSuffix: 'Das ersetzt deine vorherige Anweisung.',
    estopUnconfirmed:
      'Ich habe den Plan gestoppt, aber der Roboter hat es nicht bestätigt. ' +
      'Er bewegt sich vielleicht noch — benutz den Not-Aus-Schalter.',
    selfName: 'Ich bin {name}.',
  },
  en: {
    ackPrefix: 'Okay, I will',
    and: 'and',
    more: 'and carry on from there',
    done: 'Done.',
    doneNothing: 'Done — there was nothing to do.',
    aborted: 'Stopped.',
    failedPrefix: 'That did not work:',
    detail: 'The details are in the timeline.',
    kinds: {
      walk: 'walk a bit',
      turn: 'turn',
      goto: 'walk to the target',
      look: 'take a look',
      scan_room: 'look around the room',
      wave: 'wave',
      greet: 'say hello',
      posture: 'change my posture',
      speak: 'say something',
      wait: 'wait a moment',
      patrol: 'walk the patrol route',
      capture: 'take a control photo',
      inspect: 'compare with the reference',
      vla_skill: 'run a learned skill',
    },
    outcomes: {
      estop: 'Stopped.',
      folded: 'Okay, I will do that after the current step.',
      disabled: 'Agent Mode is switched off.',
      estop_latched: 'The emergency stop is still latched — reset it first.',
      winding_down: 'The stopped plan is still winding down. Say it again in a moment.',
      busy: 'Something else has control right now.',
    },
    replacedSuffix: 'That replaces what you asked for before.',
    estopUnconfirmed:
      'I stopped the plan, but the robot did not confirm it. ' +
      'It may still be moving — use the hardware E-Stop.',
    selfName: 'I am {name}.',
  },
};

function phrases(language: SpokenLanguage): Phrases {
  return PHRASES[language] ?? PHRASES.en;
}

/**
 * The two things a patrol says out loud (TASK-212), and nothing else. The
 * start-of-run notice is the transparency obligation — a robot that is about
 * to photograph rooms says so; the person line is spoken ONCE per run when a
 * person is confirmed on the route (Orbit 5.1 pattern: pause, one line,
 * record without an image, resume). Templates, no model call.
 */
export type PatrolPhraseKind = 'startPatrol' | 'startBaseline' | 'person';

const PATROL_PHRASES: Record<SpokenLanguage, Record<PatrolPhraseKind, string>> = {
  en: {
    startPatrol: 'Starting patrol; I take reference photos.',
    startBaseline: 'Starting the baseline walk; I take reference photos.',
    person: 'I am on patrol, please step aside.',
  },
  de: {
    startPatrol: 'Ich beginne die Patrouille und mache Referenzfotos.',
    startBaseline: 'Ich beginne den Referenzlauf und mache Referenzfotos.',
    person: 'Ich bin auf Patrouille, bitte treten Sie zur Seite.',
  },
};

export function patrolPhrase(kind: PatrolPhraseKind, language: SpokenLanguage = 'en'): string {
  return (PATROL_PHRASES[language] ?? PATROL_PHRASES.en)[kind];
}

/**
 * The robot saying its own name — the NAME ONLY, from the phrasebook.
 *
 * Kept here rather than in `identity.ts` for the same reason every other
 * spoken sentence is: this is the file that owns what the robot says out loud,
 * and it must stay a template. An empty name degrades to a bare
 * acknowledgement rather than "I am ." — a robot with no name has to be able
 * to say something.
 */
export function describeNameAloud(name: string, language: SpokenLanguage): string {
  const clean = name.trim();
  if (!clean) return language === 'de' ? 'Ich habe noch keinen Namen.' : 'I do not have a name yet.';
  return phrases(language).selfName.replace('{name}', clean);
}

/** One spoken clause per block, with its parameters when they carry meaning. */
function describeBlock(block: AgentBlock, language: SpokenLanguage): string | null {
  const p = phrases(language);
  const de = language === 'de';
  switch (block.kind) {
    case 'walk': {
      const m = Number(block.params.distanceM);
      const dir = String(block.params.direction ?? 'forward');
      if (!Number.isFinite(m)) return p.kinds.walk;
      const metres = de ? `${fmt(m)} Meter` : `${fmt(m)} metres`;
      const DIRECTIONS: Record<string, [string, string]> = {
        forward: ['vorwärts', 'forward'],
        backward: ['rückwärts', 'backward'],
        left: ['nach links', 'to the left'],
        right: ['nach rechts', 'to the right'],
      };
      const word = DIRECTIONS[dir] ?? DIRECTIONS.forward;
      return de
        ? `gehe ${metres} ${word[0]}`
        : `walk ${metres} ${word[1]}`;
    }
    case 'turn': {
      const deg = Number(block.params.angleDeg);
      if (!Number.isFinite(deg) || deg === 0) return p.kinds.turn;
      if (Math.abs(deg) >= 170) return de ? 'drehe mich um' : 'turn around';
      const side = deg > 0 ? (de ? 'links' : 'left') : de ? 'rechts' : 'right';
      return de
        ? `drehe mich ${Math.round(Math.abs(deg))} Grad nach ${side}`
        : `turn ${Math.round(Math.abs(deg))} degrees ${side}`;
    }
    case 'goto': {
      const entity = String(block.params.entity ?? '').trim();
      if (!entity) return p.kinds.goto;
      return de ? `gehe zu ${entity}` : `walk to the ${entity}`;
    }
    case 'posture': {
      const pose = String(block.params.pose ?? '').trim();
      if (!pose) return p.kinds.posture;
      return de ? `gehe in Position ${pose}` : `go to the ${pose} posture`;
    }
    case 'wait': {
      const s = Number(block.params.seconds);
      if (!Number.isFinite(s)) return p.kinds.wait;
      return de ? `warte ${fmt(s)} Sekunden` : `wait ${fmt(s)} seconds`;
    }
    case 'vla_skill': {
      // The skill's own label, not its instruction: the instruction is the
      // policy's trained prompt and saying it out loud would be the robot
      // reading a dataset annotation to the room. TASK-226.
      const label = String(block.params.label ?? block.params.skill ?? '').trim();
      if (!label) return p.kinds.vla_skill;
      return de ? `versuche "${label}"` : `try to ${label}`;
    }
    // `speak` and `greet` are not announced: the robot is about to say the
    // words themselves, and prefixing them with "I will say something" turns
    // one utterance into two and makes the greeting land late.
    case 'speak':
    case 'greet':
      return null;
    default:
      return p.kinds[block.kind] ?? null;
  }
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** "a, b und c" / "a, b and c". */
function joinClauses(clauses: string[], language: SpokenLanguage): string {
  const p = phrases(language);
  if (clauses.length <= 1) return clauses[0] ?? '';
  return `${clauses.slice(0, -1).join(', ')} ${p.and} ${clauses[clauses.length - 1]}`;
}

/**
 * The sentence spoken the moment a plan is understood — before it runs.
 *
 * Returns null when there is nothing worth announcing, which is the common
 * "just answer me" case: a plan that only speaks needs no preamble, and a
 * failed planner already produced a `speak` block that says so honestly.
 */
export function describePlanAloud(plan: AgentPlan, language: SpokenLanguage): string | null {
  const clauses: string[] = [];
  for (const block of plan.blocks) {
    const clause = describeBlock(block, language);
    if (clause) clauses.push(clause);
  }
  if (clauses.length === 0) return null;
  const p = phrases(language);
  const shown = clauses.slice(0, MAX_SPOKEN_ACTIONS);
  const tail = clauses.length > shown.length ? `, ${p.more}` : '';
  return `${p.ackPrefix} ${joinClauses(shown, language)}${tail}.`;
}

/**
 * The sentence spoken when the plan ends.
 *
 * A failure is named by its block kind and the block's own message is NOT read
 * out: those messages are English operator prose written for the timeline
 * ("2 looks in a row did not report it, so the stored bearing is stale") and a
 * German voice reading English sentences is worse than useless. The operator is
 * told plainly that it failed, on which step, and where to read why.
 */
export function describeOutcomeAloud(plan: AgentPlan, language: SpokenLanguage): string | null {
  const p = phrases(language);
  if (plan.status === 'aborted') return p.aborted;

  const failed = plan.blocks.find((b) => b.status === 'failed');
  if (failed) {
    const what = describeBlock(failed, language) ?? failed.kind;
    return `${p.failedPrefix} ${what}. ${p.detail}`;
  }
  if (plan.status === 'failed') return `${p.failedPrefix} ${p.detail}`;

  // A plan that ended with no blocks at all has to say SOMETHING: the operator
  // was answered with "one moment" while the planner ran, and a planner that
  // then produces nothing would otherwise leave that promise hanging in silence.
  if (plan.blocks.length === 0) return p.doneNothing;

  // Nothing but talking happened — the words were the whole plan, and "done"
  // after them is an answer to a question nobody asked.
  const acted = plan.blocks.some((b) => b.kind !== 'speak' && b.kind !== 'greet');
  if (!acted) return null;
  return p.done;
}

/**
 * The spoken form of a command reply that never became a plan of its own — an
 * E-Stop, an interrupt folded into the running plan, or a refusal.
 *
 * Returns null when the outcome has no spoken form (a fresh plan, which the
 * plan acknowledgement handles) or is unknown, and the caller then falls back to
 * the English `message`. An unmapped future code must still say something.
 */
export function describeCommandReplyAloud(
  result: { outcome?: AgentCommandOutcome; delivered?: boolean; replacedCommand?: string },
  language: SpokenLanguage
): string | null {
  const p = phrases(language);
  if (!result.outcome || result.outcome === 'planned' || result.outcome === 'empty') return null;

  // The E-Stop is the one reply where the exact truth matters more than
  // brevity: "Gestoppt." when the base confirmed it, and the long warning when
  // only the software latch is set and the robot may still be walking.
  if (result.outcome === 'estop' && result.delivered === false) return p.estopUnconfirmed;

  const line = p.outcomes[result.outcome];
  if (!line) return null;
  if (result.outcome === 'folded' && result.replacedCommand) {
    return `${line} ${p.replacedSuffix}`;
  }
  return line;
}

// ---------------------------------------------------------------------------
// Live narration
// ---------------------------------------------------------------------------

type Subscribe = (listener: (event: AgentModeEvent) => void) => () => void;

export interface NarrationDeps {
  subscribe: Subscribe;
  say?: (text: string, language: SpokenLanguage) => Promise<unknown>;
  timeoutMs?: number;
}

/**
 * Wait until the planner has turned the utterance into blocks, so the spoken
 * acknowledgement can name them.
 *
 * Resolves with the plan on `agent:plan:updated`, with the finished plan if it
 * completes first (a one-block plan can), and with null on timeout — the
 * caller then falls back to a generic acknowledgement rather than holding the
 * microphone shut waiting for a local LLM that may be swapping models.
 */
export function awaitPlannedBlocks(
  planId: string,
  deps: NarrationDeps
): Promise<AgentPlan | null> {
  const timeoutMs = deps.timeoutMs ?? PLAN_ACK_TIMEOUT_MS;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (plan: AgentPlan | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(plan);
    };
    const unsubscribe = deps.subscribe((event) => {
      if (!event.plan || event.plan.id !== planId) return;
      if (event.type === 'agent:plan:updated' && event.plan.blocks.length > 0) {
        finish(event.plan);
      } else if (event.type === 'agent:plan:finished') {
        finish(event.plan);
      }
    });
    const timer = setTimeout(() => finish(null), timeoutMs);
    // Node keeps the process alive for a pending timer; a narration timer is
    // never a reason not to exit.
    timer.unref?.();
  });
}

/**
 * Plans with a narrator already armed. One plan gets ONE spoken outcome, no
 * matter how many spoken commands were folded into it — without this, every
 * interrupt armed another listener on the same plan and the robot said
 * "Fertig." once per command it had been given.
 */
const narrating = new Set<string>();

/** Test seam: forget all armed narrators. */
export function resetNarrationState(): void {
  narrating.clear();
}

/**
 * Whether a voice turn is still in flight — somebody spoke, and the robot still
 * owes them an answer.
 *
 * This is the SAME span `narratePlanOutcome` holds: armed the moment a spoken
 * command is accepted (before the planner has even answered) and released when
 * the plan finishes or the narration times out. That span is exactly what an
 * unsolicited utterance must not land inside, because the voice pipeline is
 * half-duplex: every span of robot speech mutes the microphone through a
 * refcount, and the microphone is where the operator's stop word ("stopp") has
 * to go. A heartbeat that talked here would take the stop word away from a
 * person mid-sentence.
 *
 * Reusing the narration set rather than adding a second flag is deliberate:
 * two sources of truth about "is the operator mid-turn" would drift, and the
 * one that drifts closed is the one that mutes the microphone.
 */
export function isVoiceTurnInFlight(): boolean {
  return narrating.size > 0;
}

/**
 * Speak the outcome of a plan once it ends, then stop listening.
 *
 * Returns immediately — this is the half of the voice turn that outlives the
 * A2A response. That is the whole point: the operator's microphone reopens as
 * soon as the plan is acknowledged, so "stop" can be said WHILE the robot
 * walks, instead of after it finishes. Blocking the spoken reply until the plan
 * ended also meant any plan longer than the voice client's timeout was
 * reported to the operator as a failure while the robot carried on executing
 * it — a spoken lie about a moving robot.
 *
 * Arming it twice for the same plan is a no-op, so callers on the interrupt
 * path can arm unconditionally: a spoken command folded into a plan that was
 * started by TYPING still gets its outcome spoken, and one started by voice
 * does not get it spoken twice.
 *
 * The span outlives the `agent:plan:finished` event by exactly the length of
 * the closing utterance. It used to be released BEFORE `say` was called, so the
 * flag {@link isVoiceTurnInFlight} reports was already false while the robot
 * was still speaking — and a heartbeat landing in that window started a SECOND
 * utterance that extended the mute on the microphone the operator's "stopp" has
 * to reach. Listening stops immediately (the plan is over); only the flag is
 * held.
 */
export function narratePlanOutcome(
  planId: string,
  language: SpokenLanguage,
  deps: NarrationDeps
): () => void {
  if (narrating.has(planId)) return () => {};
  narrating.add(planId);

  const say = deps.say ?? speakThroughVoiceService;
  let released = false;
  let detached = false;
  /** Give the span back — the robot is no longer speaking for this plan. */
  const release = (): void => {
    if (released) return;
    released = true;
    narrating.delete(planId);
  };
  /** Stop listening. Separate from {@link release}: the two end at different times. */
  const detach = (): void => {
    if (detached) return;
    detached = true;
    clearTimeout(timer);
    unsubscribe();
  };
  const stop = (): void => {
    detach();
    release();
  };
  const unsubscribe = deps.subscribe((event) => {
    if (event.type !== 'agent:plan:finished' || event.plan?.id !== planId) return;
    detach();
    // The plan's own language wins over the one this narrator was armed with:
    // a German interrupt folded into an English plan means the person waiting
    // for the answer is the one who spoke German, and the controller has
    // already moved `plan.language` on for exactly that reason.
    const spokenIn = event.plan.language ?? language;
    const line = describeOutcomeAloud(event.plan, spokenIn);
    if (!line) {
      release();
      return;
    }
    const watchdog = setTimeout(release, SPOKEN_OUTCOME_MAX_MS);
    watchdog.unref?.();
    void (async () => {
      try {
        await say(line, spokenIn);
      } catch {
        // A voice service that refused the line is not a reason to hold the
        // microphone shut — `speakThroughVoiceService` already swallows its own
        // transport errors, and an injected `say` must not be able to wedge it.
      } finally {
        clearTimeout(watchdog);
        release();
      }
    })();
  });
  const timer = setTimeout(stop, deps.timeoutMs ?? NARRATION_TIMEOUT_MS);
  timer.unref?.();
  return stop;
}
