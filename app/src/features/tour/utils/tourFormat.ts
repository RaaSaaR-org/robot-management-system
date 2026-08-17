/**
 * @file tourFormat.ts
 * @description Pure helpers for the host-mode UI: the talk-track chunking and
 *              speech estimate the ROBOT uses (mirrored, see below), status and
 *              answer styling, run summaries, and the transcript's retention
 *              state.
 * @feature tour
 */

import { formatWhen } from '@/features/patrol/utils/patrolFormat';
import type {
  TourLegStatus,
  TourRoute,
  TourRun,
  TourRunStatus,
  TourStop,
  TourTurnAnswer,
} from '../types/tour.types';
import { TOUR_RUN_STATUS_LABELS, TOUR_TURN_ANSWER_LABELS } from '../types/tour.types';

/**
 * Shared with patrol on purpose: an operator reading a tour run and a patrol run
 * in the same session must not have to parse two date formats.
 */
export { formatWhen };

// ============================================================================
// TALK TRACKS — mirrored from the robot
// ============================================================================

/**
 * SOURCE OF RECORD: `robot-agent/src/agent-mode/host.ts`
 * (`TOUR_SENTENCES_PER_CHUNK`, `TOUR_STOP_SPEECH_CAP_S`, `TOUR_SPEECH_CHARS_PER_S`,
 * `chunkTalkTrack`, `estimateSpeechSeconds`).
 *
 * They are duplicated here rather than imported because the app does not build
 * against the robot-agent package, and an author who writes a talk track needs
 * to see the SAME chunk boundaries and the SAME seconds the robot will produce
 * — a counter that disagrees with the robot is worse than no counter, because it
 * is believed. `tourFormat.test.ts` pins the behaviour on a 600-char track;
 * when host.ts changes, that test is the tripwire.
 */

/** Sentences per spoken chunk. The (half-duplex) mic reopens between chunks. */
export const TOUR_SENTENCES_PER_CHUNK = 2;
/** Hard cap on how long one stop may talk, seconds. Beyond this the tail is dropped. */
export const TOUR_STOP_SPEECH_CAP_S = 40;
/** Measured Piper rate at the default length scale: ~14 characters per second. */
export const TOUR_SPEECH_CHARS_PER_S = 14;

/** Seconds the robot needs to say `text`, to one decimal. */
export function estimateSpeechSeconds(text: string): number {
  return Math.round((text.trim().length / TOUR_SPEECH_CHARS_PER_S) * 10) / 10;
}

/**
 * Split an authored talk track into ≤{@link TOUR_SENTENCES_PER_CHUNK}-sentence
 * chunks, dropping whatever exceeds {@link TOUR_STOP_SPEECH_CAP_S}. Never splits
 * mid-sentence: a chunk boundary is a place the robot stops talking, and
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
    // The first chunk is always kept: a stop that says nothing at all is worse
    // than a stop that runs a few seconds over its cap.
    const cost = estimateSpeechSeconds(chunk);
    if (kept.length > 0 && seconds + cost > capSeconds) break;
    kept.push(chunk);
    seconds += cost;
  }
  return kept;
}

/** Seconds of speech a stop actually gets out — the tail past the cap is not counted. */
export function stopSpeechSeconds(talkTrack: string): number {
  const seconds = chunkTalkTrack(talkTrack).reduce((total, chunk) => total + estimateSpeechSeconds(chunk), 0);
  return Math.round(seconds * 10) / 10;
}

/** True when the cap dropped part of the authored track — the editor has to say so. */
export function talkTrackTruncated(talkTrack: string): boolean {
  return chunkTalkTrack(talkTrack, Number.POSITIVE_INFINITY).length > chunkTalkTrack(talkTrack).length;
}

/**
 * What a route needs, in seconds. Mirrors `estimateTourSeconds` in host.ts,
 * including its ~20 s-per-leg walking guess. Typed on the fields it reads, not
 * on `TourRoute`, so the editor can price a draft that has no id yet.
 */
export interface TourDurationInput {
  greeting: string;
  farewell: string;
  stops: readonly TourStop[];
}

