/**
 * @file reengage.ts
 * @description The clutch rising edge a real robot's arms need before they arm
 *              (TASK-393). One per teleop socket. Pure — no sockets, no
 *              sidecar, no clock.
 * @feature teleop
 * @status live
 *
 * WHY. Arming used to follow the first joint frame that arrived under a bound
 * lease and a live heartbeat. Every disarm the operator did not cause — an
 * E-stop and its reset, a heartbeat that stalled and came back, a lease that
 * was taken over, the sidecar's own dead-man or a 409 `not_armed`, a refused
 * `/arm` — was therefore undone by the very next streamed frame. In the sim the
 * sidecar went from latched to arming within half a second of an E-stop reset,
 * and an operator who still held the grip had the arms slew straight to wherever
 * the controller was. Tracked hands have no clutch at all, so a tracked hand
 * re-armed on its next frame.
 *
 * WHAT. Arming now needs an edge the operator makes on purpose: the client's
 * clutch seen OPEN and then CLOSED, both while nothing blocks arming. The client
 * reports its clutch on every heartbeat (`{hb, clutch}`), and this latch is the
 * only thing that turns those reports into permission:
 *
 *   need_release ──clutch open──▶ need_press ──clutch closed──▶ ready ──arm──▶ holding
 *        ▲                            │  ▲                         │              │
 *        │                            │  └──────clutch open────────┘              │
 *        └──── any blocker (E-stop, no lease, heartbeat stale, sidecar latch) ────┤
 *        └──── the arms went away under a holding socket (dead-man, 409, lease) ─┘
 *
 * - A socket starts in `need_release`, so the FIRST arm of a session also needs
 *   the grip to be seen released before a squeeze counts.
 * - Edges seen while something blocks arming do not count: an operator who
 *   lets go and squeezes again during an E-stop latch, and is still squeezing
 *   when somebody else resets it, must let go once more.
 * - The operator releasing the grip while armed is NOT a disarm — the arms hold
 *   their pose under this socket — so `holding` ignores the clutch.
 * - A client that never reports a clutch (an older app, a script) stays out of
 *   `ready` for good: fail closed.
 *
 * Tracked hands report no clutch (there is no button on a hand), so a hand on
 * its own never produces the edge, and a side whose clutch is open is not
 * driven on a real robot even while the other side's clutch is closed.
 */

export type ReengageState = 'need_release' | 'need_press' | 'ready' | 'holding';

/** Per-side clutch as the client last reported it. */
export interface ClutchReport {
  left: boolean;
  right: boolean;
}

/**
 * Parse the `clutch` field of a `{hb}` frame. `true`/`false` is a one-clutch
 * client (the keyboard: a move key held), `{left, right}` the VR rig's two
 * grips. Anything else — absent included — is "not reported".
 */
export function parseClutch(value: unknown): ClutchReport | null {
  if (typeof value === 'boolean') return { left: value, right: value };
  if (typeof value !== 'object' || value === null) return null;
  const v = value as { left?: unknown; right?: unknown };
  if (typeof v.left !== 'boolean' || typeof v.right !== 'boolean') return null;
  return { left: v.left, right: v.right };
}

export class ReengageLatch {
  private stateValue: ReengageState = 'need_release';
  private clutchValue: ClutchReport | null = null;

  get state(): ReengageState {
    return this.stateValue;
  }

  /** The client's last clutch report, or null when it never sent one. */
  get clutch(): ClutchReport | null {
    return this.clutchValue;
  }

  /** Whether any clutch is closed in the last report. */
  get engaged(): boolean {
    return this.clutchValue !== null && (this.clutchValue.left || this.clutchValue.right);
  }

  /** Whether `side`'s clutch is closed in the last report. */
  sideEngaged(side: 'left' | 'right'): boolean {
    return this.clutchValue?.[side] === true;
  }

  /** Record a clutch report. Returns whether the stored report changed. */
  report(clutch: ClutchReport): boolean {
    const prev = this.clutchValue;
    this.clutchValue = { left: clutch.left, right: clutch.right };
    return prev === null || prev.left !== clutch.left || prev.right !== clutch.right;
  }

  /**
   * Advance on the current facts. Idempotent: calling it twice with the same
   * facts changes nothing, so it can run on every heartbeat and every tick.
   *
   * @param blocked arming is impossible right now (E-stop, no lease, stale
   *        heartbeat, sidecar latch). Any edge in progress is thrown away.
   * @param live this socket's claim is held and the arms are up or arming —
   *        only consulted while `holding`.
   * @returns the state before, when it changed; null otherwise.
   */
  update(blocked: boolean, live: boolean): ReengageState | null {
    const before = this.stateValue;
    if (blocked) {
      this.stateValue = 'need_release';
    } else if (this.stateValue === 'holding') {
      if (!live) this.stateValue = 'need_release';
    } else if (this.clutchValue !== null) {
      if (!this.engaged) this.stateValue = 'need_press';
      else if (this.stateValue === 'need_press') this.stateValue = 'ready';
    }
    return this.stateValue === before ? null : before;
  }

  /** May this socket start (or join) an arm right now? */
  mayArm(): boolean {
    return this.stateValue === 'ready' && this.engaged;
  }

  /** The arm was claimed on the strength of the edge. */
  held(): void {
    this.stateValue = 'holding';
  }

  /** A disarm the operator did not cause: the next arm needs a fresh edge. */
  latch(): ReengageState | null {
    const before = this.stateValue;
    this.stateValue = 'need_release';
    return before === 'need_release' ? null : before;
  }
}
