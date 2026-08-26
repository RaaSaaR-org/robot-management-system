/**
 * @file host.ts
 * @description Host mode (TASK-213): the robot with a human in front of it.
 *              The tour route source (server fetch + disk cache), the AI
 *              disclosure the greeting cannot be spoken without, the phrasebook
 *              every fixed sentence comes from, the keyword matcher that turns
 *              "ja" into an answer without a model call, the fail-closed
 *              preconditions, the block plan a route becomes, the TourRunner
 *              that drives one visit through the controller's block machinery
 *              with stop semantics, and the on-disk run store under
 *              `workspace-<robotId>/tour/<routeId>/runs/<runId>/`.
 * @feature agentmode
 * @status live-conditional
 *
 * The shape is patrol's, deliberately — read `patrol.ts` first, this file is
 * its mirror image and diverges only where a human being present changes the
 * answer. Where it does diverge, the reason is written down at the divergence.
 *
 * WHAT IS NOT HERE, ON PURPOSE:
 *
 *  * No sentence a model wrote. Everything the robot says to a visitor is
 *    either operator-authored on the route (greeting / offer / talk track /
 *    farewell) or a template below. A model is asked exactly one thing — to
 *    answer an unscripted question FROM THE FACTS — and its refusal to do so
 *    is a first-class outcome (`declined`) rather than an error.
 *  * No image, no audio, no identity. Host mode captures nothing. What
 *    persists is the text of the visit; `TOUR_TRANSCRIPT_ENABLED=false` drops
 *    even that.
 *  * No barge-in. The voice service is half-duplex (the mic is muted from
 *    utterance-end until playback-end), so a visitor cannot interrupt a
 *    sentence in flight. The mitigation is structural, not pretended: a talk
 *    track is chunked into ≤2-sentence `present` blocks and the mic reopens
 *    between them.
 */

import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/config.js';
import { safeSegment } from './baseline.js';
import { mayInitiate, SELF_INITIATIVE_MIN_BATTERY, type InitiativeContext } from './initiative.js';
import { SERVICE_TOKEN_ENV } from './journal.js';
import { PLACE_STALE_MS } from '../robot/StatePersistence.js';
import type {
  AgentBlock,
  AgentBlockKind,
  BlockOutcome,
  ControlOwner,
  SpokenLanguage,
  TourDemo,
  TourLeg,
  TourQuestionKind,
  TourRoute,
  TourRun,
  TourRunOrigin,
  TourStartResult,
  TourStop,
  TourTurn,
  TourTurnAnswer,
} from './types.js';
import {
  TOUR_DWELL_MAX_S,
  TOUR_FACTS_MAX,
  TOUR_FACT_MAX,
  TOUR_HEADLINE_MAX,
  TOUR_SITE_CARD_MAX,
  TOUR_STOPS_MAX,
  TOUR_TALK_TRACK_MAX,
} from './types.js';
import type { Workspace } from './workspace.js';

export const TOUR_ROUTE_FETCH_TIMEOUT_MS = 5000;

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function nowIso(): string {
  return new Date().toISOString();
}

function clamp(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : t.slice(0, max).trimEnd();
}

// ============================================================================
// Route source
// ============================================================================

/** Validate a route from the wire (or the cache). Throws with the reason. */
export function parseTourRoute(raw: unknown, where = 'route'): TourRoute {
  if (!raw || typeof raw !== 'object') throw new Error(`${where}: not an object`);
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id.trim()) throw new Error(`${where}: missing id`);
  if (typeof r.name !== 'string') throw new Error(`${where}: missing name`);
  if (!Array.isArray(r.stops)) throw new Error(`${where}: stops must be an array`);
  const strings = (v: unknown, max: number, cap: number): string[] =>
    (Array.isArray(v) ? v : [])
      .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
      .slice(0, cap)
      .map((x) => clamp(x, max));

  const stops: TourStop[] = r.stops.slice(0, TOUR_STOPS_MAX).map((raw, i) => {
    if (!raw || typeof raw !== 'object') throw new Error(`${where}: stop ${i} is not an object`);
    const o = raw as Record<string, unknown>;
    if (typeof o.placeId !== 'string' || !o.placeId.trim()) throw new Error(`${where}: stop ${i} has no placeId`);
    const placeId = o.placeId.trim();
    const headline = clamp(typeof o.headline === 'string' && o.headline.trim() ? o.headline : placeId, TOUR_HEADLINE_MAX);
    const demoRaw = o.demo && typeof o.demo === 'object' ? (o.demo as Record<string, unknown>) : null;
    const demo: TourDemo | null =
      demoRaw && typeof demoRaw.skillId === 'string' && demoRaw.skillId.trim()
        ? {
            skillId: demoRaw.skillId.trim(),
            skillName:
              typeof demoRaw.skillName === 'string' && demoRaw.skillName.trim()
                ? demoRaw.skillName.trim()
                : demoRaw.skillId.trim(),
            modelVersionId: typeof demoRaw.modelVersionId === 'string' ? demoRaw.modelVersionId : null,
            expectSeconds: Number.isFinite(Number(demoRaw.expectSeconds))
              ? Math.max(1, Math.min(600, Number(demoRaw.expectSeconds)))
              : 30,
          }
        : null;
    const dwell = Number(o.dwellS);
    return {
      id: typeof o.id === 'string' && o.id.trim() ? o.id.trim() : `stop-${i + 1}`,
      placeId,
      headline,
      talkTrack: clamp(typeof o.talkTrack === 'string' ? o.talkTrack : '', TOUR_TALK_TRACK_MAX),
      facts: strings(o.facts, TOUR_FACT_MAX, TOUR_FACTS_MAX),
      demo,
      // 30 s, because that is what the `wait` block clamps to (block-executor's
      // `wait`). Accepting 60 here and 120 on the server made the editor's
      // duration estimate promise a pause the robot would never take.
      dwellS: Number.isFinite(dwell) ? Math.max(0, Math.min(TOUR_DWELL_MAX_S, dwell)) : config.agentMode.tour.dwellS,
      askToContinue: o.askToContinue === true,
    };
  });

  const language: SpokenLanguage = r.language === 'de' ? 'de' : 'en';
  return {
    id: r.id.trim(),
    name: r.name,
    robotId: typeof r.robotId === 'string' ? r.robotId : null,
    twinId: typeof r.twinId === 'string' ? r.twinId : null,
    language,
    greetingPlaceId: typeof r.greetingPlaceId === 'string' ? r.greetingPlaceId.trim() : '',
    greeting: clamp(typeof r.greeting === 'string' ? r.greeting : '', TOUR_TALK_TRACK_MAX),
    offer: clamp(typeof r.offer === 'string' ? r.offer : '', TOUR_TALK_TRACK_MAX),
    farewell: clamp(typeof r.farewell === 'string' ? r.farewell : '', TOUR_TALK_TRACK_MAX),
    siteCard: strings(r.siteCard, TOUR_FACT_MAX, TOUR_SITE_CARD_MAX),
    stops,
    enabled: r.enabled !== false,
    autoGreet: r.autoGreet === true,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : nowIso(),
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : nowIso(),
  };
}

export interface TourRouteSourceOptions {
  serverUrl: string;
  cachePath: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /**
   * Platform API token for `GET /api/tour/routes/:id`, which sits behind
   * `authMiddleware`. Defaults to `process.env[SERVICE_TOKEN_ENV]`; `''` sends
   * no header, which is what a dev server with `AUTH_DISABLED=true` wants.
   */
  authToken?: string;
}

export type TourRouteOrigin = 'server' | 'cache' | 'none';

/**
 * `GET {SERVER_URL}/api/tour/routes/:id`, cached to one JSON file keyed by
 * route id. Same fail-soft rule as patrol's: the server being down is a stale
 * route, not no route — a robot standing in a foyer with visitors in front of
 * it must not lose its tour because the office network did.
 */
export class TourRouteSource {
  private readonly serverUrl: string;
  private readonly cachePath: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly authToken: string;

