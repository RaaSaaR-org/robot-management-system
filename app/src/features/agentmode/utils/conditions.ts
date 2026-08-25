/**
 * @file conditions.ts
 * @description The single source of truth for "what is wrong with this robot
 *              right now": the eight conditions the Agent Mode page can raise,
 *              always all eight, each with its current value and severity.
 * @feature agentmode
 */

import {
  selectDamped,
  selectError,
  selectEstopActive,
  selectEstopStatus,
  selectGeofenceNotEnforcing,
  selectRecovered,
  selectSelf,
  selectSelfAgeUnknown,
  selectSelfUpdatedAt,
  selectSelfSuperseded,
  selectStateUnknown,
} from '../store/agentmodeStore';
import type { AgentModeStore } from '../types/agentmode.types';

// ============================================================================
// TYPES
// ============================================================================

/**
 * The conditions this page is allowed to colour. Nothing outside this list may
 * put amber or red on the Agent Mode page — that rule is what keeps an amber
 * badge meaning "this is true right now" rather than becoming wallpaper.
 */
export type ConditionKey =
  | 'stateUnknown'
  | 'estop'
  | 'geofence'
  | 'recovered'
  | 'damped'
  | 'superseded'
  | 'stale'
  | 'error';

/**
 * How loud an active condition is.
 *
 * - `0` — not active. Nothing is rendered and nothing is coloured.
 * - `1` — active, but not a claim about the robot's safety state: the last
 *   request this console made failed. Worth showing, not worth an alarm.
 * - `2` — an active safety condition: amber. The robot cannot walk, its state
 *   is unknown, its snapshot is old, it came back from a crash.
 * - `3` — an alarm: a stop that the hardware did NOT confirm. Red, and the one
 *   level that may never be collapsed behind a disclosure.
 */
export type ConditionLevel = 0 | 1 | 2 | 3;

/** One condition and its value right now. `active: false` is a real answer. */
export interface Condition {
  key: ConditionKey;
  active: boolean;
  /** `0` while inactive — the level is what an ACTIVE condition costs. */
  level: ConditionLevel;
}

// ============================================================================
// ORDER + LABELS
// ============================================================================

/**
 * Fixed severity order, most-qualifying first.
 *
 * `stateUnknown` leads because it qualifies every claim under it: while the
 * robot is silent, "latched", "damped" and "recovered" are memories, not
 * readings. `error` trails because it is about this console's last request, not
 * about the robot. Consumers render in THIS order and never re-sort — the
 * operator learns the sequence, and a list that re-orders itself under a
 * changing situation is a list nobody can read at a glance.
 */
export const CONDITION_ORDER: readonly ConditionKey[] = [
  'stateUnknown',
  'estop',
  'geofence',
  'recovered',
  'damped',
  'superseded',
  'stale',
  'error',
] as const;

/**
 * What each condition is ABOUT — the row label of the details drawer's
 * checklist, not the banner headline. The headlines are copy that belongs to
 * the notice that owns each condition (EstopBanner, SelfHeader); duplicating
 * them here is how the two drift apart.
 */
export const CONDITION_LABELS: Record<ConditionKey, string> = {
  stateUnknown: 'Robot reachable',
  estop: 'E-Stop latch',
  geofence: 'Keepout fence',
  recovered: 'Boot recovery',
  damped: 'Base arming',
  superseded: 'Snapshot process',
  stale: 'Snapshot age',
  error: 'Last request',
};

/**
 * The short value of an ACTIVE condition — deliberately not the banner copy.
 *
 * The banners explain what to do; this only has to say which of the two values
 * a condition currently has. It lives here rather than in one of its two
 * consumers (the details drawer's checklist and the page's live region) because
 * the failure mode of a second copy is a screen reader being told something
 * different from what the checklist two clicks away says about the same robot.
 */
