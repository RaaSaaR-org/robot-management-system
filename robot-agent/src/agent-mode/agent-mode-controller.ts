/**
 * @file agent-mode-controller.ts
 * @description The Agent Mode singleton: on/off toggle, the one running plan,
 *              E-Stop, the idle watcher and the event fan-out. Owns the whole
 *              lifecycle; every other agent-mode module is a collaborator it
 *              drives.
 * @feature agentmode
 * @status live
 */

import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/config.js';
import { hardwareClient, type LocoResult } from '../hardware/HardwareClient.js';
import type { RobotStateManager } from '../robot/state.js';
import {
  BlockExecutor,
  G1_FSM_DAMP,
  G1_NON_LOCOMOTING_FSM_IDS,
  type BlockExecutorDeps,
} from './block-executor.js';
import { controlOwnerLock, type ControlOwnerLock } from './control-owner.js';
import { IdleWatcher } from './idle-watcher.js';
import { Navigator } from './navigator.js';
import { Planner, type PlannedBlock } from './planner.js';
import { RangeSensor } from './range.js';
import { SceneMemoryStore } from './scene-memory.js';
import { ServerMirror } from './server-mirror.js';
import { VisionClient, type VisionObservation } from './vision.js';
import type {
  AgentBlock,
  AgentBlockKind,
  AgentCommandResult,
  AgentModeEvent,
  AgentModeEventType,
  AgentModeState,
  AgentPlan,
  BlockOutcome,
  SceneMemory,
} from './types.js';

export interface SubmitCommandInput {
  text: string;
  /** A2A context id, when the command arrived over the A2A message path. */
  contextId?: string;
}

/**
 * What an E-Stop actually achieved. `ok` says the latch is set and the plan is
 * discarded — that part is local and cannot fail. `delivered` is the hardware
 * claim: StopMove AND Damp were acked by the sidecar. They are separate because
 * a dead sidecar must latch the software side all the same, while the operator
 * is told the base itself is NOT confirmed stopped.
 */
export interface AgentEstopResult {
  ok: true;
  /** A live plan was discarded by this stop. */
  stopped: boolean;
  /** StopMove and Damp both reached the robot (sidecar acked both calls). */
  delivered: boolean;
  /** Which hardware call failed, when `delivered` is false. */
  deliveryError?: string;
}

export interface AgentModeControllerDeps {
  robotId?: string;
  enabled?: boolean;
  planner?: Planner;
  vision?: VisionClient;
  /**
   * LiDAR ranging for `look`/`scan_room`. Constructed once and shared, like
   * {@link AgentModeControllerDeps.vision}, so its one-cloud-per-observation
   * cache actually spans the observation instead of being rebuilt per block.
   */
  range?: RangeSensor;
  scene?: SceneMemoryStore;
  mirror?: ServerMirror;
  lock?: ControlOwnerLock;
  /** Loco facade override — tests pass a stub instead of the sidecar. */
  loco?: BlockExecutorDeps['loco'];
  say?: BlockExecutorDeps['say'];
  sleep?: BlockExecutorDeps['sleep'];
  now?: () => number;
  maxNavStages?: number;
  idleWatchIntervalMs?: number;
}

const defaultLoco: NonNullable<BlockExecutorDeps['loco']> = {
  move: (vx, vy, omega, durationS) => hardwareClient.locoMove(vx, vy, omega, durationS),
  action: (name, args) => hardwareClient.locoAction(name, args),
  fsm: (id) => hardwareClient.locoFsm(id),
  standHeight: (preset) => hardwareClient.locoStandHeight(preset),
  odometry: () => hardwareClient.getLocoOdometry(),
};

function nowIso(): string {
  return new Date().toISOString();
}

function makeBlock(
  kind: AgentBlockKind,
  params: Record<string, unknown>,
  reasoning?: string
): AgentBlock {
  const block: AgentBlock = { id: uuidv4(), kind, params, status: 'pending' };
  if (reasoning) block.reasoning = reasoning;
  return block;
}

/** Snapshot a plan so a listener can never observe later in-place mutations. */
function clonePlan(plan: AgentPlan): AgentPlan {
  return { ...plan, blocks: plan.blocks.map((b) => ({ ...b, params: { ...b.params } })) };
}

export class AgentModeController {
  private readonly robotId: string;
  private readonly lock: ControlOwnerLock;
  private readonly planner: Planner;
  private readonly vision: VisionClient;
  private readonly range: RangeSensor;
  private readonly scene: SceneMemoryStore;
  private readonly mirror: ServerMirror;
  private readonly executor: BlockExecutor;
  private readonly navigator: Navigator;
  private readonly idleWatcher: IdleWatcher;
  private readonly loco: NonNullable<BlockExecutorDeps['loco']>;

