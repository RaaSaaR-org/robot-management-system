/**
 * @file intents.ts
 * @description Standing intents — prospective memory, and the right way to do
 *              "when you're next in the workshop, tell me if the ladder is
 *              still blocking the door". Deterministic keyword/place matching
 *              with a cooldown and a fire budget: ZERO model calls in the
 *              matching path, so it costs nothing per tick and cannot fire 400
 *              times.
 * @feature agentmode
 * @status live
 *
 * Stored as `workspace-<robotId>/intents.jsonl`, one line per intent, rewritten
 * atomically on every change. A JSONL file rather than an append log because an
 * intent MUTATES (its fire budget, its cooldown, its state) and the whole set is
 * tiny and capped — the incarnation log's append-and-rewrite-your-own-line trick
 * buys nothing here.
 *
 * The matcher never calls a model. That is not an optimisation: a model in the
 * matching path would be a model call on every 3 s idle tick, and it would make
 * "did this trigger fire?" a question nobody could answer twice the same way.
 */

import fs from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
import type { HeartbeatFinding, HeartbeatSnapshot } from './heartbeat.js';
import type { InitiativeOrigin } from './initiative.js';
import { getWorkspace, oneLine, type Workspace } from './workspace.js';

/** Defaults from the task spec: 24 h cooldown, 3 fires, 30-day expiry. */
export const INTENT_DEFAULT_COOLDOWN_MS = 24 * 60 * 60_000;
export const INTENT_DEFAULT_FIRES = 3;
export const INTENT_DEFAULT_TTL_MS = 30 * 24 * 60 * 60_000;

/**
 * Hard cap on how many intents one robot may hold. Bounded on purpose: the
 * matcher walks every armed intent on every idle tick, and an unbounded list is
 * an unbounded per-tick cost that nothing else in Agent Mode has.
 */
export const INTENT_MAX = 50;

/** Longest text one intent may carry — same budget as `remember`. */
export const INTENT_MAX_CHARS = 240;

export const IntentStates = ['armed', 'spent', 'expired', 'disarmed'] as const;
export type IntentState = (typeof IntentStates)[number];

/**
 * When an intent fires. Both halves are optional and are ANDed: a place-only
 * trigger fires on arrival, a keyword-only trigger fires wherever the words
 * turn up, and both together mean "in that place, when you see that".
 *
 * An intent with NEITHER is refused at arming time — it would fire on the next
 * tick and every tick after it.
 */
export interface IntentTrigger {
  /** Place id, compared case-insensitively against the CURRENT place. */
  place?: string | null;
  /**
   * Words that must all appear in what the robot currently sees. Matched as
   * lower-cased substrings of the scene's own view text, which is a VLM
   * caption — so a keyword can only ever DECIDE WHEN to say an
   * operator-authored sentence. It never becomes the sentence.
   */
  keywords?: string[];
}

export interface StandingIntent {
  id: string;
  trigger: IntentTrigger;
  /** v1 has exactly one action. Widening it is a v2 decision, not a v1 default. */
  action: 'speak';
  /** What the OPERATOR asked to be told. Trust `operator`, always. */
  text: string;
  scope: 'place' | 'global';
  createdAt: string;
  expiresAt: string;
  cooldownMs: number;
  firesLeft: number;
  state: IntentState;
  lastFiredAt?: string | null;
}

export interface ArmIntentInput {
  trigger: IntentTrigger;
  text: string;
  cooldownMs?: number;
  fires?: number;
  ttlMs?: number;
  id?: string;
}

export interface ArmIntentResult {
  ok: boolean;
  message: string;
  intent?: StandingIntent;
}

export interface IntentStoreDeps {
  workspace?: Workspace;
  now?: () => Date;
}

/** Parse one JSONL line, or null when it is not a usable intent. */
export function parseIntentLine(line: string): StandingIntent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const obj: unknown = JSON.parse(trimmed);
    if (typeof obj !== 'object' || obj === null) return null;
    const rec = obj as Record<string, unknown>;
    if (typeof rec.id !== 'string' || typeof rec.text !== 'string') return null;
    if (rec.action !== 'speak') return null;
    if (typeof rec.expiresAt !== 'string' || typeof rec.createdAt !== 'string') return null;
    if (typeof rec.firesLeft !== 'number' || typeof rec.cooldownMs !== 'number') return null;
    if (!IntentStates.includes(rec.state as IntentState)) return null;
    if (typeof rec.trigger !== 'object' || rec.trigger === null) return null;
    return obj as StandingIntent;
  } catch {
    return null;
  }
}

