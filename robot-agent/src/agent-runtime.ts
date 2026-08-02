/**
 * @file agent-runtime.ts
 * @description The boot steps that may only run once this process OWNS ITS PORT,
 *              and the order they run in. Extracted from `index.ts` so the
 *              ordering — which is a safety property, not a formatting choice —
 *              is a unit that can be tested.
 * @feature agentmode
 * @status live
 *
 * ## Why this exists
 *
 * The port is the one thing that decides which of several processes IS this
 * robot. `npm run dev` is `tsx watch`, so two agents are alive at once on every
 * file save, and only one of them will bind. Until `server.listen()` calls back,
 * a process is a CANDIDATE — it may still lose the port and exit.
 *
 * A candidate must therefore do none of these three things:
 *
 *  1. **Actuate.** The idle watcher's greet path issues a real `wave` on the
 *     sidecar; the safety monitor's protective stop sends an E-Stop; the
 *     simulation loop moves the robot's persisted state. A process that never
 *     served must never have moved the machine.
 *  2. **Push to the fleet mirror.** `recordBoot()` emits `agent:state:changed`
 *     whenever it inherited a crash or a latch, and `announceBootState()` always
 *     does. The server accepts any well-formed snapshot, marks the robot
 *     hydrated and stamps `stateMirroredAt` — so a loser's push is served as
 *     FRESH long after it died (observed live: the mirror showed
 *     `b-56cb257f5ffc` while `b-50a41c128583` held the port).
 *  3. **Decide a safety question.** Before `recordBoot()` the controller holds
 *     `bootFromCrash = false` and `recovered = null`, so `isCrashAcknowledged()`
 *     answers TRUE — and `mayInitiate()` lets a self-initiated plan through. The
 *     crash gate is OPEN for the whole pre-bind window unless the verdict is in
 *     the controller before the first idle tick can run.
 *
 * The fix is one rule rather than three patches: **everything that actuates,
 * pushes or decides safety runs from the `listen()` callback, in
 * {@link PORT_OWNED_STEPS} order.** A flag consulted at each dangerous site was
 * the alternative and was rejected: a flag is one more thing to forget at the
 * next call site, while a step that is not in this list simply cannot run early.
 *
 * ## What is deliberately NOT here
 *
 * Steps that neither actuate, nor touch the mirror, nor decide a safety
 * question stay in the boot sequence, because moving them buys nothing and
 * costs boot time before the port is even attempted:
 *
 *  - identity / embodiment / workspace loading, and the `RobotStateManager`
 *    constructor (which is where the durable snapshot is READ — reading is not
 *    acting). Note that this was NOT true until TASK-201: restoring a persisted
 *    E-Stop latch went straight through `SafetyMonitor.executeStop`, so the
 *    constructor POSTed a `StopMove` to the shared sidecar and persisted the
 *    state file it had just read — from a process that had not yet tried to
 *    bind. The in-memory latch still happens there (a latched robot must refuse
 *    commands from the first instant); the stop and the write moved into
 *    {@link AgentRuntimeSteps.reassertRestoredStop};
 *  - `incarnations.open()`, which writes nothing at all: it reads the previous
 *    line and mints this boot's id. {@link AgentRuntimeSteps.confirmIncarnation}
 *    is what puts it on disk;
 *  - `hardwareClient.onConnectionChange(...)`, `agentModeController.subscribe(...)`
 *    and the WebSocket servers — registering a listener is not acting, and they
 *    must be in place BEFORE the steps below fire, so nothing is missed;
 *  - the journal retention loop, which deletes expired plaintext from this
 *    robot's own memory. That is a privacy obligation a process should honour
 *    even if it is about to lose the port, and it moves no hardware;
 *  - the terminal E-Stop, which can only ever STOP. It is armed early on
 *    purpose: the person at that keyboard is standing next to the robot, and
 *    they must not have to wait for a port to press stop.
 */

/**
 * The individual start-up steps, as thunks.
 *
 * Thunks rather than the objects themselves: this module owns the ORDER and the
 * gate, nothing else. It must not grow an opinion about what a controller or a
 * state manager is — `index.ts` binds the real ones, tests bind recorders.
 */