  private enabled: boolean;
  private plan: AgentPlan | null = null;
  private estopActive = false;
  private abortRequested = false;
  private abortReason: string | null = null;
  /**
   * Set once a terminal path (E-Stop) has already written the running plan's
   * final statuses and emitted `agent:plan:finished`. It stays set until the
   * NEXT plan starts, so clearing the E-Stop latch while the stopped block is
   * still in flight can never resurrect the plan: the block still sees an abort
   * signal, the plan keeps its `aborted` status, and no second
   * `agent:plan:finished` (with a fabricated `done`) is emitted.
   */
  private planFinalized = false;
  /**
   * Last FSM id the base was commanded into, or null when it was never
   * commanded in this process. The E-Stop leaves the base in damp (1), where
   * every velocity command is ACKed and ignored — the operator and the planner
   * have to be able to see that.
   */
  private lastFsmId: number | null = null;
  private runPromise: Promise<void> | null = null;
  private pendingCommand: SubmitCommandInput | null = null;
  /** Where the navigator splices its generated blocks into the running plan. */
  private generatedInsertIndex = 0;

  private robotStateManager: RobotStateManager | null = null;
  private listeners = new Set<(event: AgentModeEvent) => void>();
  private unsubscribeLock: (() => void) | null = null;

  constructor(deps: AgentModeControllerDeps = {}) {
    this.robotId = deps.robotId ?? config.robotId;
    this.enabled = deps.enabled ?? config.agentMode.enabled;
    this.lock = deps.lock ?? controlOwnerLock;
    this.planner = deps.planner ?? new Planner();
    this.vision = deps.vision ?? new VisionClient();
    this.range = deps.range ?? new RangeSensor();
    this.scene = deps.scene ?? new SceneMemoryStore(this.robotId);
    this.mirror = deps.mirror ?? new ServerMirror({ robotId: this.robotId });
    this.loco = deps.loco ?? defaultLoco;

    // Every FSM change the blocks make goes through `commandFsm`, so the
    // controller always knows which FSM the base is in. That is the difference
    // between "the robot is damped, stand up first" and a plan of blocks that
    // all claim success while the robot lies on the floor.
    const trackedLoco: NonNullable<BlockExecutorDeps['loco']> = {
      move: (vx, vy, omega, durationS) => this.loco.move(vx, vy, omega, durationS),
      action: (name, args) => this.loco.action(name, args),
      fsm: (id) => this.commandFsm(id),
      standHeight: (preset) => this.loco.standHeight(preset),
      odometry: () => this.loco.odometry(),
    };

    const executorDeps: BlockExecutorDeps = {
      scene: this.scene,
      vision: this.vision,
      range: this.range,
      isAborted: () => this.abortSignalled(),
      onScene: (scene) => this.emit('agent:scene:updated', { scene }),
      loco: trackedLoco,
    };
    if (deps.say) executorDeps.say = deps.say;
    if (deps.sleep) executorDeps.sleep = deps.sleep;
    if (deps.now) executorDeps.now = deps.now;
    this.executor = new BlockExecutor(executorDeps);

    this.navigator = new Navigator({
      scene: this.scene,
      isAborted: () => this.abortSignalled(),
      runGeneratedBlock: (kind, params, reasoning) =>
        this.runGeneratedBlock(kind, params, reasoning),
      ...(deps.maxNavStages === undefined ? {} : { maxNavStages: deps.maxNavStages }),
    });

    this.idleWatcher = new IdleWatcher({
      observe: () => this.vision.observe(),
      isEligible: () => this.isIdleWatchEligible(),
      onPersonAppeared: (observation) => this.onPersonAppeared(observation),
      ...(deps.idleWatchIntervalMs === undefined
        ? {}
        : { intervalMs: deps.idleWatchIntervalMs }),
      ...(deps.now ? { now: deps.now } : {}),
    });

    // Human teleop outranks Agent Mode: when it takes the lock from us, the
    // running plan is aborted with an explicit takeover note.
    this.unsubscribeLock = this.lock.subscribe((change) => {
      if (change.preempted && change.previous === 'agent' && change.next === 'teleop') {
        this.abortPlan('Human teleoperation took over control.');
      }
    });
  }

  // ── wiring ────────────────────────────────────────────────────────────────