/**
 * Does this intent's trigger match the situation? Pure, and the ONLY place the
 * comparison happens.
 */
export function intentTriggerMatches(
  trigger: IntentTrigger,
  situation: { place: string | null; view: string },
): boolean {
  const place = trigger.place?.trim();
  if (place) {
    // A place trigger on an UNKNOWN place never matches. "I might be there"
    // is not "I am there", and the whole point of a standing intent is that it
    // fires where the operator said it should.
    if (!situation.place) return false;
    if (situation.place.toLowerCase() !== place.toLowerCase()) return false;
  }

  const keywords = (trigger.keywords ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean);
  if (keywords.length > 0) {
    const haystack = situation.view.toLowerCase();
    if (!keywords.every((k) => haystack.includes(k))) return false;
  }

  return Boolean(place) || keywords.length > 0;
}

/**
 * The robot's standing intents. All I/O is synchronous and the set is held in
 * memory between ticks — the matcher runs every 3 s and must not read the disk
 * to answer "no".
 */
export class IntentStore {
  private readonly workspace: Workspace;
  private readonly now: () => Date;
  private intents: StandingIntent[] | null = null;
  /** mtime the in-memory copy was loaded from, so a hand-edit is picked up. */
  private loadedMtimeMs = -1;

  constructor(deps: IntentStoreDeps = {}) {
    this.workspace = deps.workspace ?? getWorkspace();
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * `workspace-<robotId>/intents.jsonl`. Taken from the workspace rather than
   * joined here, so this store and {@link Workspace.erase} can never disagree
   * about which file holds operator-authored text.
   */
  get file(): string {
    return this.workspace.intentsFile;
  }

  /** Everything on disk, expiry applied. */
  list(): StandingIntent[] {
    this.load();
    return (this.intents ?? []).map((i) => ({ ...i }));
  }

  /**
   * Arm a new intent.
   *
   * `origin` is not decoration: a heartbeat-initiated plan may not create
   * standing intents, because an agent that can schedule its own future wake-ups
   * is an agent with an unbounded runaway path. That refusal lives here rather
   * than in a prompt.
   */
  arm(input: ArmIntentInput, origin: InitiativeOrigin): ArmIntentResult {
    if (origin !== 'operator') {
      return {
        ok: false,
        message:
          'refused: only an operator can leave me a standing intent. ' +
          'I do not schedule my own reminders.',
      };
    }

    const text = oneLine(input.text ?? '', INTENT_MAX_CHARS);
    if (!text) return { ok: false, message: 'refused: an intent with no text.' };

    const trigger: IntentTrigger = {
      ...(input.trigger.place ? { place: input.trigger.place.trim() } : {}),
      ...(input.trigger.keywords && input.trigger.keywords.length > 0
        ? { keywords: input.trigger.keywords.map((k) => k.trim()).filter(Boolean) }
        : {}),
    };
    if (!trigger.place && !(trigger.keywords && trigger.keywords.length > 0)) {
      return {
        ok: false,
        message:
          'refused: an intent needs a place or a keyword to fire on. ' +
          'Without one it would fire on the very next tick and every tick after it.',
      };
    }

    this.load();
    const live = (this.intents ?? []).filter((i) => i.state === 'armed');
    if (live.length >= INTENT_MAX) {
      return {
        ok: false,
        message: `refused: I am already holding ${live.length} standing intents (the limit is ${INTENT_MAX}).`,
      };
    }

    const nowMs = this.now().getTime();
    const intent: StandingIntent = {
      id: input.id ?? uuidv4(),
      trigger,
      action: 'speak',
      text,
      scope: trigger.place ? 'place' : 'global',
      createdAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + (input.ttlMs ?? INTENT_DEFAULT_TTL_MS)).toISOString(),
      cooldownMs: input.cooldownMs ?? INTENT_DEFAULT_COOLDOWN_MS,
      firesLeft: Math.max(1, Math.floor(input.fires ?? INTENT_DEFAULT_FIRES)),
      state: 'armed',
      lastFiredAt: null,
    };
    this.intents = [...(this.intents ?? []), intent];
    this.save();
    return { ok: true, intent, message: `I will tell you: ${text}` };
  }

