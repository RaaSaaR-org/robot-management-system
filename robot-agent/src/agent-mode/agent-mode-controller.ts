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
import type { EmbodimentConfig } from '../embodiment/types.js';
import { hardwareClient, type CachedBasePose, type LocoResult } from '../hardware/HardwareClient.js';
import type { RobotStateManager } from '../robot/state.js';
import type { PersistedAgentState } from '../robot/StatePersistence.js';
import {
  computeSelfState,
  describeSelf,
  EMBODIMENT_TAG_BY_ROBOT_TYPE,
  getIdentityStore,
  groupJointNames,
  isIdentityQuestion,
  parseNamingUtterance,
  SELF_COUNTS_TTL_MS,
  type IdentityStore,
  type RobotIdentity,
} from './identity.js';
import { IncarnationLog, type IncarnationOpenResult, type IncarnationRecord } from './incarnations.js';
import {
  BlockExecutor,
  G1_FSM_DAMP,
  G1_NON_LOCOMOTING_FSM_IDS,
  type BlockExecutorDeps,
} from './block-executor.js';
import { controlOwnerLock, type ControlOwnerLock } from './control-owner.js';
import {
  HeartbeatMonitor,
  heartbeatJournalRecord,
  parseActiveHours,
  type HeartbeatSettings,
  type HeartbeatSnapshot,
} from './heartbeat.js';
import { mayInitiate, type InitiativeContext } from './initiative.js';
import { parseReanchorUtterance } from './reanchor.js';
import { IdleWatcher } from './idle-watcher.js';
import { IntentStore, intentMatcher } from './intents.js';
import { Journal, setJournalBootId, type JournalRetention } from './journal.js';
import { ARRIVAL_M, Navigator, type NavPlannerDeps } from './navigator.js';
import { checkStraightSegment, planPath, type PlannerWorld, type SegmentCheck } from './path-planner.js';
import { FOOTPRINT_RADIUS_M } from '../robot/types.js';
import { Planner, type PlannedBlock } from './planner.js';
import { formatPlaceNotesSection } from './prompts.js';
import { resolvePlaceByName, type Place } from './place-resolver.js';
import { RangeSensor } from './range.js';
import { MapKeeper } from './occupancy-map-keeper.js';
import { PeerTracker, type TrackedPeer, type PeerTrackerStatus } from './peers.js';
import type { OccupancyMapSnapshot } from './occupancy-map.js';
import { SceneMemoryStore } from './scene-memory.js';
import { ServerMirror, type BlockJournalContext } from './server-mirror.js';
import { VisionClient, type VisionObservation } from './vision.js';
import { isVoiceTurnInFlight } from './voice-narrator.js';
import {
  getWorkspace,
  listEntries,
  MEMORY_MAX_BYTES,
  type JournalRecord,
  type TrustLevel,
  type Workspace,
} from './workspace.js';
import type {
  AgentBlock,
  AgentBlockKind,
  AgentCommandResult,
  AgentMemoryDigest,
  AgentModeEvent,
  AgentModeEventType,
  AgentModeLivenessState,
  AgentModeState,
  AgentNavPlan,
  AgentPlan,
  AgentRecoveryState,
  AgentSelfState,
  BlockOutcome,
  SceneMemory,
  SpokenLanguage,
} from './types.js';

export interface SubmitCommandInput {
  text: string;
  /** A2A context id, when the command arrived over the A2A message path. */
  contextId?: string;
  /**
   * Language the operator spoke, when the command came in over the voice
   * channel. Carried onto the plan so everything the robot SAYS about it — the
   * planner's `speak` text, the spoken outcome — comes back in that language.
   */
  language?: SpokenLanguage;
  /**
   * This turn arrived over the VOICE channel — somebody said it out loud.
   *
   * Deliberately independent of {@link SubmitCommandInput.language}: `language`
   * is what the speech client could *identify*, and `readVoiceHint()` tolerates
   * a client that identifies none (it returns `{speech: true}` with no
   * language). Inferring "this was spoken" from "this carries a language tag"
   * therefore fails OPEN — an unlabelled spoken utterance looked exactly like a
   * typed command to the trust tier, and a bystander's sentence reached durable
   * memory. See {@link AgentModeController.rememberTrust}.
   */
  spoken?: boolean;
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
  /**
   * The occupancy map's chaperone (TASK-206). Defaults to one built from
   * `config.agentMode.map*` over {@link AgentModeControllerDeps.range} and the
   * hardware client's pose/boot id; `null` runs without a map at all.
   */
  mapKeeper?: MapKeeper | null;
  /** Fleet peer feed (TASK-207); `undefined` = the real one, `null` = none. */
  peerTracker?: PeerTracker | null;
  /** Own planar pose for peer bearings (default: the hardware client's cache). */
  getPose?: () => CachedBasePose | null;
  /**
   * A FRESH pose sample for planning and the pre-walk check (TASK-208) —
   * default asks the sidecar now and falls back to the cache. Tests that pass
   * `getPose` alone get it sampled from there.
   */
  samplePose?: () => Promise<CachedBasePose | null>;
  scene?: SceneMemoryStore;
  mirror?: ServerMirror;
  lock?: ControlOwnerLock;
  /** Loco facade override — tests pass a stub instead of the sidecar. */
  loco?: BlockExecutorDeps['loco'];
  say?: BlockExecutorDeps['say'];
  sleep?: BlockExecutorDeps['sleep'];
  now?: () => number;
  maxNavStages?: number;
  /**
   * How `goto` chooses its stages (TASK-208): `grid` plans on the occupancy
   * map, `staged` is the pre-map loop. Default `AGENT_NAV_PLANNER`.
   */
  navPlanner?: 'grid' | 'staged';
  idleWatchIntervalMs?: number;
  /**
   * Durable memory (TASK-197). `null` runs the controller without one — every
   * memory surface then reports "no workspace" rather than an empty memory,
   * which are different answers.
   */
  memory?: Workspace | null;
  /** Local journal. `null` disables the tee. */
  journal?: Journal | null;
  /**
   * Who the robot is (TASK-198). `null` runs the controller without an
   * identity at all — every self surface then reports "no identity store",
   * which is a different answer from an unnamed robot.
   */
  identity?: IdentityStore | null;
  /** Boot lineage source. Defaults to the workspace's `incarnations.jsonl`. */
  lineage?: () => IncarnationRecord[];
  /**
   * Heartbeat settings (TASK-199). Defaults to `config.agentMode.heartbeat`,
   * which ships DISABLED — a controller nobody configured is never proactive.
   */
  heartbeat?: Partial<HeartbeatSettings>;
  /**
   * Standing intents. `null` runs the heartbeat without any, which is a
   * different answer from "no intent matched" only in the log.
   */
  intents?: IntentStore | null;
  /** Test seam for the tier-1 plan builder — see `HeartbeatDeps.buildPlan`. */
  buildHeartbeatPlan?: HeartbeatMonitorDeps['buildPlan'];
  /** True while a voice turn is in flight. Defaults to the narrator's own span. */
  voiceBusy?: () => boolean;
  /**
   * How often the server mirror is re-asserted while nothing changes
   * (TASK-200). Defaults to {@link MIRROR_REPUSH_INTERVAL_MS}; tests set it to
   * drive the boundary deterministically.
   */
  mirrorRepushIntervalMs?: number;
}

/**
 * How long the mirror may go without hearing from us before we re-assert the
 * state, even though nothing changed (TASK-200).
 *
 * 15 s, chosen against the two clocks it sits between. Below it: the idle
 * watcher's 3 s tick, so this is every 5th tick rather than every tick — the
 * push carries a full `AgentModeState` (place sync, journal counts, a
 * `MEMORY.md` read) and doing that at 3 s buys nothing. Above it: the app's
 * 60 s staleness threshold, so a LIVE robot re-stamps the mirror four times
 * before its own header would go amber, while a snapshot left behind by a dead
 * process still crosses that threshold and is shown as cached. Superseding a
 * dead process's entry takes at most one interval.
 */
export const MIRROR_REPUSH_INTERVAL_MS = 15_000;

/** The subset of {@link HeartbeatMonitor}'s deps this controller re-exposes. */
type HeartbeatMonitorDeps = ConstructorParameters<typeof HeartbeatMonitor>[0];

const defaultLoco: NonNullable<BlockExecutorDeps['loco']> = {
  move: (vx, vy, omega, durationS) => hardwareClient.locoMove(vx, vy, omega, durationS),
  action: (name, args) => hardwareClient.locoAction(name, args),
  fsm: (id) => hardwareClient.locoFsm(id),
  standHeight: (preset) => hardwareClient.locoStandHeight(preset),
  odometry: () => hardwareClient.getLocoOdometry(),
};

