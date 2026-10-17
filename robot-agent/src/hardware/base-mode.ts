/**
 * @file base-mode.ts
 * @description What a G1 sidecar says about the robot's locomotion MODE
 *              (TASK-398): the `loco` capability block of `/health` (which
 *              gate the sidecar runs, whether it may move the base) and the
 *              `base` block of `/health`, `/state` and `/loco/mode` (the FSM
 *              the sidecar MEASURED, how old that reading is, and why it is
 *              unknown when it is). Pure — no I/O.
 * @feature hardware
 * @status live
 */

/**
 * The sidecar's `G1_LOCO_ENABLED` gate.
 *
 * - `off` — no mode control, no locomotion (the default; `/loco/*` is 403).
 * - `fsm` — mode changes only (limp / stand / balance); walking and turning
 *   are refused by the sidecar. The real robot.
 * - `full` — the legacy all-of-`/loco/*` gate. The sim.
 * - `unknown` — the sidecar does not say (MuJoCo `sim_node.py`, any sidecar
 *   older than TASK-398). Treated like before: moves are attempted.
 */
export type LocoGate = 'off' | 'fsm' | 'full' | 'unknown';

/** The measured mode, as the sidecar names it. */
export type BaseModeName = 'limp' | 'stand' | 'balance' | 'zero_torque' | 'other' | 'unknown';

/** The three modes an operator may command. */
export type BaseModeCommand = 'limp' | 'stand' | 'balance';

export const BASE_MODE_COMMANDS: readonly BaseModeCommand[] = ['limp', 'stand', 'balance'];

export function isBaseModeCommand(v: unknown): v is BaseModeCommand {
  return typeof v === 'string' && (BASE_MODE_COMMANDS as readonly string[]).includes(v);
}

export interface LocoCapability {
  gate: LocoGate;
  /**
   * Whether the sidecar would execute a velocity / gesture / raw FSM command.
   * `null` when it does not say — then callers behave as before TASK-398.
   */
  moveEnabled: boolean | null;
  /** The FSM ids were confirmed on the robot (runbook step 4). */
  idsVerified: boolean;
  /** The resolved FSM ids, or null when not reported. */
  ids: { limp: number; stand: number; balance: number; balanceReported: number[] } | null;
}

export const UNKNOWN_LOCO_CAPABILITY: LocoCapability = Object.freeze({
  gate: 'unknown',
  moveEnabled: null,
  idsVerified: false,
  ids: null,
}) as LocoCapability;

/** The `base` block, plus when THIS process received it. */
export interface BaseState {
  /** The measured FSM id; null when the sidecar's reading is stale or missing. */
  fsmId: number | null;
  mode: BaseModeName;
  /** Age of the sidecar's reading when it answered, seconds; null = never read. */
  ageS: number | null;
  /** Why the mode is unknown (or the last RPC error), verbatim from the sidecar. */
  error: string | null;
  /** `Date.now()` when this block arrived. */
  receivedAtMs: number;
}

/** A base reading older than this (sidecar age + transport) is not trusted. */
export const BASE_STATE_FRESH_S = 4;

const BASE_MODES: readonly BaseModeName[] = ['limp', 'stand', 'balance', 'zero_torque', 'other', 'unknown'];

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Parse the `loco` block of a sidecar `/health` body. */
export function parseLocoCapability(health: unknown): LocoCapability {
  const loco = asRecord(asRecord(health)?.loco);
  if (!loco) return { ...UNKNOWN_LOCO_CAPABILITY };
  const gate: LocoGate = loco.gate === 'off' || loco.gate === 'fsm' || loco.gate === 'full'
    ? loco.gate
    : 'unknown';
  const idsRaw = asRecord(loco.ids);
  let ids: LocoCapability['ids'] = null;
  if (idsRaw) {
    const limp = finiteOrNull(idsRaw.limp);
    const stand = finiteOrNull(idsRaw.stand);
    const balance = finiteOrNull(idsRaw.balance);
    const reported = Array.isArray(idsRaw.balance_reported)
      ? idsRaw.balance_reported.filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
      : [];
    if (limp !== null && stand !== null && balance !== null) {
      ids = { limp, stand, balance, balanceReported: reported };
    }
  }
  return {
    gate,
    moveEnabled: typeof loco.move_enabled === 'boolean' ? loco.move_enabled : gate === 'unknown' ? null : gate === 'full',
    idsVerified: loco.ids_verified === true,
    ids,
  };
}

/** Parse a `base` block. Null when the body carries none. */
export function parseBaseState(v: unknown, nowMs: number = Date.now()): BaseState | null {
  const base = asRecord(v);
  if (!base) return null;
  const mode = typeof base.mode === 'string' && (BASE_MODES as readonly string[]).includes(base.mode)
    ? (base.mode as BaseModeName)
    : 'unknown';
  const fsmId = finiteOrNull(base.fsm_id);
  return {
    fsmId: mode === 'unknown' ? null : fsmId,
    mode,
    ageS: finiteOrNull(base.age_s),
    error: typeof base.error === 'string' && base.error ? base.error : null,
    receivedAtMs: nowMs,
  };
}

/** The reading's age now: what the sidecar said plus how long ago it said it. */
export function baseStateAgeS(state: BaseState, nowMs: number = Date.now()): number | null {
  if (state.ageS === null) return null;
  return state.ageS + Math.max(0, nowMs - state.receivedAtMs) / 1000;
}

/** A measured mode recent enough to act on. */
export function isFreshBaseState(
  state: BaseState | null,
  nowMs: number = Date.now(),
  maxAgeS: number = BASE_STATE_FRESH_S,
): state is BaseState {
  if (!state || state.mode === 'unknown') return false;
  const age = baseStateAgeS(state, nowMs);
  return age !== null && age <= maxAgeS;
}

/** What the sidecar's `/estop` reported (TASK-398). */
export interface SidecarEstopResult {
  /** The sidecar answered at all. */
  reached: boolean;
  /** The arm_sdk path is no longer engaged (or never was). */
  disarmed: boolean;
  /** SetFsmId(1) was accepted by the sport service. */
  damped: boolean;
  /** GetFsmId reported 1 afterwards. */
  dampConfirmed: boolean;
  /** Why the robot was not (confirmed) damped, verbatim; null when it was. */
  dampError: string | null;
}

/** Parse a sidecar `/estop` body (any sidecar — older ones report no damp). */
export function parseEstopReply(body: unknown, httpOk: boolean): SidecarEstopResult {
  const data = asRecord(body) ?? {};
  const damped = data.damped === true;
  const dampConfirmed = data.damp_confirmed === true;
  let dampError = typeof data.damp_error === 'string' && data.damp_error ? data.damp_error : null;
  if (!damped && dampError === null) {
    dampError = httpOk
      ? 'this sidecar does not damp on /estop (no mode control)'
      : 'the sidecar refused /estop';
  }
  return {
    reached: true,
    disarmed: httpOk && data.disarmed !== false,
    damped,
    dampConfirmed,
    dampError,
  };
}
