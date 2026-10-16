/**
 * @file arm-registry.ts
 * @description Who holds the sidecar ARMED (TASK-393). One claim per engaged
 *              teleop socket: the first claim on an `arm_sdk` sidecar POSTs
 *              `/arm` with the operator's lease generation, the last release
 *              POSTs `/disarm`. Also the single place the sidecar's arm status
 *              is polled while somebody is listening, so every teleop socket
 *              sees the same armed / weight / teleop-mode facts.
 * @feature teleop
 * @status live
 *
 * WHY CLAIMS AND NOT A FLAG. The sidecar is one physical write path and the
 * agent can have several teleop sockets on it (the VR modal, a keyboard tab,
 * the session page). Arming belongs to the sockets that are actually driving:
 * a socket whose lease is fenced, whose heartbeat stops or which closes must
 * give its claim back, and the robot must go back to Unitree's controller only
 * when NOBODY is driving any more — not when the first of two windows closes.
 *
 * A sidecar that does not advertise `write_mode: arm_sdk` (the MuJoCo sim,
 * older sidecars) needs no arming: `claim` answers `not_required` and nothing
 * is posted, so those robots are driven exactly as before.
 */

import { hardwareClient } from '../hardware/HardwareClient.js';
import type { SidecarArmStatus, TeleopHandMode } from '../hardware/arm-status.js';

/** The slice of `HardwareClient` this module drives. */
export interface ArmClient {
  requiresArming?(): boolean;
  isArmedLocally?(): boolean;
  getArmStatus?(): SidecarArmStatus;
  arm?(leaseGeneration: number | null): Promise<{ ok: boolean; error?: string; status?: number }>;
  disarm?(): Promise<{ ok: boolean; error?: string }>;
  refreshArmStatus?(): Promise<SidecarArmStatus | null>;
  onArmStatusChange?(cb: (status: SidecarArmStatus) => void): () => void;
}

export type ArmClaimResult =
  | { state: 'not_required' }
  | { state: 'armed' }
  | { state: 'arming' }
  | { state: 'refused'; code: 'arm_estop_latched' | 'arm_failed'; message: string };

/** What a teleop client is told about the arm path — the `{type:'arm'}` frame body. */
export interface TeleopArmView {
  /** `null` = nothing to arm (sim, older sidecar). */
  writeMode: SidecarArmStatus['writeMode'];
  /** Whether the sidecar is publishing arm commands now. */
  armed: boolean;
  /** An `/arm` request is in flight. */
  arming: boolean;
  /** Blend weight 0..1 the sidecar reports. */
  armWeight: number;
  estopLatched: boolean;
  hands: { left: boolean; right: boolean } | null;
  teleopMode: TeleopHandMode | null;
  /** Sockets holding a claim. */
  claims: number;
  /** Why the last arm attempt failed, or null. */
  lastError: string | null;
}

export interface ArmRegistryOptions {
  /** Poll period while a claim is held or an arm is in flight, in ms. */
  activePollMs?: number;
  /** Poll period while somebody is only listening, in ms. */
  idlePollMs?: number;
  /** After a failed `/arm`, how long before another claim may retry, in ms. */
  retryCooldownMs?: number;
  now?: () => number;
}

export class ArmRegistry {
  private readonly claims = new Map<string, number | null>();
  private armInFlight: Promise<void> | null = null;
  private lastError: string | null = null;
  private retryAfter = 0;
  private readonly listeners = new Set<(view: TeleopArmView) => void>();
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollInFlight = false;
  private unsubscribeClient: (() => void) | null = null;
  private lastViewKey = '';
  private readonly activePollMs: number;
  private readonly idlePollMs: number;
  private readonly retryCooldownMs: number;
  private readonly now: () => number;

  constructor(private readonly client: ArmClient, options: ArmRegistryOptions = {}) {
    this.activePollMs = options.activePollMs ?? 250;
    this.idlePollMs = options.idlePollMs ?? 2000;
    this.retryCooldownMs = options.retryCooldownMs ?? 1000;
    this.now = options.now ?? (() => Date.now());
  }

  /** The sidecar only takes commands while armed. A client without an arm path never does. */
  requiresArming(): boolean {
    return typeof this.client.requiresArming === 'function' && this.client.requiresArming();
  }

  private armedLocally(): boolean {
    return typeof this.client.isArmedLocally === 'function' && this.client.isArmedLocally();
  }

  private status(): SidecarArmStatus | null {
    return typeof this.client.getArmStatus === 'function' ? this.client.getArmStatus() : null;
  }

  /**
   * Whether a commanded joint target can reach the robot right now: nothing to
   * arm, armed by this agent, or an `/arm` on its way. False once the sidecar
   * disarmed itself (its dead-man, a 409 `not_armed`) — a target that keeps
   * moving then is a target the robot will be sent all at once on re-arm.
   */
  isLive(): boolean {
    return !this.requiresArming() || this.armedLocally() || this.armInFlight !== null;
  }

  /** Whether `id` holds a claim. */
  has(id: string): boolean {
    return this.claims.has(id);
  }

  /**
   * Ask for the robot's arms on behalf of socket `id`, driving under lease
   * `generation`. Cheap to call on every motion frame: an existing claim on an
   * armed sidecar is a map lookup.
   *
   * The CALLER owns the preconditions — a bound lease and a live heartbeat —
   * because only the socket knows them. This owns what the sidecar is told.
   */
  claim(id: string, generation: number | null): ArmClaimResult {
    if (!this.requiresArming()) return { state: 'not_required' };
    if (this.status()?.estopLatched) {
      return {
        state: 'refused',
        code: 'arm_estop_latched',
        message: 'the sidecar\'s E-stop is latched — reset the E-stop before driving the arms',
      };
    }
    this.claims.set(id, generation);
    this.schedulePoll(0);
    if (this.armedLocally()) return { state: 'armed' };
    if (this.armInFlight) return { state: 'arming' };
    if (this.now() < this.retryAfter) {
      return {
        state: 'refused',
        code: 'arm_failed',
        message: `the sidecar refused to arm: ${this.lastError ?? 'unknown error'}`,
      };
    }
    this.startArm(generation);
    return { state: 'arming' };
  }