export interface AgentRuntimeSteps {
  /**
   * Write this boot's line into the lineage (`IncarnationLog.confirm`).
   *
   * FIRST, and before anything can actuate: from here on, dying without a clean
   * `close()` leaves the line open and the next boot reads it as the crash it
   * was. Ordering it after actuation would recreate the hole this whole file
   * closes — a process that waved at somebody and then died, with nothing on
   * disk to say it ever ran.
   */
  confirmIncarnation(): void;
  /**
   * `AgentModeController.attach(robotStateManager)`.
   *
   * Before {@link recordBoot}, for two reasons: it is what re-takes an E-Stop
   * latch that survived the restart, so the first mirror push carries the latch
   * instead of claiming the robot is free; and it is what gives the controller
   * the state manager that `recordBoot` persists this boot's id through.
   *
   * Before {@link startSafetyMonitoring} as well, because it registers the
   * `onSafetyStop` listener that turns a protective stop into an aborted plan.
   */
  attachController(): void;
  /**
   * `RobotStateManager.reassertRestoredSafetyStop()` — the E-Stop latch that
   * came back from disk, now told to the MACHINE (TASK-201).
   *
   * The `RobotStateManager` constructor restores such a latch in memory, and
   * must: a robot that is latched has to refuse commands from the first
   * instant, not from the moment it wins a port. But the constructor runs
   * pre-bind, so the two halves of that restore that are NOT in-memory — the
   * `StopMove` POST to the sidecar and the durable write to
   * `data/state-<robotId>.json` — are held back to here. Both are addressed to
   * a robot a candidate does not own yet: the sidecar is shared, so a loser's
   * stop zeroed the commanded velocity of a robot the real owner was driving,
   * and the state file is shared, so a loser's debounced write could land after
   * the owner's shutdown `saveStateSync` and resurrect a cleared latch.
   *
   * After {@link attachController} so Agent Mode's `onSafetyStop` listener is
   * already registered when the stop fires, and before {@link recordBoot} so
   * the first mirror push describes a robot that is already stopped.
   */
  reassertRestoredStop(): void;
  /**
   * `AgentModeController.recordBoot(incarnation)` — the crash verdict.
   *
   * MUST precede {@link startIdleWatcher}. Until it has run the controller
   * answers `isCrashAcknowledged() === true`, which is precisely what
   * `mayInitiate()` reads: a robot that came up from a `kill -9` would greet a
   * passer-by with a real arm wave in the window before it.
   */
  recordBoot(): void;
  /** `RobotStateManager.startSimulation()` — the sim loop and the sidecar link. */
  startSimulation(): void;
  /** `RobotStateManager.startSafetyMonitoring()` — the fall net; can command a stop. */
  startSafetyMonitoring(): void;
  /**
   * `AgentModeController.announceBootState()` — seed the fleet mirror.
   *
   * After everything that can change what the state IS, so the seed is the
   * whole picture (latch, crash, damped base) rather than a partial one that a
   * later push has to correct. Before {@link startIdleWatcher} so the deliberate
   * full snapshot lands first; it also counts as the interval's re-assertion, so
   * the watcher does not immediately push the same fact again.
   */
  announceBootState(): void;
  /**
   * `AgentModeController.startIdleWatcher()` — LAST.
   *
   * It is the one clock that greets people, runs the heartbeat and re-pushes the
   * mirror, and its first tick is rate-limited by nothing. Everything it can
   * reach has to be true before it starts.
   */
  startIdleWatcher(): void;
  /** `IncarnationLog.abandon(reason)` — this process never owned its port. */
  abandonIncarnation(reason: string): void;
}

/**
 * The order, as data, so a test can assert it without re-listing it.
 *
 * Read it top to bottom as the sentence it is: *this process is in the lineage;
 * it knows what it inherited; it has told the machine what it inherited; it
 * knows how the last one ended; now it may move; now it may speak to the fleet;
 * now it may act on its own.*
 */
export const PORT_OWNED_STEPS = [
  'confirmIncarnation',
  'attachController',
  'reassertRestoredStop',
  'recordBoot',
  'startSimulation',
  'startSafetyMonitoring',
  'announceBootState',
  'startIdleWatcher',
] as const satisfies readonly (keyof AgentRuntimeSteps)[];

/** One of the {@link PORT_OWNED_STEPS}. */
export type PortOwnedStep = (typeof PORT_OWNED_STEPS)[number];

export interface AgentRuntime {
  /**
   * The `server.listen()` callback: this process owns its port. Runs every step
   * in {@link PORT_OWNED_STEPS} order.
   *
   * Idempotent, and a no-op after {@link AgentRuntime.onBindFailed} — a process
   * that has already given up its claim must not start actuating because of a
   * late callback.
   */
  onPortOwned(): void;
  /**
   * The `server.on('error')` path: this process is not the robot.
   *
   * Runs NO step and drops the lineage record, so the boot leaves no trace at
   * all — an unwritten line cannot read as a crash, and a boot that never served
   * must not be counted. Passed through to `IncarnationLog.abandon`, which knows
   * the one case where it must refuse: an error AFTER a successful bind belongs
   * to a process that did live, and its line stays exactly as it stands.
   */
  onBindFailed(reason: string): void;
  /** Whether {@link AgentRuntime.onPortOwned} has run. */
  isPortOwned(): boolean;
  /** Which steps have run, in order. For assertions and for the boot log. */
  startedSteps(): PortOwnedStep[];
}

/**
 * Bind the start-up steps to the port lifecycle.
 *
 * @param steps thunks over the real controller / state manager / lineage.
 */
export function createAgentRuntime(steps: AgentRuntimeSteps): AgentRuntime {
  let portOwned = false;
  let bindFailed = false;
  const ran: PortOwnedStep[] = [];

  return {
    onPortOwned(): void {
      if (portOwned || bindFailed) return;
      portOwned = true;
      for (const step of PORT_OWNED_STEPS) {
        try {
          steps[step]();
        } catch (err) {
          // The sequence is a chain of preconditions, so a failed step means
          // every later one would run on a premise that is not true — most
          // sharply, an idle watcher whose crash verdict never arrived. Stop,
          // say so, and let it escalate: the lineage line is already on disk, so
          // a process that dies here is read as the crash it is, and the next
          // boot refuses self-initiated motion until a human clears it.
          console.error(
            `[AgentRuntime] FATAL: start-up step "${step}" failed — ` +
              'refusing to start the remaining steps',
            err,
          );
          throw err;
        }
        ran.push(step);
      }
    },

    onBindFailed(reason: string): void {
      if (bindFailed) return;
      bindFailed = true;
      steps.abandonIncarnation(reason);
    },

    isPortOwned(): boolean {
      return portOwned;
    },

    startedSteps(): PortOwnedStep[] {
      return [...ran];
    },
  };
}