export const CONDITION_ACTIVE_HEADLINE: Record<ConditionKey, string> = {
  stateUnknown: 'not reachable — its state is unknown',
  estop: 'latched — commands refused',
  geofence: 'not enforcing — a keepout would not stop the robot',
  recovered: 'unacknowledged, the robot will not act on its own',
  damped: 'damped — it cannot walk, turn or go to',
  superseded: 'from a different process than last answered',
  stale: 'cached — older than a minute',
  error: 'the last request failed',
};

/**
 * The value of an INACTIVE condition, said specifically rather than as "clear".
 *
 * A single word reused for every row is how the checklist starts lying by
 * accident. `recovered` is the case that forced this: it means "there is an
 * UNACKNOWLEDGED recovery record", so a robot whose crash has been acknowledged
 * renders the row inactive — and "Boot recovery: clear" then reads as "no crash
 * happened" while the rail one line above still says "recovered from crash".
 * Both statements are true and they look like a contradiction, which is exactly
 * the doubt this checklist exists to remove.
 *
 * So each row says what its own false value actually means, and none of them
 * claims more than the store knows: `superseded` says no mismatch was SEEN, not
 * that none exists, and `damped` says "not damped" rather than "it can walk",
 * which would be a positive claim about hardware nobody asked.
 *
 * `geofence` is the sharpest case of that rule. THREE different states render
 * this row inactive — the fence is enforcing, the robot has no map to fence
 * with, or the agent is too old to report either — so the row says only that no
 * lapse was reported. "Enforcing" would be a claim about a fence that, in two
 * of those three states, does not exist.
 */
export const CONDITION_CLEAR_HEADLINE: Record<ConditionKey, string> = {
  stateUnknown: 'reachable',
  estop: 'not latched',
  geofence: 'no lapse reported',
  recovered: 'nothing unacknowledged',
  damped: 'not damped',
  superseded: 'no mismatch seen',
  stale: 'fresh — under a minute old',
  error: 'no failure',
};

// ============================================================================
// STALENESS
// ============================================================================

/**
 * Past this a self snapshot stops being "what the robot is doing" and becomes
 * "what the robot was doing".
 *
 * Deliberately the same 60 s as `SelfHeader`'s own `STALE_AFTER_MS` and the
 * store's `SELF_SUPERSEDED_MIN_AGE_MS`: this predicate exists to say what the
 * freshness clause on screen is already saying, and a second, different
 * threshold would produce a rail dot that disagrees with the badge beside it.
 * Neither of those constants is exported, so this is a copy — if one moves,
 * all three move.
 */
const STALE_AFTER_MS = 60_000;

/**
 * Whether the self snapshot on screen is old — the condition behind the amber
 * freshness clause.
 *
 * Mirrors `FreshnessClause`'s `data-stale` exactly, including the two cases
 * that are easy to get wrong:
 *
 * - An UNKNOWN age counts as stale. "Nobody can date this" is not better news
 *   than "this is five minutes old", and it is rendered just as loudly.
 * - `live` is NOT consulted. A snapshot the robot itself pushed a minute ago is
 *   just as old as a mirrored one; live only decides whether the word "cached"
 *   is added, never whether the clause goes amber.
 *
 * An unparsable stamp yields *not stale*, again matching the header: it renders
 * no clause at all there, so raising a condition here would colour the rail for
 * something the operator cannot see the cause of.
 */
function selfSnapshotIsStale(state: AgentModeStore, now: number): boolean {
  // Nothing has arrived yet: there is no snapshot to be old.
  if (!selectSelf(state)) return false;
  if (selectSelfAgeUnknown(state)) return true;

  const updatedAt = selectSelfUpdatedAt(state);
  if (!updatedAt) return false;
  const taken = Date.parse(updatedAt);
  if (Number.isNaN(taken)) return false;
  // A robot's clock is not this browser's, so a snapshot can arrive "from the
  // future" — clamp rather than let a negative age read as fresh forever.
  return Math.max(0, now - taken) >= STALE_AFTER_MS;
}

// ============================================================================
// SELECTOR
// ============================================================================

