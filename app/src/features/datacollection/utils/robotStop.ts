/**
 * @file robotStop.ts
 * @description What holds the robot stopped right now, for the session page
 *              (TASK-431). It is a latch that the robot agent or its sidecar
 *              reports, or, with neither, a `protective_stop` status that the
 *              robot reports. Set up's step 3 and Record's recovery slot read
 *              this one model, so both say the same thing and offer the same
 *              reset. The agent's own stop warning names the cause and the
 *              reason. No React.
 * @feature datacollection
 */

import type { RobotStatus } from '../../robots/types/robots.types';

/** `latched`: the agent or the sidecar holds a latch. `status`: only the robot's status says stop. */
export type RobotStopKind = 'latched' | 'status';

export interface RobotStop {
  kind: RobotStopKind;
  /** The robot agent's latch (its SafetyMonitor), as readiness or the mode read reports it. */
  agentLatched: boolean;
  /** The sidecar's own latch. */
  sidecarLatched: boolean;
  /** What the agent's stop warning calls it; null when the page has no warning. */
  cause: 'emergency' | 'protective' | null;
  /** The slot or step title: "E-stop is latched.", "Protective stop is latched.", "Protective stop.". */
  title: string;
  /** The step row's summary and the reason code a step carries. */
  short: string;
  code: 'estop_latched' | 'protective_stop';
  /** The agent's recorded reason, without a final period; null when none reached the page. */
  reason: string | null;
}

export interface RobotStopInput {
  agentLatched: boolean;
  sidecarLatched: boolean;
  /** The robot's status from the server; null while it is offline or not known. */
  status: RobotStatus | null;
  /** The agent's warnings, from its telemetry. */
  warnings?: readonly string[] | null;
}

// The warnings `SafetyMonitor.applyStopToState` writes with a latch, and the
// one `CommandExecutor.emergencyStop` writes.
const EMERGENCY = /^Emergency stop activated:\s*(.*)$/s;
const PROTECTIVE = /^Protective stop:\s*(.*)$/s;
const EMERGENCY_PLAIN = 'Emergency stop was activated';

const clean = (text: string): string | null => text.trim().replace(/\.+$/, '') || null;

/** The agent's stop warning: its cause and its reason. An emergency stop wins over a protective one. */
export function stopWarning(warnings: readonly string[] | null | undefined): { cause: 'emergency' | 'protective'; reason: string | null } | null {
  const list = warnings ?? [];
  for (const w of list) {
    const m = EMERGENCY.exec(w);
    if (m) return { cause: 'emergency', reason: clean(m[1]) };
  }
  for (const w of list) {
    const m = PROTECTIVE.exec(w);
    if (m) return { cause: 'protective', reason: clean(m[1]) };
  }
  if (list.includes(EMERGENCY_PLAIN)) return { cause: 'emergency', reason: null };
  return null;
}

/**
 * The stop the page shows, or null. A latch decides first; the status counts
 * only when no latch explains it. Then the robot reports a stop that nothing
 * holds, and the same reset clears it (the agent's reset with nothing latched).
 */
export function robotStop(input: RobotStopInput): RobotStop | null {
  const warning = stopWarning(input.warnings);
  const base = {
    agentLatched: input.agentLatched,
    sidecarLatched: input.sidecarLatched,
    cause: warning?.cause ?? null,
    reason: warning?.reason ?? null,
  };
  if (input.agentLatched || input.sidecarLatched) {
    // The agent names a protective stop only when it wrote one; the sidecar's
    // latch is always its E-stop.
    const protective = warning?.cause === 'protective' && input.agentLatched;
    return protective
      ? { ...base, kind: 'latched', title: 'Protective stop is latched.', short: 'Protective stop latched', code: 'protective_stop' }
      : { ...base, kind: 'latched', title: 'E-stop is latched.', short: 'E-stop latched', code: 'estop_latched' };
  }
  if (input.status === 'protective_stop') {
    return { ...base, kind: 'status', title: 'Protective stop.', short: 'Protective stop', code: 'protective_stop' };
  }
  return null;
}

/** What Reset E-stop does, in one or two sentences, for the stop shown. */
export function resetText(stop: RobotStop, headset: boolean): string {
  const what = stop.kind === 'status'
    ? 'The robot reports a protective stop, but no latch holds it. Reset E-stop clears the stop in the robot agent.'
    : 'Reset E-stop clears the latch in the robot agent and in the sidecar.';
  return `${what} It does not move the robot.${headset && stop.kind === 'latched' ? ' The operator can also reset it in the headset.' : ''}`;
}

/** The line after a reset, and before one: the robot must be stood up again. */
export const STAND_UP_AGAIN = 'Then stand the robot up again: Limp, Stand up, Balance.';
export const RESET_DONE = 'The E-stop is reset. Stand the robot up again: Limp, Stand up, Balance.';