  private startArm(generation: number | null): void {
    const arm = this.client.arm;
    if (typeof arm !== 'function') return;
    console.log(`[ArmRegistry] arming the sidecar (lease generation ${generation ?? 'none'})`);
    this.emit();
    this.armInFlight = arm.call(this.client, generation)
      .then((res) => {
        // Cleared before anything below reads it: the disarm that undoes a
        // released arm must not see itself as still in flight.
        this.armInFlight = null;
        if (!res.ok) {
          this.lastError = res.error ?? 'refused';
          this.retryAfter = this.now() + this.retryCooldownMs;
          console.warn(`[ArmRegistry] /arm refused: ${this.lastError}`);
          return;
        }
        this.lastError = null;
        // Everybody let go while the request was out: undo it at once.
        if (this.claims.size === 0) this.disarm('released while arming');
      })
      .catch((err: unknown) => {
        this.lastError = err instanceof Error ? err.message : String(err);
        this.retryAfter = this.now() + this.retryCooldownMs;
      })
      .finally(() => {
        this.armInFlight = null;
        this.emit();
      });
  }

  /** Give back `id`'s claim; the last one out disarms the sidecar. */
  release(id: string, reason: string): void {
    if (!this.claims.delete(id)) return;
    if (this.claims.size === 0) this.disarm(reason);
    this.emit();
  }

  /** E-stop and lease loss: nobody may keep the arms. */
  releaseAll(reason: string): void {
    const had = this.claims.size > 0;
    this.claims.clear();
    if (had || this.armedLocally()) this.disarm(reason);
    this.emit();
  }

  private disarm(reason: string): void {
    // An arm still in flight disarms itself when it lands (see `startArm`):
    // a `/disarm` overtaking its own `/arm` on the wire would leave the sidecar
    // armed with nobody claiming it.
    if (this.armInFlight) return;
    if (!this.armedLocally()) return;
    const disarm = this.client.disarm;
    if (typeof disarm !== 'function') return;
    console.log(`[ArmRegistry] disarming the sidecar (${reason})`);
    void disarm.call(this.client).then((res) => {
      if (!res.ok) console.warn(`[ArmRegistry] /disarm failed (${reason}): ${res.error ?? 'unknown'}`);
    }).catch(() => { /* logged by the sidecar's own dead-man, which disarms anyway */ })
      .finally(() => this.emit());
  }

  view(): TeleopArmView {
    const s = this.status();
    return {
      writeMode: s?.writeMode ?? null,
      armed: (s?.armed ?? false) || this.armedLocally(),
      arming: this.armInFlight !== null,
      armWeight: s?.armWeight ?? 0,
      estopLatched: s?.estopLatched ?? false,
      hands: s?.hands ?? null,
      teleopMode: s?.teleopMode ?? null,
      claims: this.claims.size,
      lastError: this.lastError,
    };
  }

  /**
   * Hear every change of {@link view}. While anybody listens the sidecar's
   * `/health` is polled — fast while a claim is held (the HUD shows the weight
   * ramp), slow otherwise (the teleop-mode warning before anyone engages).
   */
  subscribe(cb: (view: TeleopArmView) => void): () => void {
    this.listeners.add(cb);
    if (this.listeners.size === 1) {
      if (typeof this.client.onArmStatusChange === 'function') {
        this.unsubscribeClient = this.client.onArmStatusChange(() => this.emit());
      }
      this.schedulePoll(0);
    }
    return () => {
      this.listeners.delete(cb);
      if (this.listeners.size === 0) {
        this.unsubscribeClient?.();
        this.unsubscribeClient = null;
        if (this.pollTimer) clearTimeout(this.pollTimer);
        this.pollTimer = null;
      }
    };
  }

  private emit(): void {
    const view = this.view();
    const key = JSON.stringify({ ...view, armWeight: Math.round(view.armWeight * 20) / 20 });
    if (key === this.lastViewKey) return;
    this.lastViewKey = key;
    for (const cb of this.listeners) {
      try {
        cb(view);
      } catch (err) {
        console.error('[ArmRegistry] listener failed:', err);
      }
    }
  }

  private schedulePoll(delayMs: number): void {
    if (this.listeners.size === 0) return;
    if (typeof this.client.refreshArmStatus !== 'function') return;
    // One poll chain, ever: a request in flight reschedules itself when it lands.
    if (this.pollInFlight) return;
    if (this.pollTimer) {
      if (delayMs > 0) return;
      clearTimeout(this.pollTimer);
    }
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      this.pollInFlight = true;
      void this.client.refreshArmStatus!().finally(() => {
        this.pollInFlight = false;
        this.emit();
        const busy = this.claims.size > 0 || this.armInFlight !== null;
        this.schedulePoll(busy ? this.activePollMs : this.idlePollMs);
      });
    }, delayMs);
    this.pollTimer.unref?.();
  }

  /** Test seam: forget every claim and listener without talking to the sidecar. */
  reset(): void {
    this.claims.clear();
    this.armInFlight = null;
    this.lastError = null;
    this.retryAfter = 0;
    this.lastViewKey = '';
    this.listeners.clear();
    this.unsubscribeClient?.();
    this.unsubscribeClient = null;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    this.pollInFlight = false;
  }
}

/** The one registry for this agent's one sidecar. */
export const armRegistry = new ArmRegistry(hardwareClient);