/** Blocks during which the base moves — the only time a map sweep learns anything new. */
function isMotionBlock(kind: AgentBlockKind): boolean {
  return kind === 'walk' || kind === 'turn' || kind === 'goto';
}

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
  private readonly mapKeeper: MapKeeper | null;
  private readonly peerTracker: PeerTracker | null;
  private readonly getPose: () => CachedBasePose | null;
  private readonly samplePose: () => Promise<CachedBasePose | null>;
  private readonly scene: SceneMemoryStore;
  private readonly mirror: ServerMirror;
  private readonly executor: BlockExecutor;
  private readonly navigator: Navigator;
  /** The route the navigator is following right now (TASK-208), null between navigations. */
  private navState: AgentNavPlan | null = null;
  /** The `goto` block whose route `navState` describes, while it runs. */
  private activeGoto: AgentBlock | null = null;
  private readonly idleWatcher: IdleWatcher;
  private readonly heartbeat: HeartbeatMonitor;
  private readonly intents: IntentStore | null;
  private readonly loco: NonNullable<BlockExecutorDeps['loco']>;
  private readonly memory: Workspace | null;
  private readonly journal: Journal | null;
  private readonly identity: IdentityStore | null;
  private readonly readLineage: () => IncarnationRecord[];
  /** Injected clock — the same one the executor, heartbeat and watcher get. */
  private readonly now: () => number;
  /** How long the mirror may stay silent before we re-assert (TASK-200). */
  private readonly mirrorRepushIntervalMs: number;
  /**
   * When we last pushed a full state to the server mirror. Zero means "never in
   * this process", which makes the first eligible tick re-assert immediately —
   * the honest answer while a duplicate process's snapshot may be sitting in
   * the mirror in our place.
   */
  private lastStatePushedAtMs = 0;
  /**
   * Why the identity could not be loaded, or null when it could. A GARBLED
   * `IDENTITY.md` lands here rather than being replaced by a generic self:
   * every self surface then says the identity file is unreadable, which is the
   * loud failure the spec asks for and the opposite of "Amnesia Mode".
   */
  private identityFault: string | null = null;
  /** Cached lineage — it cannot change while this process runs. */
  private lineage: IncarnationRecord[] | null = null;
  private bootStartedAtMs = Date.now();
  private bootId: string | null = null;
  /**
   * What `BODY.md` was generated from, kept for the self-report. Null until
   * {@link applyEmbodiment} has run — and null is honest: a robot that has not
   * been told what body it has must not claim a joint count.
   */
  private bodyFacts: { dof: number; hands: string | null } | null = null;
  /** Journal records for the 24 h counts, re-read at most once per TTL. */
  private journalCache: { at: number; records: JournalRecord[] } | null = null;
  /**
   * Last retention answer from the platform, or null when it has not been asked
   * (or did not answer). Reported as-is in the memory digest: `null` is UNKNOWN
   * and must never render as "nothing is retained".
   */
  private journalRetention: JournalRetention | null = null;

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
  /**
   * Cause and time of the CURRENT latch, kept so the durable snapshot (and the
   * boot banner after a restart) can say what actually happened, rather than
   * "some E-Stop, at some point". Cleared by {@link resetEstop}.
   */
  private estopReason: string | null = null;
  private estopAt: string | null = null;
  /**
   * What this boot inherited from the last one: a latch that survived a
   * restart, an unclean shutdown, or both. Null once a human has cleared it —
   * which is exactly what {@link resetEstop} is, so the badge's one-click reset
   * doubles as the acknowledgement. TASK-196.
   */
  private recovered: AgentRecoveryState | null = null;
  /** The restored latch came off disk (as opposed to being taken in this process). */
  private restoredEstop = false;
  /** The previous incarnation never wrote its `endedAt`. */
  private bootFromCrash = false;
  private runPromise: Promise<void> | null = null;
  private pendingCommand: SubmitCommandInput | null = null;
  /** Where the navigator splices its generated blocks into the running plan. */
  private generatedInsertIndex = 0;

  // ── heartbeat bookkeeping (TASK-199) ──────────────────────────────────────
  /**
   * Id of the plan the heartbeat started, while it runs. Non-null is what makes
   * `remember` untrusted for the duration: an unattended cycle is exactly where
   * poisoned content enters persistent memory, and nothing written while nobody
   * was present was authored by an operator.
   */
  private heartbeatPlanId: string | null = null;
  /**
   * Id of the plan the robot started BY ITSELF, while it runs — the heartbeat's
   * AND the idle greet's. Kept separately from {@link heartbeatPlanId}, which
   * additionally suppresses the `plan_failed_idle` feedback loop: for trust the
   * question is only "did a human ask for this", and for a greet the answer is
   * no.
   */
  private selfInitiatedPlanId: string | null = null;
  /** When the last plan FAILED, or null. A plan that succeeds clears it. */
  private lastPlanFailedAtMs: number | null = null;
  /** When an operator last did anything — a command, an E-Stop, a reset. */
  private lastOperatorTurnAtMs: number | null = null;
  /** When a durable write last failed, and why. Cleared by the next success. */
  private workspaceWriteFailedAtMs: number | null = null;
  private workspaceWriteError: string | null = null;

  private robotStateManager: RobotStateManager | null = null;
  private listeners = new Set<(event: AgentModeEvent) => void>();
  private unsubscribeLock: (() => void) | null = null;

  constructor(deps: AgentModeControllerDeps = {}) {
    this.robotId = deps.robotId ?? config.robotId;
    this.enabled = deps.enabled ?? config.agentMode.enabled;
    this.now = deps.now ?? (() => Date.now());
    this.mirrorRepushIntervalMs = deps.mirrorRepushIntervalMs ?? MIRROR_REPUSH_INTERVAL_MS;
    this.lock = deps.lock ?? controlOwnerLock;
    this.planner = deps.planner ?? new Planner();
    this.vision = deps.vision ?? new VisionClient();
    this.range = deps.range ?? new RangeSensor();
    this.mapKeeper =
      deps.mapKeeper === undefined
        ? new MapKeeper({
            enabled: config.agentMode.mapEnabled && config.agentMode.rangeEnabled,
            options: {
              resolutionM: config.agentMode.mapResolutionM,
              maxSizeM: config.agentMode.mapMaxM,
              maxRangeM: config.agentMode.rangeMaxM,
              minRangeM: config.agentMode.rangeMinM,
              decayS: config.agentMode.mapDecayS,
            },
            path: config.agentMode.mapPath,
            sweepHz: config.agentMode.mapSweepHz,
            range: this.range,
            getPose: () => hardwareClient.getCachedPose(),
            samplePose: () => hardwareClient.samplePoseNow(),
            getBootId: () => hardwareClient.getSidecarBootId(),
          })
        : deps.mapKeeper;
    this.peerTracker =
      deps.peerTracker === undefined
        ? new PeerTracker({
            enabled: config.agentMode.peersPollMs > 0,
            serverUrl: config.serverUrl,
            robotId: this.robotId,
            pollMs: config.agentMode.peersPollMs,
            getFrame: () => hardwareClient.getOdometryFrame(),
            onChange: () => this.syncPeers(),
          })
        : deps.peerTracker;
    this.getPose = deps.getPose ?? (() => hardwareClient.getCachedPose());
    this.samplePose =
      deps.samplePose ??
      (deps.getPose
        ? async () => this.getPose()
        : async () => (await hardwareClient.samplePoseNow()) ?? hardwareClient.getCachedPose());
    this.scene = deps.scene ?? new SceneMemoryStore(this.robotId);
    // `undefined` means "the real one"; an explicit `null` means "none".
    this.memory = deps.memory === undefined ? getWorkspace() : deps.memory;
    this.journal =
      deps.journal === undefined
        ? this.memory
          ? new Journal({ workspace: this.memory })
          : null
        : deps.journal;
    this.identity = deps.identity === undefined ? getIdentityStore() : deps.identity;
    // The lineage lives inside the workspace (TASK-196/197), so the default
    // reader is the same file `index.ts` opened — read lazily, because
    // constructing this controller must not touch the disk.
    this.readLineage =
      deps.lineage ??
      (() => {
        if (!this.memory) return [];
        return new IncarnationLog({
          robotId: this.robotId,
          filePath: this.memory.incarnationsFile,
        }).readAll();
      });
    this.mirror =
      deps.mirror ?? new ServerMirror({ robotId: this.robotId, journal: this.journal });
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
      // The blocks of the RUNNING plan speak the language its operator used;
      // typed commands leave it undefined and the voice service falls back to
      // its own default, exactly as before.
      language: () => this.plan?.language,
      memory: this.memory,
      rememberTrust: () => this.rememberTrust(),
      // The `remember` block writes durable memory too, and used to do it
      // silently: only `writeJournal` reported, so a workspace that had stopped
      // accepting writes still looked healthy in the heartbeat.
      onDurableWrite: (ok, error) => this.noteWorkspaceWrite(ok, error),
      // Every forward walk is checked against the map before it runs
      // (TASK-208): keepouts, occupied cells, peers. Null when there is nothing
      // to check against.
      checkForwardPath: (distanceM) => this.checkForwardPath(distanceM),
    };
    if (deps.say) executorDeps.say = deps.say;
    if (deps.sleep) executorDeps.sleep = deps.sleep;
    if (deps.now) executorDeps.now = deps.now;
    this.executor = new BlockExecutor(executorDeps);

    const navPlanner = deps.navPlanner ?? config.agentMode.navPlanner;
    const plannerDeps: NavPlannerDeps | null =
      navPlanner === 'grid'
        ? {
            plan: (from, goal) => {
              const world = this.plannerWorld();
              return planPath(world, from, goal, {
                unknownCost: config.agentMode.navUnknownCost,
                // The plan ends where the staged final approach can take over:
                // the arrival distance plus the robot's own radius, so a goal
                // ON a surface (which is where the lidar puts it) is reachable
                // without the planner having to stand inside the table.
                goalToleranceM: ARRIVAL_M + world.robotRadiusM + (world.map?.resolution ?? 0.1),
              });
            },
            samplePose: async () => {
              const pose = await this.samplePose();
              return pose ? { x: pose.x, y: pose.y, yawDeg: pose.yawDeg } : null;
            },
          }
        : null;
    this.navigator = new Navigator({
      scene: this.scene,
      isAborted: () => this.abortSignalled(),
      runGeneratedBlock: (kind, params, reasoning) =>
        this.runGeneratedBlock(kind, params, reasoning),
      planner: plannerDeps,
      onNav: (nav) => this.onNav(nav),
      // `maxStages` is what NavigatorDeps calls it. Spelled `maxNavStages` here
      // the override type-checked (a spread skips the excess-property check) and
      // was silently dropped, so AGENT_MAX_NAV_STAGES always won.
      ...(deps.maxNavStages === undefined ? {} : { maxStages: deps.maxNavStages }),
    });

    // `undefined` means "the real one"; an explicit `null` means "none".
    this.intents =
      deps.intents === undefined
        ? this.memory
          ? new IntentStore({ workspace: this.memory })
          : null
        : deps.intents;

    const heartbeatSettings: HeartbeatSettings = {
      enabled: config.agentMode.heartbeat.enabled,
      minIntervalMs: config.agentMode.heartbeat.minIntervalMs,
      activeHours: parseActiveHours(config.agentMode.heartbeat.activeHours),
      batteryPct: config.agentMode.heartbeat.batteryPct,
      motion: config.agentMode.heartbeat.motion,
      ...(deps.heartbeat ?? {}),
    };
    // A typo in AGENT_HEARTBEAT_ACTIVE_HOURS parses to null, which means ALWAYS
    // ACTIVE — the opposite of what whoever typed it meant. Say so once: a
    // heartbeat that never fires and a heartbeat with nothing to say look the
    // same from outside.
    if (
      heartbeatSettings.enabled &&
      config.agentMode.heartbeat.activeHours &&
      heartbeatSettings.activeHours === null &&
      deps.heartbeat?.activeHours === undefined
    ) {
      console.warn(
        `[AgentMode/Heartbeat] AGENT_HEARTBEAT_ACTIVE_HOURS="${config.agentMode.heartbeat.activeHours}" ` +
          'could not be read as an hour window (expected e.g. "8-20") — the heartbeat is active at all hours.',
      );
    }

    this.heartbeat = new HeartbeatMonitor({
      settings: heartbeatSettings,
      snapshot: () => this.heartbeatSnapshot(),
      // Every proactive plan goes through the SAME path as `onPersonAppeared`.
      // There is no second execution path, and there must not be one.
      run: (command, blocks) => this.startProactivePlan(command, blocks, 'heartbeat'),
      journal: (record) => this.writeJournal(record),
      voiceBusy: deps.voiceBusy ?? (() => isVoiceTurnInFlight()),
      ...(this.intents ? { matchIntents: intentMatcher(this.intents) } : {}),
      ...(deps.buildHeartbeatPlan ? { buildPlan: deps.buildHeartbeatPlan } : {}),
      ...(deps.now ? { now: deps.now } : {}),
    });

    this.idleWatcher = new IdleWatcher({
      observe: () => this.vision.observe(),
      isEligible: () => this.isIdleWatchEligible(),
      onPersonAppeared: (observation) => this.onPersonAppeared(observation),
      // Rides the existing clock — see the idle-watcher header. Registered
      // BEFORE the vision call, so a firing predicate does not first pay for a
      // frame the robot will not act on.
      checks: [{ name: 'heartbeat', run: () => this.heartbeat.tick() }],
      // Runs on EVERY tick, eligible or not (TASK-200). The mirror's whole
      // purpose is to answer "what is this robot doing", and the two states it
      // is most often asked about — a plan running, an E-Stop latched — are
      // exactly the ones `checks[]` above is skipped in.
      alwaysChecks: [{ name: 'mirror-state', run: () => this.remirrorState() }],
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

  /**
   * Called once from index.ts so E-Stop can reach the existing safety path.
   *
   * Also where Agent Mode comes back as it was (TASK-196): a latch that was
   * held when the process died is re-taken here, and the base's last FSM is
   * restored so `isDamped()` is true again. `RobotStateManager` has already
   * re-latched the SafetyMonitor by this point — this is the other half, and
   * they must agree: a UI that shows no latch while the SafetyMonitor refuses
   * every command is the same lying state in a different place.
   */
  attach(robotStateManager: RobotStateManager): void {
    this.robotStateManager = robotStateManager;
    this.peerTracker?.start();

    // A protective stop has to stop the thing that is DRIVING, not just latch.
    // Without this the geofence (TASK-200) "fires" while the running `walk`
    // block keeps streaming `/loco/move` and the Navigator keeps generating
    // stages — the robot drives into the rack for the rest of the plan and only
    // the NEXT command is refused. `abortPlan` no-ops when nothing is running,
    // so an E-Stop (which finalizes the plan itself, before the SafetyMonitor
    // ever sees it) is unaffected. Optional call: test doubles are partial.
    robotStateManager.onSafetyStop?.((stop) =>
      this.abortPlan(`Safety stop (${stop.type}): ${stop.reason}`),
    );

    // Optional call: test doubles for RobotStateManager may be partial.
    const restored = robotStateManager.getRestoredAgentState?.();
    if (!restored) return;

    if (restored.lastFsmId !== null) this.lastFsmId = restored.lastFsmId;
    if (restored.estopLatched) {
      this.estopActive = true;
      this.restoredEstop = true;
      this.estopReason = restored.estopReason;
      this.estopAt = restored.estopAt;
      console.warn(
        `[AgentMode] E-Stop latch RESTORED from disk (${restored.estopReason ?? 'no reason recorded'}` +
          `${restored.estopAt ? `, latched ${restored.estopAt}` : ''}) — ` +
          'commands are refused until an operator resets it',
      );
    }
    if (this.isDamped()) {
      console.warn(
        `[AgentMode] the base was damped when this robot last shut down (FSM ${this.lastFsmId}) — ` +
          'send `posture stand` before any locomotion',
      );
    }
    this.refreshRecovered();
  }

  /**
   * Hand the controller the incarnation this process opened (`index.ts`, right
   * after the secure-boot check). A previous line without `endedAt` means the
   * last process was killed or crashed — the robot says so, and refuses
   * self-initiated motion until someone clears it (TASK-199 uses the gate in
   * `initiative.ts` for that; an operator's command is never refused for it).
   */
  recordBoot(incarnation: IncarnationOpenResult): void {
    this.bootFromCrash = incarnation.fromCrash;
    this.bootId = incarnation.bootId;
    const startedAt = Date.parse(incarnation.startedAt);
    if (Number.isFinite(startedAt)) this.bootStartedAtMs = startedAt;
    // Read the lineage ONCE, here: it is what the self-report counts lives
    // from, and it cannot change again while this process is alive.
    this.lineage = null;
    this.robotStateManager?.setAgentSafetyState?.({ bootId: incarnation.bootId });
    // Every journal line from here on carries this boot, so a reader can tell
    // "the last thing before the crash" from "the first thing after it".
    setJournalBootId(incarnation.bootId);
    if (incarnation.fromCrash) {
      console.warn(
        `[AgentMode] recovered from an unclean shutdown (previous boot ${incarnation.previous?.bootId ?? 'unknown'})`,
      );
    }
    if (this.refreshRecovered(incarnation.startedAt)) this.emit('agent:state:changed');
  }

  /**
   * What this boot inherited, or null when it inherited nothing (and once a
   * human has acknowledged it).
   */
  getRecovered(): AgentRecoveryState | null {
    return this.recovered ? { ...this.recovered } : null;
  }

  /**
   * Whether the crash / restored latch has been acknowledged by a human. Feeds
   * `mayInitiate()`'s crash check — TASK-199 wires that up.
   */
  isCrashAcknowledged(): boolean {
    return this.recovered === null;
  }

  /** Safety state for the incarnation line written at shutdown. */
  incarnationSnapshot(): { estopLatched: boolean; damped: boolean } {
    return { estopLatched: this.estopActive, damped: this.isDamped() };
  }

  /**
   * Recompute the recovery marker. `at` is pinned to the first time it was set,
   * so a later refresh does not make an old crash look like a fresh one.
   *
   * @returns true when it changed.
   */
  private refreshRecovered(at?: string): boolean {
    const next: AgentRecoveryState | null =
      this.bootFromCrash || this.restoredEstop
        ? {
            fromCrash: this.bootFromCrash,
            estopLatched: this.restoredEstop,
            at: this.recovered?.at ?? at ?? nowIso(),
          }
        : null;

    const changed =
      (next === null) !== (this.recovered === null) ||
      (next !== null &&
        this.recovered !== null &&
        (next.fromCrash !== this.recovered.fromCrash ||
          next.estopLatched !== this.recovered.estopLatched));
    this.recovered = next;
    return changed;
  }

  /**
   * Write the durable safety state through to disk. Called on every transition
   * — latch taken, latch cleared, base damped or re-armed — because the only
   * thing that matters is that the file is right at the instant the process
   * dies. `place` is deliberately not written here: TASK-195 owns it, and
   * sending `undefined` would be a claim we cannot make.
   */
  private persistSafetyState(): void {
    const patch: Partial<PersistedAgentState> = {
      estopLatched: this.estopActive,
      estopReason: this.estopReason,
      estopAt: this.estopAt,
      damped: this.isDamped(),
      lastFsmId: this.lastFsmId,
    };
    // Optional call: test doubles for RobotStateManager may be partial.
    this.robotStateManager?.setAgentSafetyState?.(patch);
  }

  /** Local event subscription (robot-agent WebSocket, A2A executor). */
  subscribe(cb: (event: AgentModeEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    this.peerTracker?.dispose();
    this.mapKeeper?.dispose();
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
    this.syncPlace();
    return {
      robotId: this.robotId,
      enabled: this.enabled,
      controlOwner: this.lock.get(),
      plan: this.plan ? clonePlan(this.plan) : null,
      scene: this.scene.snapshot(),
      estopActive: this.estopActive,
      fsmId: this.lastFsmId,
      damped: this.isDamped(),
      recovered: this.recovered ? { ...this.recovered } : null,
      self: this.selfState(),
      map: this.mapKeeper?.summary() ?? null,
      nav: this.navState ? { ...this.navState } : null,
    };
  }

  /** The navigator's current route (TASK-208), for `/map` and the state. */
  navPlan(): AgentNavPlan | null {
    return this.navState ? { ...this.navState } : null;
  }

  /**
   * A `goto` is one of two things (TASK-209): `{"entity"}` walks to something the
   * camera saw, `{"place"}` walks INTO a room or area of the place graph. The
   * place is resolved here, against the graph the robot actually holds, so the
   * navigator only ever sees a real polygon — and a name that matches nothing
   * fails in one sentence that lists what would have matched.
   */
  private async runGoto(block: AgentBlock): Promise<BlockOutcome> {
    const placeName = typeof block.params.place === 'string' ? block.params.place.trim() : '';
    if (!placeName) return this.navigator.navigate(String(block.params.entity ?? ''));

    const rsm = this.robotStateManager;
    const registration = rsm?.getPlaceFrameRegistration?.() ?? null;
    const places = this.knownPlaces();
    if (places.length === 0) {
      return {
        ok: false,
        message:
          registration && !registration.registered
            ? `goto place "${placeName}": the place graph is not registered to this robot's odometry — ${registration.reason}`
            : `goto place "${placeName}": this robot has no place graph, so it knows no places by name.`,
      };
    }
    const place = resolvePlaceByName(placeName, places);
    if (!place) {
      return {
        ok: false,
        message:
          `goto place "${placeName}": no such place on the map. Known places: ` +
          `${places.map((p) => p.name || p.id).join(', ')}.`,
      };
    }
    return this.navigator.navigateToPlace(place);
  }

  /**
   * The places the robot may be sent to by name: the graph's non-keepout places
   * on the ground floor, and only while the graph's frame is registered to
   * odometry — the same rule `plannerWorld()` applies to keepouts, for the same
   * reason (unregistered polygons are numbers about another origin).
   */
  private knownPlaces(): readonly Place[] {
    const rsm = this.robotStateManager;
    if (rsm?.getPlaceFrameRegistration?.()?.registered !== true) return [];
    return (rsm.getPlaces?.() ?? []).filter((p) => !p.keepout && p.floor === 0);
  }

  /** One line for the planner: which places `goto.place` accepts. Empty when none. */
  private knownPlacesLine(): string {
    const places = this.knownPlaces();
    if (places.length === 0) return '';
    const here = this.scene.getPlace()?.id ?? null;
    return (
      'Places on the map (use `goto` with "place" to walk into one): ' +
      places.map((p) => `${p.name || p.id}${p.id === here ? ' (here)' : ''}`).join(', ') +
      '.'
    );
  }

  /**
   * The world the planner and the pre-walk check see (TASK-208): the live map
   * (may be null), and the keepouts ONLY when the place graph's frame is
   * registered to odometry — on an unregistered frame the polygons are numbers
   * about another origin, and the geofence, `/map` and this all say `[]`.
   */
  private plannerWorld(): PlannerWorld {
    const rsm = this.robotStateManager;
    const registered = rsm?.getPlaceFrameRegistration?.()?.registered === true;
    const keepouts = registered ? (rsm?.getPlaces?.() ?? []).filter((p) => p.keepout && p.floor === 0) : [];
    return {
      map: this.mapKeeper?.getMap() ?? null,
      keepouts,
      keepoutMarginM: config.place.keepoutMarginM,
      // Footprint plus the path margin — see `navPathMarginM` in config.ts for
      // the arch post that taught us the two clamps must agree.
      robotRadiusM: (FOOTPRINT_RADIUS_M[config.robotType] ?? FOOTPRINT_RADIUS_M.generic) + config.agentMode.navPathMarginM,
    };
  }

  /** See {@link BlockExecutorDeps.checkForwardPath}. */
  private async checkForwardPath(distanceM: number): Promise<SegmentCheck | null> {
    // Sampled, not cached: the walk usually follows a turn, and a pose from
    // before that turn would check the wrong heading.
    const pose = await this.samplePose();
    if (!pose) return null;
    const world = this.plannerWorld();
    if (!(world.map?.isAllocated() ?? false) && world.keepouts.length === 0) return null;
    return checkStraightSegment(world, { x: pose.x, y: pose.y }, pose.yawDeg, distanceM);
  }

  /** The navigator planned, re-planned or finished (TASK-208). */
  private onNav(nav: AgentNavPlan | null): void {
    this.navState = nav;
    const goto = this.activeGoto;
    if (nav && goto && this.plan) {
      goto.nav = { planned: nav.planned, lengthM: nav.lengthM, segments: nav.segments, reason: nav.reason };
      this.plan.updatedAt = nowIso();
      this.emit('agent:plan:updated', { plan: clonePlan(this.plan) });
    }
  }

  /**
   * The full occupancy grid (TASK-206) — served by `GET /robots/:id/map`, never
   * mirrored. Null when map building is disabled or nothing has been integrated.
   */
  mapSnapshot(): OccupancyMapSnapshot | null {
    return this.mapKeeper?.snapshot() ?? null;
  }

  /** Diagnostics for `/map`: session id, skip counters, persistence. */
  mapStatus(): ReturnType<MapKeeper['status']> | null {
    return this.mapKeeper?.status() ?? null;
  }

  /**
   * Write the occupancy map to disk NOW, synchronously. Called from the
   * shutdown path next to `saveStateSync()`, before anything that can block —
   * `dispose()` also saves, but a supervisor's SIGKILL can arrive before it.
   */
  persistMap(): boolean {
    return this.mapKeeper?.save() ?? false;
  }

  /** The keeper's live map, for callers that need geometry queries (TASK-208). */
  occupancyMap() {
    return this.mapKeeper?.getMap() ?? null;
  }

  /** Accepted (same-frame, unexpired) peers, for `/map` and the scene (TASK-207). */
  peers(): TrackedPeer[] {
    return this.peerTracker?.list() ?? [];
  }

  /** Peer feed diagnostics; null when this controller has no tracker. */
  peerStatus(): PeerTrackerStatus | null {
    return this.peerTracker?.status() ?? null;
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
    this.syncPlace();
    return this.scene.snapshot();
  }

  sceneMarkdown(): string {
    this.syncPlace();
    return this.scene.toMarkdown();
  }

  /**
   * Copy the state manager's place belief into the scene store, right before
   * anything renders it (TASK-195).
   *
   * PULLED rather than pushed on purpose. The belief is produced by the 2 s
   * hardware poll and consumed by three renderers (`summary()` for the planner,
   * `snapshot()` for the UI, `toMarkdown()` for `scene.md`); a subscription
   * would add a second write path into the store whose ordering against the
   * state manager's own listener nothing guarantees, for no freshness that a
   * pull at render time does not already give.
   *
   * `null` from `getPlaceBelief()` means place awareness is not configured at
   * all; the store is still cleared, because "no map" and "unknown place" must
   * both render as unknown and never as the last place the robot saw.
   */
  /**
   * Try to read an utterance as an operator re-anchor (TASK-200).
   *
   * Returns a finished {@link AgentCommandResult} when it was one, or `null` to
   * let the normal command path have it. Deterministic and model-free: a
   * re-anchor outranks geometry, and nothing that important is inferred by an
   * LLM from "go and check aisle 3".
   */
  private tryReanchor(text: string): AgentCommandResult | null {
    const rsm = this.robotStateManager;
    const places = rsm?.getPlaces?.() ?? [];
    if (places.length === 0) return null;

    const request = parseReanchorUtterance(text, places);
    if (!request) return null;

    const declared = rsm?.declarePlace?.(request.placeId) ?? null;
    if (!declared) return null;

    this.syncPlace();
    // `trust: 'operator'` — a human said this out loud, which is the highest
    // provenance this system has, and it is the whole reason a re-anchor is
    // allowed to outrank geometry.
    this.writeJournal(
      heartbeatJournalRecord({
        at: nowIso(),
        place: declared.id,
        trust: 'operator',
        msg: `Operator re-anchored me to ${declared.id} ("${request.spoken}") — drift budget reset.`,
      }),
    );
    this.emit('agent:scene:updated', { scene: this.scene.snapshot() ?? undefined });
    return {
      accepted: true,
      outcome: 'reanchored',
      message: `Understood — I am in ${declared.name}. I have reset how far I think I have drifted.`,
    };
  }

  private syncPlace(): void {
    // Optional call: test doubles for RobotStateManager may be partial.
    const belief = this.robotStateManager?.getPlaceBelief?.() ?? null;
    if (!belief || belief.poseM === null || belief.poseSource === null) {
      this.scene.clearPoseM();
    } else {
      this.scene.setPoseM(belief.poseM.x, belief.poseM.y, belief.poseSource);
    }
    this.scene.setPlace(belief?.place ?? null, belief?.driftSinceAnchorM ?? null);
    this.syncPeers();
  }

  /**
   * Push the fleet's view of the other robots into the two places that read
   * it (TASK-207): the map's dynamic overlay (every accepted peer, as a disc)
   * and scene memory (only peers within `AGENT_PEERS_NOTICE_M` and inside ±90°
   * of heading — what the robot would plausibly "notice"). Called on every
   * peer change and, like {@link syncPlace}, on every render pull, because the
   * robot's own pose moves too and bearings are relative to it.
   */
  private syncPeers(): void {
    if (!this.peerTracker) return;
    const peers = this.peerTracker.list();
    this.mapKeeper?.getMap()?.setDynamicObstacles(this.peerTracker.obstacles());

    const pose = this.getPose();
    if (!pose) {
      // No own pose: bearings would be fiction. The overlay above still holds
      // (it is in map coordinates, not relative), the scene says nothing.
      this.scene.setFleetEntities([]);
      return;
    }
    const noticeM = config.agentMode.peersNoticeM;
    const now = nowIso();
    const entities = peers.flatMap((p) => {
      const dx = p.x - pose.x;
      const dy = p.y - pose.y;
      const dist = Math.hypot(dx, dy);
      if (dist > noticeM) return [];
      const bearing = (Math.atan2(dy, dx) * 180) / Math.PI;
      let rel = bearing - pose.yawDeg;
      while (rel > 180) rel -= 360;
      while (rel <= -180) rel += 360;
      if (Math.abs(rel) > 90) return [];
      let world = bearing;
      while (world > 180) world -= 360;
      while (world <= -180) world += 360;
      return [
        {
          label: `robot ${p.name}`,
          bearingDeg: world,
          distanceEstM: Math.round(dist * 10) / 10,
          distanceSource: 'fleet' as const,
          confidence: 1,
          lastSeen: p.updatedAt ?? now,
          observedSeq: 0,
        },
      ];
    });
    this.scene.setFleetEntities(entities);
  }

  setEnabled(enabled: boolean): AgentModeState {
    if (this.enabled === enabled) return this.getState();
    this.enabled = enabled;
    if (enabled) {
      this.idleWatcher.reset();
      // A fresh session starts with a fresh pulse: the damped/place-lost clocks
      // were measured in a session that is over, and the rate limiter must not
      // make the first thing the robot notices wait five minutes.
      this.heartbeat.reset();
      this.idleWatcher.start();
    } else {
      // The CLOCK keeps running with the mode off (TASK-200): `isEligible()`
      // already gates every vision call, greet and heartbeat on `this.enabled`,
      // so nothing observes and nothing moves — but the mirror re-push rides
      // this tick, and a robot whose Agent Mode is off is exactly as capable of
      // being misrepresented by a dead process's snapshot as one whose mode is
      // on. Stopping here would make "mode off" mean "stops correcting the
      // record", which is the opposite of what it should mean.
      if (this.isRunning()) this.abortPlan('Agent Mode was switched off.');
    }
    console.log(`[AgentMode] mode ${enabled ? 'ENABLED' : 'disabled'}`);
    this.emit('agent:state:changed');
    return this.getState();
  }

  /**
   * Start the one idle-time clock (boot path).
   *
   * Started unconditionally since TASK-200. It used to be gated on
   * `this.enabled`, which was right while the watcher only did vision: with the
   * mode off there is nobody to greet. It now also carries the mirror re-push,
   * and that has to happen whatever the mode is — the server's answer for a
   * mode-off robot is just as capable of being a dead process's leftover.
   * Everything the watcher DOES stays gated: `isEligible()` still returns false
   * while the mode is off, so no frame is taken and no plan is started. The
   * interval is `unref()`ed, so it never holds shutdown open.
   */
  startIdleWatcher(): void {
    this.idleWatcher.start();
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

  /**
   * One heartbeat pulse. Public for the same reason `IdleWatcher.tick()` is:
   * tests drive the pulse deterministically instead of waiting on a 3 s timer.
   * In production nothing calls this — the idle watcher's `checks[]` does.
   */
  heartbeatTick(): void {
    this.heartbeat.tick();
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
    if (!text) return { accepted: false, outcome: 'empty', message: 'Empty command.' };

    // Somebody is here. That is what `plan_failed_idle` waits for, and it counts
    // whatever the command turns out to be — including a refused one.
    this.noteOperatorTurn();

    if (!this.enabled) {
      return {
        accepted: false,
        outcome: 'disabled',
        message: 'Agent Mode is off — enable it before sending commands.',
      };
    }

    if (this.isStopWord(text)) {
      const result = await this.estop(`Stop word "${text}" received`);
      // `estop()` computes `delivered` precisely so the caller can tell "latch
      // set" from "base actually stopped" — hard-coding "and the robot was
      // damped." into both arms threw that away and told the operator the one
      // thing they must be able to trust. The typed-stop-word path is the same
      // E-Stop as the button and gets the same honesty.
      const head = result.stopped
        ? 'the running plan was discarded'
        : 'nothing was running';
      const tail = result.delivered
        ? 'and the robot was damped.'
        : `but the robot did NOT confirm StopMove/Damp (${result.deliveryError ?? 'no sidecar ack'}) — it may still be moving; use the hardware E-Stop.`;
      return {
        accepted: true,
        outcome: 'estop',
        message: `E-Stop: ${head} ${tail}`,
        delivered: result.delivered,
        ...(result.deliveryError === undefined ? {} : { deliveryError: result.deliveryError }),
      };
    }

    // "You are in aisle 3." — a STATEMENT about where the robot is, not an
    // instruction, so it never reaches the planner and never becomes a plan.
    // It is allowed while an E-Stop is latched, deliberately: correcting the
    // robot's belief about its own position is exactly what an operator does
    // while standing next to a stopped robot, and it moves nothing.
    const reanchored = this.tryReanchor(text);
    if (reanchored) return reanchored;

    // Our own latch is NOT the only one that forbids driving: the SafetyMonitor
    // latches on its own fall/tilt detection and on platform/fleet E-Stops that
    // never route through this controller. Trusting only `estopActive` meant
    // planning and driving a robot the rest of the system reports as
    // emergency-stopped.
    const latch = this.latchedEstop();
    if (latch) {
      return { accepted: false, outcome: 'estop_latched', message: this.latchMessage(latch) };
    }

    // A plan that an E-Stop or a takeover terminated may still be winding down:
    // the block in flight is never cut off mid-motion. Folding a command into
    // that plan would attach it to a dead run and `runPlan`'s finally would
    // drop it without a word, so say so instead.
    if (this.isRunning() && this.abortSignalled()) {
      return {
        accepted: false,
        outcome: 'winding_down',
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
      this.pendingCommand = {
        text,
        ...(input.contextId ? { contextId: input.contextId } : {}),
        ...(input.language ? { language: input.language } : {}),
        ...(input.spoken ? { spoken: true } : {}),
      };
      return {
        accepted: true,
        outcome: 'folded',
        planId: this.plan.id,
        ...(replaced ? { replacedCommand: replaced.text } : {}),
        message: replaced
          ? `Understood — I will fold that into the running plan after the current block. ` +
            `This replaces your earlier instruction "${replaced.text}", which had not started yet.`
          : 'Understood — I will fold that into the running plan after the current block.',
      };
    }

    const claim = this.lock.claim('agent');
    if (!claim.ok) {
      return {
        accepted: false,
        outcome: 'busy',
        message: `Cannot start: ${claim.reason ?? 'control is busy.'}`,
      };
    }

    const plan: AgentPlan = {
      id: uuidv4(),
      robotId: this.robotId,
      command: text,
      ...(input.contextId ? { contextId: input.contextId } : {}),
      ...(input.language ? { language: input.language } : {}),
      ...(input.spoken ? { spoken: true } : {}),
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

    return { accepted: true, outcome: 'planned', planId: plan.id, message: 'Planning…' };
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
    this.estopReason = reason;
    this.estopAt = nowIso();
    // BEFORE the hardware round-trip, not after: a process that dies between
    // the latch and the sidecar's answer must still come back latched. The
    // debounced write in StatePersistence collapses this with the writes the
    // damp below triggers. (TASK-196)
    this.persistSafetyState();

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
    this.noteOperatorTurn();
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
    this.estopReason = null;
    this.estopAt = null;
    // A human clicked reset, so a human has now seen whatever this boot
    // inherited — that IS the acknowledgement the initiative gate waits for.
    // Clearing it here (rather than on a separate "dismiss") is deliberate:
    // the alternative is an operator who deletes the state file to make the
    // badge go away, which is worse than the bug this task fixes.
    this.restoredEstop = false;
    this.bootFromCrash = false;
    this.recovered = null;
    this.persistSafetyState();
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
          ...(plan.language ? { language: plan.language } : {}),
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
            this.activeGoto = block;
            try {
              outcome = await this.runGoto(block);
            } finally {
              this.activeGoto = null;
            }
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
      this.notePlanOutcome(plan);
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
    // Durable: a robot that was damped comes back damped (TASK-196). Written on
    // every FSM change, not only on the damped/armed transition — `lastFsmId`
    // is what the restore reconstructs `isDamped()` from.
    this.persistSafetyState();
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
    this.syncPlace();
    const sections = [this.scene.summary()];
    // The place vocabulary (TASK-209): what `goto.place` will accept, so the
    // planner names a room the robot actually knows rather than guessing one.
    const places = this.knownPlacesLine();
    if (places) sections.push(places);

    // Retrieval (TASK-197): deterministic and place-keyed, injected here rather
    // than planned. There is no `recall` block on purpose — a 4B planner cannot
    // be trusted to plan a retrieval step, and a missed recall must not become
    // a failed plan. Read at plan start, so a `remember` earlier in the SAME
    // plan is already visible to the re-plan that follows it.
    const notes = this.placeNotesSection();
    if (notes) sections.push(notes);

    if (this.isDamped()) {
      sections.push(
        `Robot state: the base is DAMPED (FSM ${this.lastFsmId}, after an E-Stop). ` +
          `Locomotion commands are accepted in this state and do nothing. Plan a ` +
          `posture block with pose "stand" BEFORE any walk, turn or goto.`,
      );
    }
    return sections.join('\n\n');
  }

  /**
   * What the robot durably knows about the place it is standing in, capped for
   * the prompt. Empty string when the place is unknown, there is no workspace,
   * or nothing has been written about it — in all three cases the section is
   * omitted rather than rendered empty.
   */
  private placeNotesSection(): string {
    const placeId = this.scene.getPlace()?.id;
    if (!placeId || !this.memory) return '';
    try {
      return formatPlaceNotesSection(placeId, this.memory.placeExcerpt(placeId));
    } catch (err) {
      // An unreadable memory must not stop a plan from being made.
      console.warn(
        `[AgentMode] could not read the note for ${placeId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return '';
    }
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
    // The INTERRUPTING utterance sets the language from here on: whoever spoke
    // last is the one waiting for an answer. A typed interrupt (no language)
    // leaves the plan's existing one alone rather than silently switching the
    // robot back to English mid-conversation.
    if (pending.language) plan.language = pending.language;
    // `spoken` only ever goes one way. A typed interrupt after a spoken turn
    // does not make the plan typed again — the fail-closed direction, because
    // the remainder still carries content nobody in the room vouched for.
    if (pending.spoken) plan.spoken = true;

    const replanned = await this.planner.plan({
      command: pending.text,
      sceneSummary: this.plannerSceneSummary(),
      remainingPlan: remaining,
      ...(plan.language ? { language: plan.language } : {}),
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
    // The map fills in between looks only while the robot is actually moving;
    // a `speak` or `wait` block would just re-sample the same cloud.
    if (isMotionBlock(block.kind)) this.mapKeeper?.setSweeping(true);
    this.emit('agent:block:started', { plan: clonePlan(plan), block: { ...block } });
  }

  private finishBlock(plan: AgentPlan, block: AgentBlock, outcome: BlockOutcome): void {
    this.mapKeeper?.setSweeping(false);
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
    // never stall behind it. The journal tee inside `logBlock` runs
    // synchronously before that call, so it survives a process that dies here.
    void this.mirror.logBlock(plan.command, block, this.journalContext(plan));
    // A `remember` that just landed changed durable memory — say so, so the
    // panel is not showing a memory the robot no longer has.
    if (block.kind === 'remember' && block.status === 'done') this.emitMemoryDigest();
  }

  /**
   * Where the robot was when a block finished. Pulled at write time rather than
   * cached: a plan can cross a place boundary, and attributing a block to the
   * place the plan STARTED in would file it under the wrong aisle.
   */
  private journalContext(plan: AgentPlan): BlockJournalContext {
    const poseM = this.scene.getPoseM();
    const poseSource = this.scene.getPoseSource();
    return {
      planId: plan.id,
      place: this.scene.getPlace()?.id ?? null,
      pose:
        poseM && poseSource
          ? { x: poseM.x, y: poseM.y, yawDeg: this.scene.getYawDeg(), source: poseSource }
          : null,
    };
  }

  // ── identity + the sensorium (TASK-198) ───────────────────────────────────

  /**
   * Regenerate `BODY.md` from the embodiment config.
   *
   * Called at boot and again on every `embodiment:reloaded` — the loader is
   * already a Zod-validated, chokidar-watching singleton, so this is a
   * subscription rather than a parser. `undefined` is passed through honestly:
   * the file then says which tag was asked for and that everything else about
   * the body is unknown, instead of describing a robot nobody configured.
   */
  applyEmbodiment(embodiment: EmbodimentConfig | undefined): void {
    const robotType = config.robotType;
    const embodimentTag = EMBODIMENT_TAG_BY_ROBOT_TYPE[robotType] ?? 'generic';
    if (embodiment) {
      const groups = groupJointNames(embodiment.proprioception.joint_names);
      this.bodyFacts = {
        dof: embodiment.action.dim,
        // Only claimed when the joint names actually carry hand joints — the
        // one place a self-description could otherwise invent a manipulator.
        // Phrased as a share of the total so it does not read as 43 + 14.
        hands: groups.hand > 0 ? `${groups.hand} of those in my hands` : null,
      };
    } else {
      this.bodyFacts = null;
    }
    this.identity?.regenerateBody({ embodiment, robotType, embodimentTag });
  }

  /**
   * The ID card, or null when there is no identity store / the card is
   * unreadable. A garbled card is recorded in {@link identityProblem} and NEVER
   * substituted with a generic self.
   */
  identitySnapshot(): RobotIdentity | null {
    if (!this.identity) return null;
    try {
      const identity = this.identity.current();
      this.identityFault = null;
      return identity;
    } catch (err) {
      this.identityFault = err instanceof Error ? err.message : String(err);
      return null;
    }
  }

  /** Why the identity could not be read, or null when it could. */
  identityProblem(): string | null {
    // Force a load attempt so a caller asking only this still gets an answer.
    this.identitySnapshot();
    return this.identityFault;
  }

  /**
   * Who this robot is and what it has been through — the per-turn sensorium.
   *
   * `null` means there is no identity at all (no store, or a card that cannot
   * be read), which is deliberately distinguishable from a robot that simply
   * has not been named yet — that is `bootstrapRequired` on a present self.
   */
  selfState(): AgentSelfState | null {
    const identity = this.identitySnapshot();
    if (!identity || !this.identity) return null;
    this.syncPlace();
    if (this.lineage === null) {
      try {
        this.lineage = this.readLineage();
      } catch (err) {
        console.warn(
          `[AgentMode] could not read the boot lineage: ${err instanceof Error ? err.message : String(err)}`,
        );
        this.lineage = [];
      }
    }
    const battery = this.robotStateManager?.getState?.()?.batteryLevel;
    return computeSelfState({
      identity,
      bootstrapRequired: this.identity.needsBootstrap(),
      incarnations: this.lineage,
      bootId: this.bootId,
      startedAtMs: this.bootStartedAtMs,
      nowMs: Date.now(),
      journal: this.recentJournal(),
      memoryMarkdown: this.memory?.readMemory() ?? '',
      place: this.scene.getPlace()?.id ?? null,
      poseSource: this.scene.getPoseSource(),
      batteryPct: typeof battery === 'number' ? Math.round(battery) : null,
      controlOwner: this.lock.get(),
      damped: this.isDamped(),
      estopLatched: this.estopActive,
    });
  }

  /**
   * The robot's answer to "who are you?", or null when it has no self to
   * report. Templated from {@link selfState} — no model call, and every clause
   * checkable against a file on this disk.
   */
  selfReport(language: SpokenLanguage = 'en'): string | null {
    const self = this.selfState();
    if (!self) {
      return this.identityFault
        ? `I cannot tell you who I am: ${this.identityFault}`
        : null;
    }
    return describeSelf(
      {
        self,
        dof: this.bodyFacts?.dof ?? null,
        hands: this.bodyFacts?.hands ?? null,
        nowMs: Date.now(),
      },
      language,
    );
  }

  /**
   * Answer an identity question — or accept a name — WITHOUT planning.
   *
   * This is the wiring fix. `agent-executor.ts` short-circuits to Agent Mode
   * before the Genkit branch whenever the mode is on, and the profile this
   * whole line of work targets forces it on. Identity routed only into
   * `prompts/robot_agent.prompt` would therefore land in a code path that does
   * not execute in the shipped configuration. It also must not go through the
   * block planner: gemma3:4b is on the latency path and gets no identity and no
   * soul at all — persona belongs where there is no navigation to corrupt.
   *
   * @returns the reply, or null when the utterance is an ordinary command.
   */
  answerIdentityQuestion(text: string, language: SpokenLanguage = 'en'): string | null {
    const named = parseNamingUtterance(text);
    if (named) return this.nameSelf(named, language);
    if (!isIdentityQuestion(text)) return null;
    return this.selfReport(language);
  }

  /**
   * The naming ritual: the robot ASKS, an operator answers, the card is
   * written. It never picks a name for itself — that is the whole reason this
   * takes an operator utterance rather than defaulting.
   */
  nameSelf(name: string, language: SpokenLanguage = 'en'): string {
    const result = this.writeIdentity({ Name: name });
    if (!result.ok) {
      return language === 'de'
        ? `Ich konnte den Namen nicht speichern: ${result.message}`
        : `I could not keep that name: ${result.message}`;
    }
    return language === 'de'
      ? `Verstanden. Ab jetzt heiße ich ${result.identity.name}.`
      : `Understood. From now on I am ${result.identity.name}.`;
  }

  /**
   * Write back agent-writable ID-card labels. Never throws — the REST handler
   * and the naming ritual both need a returned refusal, and a refusal here
   * ("Unit is not agent-writable") is a fact the caller has to be told rather
   * than a crash.
   */
  writeIdentity(
    patch: Record<string, string | null | undefined>,
  ): { ok: true; identity: RobotIdentity } | { ok: false; message: string } {
    if (!this.identity) return { ok: false, message: 'this agent has no identity store' };
    try {
      const identity = this.identity.writeIdentityFields(patch);
      this.identityFault = null;
      this.emit('agent:state:changed');
      return { ok: true, identity };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * `SOUL.md` — voice, tone, boundaries. Human-authored; nothing in this
   * process writes it. Empty string when there is no identity store.
   */
  soulMarkdown(): string {
    return this.identity?.soul() ?? '';
  }

  /** `BODY.md` as generated at boot, or `''` before {@link applyEmbodiment}. */
  bodyMarkdown(): string {
    return this.identity?.bodyMarkdown() ?? '';
  }

  /**
   * Journal records for the 24 h counts, re-read at most once per TTL. The
   * counts fan out on every state event; re-reading two day files each time
   * would put a disk read on the UI's refresh path for numbers that change a
   * handful of times an hour.
   */
  private recentJournal(): JournalRecord[] {
    const now = Date.now();
    if (this.journalCache && now - this.journalCache.at < SELF_COUNTS_TTL_MS) {
      return this.journalCache.records;
    }
    let records: JournalRecord[] = [];
    try {
      records = this.journal?.readLastDays(2) ?? [];
    } catch (err) {
      console.warn(
        `[AgentMode] could not read the journal for the self-report: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.journalCache = { at: now, records };
    return records;
  }

  // ── durable memory (TASK-197) ─────────────────────────────────────────────

  /**
   * Counts, not content — see {@link AgentMemoryDigest}. `null` when this agent
   * has no workspace at all, which is not the same as an empty memory.
   */
  memoryDigest(): AgentMemoryDigest | null {
    if (!this.memory) return null;
    this.syncPlace();
    const memoryText = this.memory.readMemory();
    const places = this.memory.listPlaceNotes().map((id) => {
      const note = this.memory!.readPlaceNote(id);
      return { id, entries: listEntries(note).length, bytes: Buffer.byteLength(note, 'utf-8') };
    });
    return {
      robotId: this.robotId,
      place: this.scene.getPlace()?.id ?? null,
      memoryBytes: Buffer.byteLength(memoryText, 'utf-8'),
      memoryMaxBytes: MEMORY_MAX_BYTES,
      memoryEntries: listEntries(memoryText).length,
      places,
      journalDays: this.journal?.listDays() ?? [],
      retention: this.journalRetention,
      updatedAt: nowIso(),
    };
  }

  /** `MEMORY.md` verbatim, for `GET /robots/:id/memory.md`. */
  memoryMarkdown(): string {
    if (!this.memory) return '# Memory\n\n(this robot has no memory workspace configured)\n';
    const text = this.memory.readMemory();
    return text || '# Memory\n\n(nothing has been remembered yet)\n';
  }

  /**
   * Erase the workspace (GDPR Art. 17). Place notes, `MEMORY.md` and the whole
   * journal go; `AGENTS.md` and the place graph stay — see `Workspace.erase`.
   *
   * `redacted` is carried out alongside `removed` because the two are not the
   * same act and only one of them is a deletion: blanking `Operator` and `Site`
   * on `IDENTITY.md` leaves the file in place, so a workspace where that was the
   * only personal data answers `removed: 0` — which reads as "there was nothing
   * to erase" unless the redaction is reported too. `RobotMemoryErasureService`
   * records both against the GDPR request.
   */
  eraseMemory(): { ok: boolean; removed: number; redacted: number; errors: string[] } {
    if (!this.memory) {
      return { ok: false, removed: 0, redacted: 0, errors: ['no memory workspace configured'] };
    }
    const { removed, redacted, errors } = this.memory.erase();
    this.emitMemoryDigest();
    return { ok: errors.length === 0, removed: removed.length, redacted: redacted.length, errors };
  }

  /**
   * Record what the platform says governs the journal, and prune to it.
   *
   * Called at boot (and by whoever refreshes it). Never throws: a robot whose
   * platform is unreachable keeps journalling under the fallback window rather
   * than stopping.
   */
  applyJournalRetention(retention: JournalRetention): void {
    this.journalRetention = retention;
    try {
      this.journal?.prune(retention);
    } catch (err) {
      console.warn(
        `[AgentMode] journal prune failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private emitMemoryDigest(): void {
    const memory = this.memoryDigest();
    if (memory) this.emit('agent:memory:updated', { memory });
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
    this.startProactivePlan(
      '(idle) a person appeared',
      [
        {
          kind: 'greet',
          params: { text: 'Hello! I am ready whenever you have a job for me.' },
          reasoning: `A person became visible: ${observation.currentView}`,
        },
      ],
      'greet',
    );
  }

  /**
   * Everything {@link mayInitiate} needs, from the same cached state
   * {@link heartbeatSnapshot} reads. Assembled here so the initiative gate and
   * the heartbeat can never disagree about what the robot knows about itself.
   */
  private initiativeContext(): InitiativeContext {
    const belief = this.robotStateManager?.getPlaceBelief?.() ?? null;
    const battery = this.robotStateManager?.getState?.()?.batteryLevel;
    return {
      estopLatched: this.latchedEstop() !== null,
      crashAcknowledged: this.isCrashAcknowledged(),
      batteryPercent: typeof battery === 'number' ? battery : null,
      place: belief?.place?.id ?? null,
      placeAgeMs: belief?.ageMs ?? null,
      damped: this.isDamped(),
    };
  }

  /**
   * The ONE path a plan the robot started BY ITSELF takes.
   *
   * The greet has always run this way; TASK-199's heartbeat joins it rather
   * than getting a path of its own, because a second execution path is a second
   * place where `isIdleWatchEligible()` and the control lock can be forgotten.
   * `skipPlanning` is true throughout: everything self-initiated is built from
   * a template, so there is no planner round-trip to hallucinate motion into.
   *
   * And it is where {@link mayInitiate} is asked, for EVERY origin. It used to
   * be asked only by `HeartbeatMonitor.runTierOne`, so the gate covered the
   * heartbeat and not the greet — while `greet` is not speak-only: it issues a
   * real right-arm `wave` to the sidecar. A robot brought back by `kill -9`
   * therefore held its heartbeat correctly and still waved at the first person
   * to walk past its camera, with nobody having acknowledged the unclean
   * shutdown. The heartbeat still asks the gate itself, one tick earlier, so it
   * can journal the refusal in the robot's own words; asking twice is free
   * (`mayInitiate` is pure) and the duplication is the cheap direction.
   *
   * @returns false when it did not start (not eligible, refused by the
   *          initiative gate, or control is busy). Not an error — something
   *          else took the robot in the meantime, or it is not in a state to
   *          volunteer.
   */
  private startProactivePlan(
    command: string,
    blocks: PlannedBlock[],
    origin: 'greet' | 'heartbeat',
  ): boolean {
    if (!this.isIdleWatchEligible()) return false;

    const context = this.initiativeContext();
    for (const block of blocks) {
      const verdict = mayInitiate(block.kind, 'self', context);
      if (!verdict.ok) {
        // Said once per refusal, not per tick: proactive plans are edge-driven
        // (a person appearing, a tier-1 pass that already rate-limits itself).
        console.log(`[AgentMode] not starting "${command}": ${verdict.reason}`);
        this.writeJournal(
          heartbeatJournalRecord({
            at: nowIso(),
            place: this.scene.getPlace()?.id ?? null,
            trust: 'self',
            msg: `refused ${origin}: ${verdict.reason}`,
          }),
        );
        return false;
      }
    }

    const claim = this.lock.claim('agent');
    if (!claim.ok) return false;

    const plan: AgentPlan = {
      id: uuidv4(),
      robotId: this.robotId,
      command,
      blocks: blocks.map((b) => this.toBlock(b)),
      cursor: -1,
      status: 'running',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.plan = plan;
    this.abortRequested = false;
    this.abortReason = null;
    this.planFinalized = false;
    // Both set BEFORE the first block runs: this is what makes a `remember`
    // inside an unattended cycle `untrusted`, and it must be true for the whole
    // plan. `selfInitiatedPlanId` covers the greet too — nobody asked for that
    // one either, so nothing it produces may be filed as an operator's word.
    this.selfInitiatedPlanId = plan.id;
    if (origin === 'heartbeat') this.heartbeatPlanId = plan.id;
    this.emit('agent:plan:started', { plan: clonePlan(plan) });

    this.runPromise = this.runPlan(plan, true).finally(() => {
      this.runPromise = null;
      if (this.heartbeatPlanId === plan.id) this.heartbeatPlanId = null;
      if (this.selfInitiatedPlanId === plan.id) this.selfInitiatedPlanId = null;
    });
    return true;
  }

  // ── heartbeat (TASK-199) ──────────────────────────────────────────────────

  /**
   * Everything the tier-0 predicates read, and NOTHING that costs anything.
   *
   * Every field below is already in memory: the place belief is maintained by
   * the 2 s `HardwareClient` pose poll (TASK-195), the scene came from the last
   * frame the idle watcher took, the rest are this controller's own flags. No
   * model call and no HTTP request happens here, and there is a test that
   * asserts exactly that — `getLocoOdometry()` in particular must never be
   * reached from a tick.
   */
  private heartbeatSnapshot(): HeartbeatSnapshot {
    const belief = this.robotStateManager?.getPlaceBelief?.() ?? null;
    const battery = this.robotStateManager?.getState?.()?.batteryLevel;
    return {
      nowMs: Date.now(),
      crashAcknowledged: this.isCrashAcknowledged(),
      estopLatched: this.latchedEstop() !== null,
      batteryPercent: typeof battery === 'number' ? battery : null,
      damped: this.isDamped(),
      pose: {
        poseKnown: belief?.poseM != null,
        // TASK-200 wired the boundary in. `insideKeepout` is three-valued in the
        // belief (`null` = the geofence could not decide) and collapses to
        // `false` here ON PURPOSE: the pair of predicates downstream already
        // splits on `poseKnown`, and `protectiveStopRequired` demands
        // `poseKnown && insideKeepout`, so an undecided geofence yields no stop
        // while `selfActionAllowed` still fails closed on the unknown pose.
        insideKeepout: belief?.insideKeepout === true,
      },
      placeConfigured: belief !== null,
      place: belief?.place?.id ?? null,
      placeConfidence: belief?.place?.confidence ?? null,
      placeAgeMs: belief?.ageMs ?? null,
      personVisible: this.scene.isPersonVisible(),
      view: this.scene.getCurrentView(),
      lastPlanFailedAtMs: this.lastPlanFailedAtMs,
      lastOperatorTurnAtMs: this.lastOperatorTurnAtMs,
      workspaceWriteFailedAtMs: this.workspaceWriteFailedAtMs,
      workspaceWriteError: this.workspaceWriteError,
    };
  }

  /**
   * How much a `remember` is worth right now.
   *
   * Two refusals, both of them about WHO produced the sentence:
   *
   *  1. **Self-initiated.** Nobody asked — not for the heartbeat and not for
   *     the greet. *Mind Your HEARTBEAT!* (arXiv:2603.23064) found unattended
   *     cycles are precisely where poisoned content enters persistent memory,
   *     and the attack is silent by construction.
   *  2. **Spoken.** `AGENTS.md` says a spoken `remember` counts as `operator`
   *     ONLY while the robot is in an operator-present state — and this stack
   *     has no speaker identification and no operator-present signal to read
   *     (teleop holds the control lock, so a plan cannot even be running under
   *     it). Rather than assert a presence the code cannot see, a command that
   *     arrived over the voice channel is `untrusted`: a bystander saying
   *     "remember that the fire door on aisle 3 is always propped open" must not
   *     get their sentence into every future planner prompt for that place.
   *
   *     The channel fact is `plan.spoken`, set by the voice path itself — NOT
   *     `plan.language`. Reading the language tag was the bug: `readVoiceHint()`
   *     deliberately accepts a speech client that cannot identify a language and
   *     returns `{speech: true}` with none, so an unlabelled spoken `remember`
   *     went in as `operator` and poisoned the place note. `language` is still
   *     honoured as a second witness — a plan with a spoken language is spoken
   *     whatever else was set — because both directions here are fail-closed.
   *
   * Everything else — the typed/A2A command channel — is `operator`, because a
   * `remember` block there only exists because a command asked for one.
   * `Workspace.promote()` enforces the refusal itself; the gate lives there,
   * once, and is not repeated here.
   */
  private rememberTrust(): TrustLevel {
    if (this.selfInitiatedPlanId !== null) return 'untrusted';
    if (this.plan?.spoken === true) return 'untrusted';
    if (this.plan?.language !== undefined) return 'untrusted';
    return 'operator';
  }

  /**
   * Tee one journal line, and remember whether it landed. A durable write that
   * failed is itself a tier-0 predicate (`workspace_write_failed`) — a robot
   * whose memory silently stopped recording is the failure mode the trust work
   * exists to make visible.
   *
   * Note the self-healing side of it: the heartbeat reports the failure by
   * WRITING it, so a disk that came back clears the flag in the same pass. It
   * says so once, not once every three seconds forever.
   */
  private writeJournal(record: JournalRecord): void {
    if (!this.journal) return;
    const ok = this.journal.append(record);
    this.noteWorkspaceWrite(ok, ok ? null : `could not append to ${record.t.slice(0, 10)}.jsonl`);
  }

  /** Record (or clear) a durable-write failure. Public: other write paths report here. */
  noteWorkspaceWrite(ok: boolean, error: string | null = null): void {
    if (ok) {
      this.workspaceWriteFailedAtMs = null;
      this.workspaceWriteError = null;
      return;
    }
    this.workspaceWriteFailedAtMs ??= Date.now();
    this.workspaceWriteError = error;
  }

  /** The standing intents this robot holds, or null when it has no workspace. */
  standingIntents(): IntentStore | null {
    return this.intents;
  }

  /** An operator did something. Feeds `plan_failed_idle`. */
  private noteOperatorTurn(): void {
    this.lastOperatorTurnAtMs = Date.now();
  }

  /**
   * Remember how the last plan ended, for `plan_failed_idle`.
   *
   * A plan the HEARTBEAT started is deliberately not recorded: a failed
   * proactive plan that made the robot proactive again is the runaway loop this
   * feature is not allowed to have. An abort clears the marker too — somebody
   * pressed something, so the failure is no longer unattended.
   */
  private notePlanOutcome(plan: AgentPlan): void {
    if (this.heartbeatPlanId === plan.id) return;
    if (plan.status === 'failed') this.lastPlanFailedAtMs = Date.now();
    else if (plan.status === 'done' || plan.status === 'aborted') this.lastPlanFailedAtMs = null;
  }

  // ── events ────────────────────────────────────────────────────────────────

  /**
   * Tell the server mirror we are still here, when nothing else has (TASK-200).
   *
   * The mirror only moves on a push, so a snapshot from a process that has
   * since DIED stays there forever and is served as this robot's current state
   * — observed live: a duplicate agent booted, pushed one state event, died on
   * EADDRINUSE, and the console then showed its incarnation, battery and uptime
   * as the running robot's for over an hour. Re-asserting on a clock is what
   * bounds that to one interval.
   *
   * Deliberately NOT routed through {@link emit}: local subscribers (the
   * robot-agent's own WebSocket, the A2A executor) get events when something
   * HAPPENS, and a periodic heartbeat is not an event. This goes to the mirror
   * only — fire-and-forget, transport errors swallowed by contract — and reads
   * nothing but in-process state, so a dead sidecar cannot make the tick block.
   *
   * It carries NO plan and NO scene — see {@link livenessState}. The server
   * fans this straight out to every connected app client, so the payload has to
   * be limited to what a heartbeat can honestly assert about a moment that has
   * already passed by the time it lands.
   */
  private remirrorState(): void {
    const now = this.now();
    if (now - this.lastStatePushedAtMs < this.mirrorRepushIntervalMs) return;
    this.lastStatePushedAtMs = now;
    this.mirror.emit({
      type: 'agent:state:changed',
      robotId: this.robotId,
      timestamp: nowIso(),
      state: this.livenessState(),
    });
  }

  /**
   * {@link getState} minus the plan and the scene — the re-assertion payload.
   *
   * The push is fire-and-forget, so a snapshot taken at T can be INGESTED after
   * an event emitted at T+ε. With the plan aboard, the last live-observed
   * failure was: the final block finishes, `agent:plan:finished` (`done`) is
   * posted and ingested first, the heartbeat POST lands 2 ms later carrying
   * `running` — and since no further event exists for a finished plan, every
   * console shows it executing forever. A heartbeat that started a new plan
   * inside that window is worse still: the operator watches the OLD plan's
   * blocks for the whole run of the new one.
   *
   * Rest-stripped rather than hand-listed, so a field added to {@link getState}
   * rides along with the heartbeat by default; only `plan` and `scene` — the
   * two fields that carry their own event — are held back.
   */
  private livenessState(): AgentModeLivenessState {
    const { plan: _plan, scene: _scene, ...liveness } = this.getState();
    return liveness;
  }

  private emit(
    type: AgentModeEventType,
    extra: Partial<Pick<AgentModeEvent, 'plan' | 'block' | 'scene' | 'memory'>> = {}
  ): void {
    const event: AgentModeEvent = {
      type,
      robotId: this.robotId,
      timestamp: nowIso(),
      ...extra,
    };
    if (type === 'agent:state:changed') {
      event.state = this.getState();
      // A real state change IS a re-assertion, so the periodic one waits
      // another full interval. Without this an active robot would push twice
      // for the same fact.
      this.lastStatePushedAtMs = this.now();
    }

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