  constructor(opts: TourRouteSourceOptions) {
    this.serverUrl = opts.serverUrl.replace(/\/+$/, '');
    this.cachePath = opts.cachePath;
    this.timeoutMs = opts.timeoutMs ?? TOUR_ROUTE_FETCH_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    this.authToken = opts.authToken ?? process.env[SERVICE_TOKEN_ENV] ?? '';
  }

  url(routeId: string): string {
    return `${this.serverUrl}/api/tour/routes/${encodeURIComponent(routeId)}`;
  }

  private readCache(): Record<string, unknown> {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.cachePath, 'utf-8')) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  loadCached(routeId: string): TourRoute | null {
    const raw = this.readCache()[routeId];
    if (!raw) return null;
    try {
      return parseTourRoute(raw, `cached route ${routeId}`);
    } catch (err) {
      console.warn(`[Host] cached route ${routeId} unusable: ${msg(err)}`);
      return null;
    }
  }

  /** Remember a route that arrived inline, so a later fetch-less start can reuse it. */
  remember(route: TourRoute): void {
    try {
      const all = this.readCache();
      all[route.id] = route;
      fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
      const tmp = `${this.cachePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(all, null, 2), 'utf-8');
      fs.renameSync(tmp, this.cachePath);
    } catch (err) {
      console.warn(`[Host] could not cache route ${route.id}: ${msg(err)}`);
    }
  }

  async fetch(routeId: string): Promise<{ route: TourRoute | null; origin: TourRouteOrigin; error?: string }> {
    try {
      const res = await this.fetchImpl(this.url(routeId), {
        signal: AbortSignal.timeout(this.timeoutMs),
        ...(this.authToken ? { headers: { Authorization: `Bearer ${this.authToken}` } } : {}),
      });
      if (!res.ok) {
        // Auto-greet is the one host-mode path where the robot fetches for
        // itself, so an unauthenticated 401 here does not fail loudly — it falls
        // back to the disk cache, which on a fresh robot is empty, and the robot
        // greets nobody, forever. Say which of the two it is.
        throw new Error(
          res.status === 401 || res.status === 403
            ? `HTTP ${res.status} — the robot is not authenticated to the platform. ` +
              `Set ${SERVICE_TOKEN_ENV} to a service-account API token.`
            : `HTTP ${res.status}`,
        );
      }
      const route = parseTourRoute(await res.json(), this.url(routeId));
      this.remember(route);
      return { route, origin: 'server' };
    } catch (err) {
      const error = msg(err);
      const cached = this.loadCached(routeId);
      if (cached) return { route: cached, origin: 'cache', error };
      return { route: null, origin: 'none', error };
    }
  }
}

// ============================================================================
// What the robot says — templates only
// ============================================================================

/**
 * EU AI Act Article 50, in force since 2 August 2026: a person interacting
 * with an AI system must be informed of that, unless it is obvious. A humanoid
 * that walks up and talks is exactly the case the article is about, and
 * "obvious" is not a judgement call we get to make on a visitor's behalf.
 *
 * This lives in source and is appended to whatever greeting an operator
 * authored — `TOUR_DISCLOSURE_EXTRA` can ADD to it (a site may need to name
 * its controller), never replace it. The same reasoning as `DEFAULT_SOUL`:
 * a sentence with legal weight is reviewed like code, not edited in a form.
 */
export const AI_DISCLOSURE: Record<SpokenLanguage, string> = {
  en: 'Just so you know: I am a robot driven by artificial intelligence, our conversation is processed by an AI, and I record no video and no audio.',
  de: 'Damit Sie es wissen: Ich bin ein Roboter mit künstlicher Intelligenz, unser Gespräch wird von einer KI verarbeitet, und ich zeichne weder Bild noch Ton auf.',
};

/** The disclosure plus the site's optional addition. Never empty. */
export function disclosureLine(language: SpokenLanguage, extra = config.agentMode.tour.disclosureExtra): string {
  const base = AI_DISCLOSURE[language] ?? AI_DISCLOSURE.en;
  const add = extra.trim();
  return add ? `${base} ${add}` : base;
}

export type TourPhraseKind =
  | 'accepted'
  | 'declined'
  | 'offerLapsed'
  | 'goOn'
  | 'continueYes'
  | 'abandoned'
  | 'dontKnow'
  | 'noteTaken'
  | 'giveRoom'
  | 'cannotStart'
  | 'questionsWelcome'
  | 'demoStart'
  | 'demoNarrated'
  | 'demoFailed'
  | 'answerFailed';

const TOUR_PHRASES: Record<SpokenLanguage, Record<TourPhraseKind, string>> = {
  en: {
    accepted: 'Wonderful — follow me, please.',
    declined: 'No problem. If you change your mind, just say hello.',
    offerLapsed: 'All right, I will be here if you need me.',
    goOn: 'Shall we go on?',
    continueYes: 'This way, please.',
    abandoned: 'I will wait here — say hello if you would like to continue.',
    dontKnow: 'I do not know that, and I would rather not guess.',
    noteTaken: 'I will pass the question on to my team.',
    giveRoom: 'Please give me a little room and I will lead the way.',
    cannotStart: 'I am sorry — I cannot start the tour just now.',
    questionsWelcome: 'Ask me anything about this.',
    demoStart: 'Watch — I will do it now.',
    demoNarrated: 'I am not set up to run it right here, so let me describe it instead.',
    demoFailed: 'That did not work just now — it happens, and it is why we keep testing.',
    answerFailed: 'Sorry, I could not work that out just now.',
  },
  de: {
    accepted: 'Wunderbar — folgen Sie mir bitte.',
    declined: 'Kein Problem. Sagen Sie einfach Hallo, wenn Sie es sich anders überlegen.',
    offerLapsed: 'In Ordnung, ich bin hier, falls Sie mich brauchen.',
    goOn: 'Sollen wir weitergehen?',
    continueYes: 'Hier entlang, bitte.',
    abandoned: 'Ich warte hier — sagen Sie Hallo, wenn Sie weitermachen möchten.',
    dontKnow: 'Das weiß ich nicht, und ich möchte lieber nicht raten.',
    noteTaken: 'Ich gebe die Frage an mein Team weiter.',
    giveRoom: 'Bitte lassen Sie mir etwas Platz, dann gehe ich voran.',
    cannotStart: 'Es tut mir leid — ich kann den Rundgang gerade nicht starten.',
    questionsWelcome: 'Fragen Sie mich gern etwas dazu.',
    demoStart: 'Schauen Sie — ich mache es jetzt.',
    demoNarrated: 'Ich kann es hier nicht ausführen, deshalb beschreibe ich es Ihnen.',
    demoFailed: 'Das hat gerade nicht geklappt — das kommt vor, und genau deshalb testen wir.',
    answerFailed: 'Entschuldigung, das konnte ich gerade nicht beantworten.',
  },
};

export function tourPhrase(kind: TourPhraseKind, language: SpokenLanguage = 'en'): string {
  return (TOUR_PHRASES[language] ?? TOUR_PHRASES.en)[kind];
}

/**
 * What a `demo` block says when it is NARRATING rather than running the skill.
 * Names the skill and says plainly that nothing is being executed — a visitor
 * who hears "this is where I pick up the apple" while the robot stands still
 * has been misled, and the sentence has to prevent that on its own.
 */
export function demoNarration(skillName: string, language: SpokenLanguage): string {
  const name = skillName.trim() || (language === 'de' ? 'diese Fähigkeit' : 'this skill');
  return language === 'de'
    ? `Hier führe ich „${name}“ aus. Von hier aus kann ich das gerade nicht wirklich tun, deshalb beschreibe ich es nur.`
    : `This is where I run "${name}". I cannot actually do it from where I am standing, so I am only describing it.`;
}

// ============================================================================
// Yes / no / goodbye — keyword only
// ============================================================================

export type TourReply = 'yes' | 'no' | 'bye';

/**
 * BOTH languages are always matched, in both directions. A German visitor
 * answering an English greeting with "ja" is the single most likely thing to
 * happen at ZeMA, and a robot that only understands the language it happened
 * to open with would stand there looking broken.
 *
 * Order matters: goodbye wins over yes/no, because "ja, danke, tschüss" ends
 * the tour rather than starting one.
 */
const REPLY_WORDS: Record<TourReply, readonly string[]> = {
  bye: [
    'bye', 'goodbye', 'good bye', 'see you', 'thanks bye', 'that is all', "that's all", 'i am done', 'im done',
    'tschüss', 'tschuess', 'tschuss', 'auf wiedersehen', 'wiedersehen', 'ciao', 'das wars', 'das war es', 'danke tschüss',
  ],
  yes: [
    'yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'please', 'yes please', 'go ahead', 'lets go', "let's go", 'why not',
    'ja', 'jaa', 'jawohl', 'klar', 'gerne', 'gern', 'okey', 'na klar', 'jo', 'passt', 'los gehts', "los geht's",
  ],
  no: [
    'no', 'nope', 'no thanks', 'not now', 'later', 'maybe later', 'i am fine', 'no thank you',
    'nein', 'nö', 'noe', 'ne', 'nee', 'danke nein', 'nein danke', 'später', 'spaeter', 'lieber nicht', 'kein interesse',
  ],
};

/**
 * Normalise the way `normalizeStopWordCandidate` does: lower-case, strip
 * punctuation and collapse whitespace. Speech-to-text hands us "Ja, gerne!"
 * and the matcher must not care.
 */
function normalizeReply(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A short utterance that is an ANSWER, or null when it is something else (and
 * therefore a question, or a command). Zero model calls: this runs in the gap
 * right after a visitor stops speaking.
 *
 * Only short utterances are matched. "No, what I actually wanted to ask is
 * whether the arm is dangerous" starts with "no" and is not a refusal — a
 * length gate is a cruder rule than intent classification and a far more
 * predictable one, and the cost of getting it wrong here is high.
 */
export function matchVisitorReply(text: string): TourReply | null {
  const norm = normalizeReply(text);
  if (!norm) return null;
  const words = norm.split(' ');
  if (words.length > 4) return null;
  for (const kind of ['bye', 'yes', 'no'] as const) {
    for (const phrase of REPLY_WORDS[kind]) {
      if (norm === phrase) return kind;
      // "ja bitte", "no thanks": the reply word plus a courtesy.
      if (words.length <= 3 && (norm.startsWith(`${phrase} `) || norm.endsWith(` ${phrase}`))) return kind;
    }
  }
  return null;
}

// ============================================================================
// Preconditions — fail closed
// ============================================================================

export type TourRefusalReason =
  | 'disabled'
  | 'estop'
  | 'busy'
  | 'battery'
  | 'place_unknown'
  | 'damped'
  | 'crash_unacknowledged'
  | 'route_unknown'
  | 'no_places'
  | 'no_stops'
  | 'person_too_close'
  | 'running';

export interface TourPreconditionInput {
  /** `AGENT_HOST_ENABLED`. */
  hostEnabled: boolean;
  agentModeEnabled: boolean;
  estopLatched: boolean;
  /** A tour is already running on this robot. */
  tourActive: boolean;
  /** Any Agent Mode plan is running. */
  planRunning: boolean;
  controlOwner: ControlOwner;
  teleopOrVlaActive: boolean;
  initiative: InitiativeContext;
  origin: TourRunOrigin;
  route: TourRoute;
  /** Place ids the robot can `goto` right now (registered frame, non-keepout). */
  knownPlaceIds: readonly string[];
  /** Clear distance straight ahead, m; null when the range sensor said nothing. */
  rangeAheadM: number | null;
  personVisible: boolean;
  now: Date;
}

export type TourPreconditionVerdict = { ok: true } | { ok: false; reason: TourRefusalReason; message: string };

/**
 * Every reason a tour must not start, in the order they are checked. Pure.
 *
 * A `visitor`-origin tour goes through {@link mayInitiate} as `self`: the robot
 * offered it, and an offer is an initiative even though a human accepted it.
 * An `operator` start passes the gate (a human asked) but is still refused on a
 * damped base, exactly as patrol is.
 */
export function checkTourPreconditions(input: TourPreconditionInput): TourPreconditionVerdict {
  const refuse = (reason: TourRefusalReason, message: string): TourPreconditionVerdict => ({ ok: false, reason, message });
  if (!input.hostEnabled) return refuse('disabled', 'Host mode is disabled on this robot (AGENT_HOST_ENABLED=false).');
  if (!input.agentModeEnabled) return refuse('disabled', 'Agent Mode is off — enable it before starting a tour.');
  if (input.tourActive) return refuse('running', 'A tour is already running on this robot.');
  if (input.estopLatched) return refuse('estop', 'An E-Stop is latched — reset it before starting a tour.');
  if (input.planRunning) return refuse('busy', 'An Agent Mode plan is running — wait for it or stop it first.');
  if (input.controlOwner !== 'idle') return refuse('busy', `Control is held by ${input.controlOwner}.`);
  if (input.teleopOrVlaActive) return refuse('busy', 'Teleoperation or VLA control is active.');
  if (input.route.stops.length === 0) return refuse('no_stops', `Tour "${input.route.name}" has no stops.`);
  if (input.knownPlaceIds.length === 0) {
    return refuse('no_places', 'This robot knows no places by name (no registered place graph), so it cannot walk a tour.');
  }
  const known = new Set(input.knownPlaceIds.map((p) => p.toLowerCase()));
  const wanted = [...input.route.stops.map((s) => s.placeId)];
  if (input.route.greetingPlaceId) wanted.push(input.route.greetingPlaceId);
  const unknown = wanted.filter((p) => !known.has(p.toLowerCase()));
  if (unknown.length > 0) {
    return refuse(
      'route_unknown',
      `Tour "${input.route.name}" names places this robot does not know: ${[...new Set(unknown)].join(', ')}. ` +
        `Known: ${input.knownPlaceIds.join(', ')}.`,
    );
  }
  // Proxemics. We have no person-relative controller, so this is the crude
  // version of it: do not start walking while somebody is standing inside
  // personal distance in front of the robot. Said out loud by the caller
  // ("please give me a little room"), never refused silently.
  if (input.personVisible && input.rangeAheadM !== null && input.rangeAheadM < config.agentMode.tour.minPersonM) {
    return refuse(
      'person_too_close',
      `Somebody is standing ${input.rangeAheadM.toFixed(2)} m in front of me — I need ${config.agentMode.tour.minPersonM.toFixed(1)} m before I start walking.`,
    );
  }
  const ctx = input.initiative;
  if (input.origin === 'visitor') {
    const verdict = mayInitiate('goto', 'self', ctx);
    if (!verdict.ok) {
      let reason: TourRefusalReason = 'busy';
      if (ctx.estopLatched) reason = 'estop';
      else if (!ctx.crashAcknowledged) reason = 'crash_unacknowledged';
      else if (ctx.batteryPercent === null || ctx.batteryPercent < SELF_INITIATIVE_MIN_BATTERY) reason = 'battery';
      else if (ctx.damped) reason = 'damped';
      else if (ctx.place === null || ctx.placeAgeMs === null || ctx.placeAgeMs > PLACE_STALE_MS) reason = 'place_unknown';
      return refuse(reason, verdict.reason);
    }
  } else if (ctx.damped) {
    return refuse('damped', 'The base is damped (after an E-Stop) — send `posture stand` before a tour.');
  }
  return { ok: true };
}

// ============================================================================
// Talk tracks — chunking and duration
// ============================================================================

/** Sentences per spoken chunk. The mic reopens between chunks; see the file header. */
export const TOUR_SENTENCES_PER_CHUNK = 2;
/** Hard cap on how long one stop may talk, seconds. Beyond this the tail is dropped. */
export const TOUR_STOP_SPEECH_CAP_S = 40;
/**
 * Speaking rate used for the estimate, characters per second. Measured on
 * Piper (`de_DE-thorsten-medium` / `en_US-lessac-medium`) at the default
 * length scale: ~14 chars/s. The editor shows the same number, computed by the
 * same rule, so an author is never surprised by what the robot does.
 */
export const TOUR_SPEECH_CHARS_PER_S = 14;

/** How often the reply window is checked for an answer, ms. */
export const TOUR_REPLY_POLL_MS = 100;

export function estimateSpeechSeconds(text: string): number {
  return Math.round((text.trim().length / TOUR_SPEECH_CHARS_PER_S) * 10) / 10;
}

/**
 * Split an authored talk track into ≤{@link TOUR_SENTENCES_PER_CHUNK}-sentence
 * chunks, dropping whatever exceeds {@link TOUR_STOP_SPEECH_CAP_S}. Never
 * splits mid-sentence: a chunk boundary is a place the robot stops talking, and
 * stopping mid-clause in front of a visitor reads as a crash.
 */
export function chunkTalkTrack(talkTrack: string, capSeconds = TOUR_STOP_SPEECH_CAP_S): string[] {
  const text = talkTrack.trim();
  if (!text) return [];
  const sentences = text.match(/[^.!?…]+(?:[.!?…]+|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  const chunks: string[] = [];
  for (let i = 0; i < sentences.length; i += TOUR_SENTENCES_PER_CHUNK) {
    chunks.push(sentences.slice(i, i + TOUR_SENTENCES_PER_CHUNK).join(' '));
  }
  const kept: string[] = [];
  let seconds = 0;
  for (const chunk of chunks) {
    const cost = estimateSpeechSeconds(chunk);
    // The first chunk is always kept: a stop that says nothing at all is worse
    // than a stop that runs a few seconds over its cap.
    if (kept.length > 0 && seconds + cost > capSeconds) break;
    kept.push(chunk);
    seconds += cost;
  }
  return kept;
}

/** Roughly how long a route takes: speech + demos + dwell + ~20 s of walking per leg. */
export function estimateTourSeconds(route: TourRoute): number {
  const walk = 20;
  return Math.round(
    route.stops.reduce(
      (total, stop) =>
        total +
        walk +
        stop.dwellS +
        chunkTalkTrack(stop.talkTrack).reduce((s, c) => s + estimateSpeechSeconds(c), 0) +
        (stop.demo ? stop.demo.expectSeconds : 0),
      estimateSpeechSeconds(route.greeting) + estimateSpeechSeconds(route.farewell) + walk,
    ),
  );
}

// ============================================================================
// The block plan
// ============================================================================

/** A block of the tour plan and which stop (leg) it belongs to (`-1` = not a leg). */
export interface TourPlanBlock {
  block: AgentBlock;
  legIndex: number;
  /** The closing walk back to the greeting place, which is not a stop. */
  home?: boolean;
}

function makeBlock(kind: AgentBlockKind, params: Record<string, unknown>, reasoning: string): AgentBlock {
  return { id: uuidv4(), kind, params, status: 'pending', reasoning };
}

/**
 * The plan a route becomes: a leading `tour` block, then per stop
 * `goto{place}` → `present`×n (the chunked talk track) → `demo` (when the stop
 * has one) → `wait` (the dwell, where questions are taken), and finally
 * `goto{greetingPlace}` + the farewell `speak`.
 *
 * The greeting and the offer are NOT in here: they were spoken before the
 * visitor accepted, by the greet plan that made the offer.
 */
export function buildTourBlocks(
  route: TourRoute,
  opts: { demoMode?: 'execute' | 'narrate'; disclosureSpoken?: boolean } = {},
): TourPlanBlock[] {
  const demoMode = opts.demoMode ?? config.agentMode.tour.demoMode;
  const out: TourPlanBlock[] = [];
  out.push({
    block: makeBlock(
      'tour',
      { routeId: route.id, routeName: route.name, stops: route.stops.length },
      `Tour "${route.name}" — ${route.stops.length} stop(s), about ${Math.round(estimateTourSeconds(route) / 60)} minute(s).`,
    ),
    legIndex: -1,
  });
  // The disclosure rides the GREETING when the robot offered the tour itself.
  // A tour an operator starts from the UI has greeted nobody — and the visitor
  // standing in front of the robot is owed the sentence just the same. Art. 50
  // is about the person, not about which button started the visit.
  if (opts.disclosureSpoken !== true) {
    out.push({
      block: makeBlock(
        'speak',
        { text: disclosureLine(route.language), disclosure: true },
        'Tell the visitor they are talking to an AI (EU AI Act Art. 50).',
      ),
      legIndex: -1,
    });
  }
  route.stops.forEach((stop, i) => {
    // Every block of a stop carries WHICH stop it belongs to in words, not only
    // as an id: `stopId` identifies the stop, `stopName`/`stopIndex` are what a
    // console can render without holding the route. Patrol already does this
    // (`routeName` on `patrol`, `checkpointName` on `capture`/`inspect`), and
    // the Agent Mode rail is the reason — it watches the running BLOCK and has
    // no run, no route and no place graph in hand. Without the name, the one
    // question an operator asks while a visitor is being walked around —
    // "which stop is it at?" — is answerable only from the block's prose.
    const at = { stopId: stop.id, stopIndex: i + 1, stopName: stop.headline };
    out.push({
      block: makeBlock('goto', { place: stop.placeId, ...at }, `Stop ${i + 1}: walk to ${stop.headline}.`),
      legIndex: i,
    });
    const chunks = chunkTalkTrack(stop.talkTrack);
    chunks.forEach((text, c) => {
      out.push({
        block: makeBlock(
          'present',
          { ...at, text, chunk: c + 1, of: chunks.length },
          `Say part ${c + 1} of ${chunks.length} at ${stop.headline}.`,
        ),
        legIndex: i,
      });
    });
    if (stop.demo) {
      out.push({
        block: makeBlock(
          'demo',
          {
            ...at,
            skillId: stop.demo.skillId,
            skillName: stop.demo.skillName,
            mode: demoMode,
            ...(stop.demo.modelVersionId ? { modelVersionId: stop.demo.modelVersionId } : {}),
            expectSeconds: stop.demo.expectSeconds,
          },
          demoMode === 'execute' ? `Run "${stop.demo.skillName}" at ${stop.headline}.` : `Describe "${stop.demo.skillName}" at ${stop.headline}.`,
        ),
        legIndex: i,
      });
    }
    if (stop.dwellS > 0) {
      out.push({
        block: makeBlock('wait', { seconds: Math.min(30, stop.dwellS), ...at }, `Take questions at ${stop.headline}.`),
        legIndex: i,
      });
    }
  });
  if (route.greetingPlaceId) {
    out.push({
      block: makeBlock('goto', { place: route.greetingPlaceId }, `Walk back to ${route.greetingPlaceId}.`),
      legIndex: -1,
      home: true,
    });
  }
  if (route.farewell.trim()) {
    out.push({ block: makeBlock('speak', { text: route.farewell.trim() }, 'Say goodbye.'), legIndex: -1, home: true });
  }
  return out;
}

export function newTourRun(input: {
  robotId: string;
  route: TourRoute;
  origin: TourRunOrigin;
  status?: TourRun['status'];
  reason?: string | null;
  disclosureSpoken?: boolean;
}): TourRun {
  const at = nowIso();
  const status = input.status ?? 'running';
  return {
    runId: uuidv4(),
    routeId: input.route.id,
    routeName: input.route.name,
    robotId: input.robotId,
    origin: input.origin,
    status,
    reason: input.reason ?? null,
    startedAt: at,
    finishedAt: status === 'running' ? null : at,
    legs: input.route.stops.map((stop, i) => ({
      index: i,
      stopId: stop.id,
      placeId: stop.placeId,
      name: stop.headline,
      status: status === 'running' ? 'pending' : 'skipped',
      spoken: null,
      demo: null,
    })),
    turns: [],
    language: input.route.language,
    disclosureSpoken: input.disclosureSpoken ?? false,
    planId: null,
  };
}

// ============================================================================
// Runs on disk
// ============================================================================

export interface TourRunStoreDeps {
  workspace: Workspace;
  now?: () => number;
}

/** `tour/<routeId>/runs/<runId>/run.json`. Text only — host mode stores no media. */
export class TourRunStore {
  private readonly ws: Workspace;
  private readonly now: () => number;

  constructor(deps: TourRunStoreDeps) {
    this.ws = deps.workspace;
    this.now = deps.now ?? (() => Date.now());
  }

  runDir(routeId: string, runId: string): string {
    const r = safeSegment(routeId);
    const u = safeSegment(runId);
    if (!r || !u) throw new Error(`tour: unusable route/run id ${JSON.stringify(routeId)}/${JSON.stringify(runId)}`);
    return path.join(this.ws.tourDir, r, 'runs', u);
  }

  saveRun(run: TourRun): void {
    this.ws.atomicWrite(path.join(this.runDir(run.routeId, run.runId), 'run.json'), JSON.stringify(run, null, 2));
  }

  private readJson<T>(file: string, fallback: T): T {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
    } catch {
      return fallback;
    }
  }

  /** Every run on disk, newest first. */
  listRuns(limit = 20, routeId?: string): TourRun[] {
    const runs: TourRun[] = [];
    let routeDirs: string[] = [];
    try {
      routeDirs = fs
        .readdirSync(this.ws.tourDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && (!routeId || e.name === routeId))
        .map((e) => path.join(this.ws.tourDir, e.name, 'runs'));
    } catch {
      return [];
    }
    for (const dir of routeDirs) {
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const run = this.readJson<TourRun | null>(path.join(dir, e.name, 'run.json'), null);
        if (run && typeof run.runId === 'string') runs.push(run);
      }
    }
    runs.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
    return runs.slice(0, Math.max(0, limit));
  }

  findRun(runId: string): TourRun | null {
    return this.listRuns(Number.MAX_SAFE_INTEGER).find((r) => r.runId === runId) ?? null;
  }

  /**
   * Retention: a run's TRANSCRIPT is dropped after `transcriptRetentionDays`,
   * the run itself is kept. What a visitor said is personal data with a short
   * useful life (it tells the operator which facts to add); the fact that a
   * tour happened, and how far it got, is the operational record.
   *
   * Returns the run ids whose transcript was cleared.
   */
  sweep(retentionDays = config.agentMode.tour.transcriptRetentionDays): string[] {
    const cleared: string[] = [];
    const cutoff = this.now() - retentionDays * 24 * 60 * 60_000;
    for (const run of this.listRuns(Number.MAX_SAFE_INTEGER)) {
      if (run.turns.length === 0) continue;
      const started = Date.parse(run.startedAt);
      if (!Number.isFinite(started) || started > cutoff) continue;
      try {
        this.saveRun({ ...run, turns: [] });
        cleared.push(run.runId);
      } catch {
        // A transcript we cannot rewrite is reported by not being listed here.
      }
    }
    return cleared;
  }

  /**
   * Runs left `status:'running'` on disk by a crash, a redeploy or a reboot.
   * Patrol shipped without this and had to add it; do not re-introduce the bug.
   */
  closeInterrupted(): TourRun[] {
    const closed: TourRun[] = [];
    for (const run of this.listRuns(Number.MAX_SAFE_INTEGER)) {
      if (run.status !== 'running') continue;
      const fixed: TourRun = {
        ...run,
        status: 'failed',
        reason: 'the robot restarted while this tour was running',
        finishedAt: new Date(this.now()).toISOString(),
        legs: run.legs.map((l) => (l.status === 'pending' || l.status === 'running' ? { ...l, status: 'skipped' } : l)),
      };
      try {
        this.saveRun(fixed);
        closed.push(fixed);
      } catch {
        continue;
      }
    }
    return closed;
  }
}

// ============================================================================
// Runner
// ============================================================================

/** How the runner drives blocks — supplied by the controller. Patrol's interface, verbatim. */
export interface TourExecution {
  begin(block: AgentBlock): void;
  execute(block: AgentBlock): Promise<BlockOutcome>;
  finish(block: AgentBlock, outcome: BlockOutcome): void;
  skip(block: AgentBlock, reason: string): void;
  isAborted(): boolean;
  abortReason(): string | null;
}

/** One visitor question waiting to be answered. */
export interface TourQuestion {
  text: string;
  language: SpokenLanguage;
  at: string;
  /**
   * The stop the visitor was standing at when they ASKED, which is not always
   * the one the robot is at when it answers — a question asked during a talk
   * track is answered at the next gap, and the tour may have moved on by then.
   * It is the asking stop that matters twice over: its facts are what the
   * visitor was looking at, and it is the stop whose facts the operator has to
   * extend when the answer comes back `declined`.
   */
  stopId: string | null;
}

/** What the controller's grounded answerer hands back. */
export interface TourAnswer {
  answer: string;
  answered: TourTurnAnswer;
}

export interface TourAnswerRequest {
  question: string;
  language: SpokenLanguage;
  route: TourRoute;
  /** The stop the visitor is standing at, or null (asked between stops). */
  stop: TourStop | null;
}

export type TourEventType = 'agent:tour:started' | 'agent:tour:leg' | 'agent:tour:turn' | 'agent:tour:finished';

export interface TourRunnerDeps {
  robotId: string;
  workspace: Workspace | null;
  runs?: TourRunStore;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  emit: (type: TourEventType, run: TourRun, turn?: TourTurn) => void;
  /** Speak a template or an authored line. Returns false when the voice service is unreachable. */
  say?: (text: string, language?: SpokenLanguage) => Promise<boolean>;
  /**
   * Answer one unscripted question from the facts. THE ONLY model call in a
   * tour. Supplied by the controller; a runner without one declines every
   * question, which is a degraded tour and not a broken one.
   */
  answer?: (req: TourAnswerRequest) => Promise<TourAnswer>;
  /** The robot's planar pose (odom frame), stamped on each leg when it finishes. */
  getPose?: () => { x: number; y: number; yawDeg: number } | null;
  /** Clear distance straight ahead, m — the proxemics check before a walking leg. */
  rangeAheadM?: () => number | null;
  personVisible?: () => boolean;
  log?: (line: string) => void;
}

interface Session {
  run: TourRun;
  route: TourRoute;
  blocks: TourPlanBlock[];
  currentStop: number;
  /** Questions asked while the robot was talking, drained at the dwell. */
  questions: TourQuestion[];
  /** Set once the visitor has been asked to step back on this leg. */
  roomAsked: Set<number>;
}

/**
 * One tour at a time per robot. The controller asks {@link begin} after the
 * preconditions passed and the lock is claimed; everything after that goes
 * through the {@link TourExecution} it hands over, so E-Stop, geofence, the
 * pre-walk map check, the mirror and the compliance record apply to a tour leg
 * exactly as to an operator's `goto`.
 *
 * The runner also owns the ONE piece of conversational state host mode adds:
 * a question the robot asked and is waiting to have answered.
 */
export class TourRunner {
  private readonly deps: TourRunnerDeps;
  readonly runs: TourRunStore | null;
  private readonly sleep: (ms: number) => Promise<void>;
  private session: Session | null = null;
  private last: TourRun | null = null;
  private abortRequest: string | null = null;
  /** Set when the visitor ended the visit (not an abort — see {@link endByVisitor}). */
  private visitorEnd: { status: TourRun['status']; reason: string } | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  /** A question the robot asked out loud and is waiting for an answer to. */
  private pendingQuestion: {
    kind: TourQuestionKind;
    route: TourRoute;
    askedAt: number;
    expiresAt: number;
    /** Whether the greeting that armed this offer actually reached a speaker. */
    disclosureSpoken: boolean;
  } | null = null;
  /** Replies pushed by the controller while {@link ask} is waiting. */
  private replies: TourReply[] = [];

  constructor(deps: TourRunnerDeps) {
    this.deps = deps;
    this.runs = deps.runs ?? (deps.workspace ? new TourRunStore({ workspace: deps.workspace }) : null);
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private log(line: string): void {
    (this.deps.log ?? ((l: string) => console.log(l)))(`[Host] ${line}`);
  }

  private nowMs(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private stamp(): string {
    return new Date(this.nowMs()).toISOString();
  }

  private async say(text: string, language: SpokenLanguage): Promise<boolean> {
    if (!text.trim()) return false;
    return (await this.deps.say?.(text, language)) ?? false;
  }

  // ── state ─────────────────────────────────────────────────────────────────

  active(): TourRun | null {
    return this.session ? cloneRun(this.session.run) : null;
  }

  activeRoute(): TourRoute | null {
    return this.session?.route ?? null;
  }

  activeStop(): TourStop | null {
    const s = this.session;
    if (!s || s.currentStop < 0) return null;
    return s.route.stops[s.currentStop] ?? null;
  }

  lastRun(): TourRun | null {
    if (this.last) return cloneRun(this.last);
    return this.runs?.listRuns(1)[0] ?? null;
  }

  dispose(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  /** Ask the running tour to stop after the block in flight. */
  requestAbort(reason: string): string | null {
    if (!this.session) return null;
    this.abortRequest = reason;
    return this.session.run.runId;
  }

  /**
   * The VISITOR ended the tour — "nein", "danke, tschüss", or the reply window
   * lapsing. Deliberately NOT {@link requestAbort}: an abort is the E-Stop
   * shape, and it skips the walk home and marks the run `aborted`. A guest
   * saying goodbye is the normal, polite end of a visit — the robot stops
   * showing stops, says the farewell it was going to say anyway, and walks
   * back to where the next visitor will find it. Leaving it standing in an
   * aisle because somebody was polite is the failure this exists to prevent.
   */
  endByVisitor(reason: string, status: TourRun['status'] = 'done'): string | null {
    if (!this.session) return null;
    this.visitorEnd = { status, reason };
    return this.session.run.runId;
  }

  // ── the pending question ──────────────────────────────────────────────────

  /**
   * Arm the offer: the robot has just greeted somebody and asked whether they
   * would like a tour. Nothing awaits this — the greet plan is over — so the
   * controller polls {@link pending} on the next utterance.
   */
  armOffer(route: TourRoute, opts: { disclosureSpoken?: boolean; windowMs?: number } = {}): void {
    const windowMs = opts.windowMs ?? config.agentMode.tour.replyWindowMs;
    this.pendingQuestion = {
      kind: 'offer',
      route,
      askedAt: this.nowMs(),
      expiresAt: this.nowMs() + windowMs,
      // Recorded, not assumed: a greeting the voice service never played
      // disclosed nothing, and the run must be able to say so.
      disclosureSpoken: opts.disclosureSpoken ?? false,
    };
  }

  /** The question in flight, or null when there is none (or it has lapsed). */
  pending(): { kind: TourQuestionKind; route: TourRoute; expiresAt: string; disclosureSpoken: boolean } | null {
    const p = this.pendingQuestion;
    if (!p) return null;
    if (this.nowMs() > p.expiresAt) return null;
    return { kind: p.kind, route: p.route, expiresAt: new Date(p.expiresAt).toISOString(), disclosureSpoken: p.disclosureSpoken };
  }

  clearPending(): void {
    this.pendingQuestion = null;
  }

  /**
   * An offer nobody answered. Recorded as an `abandoned` run so "how many
   * people walked past" is a number rather than an anecdote — and swept from
   * the pending slot so the next "ja" is planned normally instead of starting
   * a tour the visitor never asked for.
   */
  expireOffer(): TourRun | null {
    const p = this.pendingQuestion;
    if (!p || p.kind !== 'offer' || this.nowMs() <= p.expiresAt) return null;
    this.pendingQuestion = null;
    const run = newTourRun({
      robotId: this.deps.robotId,
      route: p.route,
      origin: 'visitor',
      status: 'abandoned',
      reason: 'the offer of a tour was not answered',
      disclosureSpoken: p.disclosureSpoken,
    });
    this.persist(run);
    this.last = run;
    this.deps.emit('agent:tour:finished', cloneRun(run));
    void this.say(tourPhrase('offerLapsed', p.route.language), p.route.language);
    return cloneRun(run);
  }

  /** A reply the controller matched, handed to whatever is waiting for one. */
  pushReply(reply: TourReply): void {
    this.replies.push(reply);
  }

  /** A question asked while the robot was talking. Answered at the next dwell. */
  enqueueQuestion(text: string, language: SpokenLanguage): boolean {
    const s = this.session;
    if (!s) return false;
    // Three is the whole queue. A visitor who asks four questions during one
    // talk track gets the first three answered and the rest re-asked — better
    // than a robot working through a backlog nobody remembers asking for.
    if (s.questions.length >= 3) return false;
    const stop = s.currentStop >= 0 ? (s.route.stops[s.currentStop] ?? null) : null;
    s.questions.push({ text: text.trim(), language, at: this.stamp(), stopId: stop?.id ?? null });
    return true;
  }

  /** Ask a yes/no question out loud and wait for the answer. Templated, no model. */
  private async ask(
    kind: TourQuestionKind,
    route: TourRoute,
    text: string,
    windowMs: number,
    exec?: TourExecution,
  ): Promise<TourReply | 'lapsed'> {
    this.replies = [];
    this.pendingQuestion = {
      kind,
      route,
      askedAt: this.nowMs(),
      expiresAt: this.nowMs() + windowMs,
      disclosureSpoken: this.session?.run.disclosureSpoken ?? false,
    };
    await this.say(text, route.language);
    try {
      // Counted in polls rather than measured against the clock: `sleep` is
      // injectable, and a wait whose end depends on wall time cannot be driven
      // deterministically by a test that replaces it.
      const polls = Math.max(1, Math.ceil(windowMs / TOUR_REPLY_POLL_MS));
      for (let i = 0; i < polls; i++) {
        const reply = this.replies.shift();
        if (reply) return reply;
        // An E-Stop must not leave the robot standing here for the rest of the
        // window and then say two more sentences. The runner's own abort was
        // already checked; the executor's (E-Stop, teleop takeover) was not.
        if (this.abortRequest || this.visitorEnd || exec?.isAborted()) return 'lapsed';
        // Somebody who asks a QUESTION instead of answering has not left —
        // they are standing right there talking. Answer it and give them the
        // window back, rather than recording "nobody answered, the visitor had
        // left" about a person mid-sentence.
        if (this.session && this.session.questions.length > 0) {
          await this.answerOne(this.session.questions.shift()!);
          i = -1;
          continue;
        }
        await this.sleep(TOUR_REPLY_POLL_MS);
      }
      return 'lapsed';
    } finally {
      this.pendingQuestion = null;
      this.replies = [];
    }
  }

  // ── refusal / decline ─────────────────────────────────────────────────────

  /**
   * A start that did not happen. Recorded as a `skipped` run and announced
   * through `agent:tour:finished`, so the server persists it — the same
   * fail-closed rule as patrol: a refusal nobody can see is a silent failure.
   */
  refuse(route: TourRoute, origin: TourRunOrigin, reason: TourRefusalReason, message: string): TourStartResult {
    const run = newTourRun({ robotId: this.deps.robotId, route, origin, status: 'skipped', reason: `${reason}: ${message}` });
    this.persist(run);
    this.last = run;
    this.log(`refused a tour of "${route.name}" (${origin}): ${reason} — ${message}`);
    this.deps.emit('agent:tour:finished', cloneRun(run));
    return { accepted: false, runId: run.runId, reason, message };
  }

  /** The visitor said no. Not a failure — the most common outcome of a good greeting. */
  decline(route: TourRoute, reason = 'the visitor declined the tour', disclosureSpoken = true): TourRun {
    this.clearPending();
    const run = newTourRun({
      robotId: this.deps.robotId,
      route,
      origin: 'visitor',
      status: 'declined',
      reason,
      disclosureSpoken,
    });
    this.persist(run);
    this.last = run;
    this.deps.emit('agent:tour:finished', cloneRun(run));
    return cloneRun(run);
  }

  // ── start / drive ─────────────────────────────────────────────────────────

  /**
   * Build the run and its plan blocks. The controller puts the blocks into an
   * AgentPlan, emits `agent:plan:started`, then calls {@link drive}.
   */
  begin(route: TourRoute, origin: TourRunOrigin, opts: { disclosureSpoken?: boolean } = {}): { run: TourRun; blocks: TourPlanBlock[] } {
    if (this.session) throw new Error('a tour is already running');
    this.clearPending();
    const disclosureSpoken = opts.disclosureSpoken === true;
    const blocks = buildTourBlocks(route, { disclosureSpoken });
    const run = newTourRun({ robotId: this.deps.robotId, route, origin, disclosureSpoken });
    this.session = { run, route, blocks, currentStop: -1, questions: [], roomAsked: new Set<number>() };
    this.abortRequest = null;
    this.visitorEnd = null;
    this.persist(run);
    return { run, blocks };
  }

  /**
   * Drive the plan with stop semantics. Resolves with the finished run; never
   * throws (a crash becomes a `failed` run).
   *
   * Where this differs from patrol's `drive`, and why:
   *  * a failed leg does NOT end the tour after two — a visitor is following
   *    the robot, and walking them back to the door because one door was shut
   *    is worse than skipping that stop and carrying on;
   *  * every stop ends in a dwell where the visitor's questions are answered;
   *  * the farewell walk runs even when the visitor left early, because the
   *    robot has to get back to where the next visitor will find it.
   */
  async drive(planId: string, exec: TourExecution): Promise<TourRun> {
    const s = this.session;
    if (!s) throw new Error('drive() without begin()');
    const run = s.run;
    run.planId = planId;
    this.deps.emit('agent:tour:started', cloneRun(run));
    const aborted = (): boolean => exec.isAborted() || this.abortRequest !== null;
    const abortReason = (): string => exec.abortReason() ?? this.abortRequest ?? 'aborted';
    const tourBlock = s.blocks[0]?.block;
    /** Set when the visitor ended the tour early (said no / goodbye / walked away). */
    let visitorLeft: { status: TourRun['status']; reason: string } | null = null;
    /** Whatever ended the visit: the visitor's own words, or this loop's. */
    const ended = (): { status: TourRun['status']; reason: string } | null => visitorLeft ?? this.visitorEnd;

    try {
      if (tourBlock) exec.begin(tourBlock);

      // Non-leg blocks between the `tour` block and the first stop: the AI
      // disclosure, when the greeting did not already say it. They are not
      // part of any leg and would otherwise never run — the leg loop below
      // only walks blocks it owns.
      for (const pb of s.blocks.slice(1)) {
        if (pb.legIndex !== -1 || pb.home) break;
        if (aborted()) {
          exec.skip(pb.block, abortReason());
          continue;
        }
        exec.begin(pb.block);
        const outcome = await exec.execute(pb.block);
        exec.finish(pb.block, outcome);
        // The disclosure is only "spoken" once it has actually been played.
        if (pb.block.params.disclosure === true && pb.block.params.spoken === true) {
          run.disclosureSpoken = true;
          this.persist(run);
        }
      }

      for (let i = 0; i < run.legs.length; i++) {
        const leg = run.legs[i];
        const stop = s.route.stops[i];
        const legBlocks = s.blocks.filter((b) => b.legIndex === i);
        if (aborted() || ended()) {
          const why = ended()?.reason ?? abortReason();
          for (const pb of legBlocks) exec.skip(pb.block, why);
          leg.status = 'skipped';
          leg.message = why;
          continue;
        }
        s.currentStop = i;
        leg.status = 'running';
        leg.startedAt = this.stamp();
        this.persist(run);
        // Say so at the START of the leg, not only when it settles: a snapshot
        // taken between legs carries no `running` leg at all, and the live
        // banner cannot name a stop the robot never said it was at (TASK-222).
        this.deps.emit('agent:tour:leg', cloneRun(run));

        let legFailed = false;
        let said = 0;
        const chunks = legBlocks.filter((b) => b.block.kind === 'present').length;
        for (const pb of legBlocks) {
          if (aborted()) {
            exec.skip(pb.block, abortReason());
            continue;
          }
          if (legFailed) {
            exec.skip(pb.block, 'could not get to this stop');
            continue;
          }
          // The visitor said goodbye mid-stop: stop talking at them.
          if (this.visitorEnd) {
            exec.skip(pb.block, this.visitorEnd.reason);
            continue;
          }
          if (pb.block.kind === 'goto') await this.makeRoom(i, s.route.language);
          exec.begin(pb.block);
          let outcome: BlockOutcome;
          try {
            outcome = await exec.execute(pb.block);
          } catch (err) {
            outcome = { ok: false, message: msg(err) };
          }
          exec.finish(pb.block, outcome);
          if (!outcome.ok) {
            if (pb.block.kind === 'goto') {
              legFailed = true;
              leg.message = outcome.message;
            } else {
              leg.message = outcome.message;
            }
          } else if (pb.block.kind === 'goto') {
            leg.message = outcome.message.split(' — ')[0];
          } else if (pb.block.kind === 'present') {
            said += 1;
          }
          if (pb.block.kind === 'demo') {
            leg.demo = readDemoResult(pb.block, outcome);
          }
          // Questions asked during the talk track are answered as soon as the
          // chunk in flight is finished — the mic only reopens between chunks,
          // so this IS the first moment the robot could have replied.
          if (!legFailed && (pb.block.kind === 'present' || pb.block.kind === 'wait')) {
            await this.drainQuestions(exec);
          }
        }
        leg.spoken = chunks > 0 ? { said, of: chunks } : null;
        leg.status = legFailed ? 'failed' : aborted() ? 'failed' : 'done';
        if (aborted() && !legFailed) leg.message = abortReason();
        leg.finishedAt = this.stamp();
        const pose = this.deps.getPose?.() ?? null;
        if (pose) leg.pose = { x: pose.x, y: pose.y, yawDeg: pose.yawDeg };
        this.persist(run);
        this.deps.emit('agent:tour:leg', cloneRun(run));

        // "Shall we go on?" — only when the stop asks for it and there is
        // somewhere left to go.
        const isLast = i === run.legs.length - 1;
        if (!isLast && !aborted() && !ended() && stop?.askToContinue) {
          const reply = await this.ask(
            'continue',
            s.route,
            tourPhrase('goOn', s.route.language),
            config.agentMode.tour.replyWindowMs,
            exec,
          );
          if (reply === 'yes') {
            await this.say(tourPhrase('continueYes', s.route.language), s.route.language);
          } else if (reply === 'no' || reply === 'bye') {
            visitorLeft = { status: 'done', reason: `the visitor ended the tour after ${i + 1} of ${run.legs.length} stop(s)` };
          } else {
            await this.say(tourPhrase('abandoned', s.route.language), s.route.language);
            visitorLeft = { status: 'abandoned', reason: 'nobody answered — the visitor had left' };
          }
        }
      }
      // Anything the visitor asked during the last stop's talk track was
      // promised an answer ("I will answer that as soon as I have finished
      // this sentence"). The per-stop drains cannot cover a question that
      // arrived during the last block of the last stop, so drain once more
      // before the robot turns round and walks away.
      if (!aborted() && !this.visitorEnd) await this.drainQuestions(exec);
      s.currentStop = -1;

      // Back to the greeting place, and goodbye.
      //
      // The WALK is skipped on a real abort (E-Stop, operator takeover): a
      // latched robot must not drive, and standing in a corridor is the lesser
      // problem. The FAREWELL is not — it moves nothing, and a visitor who was
      // mid-tour when the robot stopped is owed a sentence rather than a
      // machine that goes quiet and stares at them.
      for (const pb of s.blocks.filter((b) => b.home)) {
        if (aborted() && pb.block.kind !== 'speak') {
          exec.skip(pb.block, abortReason());
          continue;
        }
        exec.begin(pb.block);
        const outcome = await exec.execute(pb.block);
        exec.finish(pb.block, outcome);
      }

      const visitorClosed = ended();
      if (aborted()) {
        run.status = 'aborted';
        run.reason = abortReason();
      } else if (visitorClosed) {
        run.status = visitorClosed.status;
        run.reason = visitorClosed.reason;
      } else if (run.legs.length > 0 && run.legs.every((l) => l.status === 'failed')) {
        run.status = 'failed';
        run.reason = 'the robot could not reach a single stop';
      } else {
        run.status = 'done';
        const missed = run.legs.filter((l) => l.status !== 'done');
        if (missed.length > 0) run.reason = `${missed.length} stop(s) were not shown`;
      }
    } catch (err) {
      run.status = 'failed';
      run.reason = `crashed: ${msg(err)}`;
      for (const leg of run.legs) if (leg.status === 'pending' || leg.status === 'running') leg.status = 'skipped';
      console.error(`[Host] tour ${run.runId} crashed: ${msg(err)}`);
    } finally {
      run.finishedAt = this.stamp();
      if (tourBlock) {
        const shown = run.legs.filter((l) => l.status === 'done').length;
        const declined = run.turns.filter((t) => t.answered === 'declined').length;
        const summary =
          `Tour ${run.status}: ${shown}/${run.legs.length} stop(s) shown, ${run.turns.length} question(s)` +
          (declined > 0 ? ` (${declined} I could not answer)` : '') +
          `${run.reason ? ` — ${run.reason}` : ''}.`;
        exec.finish(tourBlock, { ok: run.status === 'done', message: summary });
      }
      this.persist(run);
      this.last = cloneRun(run);
      this.session = null;
      this.abortRequest = null;
      this.visitorEnd = null;
      this.pendingQuestion = null;
      this.replies = [];
      this.deps.emit('agent:tour:finished', cloneRun(run));
    }
    return cloneRun(run);
  }

  /**
   * Somebody standing in the way is asked to move, once per leg, out loud —
   * and then the robot walks anyway. The forward-clearance floor
   * (`AGENT_RANGE_MIN_M`) is the thing that actually stops it; this is
   * courtesy, and pretending it is a safety interlock would be worse than not
   * having it.
   */
  private async makeRoom(legIndex: number, language: SpokenLanguage): Promise<void> {
    const s = this.session;
    if (!s || s.roomAsked.has(legIndex)) return;
    const range = this.deps.rangeAheadM?.() ?? null;
    const person = this.deps.personVisible?.() ?? false;
    if (!person || range === null || range >= config.agentMode.tour.minPersonM) return;
    s.roomAsked.add(legIndex);
    await this.say(tourPhrase('giveRoom', language), language);
    await this.sleep(2000);
  }

  /** Answer everything queued, oldest first. One model call per question, at most. */
  private async drainQuestions(exec: TourExecution): Promise<void> {
    const s = this.session;
    if (!s) return;
    while (s.questions.length > 0 && !exec.isAborted() && this.abortRequest === null) {
      const q = s.questions.shift();
      if (!q) return;
      await this.answerOne(q);
    }
  }

  private async answerOne(q: TourQuestion): Promise<void> {
    const s = this.session;
    if (!s) return;
    // The stop the question was asked at, falling back to where the robot is
    // now for a question asked between stops.
    const stop =
      (q.stopId ? s.route.stops.find((x) => x.id === q.stopId) : undefined) ??
      (s.currentStop >= 0 ? (s.route.stops[s.currentStop] ?? null) : null);
    let result: TourAnswer;
    try {
      result = (await this.deps.answer?.({ question: q.text, language: q.language, route: s.route, stop })) ?? {
        answer: `${tourPhrase('dontKnow', q.language)} ${tourPhrase('noteTaken', q.language)}`,
        answered: 'declined',
      };
    } catch (err) {
      this.log(`could not answer "${q.text}": ${msg(err)}`);
      result = { answer: tourPhrase('answerFailed', q.language), answered: 'unanswered' };
    }
    await this.say(result.answer, q.language);
    // The switch REDACTS the transcript, it does not omit the turn.
    //
    // Dropping the turn entirely looked like the private thing to do and was
    // worse in three ways: the run then claimed nobody had asked anything, the
    // "questions the facts did not cover" number — the whole point of the
    // classification — went to zero, and the event still carried the question
    // text off the robot while the stored run did not, which is both the wrong
    // way round AND made every later event look like a downgrade to the app's
    // out-of-order guard. What is kept here is a count and an outcome, which
    // is not personal data; what is dropped is what the visitor actually said.
    const keepText = config.agentMode.tour.transcriptEnabled;
    const turn: TourTurn = {
      at: q.at,
      stopId: stop?.id ?? null,
      question: keepText ? q.text : '',
      answer: keepText ? result.answer : '',
      answered: result.answered,
      language: q.language,
    };
    s.run.turns.push(turn);
    this.persist(s.run);
    this.deps.emit('agent:tour:turn', cloneRun(s.run), turn);
  }

  // ── persistence ───────────────────────────────────────────────────────────

  private persist(run: TourRun): void {
    if (!this.runs) return;
    try {
      this.runs.saveRun(run);
    } catch (err) {
      console.warn(`[Host] could not persist tour ${run.runId}: ${msg(err)}`);
    }
  }

  /** Close runs a restart left `running`, at boot. */
  closeInterrupted(): TourRun[] {
    const closed = this.runs?.closeInterrupted() ?? [];
    for (const run of closed) this.deps.emit('agent:tour:finished', cloneRun(run));
    if (closed.length > 0) this.log(`closed ${closed.length} tour(s) interrupted by a restart`);
    return closed;
  }

  /** Transcript retention sweep at boot + daily. `unref()`ed — never holds shutdown open. */
  startRetentionSweep(): void {
    if (this.sweepTimer || !this.runs) return;
    const sweep = (): void => {
      const cleared = this.runs?.sweep() ?? [];
      if (cleared.length > 0) this.log(`cleared the transcript of ${cleared.length} tour(s) past retention`);
    };
    sweep();
    this.sweepTimer = setInterval(sweep, 24 * 60 * 60_000);
    this.sweepTimer.unref?.();
  }
}

/**
 * What a finished `demo` block did, read back off the block the executor just
 * ran. `narrate` mode is reported as `narrated` and never as `done`: a
 * timeline that says a grasp happened when the robot only talked about it is
 * the one lie this feature must not tell.
 */
function readDemoResult(block: AgentBlock, outcome: BlockOutcome): TourLeg['demo'] {
  const p = block.params as Record<string, unknown>;
  const mode = p.mode === 'execute' ? 'execute' : 'narrate';
  const skillId = typeof p.skillId === 'string' ? p.skillId : '';
  const skillName = typeof p.skillName === 'string' ? p.skillName : skillId;
  const steps = Number(p.steps);
  return {
    mode,
    status: !outcome.ok ? 'failed' : mode === 'narrate' ? 'narrated' : 'done',
    skillId,
    skillName,
    steps: Number.isFinite(steps) ? steps : null,
    durationMs:
      block.startedAt && block.finishedAt ? Math.max(0, Date.parse(block.finishedAt) - Date.parse(block.startedAt)) : null,
    model: typeof p.modelVersionId === 'string' ? p.modelVersionId : null,
    message: outcome.message,
  };
}

function cloneRun(run: TourRun): TourRun {
  return {
    ...run,
    legs: run.legs.map((l) => ({ ...l, ...(l.demo ? { demo: { ...l.demo } } : {}), ...(l.spoken ? { spoken: { ...l.spoken } } : {}) })),
    turns: run.turns.map((t) => ({ ...t })),
  };
}