  /** Called once from index.ts so E-Stop can reach the existing safety path. */
  attach(robotStateManager: RobotStateManager): void {
    this.robotStateManager = robotStateManager;
  }

  /** Local event subscription (robot-agent WebSocket, A2A executor). */
  subscribe(cb: (event: AgentModeEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    this.idleWatcher.stop();
    this.unsubscribeLock?.();
    this.unsubscribeLock = null;
    this.listeners.clear();
  }

  // ── state ─────────────────────────────────────────────────────────────────

  isEnabled(): boolean {
    return this.enabled;
  }

  isRunning(): boolean {
    return this.runPromise !== null;
  }

  getState(): AgentModeState {
    return {
      robotId: this.robotId,
      enabled: this.enabled,
      controlOwner: this.lock.get(),
      plan: this.plan ? clonePlan(this.plan) : null,
      scene: this.scene.snapshot(),
      estopActive: this.estopActive,
      fsmId: this.lastFsmId,
      damped: this.isDamped(),
    };
  }

  /**
   * Which E-Stop latch, if any, currently forbids Agent Mode from driving.
   *
   * `agent` is our own latch (the operator's STOPP, a stop word, the platform
   * E-Stop routes that call {@link estop}). `safety` is the SafetyMonitor's,
   * which latches on paths that never reach this controller at all — its own
   * humanoid fall/tilt protective stop, `CommandExecutor.emergencyStop`, the
   * fleet/A2A E-Stop. Both must block a command; the operator has to be told
   * WHICH one, because they are cleared in different places.
   */
  private latchedEstop(): 'agent' | 'safety' | null {
    if (this.estopActive) return 'agent';
    // Optional call: test doubles for RobotStateManager may be partial.
    if (this.robotStateManager?.isEStopTriggered?.()) return 'safety';
    return null;
  }

  private latchMessage(latch: 'agent' | 'safety'): string {
    return latch === 'agent'
      ? 'E-Stop is latched — reset it before sending a new command.'
      : 'E-Stop is latched on the safety monitor, not by Agent Mode — clear it there ' +
          '(POST /robots/:id/safety/estop/reset) before sending a new command.';
  }

  /**
   * True while the base sits in a non-locomoting FSM (damp/sit/zero-torque) —
   * after an E-Stop, until a `posture` block with pose "stand" re-arms it.
   * Locomotion commands are still ACKed in this state and do nothing, so this
   * flag is what stops the UI and the planner from being lied to. Clearing the
   * E-Stop latch deliberately does NOT clear it: re-arming a collapsed G1 is an
   * explicit operator action, never a side effect of a UI click.
   */
  isDamped(): boolean {
    return this.lastFsmId !== null && G1_NON_LOCOMOTING_FSM_IDS.has(this.lastFsmId);
  }

  getScene(): SceneMemory | null {
    return this.scene.snapshot();
  }

  sceneMarkdown(): string {
    return this.scene.toMarkdown();
  }

  setEnabled(enabled: boolean): AgentModeState {
    if (this.enabled === enabled) return this.getState();
    this.enabled = enabled;
    if (enabled) {
      this.idleWatcher.reset();
      this.idleWatcher.start();
    } else {
      this.idleWatcher.stop();
      if (this.isRunning()) this.abortPlan('Agent Mode was switched off.');
    }
    console.log(`[AgentMode] mode ${enabled ? 'ENABLED' : 'disabled'}`);
    this.emit('agent:state:changed');
    return this.getState();
  }

  /** Start the idle watcher if the mode is already on (boot path). */
  startIdleWatcher(): void {
    if (this.enabled) this.idleWatcher.start();
  }

  /**
   * Tell the server what mode we booted in.
   *
   * The mirror is event-driven, so without this the server knows nothing about
   * a robot until its first plan — and rendered an Agent-Mode-ON robot as
   * "off", with the command box disabled. Fire-and-forget like every other
   * mirror push; the server also asks us directly when it has nothing, which is
   * what covers a server that was down at our boot.
   */
  announceBootState(): void {
    this.emit('agent:state:changed');
  }

  stopIdleWatcher(): void {
    this.idleWatcher.stop();
  }

  /** Resolves when no plan is running. Used by the A2A executor and by tests. */
  async whenIdle(): Promise<void> {
    while (this.runPromise) {
      await this.runPromise;
    }
  }

  // ── commands ──────────────────────────────────────────────────────────────

  /**
   * Whether `text` is a BARE stop word. Stop words bypass the planner entirely —
   * an operator shouting "STOPP" must never wait on an LLM round-trip.
   *
   * Matching is deliberately restricted to the whole utterance. The shipped
   * default list contains `halt`, which is the most common German modal
   * particle ("geh halt zum Tisch") and also the imperative of *halten* ("halt
   * die Tasse fest"); matching it inside a sentence turned ordinary commands
   * into a latched E-Stop — StopMove + Damp, a real G1 going limp — with the
   * planner never called. A sentence that genuinely means "stop" reaches the
   * planner instead, which is the same path every other command takes.
   */
  isStopWord(text: string): boolean {
    const normalized = normalizeStopWordCandidate(text);
    if (!normalized) return false;
    return config.agentMode.stopWords.includes(normalized);
  }

  async submitCommand(input: SubmitCommandInput): Promise<AgentCommandResult> {
    const text = input.text?.trim() ?? '';
    if (!text) return { accepted: false, message: 'Empty command.' };

    if (!this.enabled) {
      return { accepted: false, message: 'Agent Mode is off — enable it before sending commands.' };
    }

    if (this.isStopWord(text)) {
      const result = await this.estop(`Stop word "${text}" received`);
      return {
        accepted: true,
        message: result.stopped
          ? 'E-Stop: the running plan was discarded and the robot was damped.'
          : 'E-Stop: nothing was running; the robot was damped.',
      };
    }

    // Our own latch is NOT the only one that forbids driving: the SafetyMonitor
    // latches on its own fall/tilt detection and on platform/fleet E-Stops that
    // never route through this controller. Trusting only `estopActive` meant
    // planning and driving a robot the rest of the system reports as
    // emergency-stopped.
    const latch = this.latchedEstop();
    if (latch) {
      return { accepted: false, message: this.latchMessage(latch) };
    }

    // A plan that an E-Stop or a takeover terminated may still be winding down:
    // the block in flight is never cut off mid-motion. Folding a command into
    // that plan would attach it to a dead run and `runPlan`'s finally would
    // drop it without a word, so say so instead.
    if (this.isRunning() && this.abortSignalled()) {
      return {
        accepted: false,
        message: 'The stopped plan is still winding down — send the command again in a moment.',
      };
    }

    // A command arriving while a plan runs is an interrupt, not a new plan: the
    // running block finishes, then the planner rewrites the remaining blocks.
    // The slot holds ONE interrupt; a second one replaces the first, and the
    // replacement is said out loud in the acknowledgement — an operator whose
    // accepted order silently evaporated waits forever for it.
    if (this.isRunning() && this.plan) {
      const replaced = this.pendingCommand;
      this.pendingCommand = { text, ...(input.contextId ? { contextId: input.contextId } : {}) };
      return {
        accepted: true,
        planId: this.plan.id,
        message: replaced
          ? `Understood — I will fold that into the running plan after the current block. ` +
            `This replaces your earlier instruction "${replaced.text}", which had not started yet.`
          : 'Understood — I will fold that into the running plan after the current block.',
      };
    }

    const claim = this.lock.claim('agent');
    if (!claim.ok) {
      return { accepted: false, message: `Cannot start: ${claim.reason ?? 'control is busy.'}` };
    }

    const plan: AgentPlan = {
      id: uuidv4(),
      robotId: this.robotId,
      command: text,
      ...(input.contextId ? { contextId: input.contextId } : {}),
      blocks: [],
      cursor: -1,
      status: 'planning',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.plan = plan;
    this.abortRequested = false;
    this.abortReason = null;
    this.planFinalized = false;
    this.emit('agent:plan:started', { plan: clonePlan(plan) });

    // Planning happens inside the run promise so the caller (and the A2A
    // acknowledgement) is not blocked on the local LLM.
    this.runPromise = this.runPlan(plan).finally(() => {
      this.runPromise = null;
    });

    return { accepted: true, planId: plan.id, message: 'Planning…' };
  }

  // ── E-Stop ────────────────────────────────────────────────────────────────

  /**
   * Manual E-Stop (the ONLY safety mechanism in Agent Mode v1 — see the
   * recorded deviation in TASK-194). Discards the plan, stops and damps the
   * base, and delegates to the existing SafetyMonitor path so the rest of the
   * system sees a normal emergency stop.
   */
  async estop(reason: string): Promise<AgentEstopResult> {
    const wasRunning = this.isRunning();
    this.estopActive = true;
    this.abortRequested = true;
    this.abortReason = reason;

    // Only a plan that is still live can be aborted. Rewriting a plan that has
    // already reached `done`/`failed`/`aborted` would claim an abort that never
    // happened — the operator would read "aborted after 6 of 6 blocks" about a
    // run that completed normally. The E-Stop still latches and damps the robot
    // either way; that part is unconditional and is what actually matters.
    const plan = this.plan;
    if (plan && (plan.status === 'planning' || plan.status === 'running')) {
      for (const block of plan.blocks) {
        if (block.status === 'pending') {
          block.status = 'skipped';
          block.error = reason;
        } else if (block.status === 'running') {
          block.status = 'aborted';
          block.error = reason;
          block.finishedAt = nowIso();
        }
      }
      plan.status = 'aborted';
      plan.cursor = -1;
      plan.updatedAt = nowIso();
      // This plan is now terminal. `planFinalized` outlives the latch reset, so
      // a reset that lands while the stopped block is still awaiting cannot
      // resurrect the plan, re-label it `done`, or emit a second
      // `agent:plan:finished`.
      this.planFinalized = true;
      this.emit('agent:plan:finished', { plan: clonePlan(plan) });
    }

    // Hardware path: zero the base velocity, then drop into damping. Both are
    // best-effort, and delivery is reported to the CALLER, not just the log —
    // a StopMove/Damp the sidecar never acked means the base may still be
    // executing up to a minute of commanded velocity, and every UI upstream
    // renders whatever this return value claims.
    const stop = await this.loco.action('stop');
    if (!stop.ok) console.error(`[AgentMode] E-Stop StopMove failed: ${stop.error}`);
    const damp = await this.commandFsm(G1_FSM_DAMP);
    if (!damp.ok) console.error(`[AgentMode] E-Stop Damp failed: ${damp.error}`);
    const delivered = stop.ok && damp.ok;
    const deliveryError = [
      ...(stop.ok ? [] : [`StopMove: ${stop.error ?? 'failed'}`]),
      ...(damp.ok ? [] : [`Damp: ${damp.error ?? 'failed'}`]),
    ].join('; ');

    // Keep the existing safety net in the loop — it owns the E-stop state the
    // rest of the fleet reads.
    this.robotStateManager?.triggerEmergencyStop('local', `Agent Mode E-Stop: ${reason}`);

    this.lock.release('agent');
    console.warn(`[AgentMode] E-STOP: ${reason}`);
    this.emit('agent:state:changed');
    return {
      ok: true,
      stopped: wasRunning,
      delivered,
      ...(delivered ? {} : { deliveryError }),
    };
  }

  /**
   * Clear the E-Stop latch — Agent Mode's AND the SafetyMonitor's.
   *
   * The two have to clear together. While the SafetyMonitor stays `triggered`
   * its humanoid fall/tilt protective stop is disarmed (`updateOrientation()`
   * returns early) and no further E-Stop can propagate, so an Agent Mode that
   * is free to drive again would be driving with the safety net switched off,
   * while `GET /safety` still reports the robot as emergency-stopped.
   *
   * What this does NOT do is re-arm the base: leaving damp is `posture stand`,
   * an explicit operator action. A UI click must never make a collapsed G1
   * stand up. The damped state stays visible in {@link getState}, and a plan an
   * E-Stop already terminated stays terminated.
   */
  resetEstop(): AgentModeState {
    const rsm = this.robotStateManager;
    if (rsm && !rsm.resetEmergencyStop()) {
      // The SafetyMonitor refused (server link down, force still above limit).
      // Keeping our own latch is the only honest answer — clearing it would let
      // the agent drive a robot the rest of the fleet still reports as
      // e-stopped, with the fall protection disarmed.
      console.warn(
        '[AgentMode] E-Stop latch NOT reset: the SafetyMonitor refused to clear its own latch'
      );
      this.emit('agent:state:changed');
      return this.getState();
    }

    // Only the E-Stop's own abort is forgiven by a latch reset. `abortRequested`
    // is also set by abortPlan() — teleop takeover, mode switched off — and an
    // E-Stop always finalizes a live plan, so when `estopActive` is false a set
    // `abortRequested` belongs to a non-finalized abort whose plan is still
    // winding down. Clearing it here resumed that plan's remaining motion
    // blocks, through the LocoClient, while a human held the teleop lock.
    const hadAgentLatch = this.estopActive;
    this.estopActive = false;
    if (hadAgentLatch) {
      this.abortRequested = false;
      this.abortReason = null;
    }
    console.log(
      `[AgentMode] E-Stop latch reset${this.isDamped() ? ' — the base is still damped; send `posture stand` before moving' : ''}`
    );
    this.emit('agent:state:changed');
    return this.getState();
  }

  /** Abort the running plan without touching the E-Stop latch. */
  abortPlan(reason: string): void {
    if (!this.plan || !this.isRunning()) return;
    this.abortRequested = true;
    this.abortReason = reason;
    console.warn(`[AgentMode] plan aborted: ${reason}`);
  }

  // ── plan execution ────────────────────────────────────────────────────────

  /**
   * @param skipPlanning true when `plan.blocks` is already populated (the idle
   *        greet), so no planner round-trip is made.
   */
  private async runPlan(plan: AgentPlan, skipPlanning = false): Promise<void> {
    try {
      if (!skipPlanning) {
        const planned = await this.planner.plan({
          command: plan.command,
          sceneSummary: this.plannerSceneSummary(),
        });
        // An E-Stop that landed during the LLM round-trip already finalized
        // this plan and emitted its `finished`. Writing fresh pending blocks
        // now would mutate a plan whose terminal event is out the door — the
        // mirror and the UI would forever show an `aborted` plan with blocks
        // stuck `pending`.
        if (this.planFinalized) return;
        plan.blocks = planned.blocks.map((b) => this.toBlock(b));
      }
      plan.status = this.abortSignalled() ? 'aborted' : 'running';
      plan.updatedAt = nowIso();
      this.emit('agent:plan:updated', { plan: clonePlan(plan) });

      let i = 0;
      // Outer loop only re-enters when an interrupting command arrived during
      // the very last block; the inner loop is the normal block walk.
      for (;;) {
        while (i < plan.blocks.length) {
          if (this.abortSignalled()) break;

          const block = plan.blocks[i];
          if (block.status !== 'pending') {
            i++;
            continue;
          }

          plan.cursor = i;
          this.startBlock(plan, block);

          const before = plan.blocks.length;
          let outcome: BlockOutcome;
          if (block.kind === 'goto') {
            // The navigator splices its generated blocks in directly after the
            // `goto`, so they render in order in the timeline.
            this.generatedInsertIndex = i + 1;
            outcome = await this.navigator.navigate(String(block.params.entity ?? ''));
          } else {
            outcome = await this.executor.execute(block);
          }
          const consumed = plan.blocks.length - before;

          this.finishBlock(plan, block, outcome);
          i += consumed + 1;

          if (this.abortSignalled()) break;
          if (!outcome.ok) {
            plan.status = 'failed';
            break;
          }

          await this.applyPendingCommand(plan, i);
        }

        if (this.abortSignalled() || plan.status === 'failed') break;
        if (!this.pendingCommand) break;
        await this.applyPendingCommand(plan, i);
        if (i >= plan.blocks.length) break;
      }

      if (this.abortSignalled()) {
        // The abort reason is recorded on every block that did not run — the
        // AgentPlan shape has no plan-level note, and "skipped, because human
        // teleoperation took over" is exactly what the operator needs to read.
        for (const block of plan.blocks) {
          if (block.status === 'pending') {
            block.status = 'skipped';
            if (this.abortReason) block.error = this.abortReason;
          } else if (block.status === 'running') {
            block.status = 'aborted';
            block.finishedAt = nowIso();
            if (this.abortReason) block.error = this.abortReason;
          }
        }
        plan.status = 'aborted';
      } else if (plan.status === 'failed') {
        for (const block of plan.blocks) {
          if (block.status === 'pending') block.status = 'skipped';
        }
        await this.announceDroppedCommand(plan);
      } else {
        plan.status = 'done';
      }
    } catch (err) {
      plan.status = 'failed';
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[AgentMode] plan ${plan.id} crashed: ${message}`);
      for (const block of plan.blocks) {
        if (block.status === 'pending') block.status = 'skipped';
        else if (block.status === 'running') {
          block.status = 'failed';
          block.error = message;
          block.finishedAt = nowIso();
        }
      }
      // A crash is exactly when the operator most needs to hear that the
      // interrupt we acknowledged is gone. Guarded: whatever broke the plan
      // must not also break the report about it.
      await this.announceDroppedCommand(plan).catch((announceErr) => {
        console.error(
          `[AgentMode] could not report the dropped command: ${announceErr instanceof Error ? announceErr.message : String(announceErr)}`
        );
      });
    } finally {
      plan.cursor = -1;
      plan.updatedAt = nowIso();
      this.pendingCommand = null;
      // A plan the E-Stop already finalized has had its lock released and its
      // `agent:plan:finished` emitted. Guarding on `planFinalized` rather than
      // on `estopActive` is what keeps that true after a latch reset: otherwise
      // a reset mid-block produced a SECOND finished event carrying `done` for
      // a plan whose blocks are all `aborted`/`skipped`.
      if (!this.planFinalized) {
        this.lock.release('agent');
        this.emit('agent:plan:finished', { plan: clonePlan(plan) });
      }
    }
  }

  /**
   * Whether the running plan must stop. `abortRequested` is cleared by a latch
   * reset; `planFinalized` is not — an E-Stopped plan stays stopped even if the
   * operator clears the latch while its last block is still in flight.
   */
  private abortSignalled(): boolean {
    return this.abortRequested || this.planFinalized;
  }

  /**
   * Record which FSM the base was commanded into. Every FSM call — the E-Stop's
   * damp and every `posture` block — goes through here, so {@link isDamped}
   * always reflects the last successful command.
   */
  private async commandFsm(id: number): Promise<LocoResult> {
    const result = await this.loco.fsm(id);
    if (!result.ok) return result;
    const wasDamped = this.isDamped();
    this.lastFsmId = id;
    // Only a CHANGE is worth an event: the UI banner ("the robot is damped —
    // send `posture stand`") flips exactly here.
    if (wasDamped !== this.isDamped()) this.emit('agent:state:changed');
    return result;
  }

  /**
   * Scene text handed to the planner, plus the base's own state when it matters.
   * A damped base swallows every locomotion command silently, so the planner
   * has to be told to stand the robot up first — otherwise it keeps planning
   * walks that cannot move.
   */
  private plannerSceneSummary(): string {
    const summary = this.scene.summary();
    if (!this.isDamped()) return summary;
    return (
      `${summary}\n\nRobot state: the base is DAMPED (FSM ${this.lastFsmId}, after an E-Stop). ` +
      `Locomotion commands are accepted in this state and do nothing. Plan a ` +
      `posture block with pose "stand" BEFORE any walk, turn or goto.`
    );
  }

  /**
   * An interrupting command was accepted ("I will fold that into the running
   * plan after the current block") but the plan failed before it could be
   * planned. Saying so out loud is the only honest option: silently dropping an
   * acknowledged order leaves the operator waiting for something that will
   * never happen, and closes the A2A task with another command's outcome.
   */
  private async announceDroppedCommand(plan: AgentPlan): Promise<void> {
    const pending = this.pendingCommand;
    if (!pending) return;
    this.pendingCommand = null;

    const block = makeBlock(
      'speak',
      {
        text:
          `I did not carry out "${pending.text}": the step before it failed. ` +
          `Please send the command again.`,
      },
      'The interrupting command was dropped because the running plan failed.'
    );
    plan.blocks.push(block);
    this.startBlock(plan, block);
    const outcome = await this.executor.execute(block);
    this.finishBlock(plan, block, outcome);
  }

  /** Fold an interrupting command into the not-yet-started remainder. */
  private async applyPendingCommand(plan: AgentPlan, nextIndex: number): Promise<void> {
    const pending = this.pendingCommand;
    if (!pending) return;
    this.pendingCommand = null;

    const remaining = plan.blocks.slice(nextIndex).filter((b) => b.status === 'pending');
    const replanned = await this.planner.plan({
      command: pending.text,
      sceneSummary: this.plannerSceneSummary(),
      remainingPlan: remaining,
    });

    // Completed blocks are frozen; only the pending tail is replaced.
    plan.blocks = [
      ...plan.blocks.slice(0, nextIndex),
      ...replanned.blocks.map((b) => this.toBlock(b)),
    ];
    plan.command = `${plan.command} → ${pending.text}`;
    plan.updatedAt = nowIso();
    this.emit('agent:plan:updated', { plan: clonePlan(plan) });
  }

  /** Called by the Navigator for each block its `goto` expansion produces. */
  private async runGeneratedBlock(
    kind: AgentBlockKind,
    params: Record<string, unknown>,
    reasoning: string
  ): Promise<AgentBlock> {
    const block = makeBlock(kind, params, reasoning);
    const plan = this.plan;
    if (!plan) {
      block.status = 'aborted';
      block.error = 'no active plan';
      return block;
    }
    const at = Math.min(this.generatedInsertIndex, plan.blocks.length);
    plan.blocks.splice(at, 0, block);
    this.generatedInsertIndex = at + 1;
    plan.cursor = at;

    this.startBlock(plan, block);
    const outcome = await this.executor.execute(block);
    this.finishBlock(plan, block, outcome);
    return block;
  }

  private startBlock(plan: AgentPlan, block: AgentBlock): void {
    block.status = 'running';
    block.startedAt = nowIso();
    plan.updatedAt = block.startedAt;
    this.emit('agent:block:started', { plan: clonePlan(plan), block: { ...block } });
  }

  private finishBlock(plan: AgentPlan, block: AgentBlock, outcome: BlockOutcome): void {
    // An E-Stop that landed while this block was in flight already gave it a
    // terminal status — never overwrite it.
    if (block.status === 'aborted' || block.status === 'skipped') return;

    block.finishedAt = nowIso();
    // Kept on failures too: "walk failed" and "walk failed after 0.00 m" lead
    // to different decisions, and the navigator makes one of them.
    if (outcome.measured) block.measured = outcome.measured;
    if (this.abortSignalled() && !outcome.ok) {
      block.status = 'aborted';
      block.error = this.abortReason ?? outcome.message;
    } else if (outcome.ok) {
      block.status = 'done';
      block.result = outcome.message;
    } else {
      block.status = 'failed';
      block.error = outcome.message;
    }
    plan.updatedAt = block.finishedAt;
    this.emit('agent:block:finished', { plan: clonePlan(plan), block: { ...block } });
    // Fire-and-forget: compliance batching does network I/O, and a plan must
    // never stall behind it.
    void this.mirror.logBlock(plan.command, block);
  }

  private toBlock(planned: PlannedBlock): AgentBlock {
    return makeBlock(planned.kind, planned.params, planned.reasoning);
  }

  // ── idle watcher ──────────────────────────────────────────────────────────

  private isIdleWatchEligible(): boolean {
    // Same rule as submitCommand: EITHER latch forbids autonomous motion. A
    // greet is `speak` + a right-arm wave — moving an arm on an e-stopped,
    // damped robot is exactly what the latch exists to prevent.
    if (!this.enabled || this.latchedEstop() || this.isRunning()) return false;
    if (this.lock.get() !== 'idle') return false;
    const rsm = this.robotStateManager;
    if (rsm && (rsm.isTeleopActive() || rsm.isVLAActive())) return false;
    return true;
  }

  /**
   * A person newly appeared while idle. The greet plan is built directly rather
   * than routed through the planner: greeting is a fixed two-step (`speak` +
   * `wave`), and spending an LLM call on it would add latency and a chance to
   * hallucinate motion for what must never be more than a wave.
   */
  private onPersonAppeared(observation: VisionObservation): void {
    if (!this.isIdleWatchEligible()) return;
    const claim = this.lock.claim('agent');
    if (!claim.ok) return;

    const plan: AgentPlan = {
      id: uuidv4(),
      robotId: this.robotId,
      command: '(idle) a person appeared',
      blocks: [
        makeBlock(
          'greet',
          { text: 'Hello! I am ready whenever you have a job for me.' },
          `A person became visible: ${observation.currentView}`
        ),
      ],
      cursor: -1,
      status: 'running',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.plan = plan;
    this.abortRequested = false;
    this.abortReason = null;
    this.planFinalized = false;
    this.emit('agent:plan:started', { plan: clonePlan(plan) });

    this.runPromise = this.runPlan(plan, true).finally(() => {
      this.runPromise = null;
    });
  }

  // ── events ────────────────────────────────────────────────────────────────

  private emit(
    type: AgentModeEventType,
    extra: Partial<Pick<AgentModeEvent, 'plan' | 'block' | 'scene'>> = {}
  ): void {
    const event: AgentModeEvent = {
      type,
      robotId: this.robotId,
      timestamp: nowIso(),
      ...extra,
    };
    if (type === 'agent:state:changed') event.state = this.getState();

    for (const cb of this.listeners) {
      try {
        cb(event);
      } catch (err) {
        console.error('[AgentMode] event listener error:', err);
      }
    }
    this.mirror.emit(event);
  }
}

/**
 * Lower-case, trim, and strip surrounding punctuation/whitespace so "STOPP!",
 * " stopp " and "Stopp." all reduce to the bare token. Nothing INSIDE the
 * utterance is touched — a stop word only counts when it is the whole message.
 */
function normalizeStopWordCandidate(text: string): string {
  return text.toLowerCase().replace(/^[\s!.?,;:]+/, '').replace(/[\s!.?,;:]+$/, '');
}

/** Process-wide singleton — one robot, one Agent Mode. */
export const agentModeController = new AgentModeController();

/** Re-exported so the E-Stop path's FSM id is discoverable from one place. */
export { G1_FSM_DAMP };