export function estimateTourSeconds(route: TourDurationInput): number {
  const walk = 20;
  return Math.round(
    route.stops.reduce(
      (total, stop) => total + walk + stop.dwellS + stopSpeechSeconds(stop.talkTrack) + (stop.demo ? stop.demo.expectSeconds : 0),
      estimateSpeechSeconds(route.greeting) + estimateSpeechSeconds(route.farewell) + walk
    )
  );
}

/** "about 6 min" / "about 40 s" — never a false precision on an estimate. */
export function formatEstimate(seconds: number): string {
  if (seconds < 90) return `about ${Math.max(1, Math.round(seconds))} s`;
  return `about ${Math.round(seconds / 60)} min`;
}

// ============================================================================
// STATUS STYLES
// ============================================================================

export interface ChipStyle {
  label: string;
  className: string;
  pulse?: boolean;
}

/**
 * `declined` is turquoise-neutral, not amber: the visitor said no to the offer,
 * which is a normal end of a greeting and must not read as something to fix.
 */
const RUN_STATUS_STYLES: Record<TourRunStatus, ChipStyle> = {
  running: { label: TOUR_RUN_STATUS_LABELS.running, className: 'bg-cobalt-500/15 text-cobalt-600 dark:text-cobalt-300', pulse: true },
  done: { label: TOUR_RUN_STATUS_LABELS.done, className: 'bg-turquoise-500/15 text-turquoise-700 dark:text-turquoise-400' },
  declined: { label: TOUR_RUN_STATUS_LABELS.declined, className: 'glass-subtle text-theme-secondary' },
  abandoned: { label: TOUR_RUN_STATUS_LABELS.abandoned, className: 'glass-subtle text-theme-muted' },
  aborted: { label: TOUR_RUN_STATUS_LABELS.aborted, className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  failed: { label: TOUR_RUN_STATUS_LABELS.failed, className: 'bg-red-500/15 text-red-600 dark:text-red-400' },
  skipped: { label: TOUR_RUN_STATUS_LABELS.skipped, className: 'glass-subtle text-theme-muted' },
};

/** Pill styling for a tour run status. */
export function runStatusStyle(status: TourRunStatus): ChipStyle {
  return RUN_STATUS_STYLES[status] ?? RUN_STATUS_STYLES.skipped;
}

const LEG_STATUS_STYLES: Record<TourLegStatus, ChipStyle> = {
  pending: { label: 'Pending', className: 'glass-subtle text-theme-tertiary' },
  running: { label: 'Running', className: 'bg-cobalt-500/15 text-cobalt-600 dark:text-cobalt-300', pulse: true },
  done: { label: 'Done', className: 'bg-turquoise-500/15 text-turquoise-700 dark:text-turquoise-400' },
  failed: { label: 'Failed', className: 'bg-red-500/15 text-red-600 dark:text-red-400' },
  skipped: { label: 'Skipped', className: 'glass-subtle text-theme-muted' },
};

/** Pill styling for a stop's leg status. */
export function legStatusStyle(status: TourLegStatus): ChipStyle {
  return LEG_STATUS_STYLES[status] ?? LEG_STATUS_STYLES.pending;
}

/**
 * `declined` is amber and `unanswered` is red, and the difference is the point:
 * a declined question is the robot doing the right thing with facts it does not
 * have (the operator's cue to add one), an unanswered one is the robot failing
 * to say anything at all.
 */
const TURN_ANSWER_STYLES: Record<TourTurnAnswer, ChipStyle> = {
  grounded: { label: TOUR_TURN_ANSWER_LABELS.grounded, className: 'bg-turquoise-500/15 text-turquoise-700 dark:text-turquoise-400' },
  from_camera: { label: TOUR_TURN_ANSWER_LABELS.from_camera, className: 'bg-cobalt-500/15 text-cobalt-600 dark:text-cobalt-300' },
  declined: { label: TOUR_TURN_ANSWER_LABELS.declined, className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  unanswered: { label: TOUR_TURN_ANSWER_LABELS.unanswered, className: 'bg-red-500/15 text-red-600 dark:text-red-400' },
};

/** Pill styling for how a visitor's question was answered. */
export function turnAnswerStyle(answer: TourTurnAnswer): ChipStyle {
  return TURN_ANSWER_STYLES[answer] ?? TURN_ANSWER_STYLES.unanswered;
}

// ============================================================================
// SUMMARIES
// ============================================================================

/** Statuses a run can no longer leave. Everything except `running`. */
const TERMINAL_RUN_STATUSES: ReadonlySet<TourRunStatus> = new Set<TourRunStatus>([
  'done',
  'declined',
  'abandoned',
  'aborted',
  'failed',
  'skipped',
]);

/** Whether a run still counts as "active" for banners and the route cards. */
export function isRunActive(run: TourRun | null | undefined): boolean {
  return Boolean(run && run.status === 'running');
}

export function isTerminalRunStatus(status: TourRunStatus): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

/**
 * "1/4 stops shown · 3 skipped · 2 questions" for a run row.
 *
 * Counts only stops the visitor was actually SHOWN. Patrol's version of this
 * counts every settled leg, which is right for a robot walking alone — the
 * question there is how far round the route it got. Here it read "4/4 stops"
 * for a visit that ended after the first stop and skipped the other three,
 * which is the one thing a record of a guided tour must never say.
 */
export function runProgressText(run: TourRun, opts: { questions?: boolean } = {}): string {
  const total = run.legs.length;
  const shown = run.legs.filter((l) => l.status === 'done').length;
  const failed = run.legs.filter((l) => l.status === 'failed').length;
  const skipped = run.legs.filter((l) => l.status === 'skipped').length;
  const parts = [`${shown}/${total} stops shown`];
  if (failed > 0) parts.push(`${failed} failed`);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  // The run list shows the question count in a column of its own, and repeating
  // it here is what pushed a 390px phone into horizontal scroll. The banner,
  // which has no such column, keeps it.
  if (opts.questions !== false) {
    parts.push(`${run.turns.length} ${run.turns.length === 1 ? 'question' : 'questions'}`);
  }
  return parts.join(' · ');
}

/** The stop the robot is at right now, or null. */
export function currentLeg(run: TourRun | null | undefined): TourRun['legs'][number] | null {
  return run?.legs.find((l) => l.status === 'running') ?? null;
}

/** The questions the facts did not cover — what the operator should author next. */
export function declinedTurns(run: TourRun | null | undefined): TourRun['turns'] {
  return (run?.turns ?? []).filter((t) => t.answered === 'declined');
}

// ============================================================================
// TRANSCRIPT RETENTION
// ============================================================================

/**
 * Default of `TOUR_TRANSCRIPT_RETENTION_DAYS` on the robot (`host.ts`
 * `TourRunStore.sweep`): past it the TURNS of a run are cleared and the run
 * itself is kept. A deployment may configure a shorter window, so the UI says
 * "past its retention window" rather than naming a number it cannot verify.
 */
export const TOUR_TRANSCRIPT_RETENTION_DAYS = 30;

/**
 * `none` — nobody asked anything; `swept` — something may have been asked and
 * was cleared by the retention sweep. The distinction exists because an empty
 * list under a heading called "Questions" is read as "no one asked", which for
 * a swept run is a claim the data cannot support.
 */
export type TranscriptState = 'present' | 'swept' | 'none';

export function transcriptState(run: TourRun, now: number = Date.now()): TranscriptState {
  if (run.turns.length > 0) return 'present';
  const started = Date.parse(run.startedAt);
  if (!Number.isFinite(started)) return 'none';
  return now - started > TOUR_TRANSCRIPT_RETENTION_DAYS * 24 * 60 * 60 * 1000 ? 'swept' : 'none';
}

/** Longest route the UI offers to draw as a stepper before it just counts them. */
export function routeSummaryText(route: TourRoute): string {
  const stops = route.stops.length;
  const demos = route.stops.filter((s) => s.demo).length;
  const parts = [`${stops} ${stops === 1 ? 'stop' : 'stops'}`, formatEstimate(estimateTourSeconds(route))];
  if (demos > 0) parts.push(`${demos} ${demos === 1 ? 'demo' : 'demos'}`);
  return parts.join(' · ');
}