/**
 * One-entry memo so `useAgentModeStore(selectConditions)` is safe.
 *
 * zustand v5 caches snapshots by identity: a selector that builds a fresh array
 * on every call makes React re-render forever. Keying on the value signature
 * (which conditions are active, plus whether the E-Stop is an alarm) hands back
 * the SAME array while nothing changed, so every consumer — rail dot, banner,
 * drawer — can subscribe directly and they all share one identity.
 */
let cachedSignature: string | null = null;
let cachedConditions: readonly Condition[] = [];

/**
 * Every condition this page can raise, with its current value.
 *
 * Returns ALL SEVEN, always, in {@link CONDITION_ORDER} — never filtered down to
 * the active ones. That is the point of the shape: the details drawer renders
 * the false ones too, which is what lets an operator verify that a calm rail is
 * calm because the conditions are false rather than because the rail broke. A
 * consumer that only wants the active ones filters; nothing may cap the list,
 * summarise it, or fold a tail into "+n more".
 *
 * @param state - The Agent Mode store state (not the wire `AgentModeState`:
 *                `estopStatus`, `stateReachability` and the snapshot age all
 *                live on the store, not on what the robot sent).
 * @param now - Injectable clock for the age comparison; tests pass a fixed one.
 */
export function selectConditions(state: AgentModeStore, now: number = Date.now()): Condition[] {
  const estopActive = selectEstopActive(state);
  const estopStatus = selectEstopStatus(state);
  // A stop the hardware did not confirm is an alarm, not a status — the robot
  // may still be moving. Only these two earn level 3, and only while the latch
  // is actually set.
  const alarm = estopActive && (estopStatus === 'failed' || estopStatus === 'unconfirmed');

  const active: Record<ConditionKey, boolean> = {
    stateUnknown: selectStateUnknown(state),
    estop: estopActive,
    geofence: selectGeofenceNotEnforcing(state),
    recovered: selectRecovered(state) !== null,
    damped: selectDamped(state),
    superseded: selectSelfSuperseded(state),
    stale: selfSnapshotIsStale(state, now),
    error: selectError(state) !== null,
  };

  const signature =
    CONDITION_ORDER.map((key) => (active[key] ? '1' : '0')).join('') + (alarm ? 'A' : '-');
  if (signature === cachedSignature) return cachedConditions as Condition[];

  cachedSignature = signature;
  cachedConditions = CONDITION_ORDER.map((key) => ({
    key,
    active: active[key],
    level: active[key] ? levelFor(key, alarm) : 0,
  }));
  return cachedConditions as Condition[];
}

/** What an ACTIVE condition costs. See {@link ConditionLevel}. */
function levelFor(key: ConditionKey, alarm: boolean): ConditionLevel {
  if (key === 'estop') return alarm ? 3 : 2;
  // `geofence` is amber (the level-2 default below), deliberately not red.
  // Level 3 is documented above as "a stop the hardware did NOT confirm" and
  // fires an assertive screen-reader interrupt; the commonest cause of a fence
  // lapse is a dropped pose poll, which is transient, so red here would
  // interrupt the operator once per dropped poll until it meant nothing.
  // Not a safety condition: a failed request says something about this console,
  // not about the robot's latch or its base. Giving it the same amber as "the
  // base cannot walk" is how amber stops meaning anything.
  if (key === 'error') return 1;
  return 2;
}

/**
 * How loud the page as a whole has to be: the MAXIMUM over the active
 * conditions, never the first match.
 *
 * The regression this exists to prevent is a ranked strip that shows the
 * highest-priority condition and stops: with the robot unreachable AND a stop
 * the hardware never confirmed, the first entry in severity order is the
 * unreachable one (level 2) and the alarm (level 3) would silently lose its
 * red. Simultaneous conditions are the normal case, not the edge case.
 */
export function conditionLevel(conditions: readonly Condition[]): ConditionLevel {
  let level: ConditionLevel = 0;
  for (const condition of conditions) {
    if (condition.active && condition.level > level) level = condition.level;
  }
  return level;
}