  /** Disarm one intent by id. */
  disarm(id: string): boolean {
    this.load();
    const intent = (this.intents ?? []).find((i) => i.id === id);
    if (!intent || intent.state !== 'armed') return false;
    intent.state = 'disarmed';
    this.save();
    return true;
  }

  /**
   * Which intents fire right now — and MARK them fired.
   *
   * Deliberately one call rather than `match()` + `fire()`: two calls is a
   * window in which the same intent matches twice, and "fired 400 times" is the
   * failure this budget exists to prevent. Returns findings, so the heartbeat
   * treats an intent exactly like any other thing it noticed.
   */
  fireMatching(situation: { place: string | null; view: string; nowMs: number }): HeartbeatFinding[] {
    this.load();
    const intents = this.intents ?? [];
    const fired: HeartbeatFinding[] = [];
    let changed = false;

    for (const intent of intents) {
      if (intent.state !== 'armed') continue;

      const expiresAt = Date.parse(intent.expiresAt);
      if (Number.isFinite(expiresAt) && situation.nowMs >= expiresAt) {
        intent.state = 'expired';
        changed = true;
        continue;
      }

      const lastFiredAt = intent.lastFiredAt ? Date.parse(intent.lastFiredAt) : NaN;
      if (Number.isFinite(lastFiredAt) && situation.nowMs - lastFiredAt < intent.cooldownMs) {
        continue;
      }

      if (!intentTriggerMatches(intent.trigger, situation)) continue;

      intent.lastFiredAt = new Date(situation.nowMs).toISOString();
      intent.firesLeft -= 1;
      if (intent.firesLeft <= 0) intent.state = 'spent';
      changed = true;
      fired.push({
        id: 'intent_matched',
        // The text was authored by an OPERATOR when the intent was armed. The
        // VLM caption only decided WHEN to say it, so it never touches the
        // trust of the sentence itself.
        trust: 'operator',
        message: `You asked me to say this here: ${intent.text}`,
      });
    }

    if (changed) this.save();
    return fired;
  }

  /** Forget the in-memory copy, so the next read comes off disk. */
  reload(): void {
    this.intents = null;
    this.loadedMtimeMs = -1;
  }

  /**
   * Read the file once, and again only when it changed on disk. `statSync` is a
   * few microseconds; parsing the whole file on every 3 s tick is not.
   */
  private load(): void {
    let mtimeMs = -1;
    try {
      mtimeMs = fs.statSync(this.file).mtimeMs;
    } catch {
      // No file yet — the common case for a robot nobody has left a note for.
      this.intents = [];
      this.loadedMtimeMs = -1;
      return;
    }
    if (this.intents !== null && mtimeMs === this.loadedMtimeMs) return;

    try {
      this.intents = fs
        .readFileSync(this.file, 'utf-8')
        .split('\n')
        .map(parseIntentLine)
        .filter((i): i is StandingIntent => i !== null);
      this.loadedMtimeMs = mtimeMs;
    } catch (err) {
      // Fail closed: an unreadable intent file means NO intents fire, not the
      // last set we happened to remember.
      console.warn(
        `[AgentMode/Intents] could not read ${this.file}: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.intents = [];
      this.loadedMtimeMs = mtimeMs;
    }
  }

  private save(): void {
    try {
      this.workspace.ensure();
      const body = (this.intents ?? []).map((i) => JSON.stringify(i)).join('\n');
      this.workspace.atomicWrite(this.file, body ? `${body}\n` : '');
      try {
        this.loadedMtimeMs = fs.statSync(this.file).mtimeMs;
      } catch {
        this.loadedMtimeMs = -1;
      }
    } catch (err) {
      console.warn(
        `[AgentMode/Intents] could not write ${this.file}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

/**
 * Turn matched intents into heartbeat findings. The signature `HeartbeatDeps`
 * expects, so the controller can hand the store straight to the monitor.
 */
export function intentMatcher(store: IntentStore): (snapshot: HeartbeatSnapshot) => HeartbeatFinding[] {
  return (snapshot) =>
    store.fireMatching({ place: snapshot.place, view: snapshot.view, nowMs: snapshot.nowMs });
}
