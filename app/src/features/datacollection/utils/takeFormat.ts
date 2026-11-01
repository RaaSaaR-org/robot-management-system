/**
 * @file takeFormat.ts
 * @description One way to name a take and who acted on it (TASK-410 D2).
 *              The wire numbers takes from 0; every screen says "Take N" with
 *              N = take + 1, and a number is never reused after a discard.
 * @feature datacollection
 */

import type { EpisodeActor, EpisodeConflictCode, LiveState } from '../types/datacollection.types';

/** The 1-based number shown for a 0-based wire take. */
export const takeNumber = (take: number): number => take + 1;

/** "Take 3" for wire take 2. */
export const takeLabel = (take: number): string => `Take ${takeNumber(take)}`;

/** `left_arm` → "L arm", `right_hand` → "R hand", `waist` → "Waist". */
export function groupLabel(group: string): string {
  const m = /^(left|right)_(.+)$/.exec(group);
  if (m) return `${m[1] === 'left' ? 'L' : 'R'} ${m[2].replace(/_/g, ' ')}`;
  const words = group.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A quick-check warning in words. */
export function warningLabel(warning: string): string {
  switch (warning) {
    case 'short':
      return 'Short';
    case 'no_motion':
      return 'No motion';
    case 'dropped_frames':
      return 'Dropped frames';
    default:
      return warning.replace(/_/g, ' ');
  }
}

/** The warnings that make Discard the suggested answer (never automatic, D3). */
export const DISCARD_SUGGESTING_WARNINGS: readonly string[] = ['no_motion', 'short'];

/** "by headset" / "by Anna" — the short actor tag on an episode row. */
export function actorTag(by: EpisodeActor | null | undefined): string | null {
  if (!by) return null;
  if (by.source === 'vr') return 'by headset';
  if (by.source === 'auto') return 'by robot';
  if (by.displayName) return `by ${by.displayName}`;
  return null;
}

type EpisodeEventKind = 'started' | 'stopped' | 'discarded';

/** "Take 11 stopped by the E-stop — discarded" (TASK-416 D4): one line on every view. */
export function describeEStopTake(take: number): string {
  return `${takeLabel(take)} stopped by the E-stop — discarded`;
}

/**
 * The toast for an action someone else took: "Take 5 started from the
 * headset", "Anna discarded take 4", "Take 6 stopped automatically".
 */
export function describeRemoteAction(kind: EpisodeEventKind, take: number, by: EpisodeActor | null | undefined): string {
  const n = takeNumber(take);
  if (by?.source === 'vr') return `Take ${n} ${kind} from the headset`;
  if (by?.source === 'auto') return `Take ${n} ${kind} automatically`;
  if (by?.displayName) return `${by.displayName} ${kind} take ${n}`;
  return `Take ${n} ${kind} from another browser`;
}

/** "from the headset" / "by Anna" / "" — the tail of a conflict toast. */
function actorPhrase(by: EpisodeActor | null | undefined): string {
  if (!by) return '';
  if (by.source === 'vr') return ' from the headset';
  if (by.source === 'auto') return ' automatically';
  if (by.displayName) return ` by ${by.displayName}`;
  return ' from another browser';
}

/**
 * The toast shown when the server refused an action because someone else got
 * there first. `by` is who caused the state the server answered with, when
 * this tab saw the event.
 */
export function describeConflict(
  code: EpisodeConflictCode | string,
  live: LiveState | null,
  by?: EpisodeActor | null,
): string {
  const take = live?.take;
  const label = typeof take === 'number' ? takeLabel(take) : 'The take';
  switch (code) {
    case 'already_capturing':
      return `Already started${actorPhrase(by)} — ${label} is recording`;
    case 'not_capturing':
      return `Already stopped${actorPhrase(by)}`;
    case 'episode_conflict':
      return live?.phase === 'capturing'
        ? `${label} was started elsewhere${actorPhrase(by)} — showing it now`
        : `${label} changed elsewhere${actorPhrase(by)} — showing the current state`;
    case 'already_discarded':
      return `${label} was already discarded${actorPhrase(by)}`;
    case 'no_take':
      return 'There is no take to discard yet';
    case 'not_recording':
      return 'The session is not recording';
    case 'unsupported_recorder':
      return "This robot's recorder runs its own episodes; start and stop are not available";
    default:
      return 'The session changed elsewhere — showing the current state';
  }
}

/** Why a discard was refused, in words, for the "was NOT discarded" toast. */
function discardRefusalReason(
  code: EpisodeConflictCode | string,
  take: number,
  live: LiveState | null,
  by?: EpisodeActor | null,
): string {
  const now = live?.take;
  switch (code) {
    case 'episode_conflict':
      return typeof now === 'number' && now !== take
        ? `${takeLabel(now)} was started elsewhere${actorPhrase(by)}`
        : `the take changed elsewhere${actorPhrase(by)}`;
    case 'unknown_take':
      return 'the server does not know that take';
    case 'recorder_unavailable':
      return 'the robot did not answer';
    case 'not_recording':
      return 'the session is not recording';
    case 'no_take':
      return 'there is no take yet';
    case 'unsupported_recorder':
      return "this robot's recorder runs its own episodes";
    default:
      return typeof code === 'string' && code ? code.replace(/_/g, ' ') : 'the server refused';
  }
}

/**
 * The toast when a discard did not happen (TASK-416): it always names the
 * take that SURVIVED, so nobody walks away thinking it is gone.
 * "Take 9 was NOT discarded — Take 10 was started elsewhere from the headset.
 * Discard it from the take list."
 */
export function describeDiscardRefusal(
  code: EpisodeConflictCode | string,
  take: number,
  live: LiveState | null,
  by?: EpisodeActor | null,
): string {
  if (code === 'already_discarded') return `${takeLabel(take)} was already discarded${actorPhrase(by)}`;
  return `${takeLabel(take)} was NOT discarded — ${discardRefusalReason(code, take, live, by)}. Discard it from the take list.`;
}
