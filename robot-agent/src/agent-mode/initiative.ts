/**
 * @file initiative.ts
 * @description The initiative gate: may the robot do this *on its own*?
 *              Not a safety monitor — `SafetyMonitor` constrains physics, this
 *              constrains intent. Pure, side-effect free, and deliberately
 *              landed before anything calls it with `origin: 'self'` (TASK-199
 *              wires the heartbeat up to it).
 * @feature agentmode
 * @status live
 */

import { PLACE_STALE_MS } from '../robot/StatePersistence.js';
import type { AgentBlockKind } from './types.js';

/**
 * Where the impulse came from.
 *
 * `scheduled` (TASK-212) is a patrol fired by the server's cron: nobody is
 * standing in front of the robot, so it is gated EXACTLY like `self` — battery,
 * known and fresh place, armed base, not damped, crash acknowledged — with one
 * difference: a scheduled patrol is the one sanctioned way the robot walks
 * unattended, so the `SELF_LOCOMOTION_KINDS` refusal for `goto` does not apply
 * to it (the other locomotion checks still do). An operator-started patrol
 * uses `operator`, like any other command.
 */
export type InitiativeOrigin = 'self' | 'operator' | 'scheduled';

/**
 * Below this the robot stops volunteering for work. An operator can still send
 * it anywhere — a human who wants the last 15% spent knows what they are doing.
 */
export const SELF_INITIATIVE_MIN_BATTERY = 20;

/**
 * Blocks that MOVE the robot through the world. They additionally require a
 * known, fresh place and an armed base: a robot that does not know where it is
 * cannot judge where "forward" leads.
 */
export const SELF_LOCOMOTION_KINDS: ReadonlySet<AgentBlockKind> = new Set<AgentBlockKind>([
  'walk',
  'turn',
  'goto',
]);

/**
 * Blocks the robot never initiates, whatever the circumstances.
 *
 * `posture` re-arms the base — standing a collapsed G1 back up is an explicit
 * human act, never a side effect of a timer. This mirrors the rule that
 * clearing the E-Stop latch does not re-arm the base either.
 *
 * `vla_skill` (TASK-226) hands a 43-DOF humanoid's arms to a learned policy
 * that cannot be interrupted between action chunks and cannot tell you whether
 * it is failing. A robot does not reach for things on its own initiative. Note
 * that this gate FAILS OPEN by construction — an unlisted kind is self-
 * initiable — so the entry is what forbids it, not the absence of one.
 */
export const SELF_FORBIDDEN_KINDS: ReadonlySet<AgentBlockKind> = new Set<AgentBlockKind>([
  'posture',
  'vla_skill',
]);

/** Blocks that cost nothing and cannot move anything, so the battery gate skips them. */
const FREE_KINDS: ReadonlySet<AgentBlockKind> = new Set<AgentBlockKind>(['speak', 'wait']);

/**
 * Everything the gate needs to answer. Passed in rather than read, so this
 * module stays pure and testable — and so the caller is forced to be explicit
 * about what it actually knows.
 */
export interface InitiativeContext {
  /** An E-Stop latch is held (ours or the SafetyMonitor's). */
  estopLatched: boolean;
  /**
   * The last shutdown was clean, OR a human has since acknowledged the crash.
   * `false` is the state a robot boots into after a `kill -9`.
   */
  crashAcknowledged: boolean;
  /** Battery percentage, or null when it is not known (which is not "full"). */
  batteryPercent: number | null;
  /** Named place the robot believes it is at (TASK-195), or null. */
  place: string | null;
  /** Age of that belief in ms; null means "no idea how old". */
  placeAgeMs: number | null;
  /** The base sits in a non-locomoting FSM and cannot walk. */
  damped: boolean;
}

/**
 * The answer. `reason` is always filled in — it is logged AND spoken, so it is
 * written in the first person and reads as a sentence a person can hear:
 * *"I did not go and look because I do not know where I am."*
 */
export interface InitiativeVerdict {
  ok: boolean;
  reason: string;
}

function allow(reason: string): InitiativeVerdict {
  return { ok: true, reason };
}

function refuse(reason: string): InitiativeVerdict {
  return { ok: false, reason };
}

/**
 * May `action` happen, given who wants it?
 *
 * An operator is never blocked here. Someone standing in front of the robot
 * giving it a command *is* the acknowledgement — the refusals below exist to
 * stop a robot from acting on its own while something about its situation is
 * unresolved, not to stop a human from working with it. (The E-Stop latch does
 * refuse an operator's command, but that refusal lives in the controller and in
 * `SafetyMonitor`, which is where the operator is told how to clear it.)
 */
export function mayInitiate(
  action: AgentBlockKind,
  origin: InitiativeOrigin,
  context: InitiativeContext,
): InitiativeVerdict {
  if (origin === 'operator') {
    return allow('An operator asked for it.');
  }
  // `scheduled` falls through: from here on it is judged exactly like `self`.
  // The place/battery/damped checks below are the whole point of routing a
  // cron-fired patrol through this gate — a robot that does not know where it
  // is must not set off on a route by itself.

  if (context.estopLatched) {
    return refuse('I did nothing on my own because an E-Stop is still latched.');
  }

  if (!context.crashAcknowledged) {
    return refuse(
      'I did nothing on my own because I did not shut down cleanly last time ' +
        'and nobody has cleared that yet.',
    );
  }

  if (SELF_FORBIDDEN_KINDS.has(action)) {
    return refuse(
      `I do not do "${action}" on my own — putting myself back on my feet is ` +
        'something a person has to ask for.',
    );
  }

  if (!FREE_KINDS.has(action)) {
    if (context.batteryPercent === null) {
      return refuse('I did nothing on my own because I do not know how much battery I have.');
    }
    if (context.batteryPercent < SELF_INITIATIVE_MIN_BATTERY) {
      return refuse(
        `I did nothing on my own because my battery is at ${Math.round(context.batteryPercent)}%.`,
      );
    }
  }

  if (SELF_LOCOMOTION_KINDS.has(action)) {
    if (context.damped) {
      return refuse(
        'I did not move on my own because my base is damped — I would have ' +
          'accepted the command and stayed exactly where I am.',
      );
    }
    if (context.place === null) {
      return refuse('I did not go and look because I do not know where I am.');
    }
    if (context.placeAgeMs === null || context.placeAgeMs > PLACE_STALE_MS) {
      return refuse(
        `I did not go and look because what I know about being at "${context.place}" ` +
          'is too old to trust.',
      );
    }
  }

  return allow(`Nothing stands in the way of "${action}".`);
}
