/**
 * @file state.ts
 * @description Robot state management facade - coordinates state, commands, simulation, tasks, and safety
 * @feature robot
 * @status live
 */

import type {
  SimulatedRobotState,
  RobotConfig,
  Robot,
  RobotTelemetry,
  RobotCommand,
  CommandResult,
  CommandType,
  RobotLocation,
  PushedTask,
  Zone,
  RobotType,
  PointCloudFrame,
  PointCloudPose,
  TelemetryFieldGroup,
} from './types.js';
import { FOOTPRINT_RADIUS_M } from './types.js';
import { generateTelemetry } from './telemetry.js';
import { generateSyntheticScan, LIVE_POINTS_PER_FRAME } from './pointcloud-sim.js';
import { PointCloudReplaySource } from './pointcloud-replay.js';
import { createScanRoom, generatePosedScan, seedFromString, type ScanRoom } from './scan-sim.js';
import { getJointConfig } from './joint-configs/index.js';
import type { JointConfig } from './types.js';
import { StatePublisher, type StateListener } from './StatePublisher.js';
import { CommandExecutor } from './CommandExecutor.js';
import { hardwareClient, HardwareActionError, type CachedBasePose } from '../hardware/HardwareClient.js';
import { controlOwnerLock } from '../agent-mode/control-owner.js';
import {
  PlaceTracker,
  loadPlaceGraph,
  toScenePlace,
  type Place,
  type PlaceGraph,
  type PlaceObservation,
} from '../agent-mode/place-resolver.js';
import { evaluateGeofence } from '../agent-mode/geofence.js';
import { assessFrameRegistration, type FrameRegistration } from '../agent-mode/place-frame.js';
import { PlaceGraphSource } from '../agent-mode/place-graph-source.js';
import type { PoseSource } from '../agent-mode/scene-memory.js';
import type { ScenePlace } from '../agent-mode/types.js';
import { SkillExecutor, skillExecutorRegistry } from '../vla/skill-executor.js';
import { SimulationEngine } from './SimulationEngine.js';
import { TaskQueue } from './TaskQueue.js';
import {
  SafetyMonitor,
  type SafetyStatus,
  type SafetyEvent,
  type SafetyEventCallback,
  type EStopState,
  type GeofenceStatus,
  type OperatingMode,
  type StopActuation,
} from '../safety/index.js';
import {
  VLAModelManager,
  type ModelSwitchRequest,
  type ModelSwitchResult,
  type VLAInferenceMetrics,
} from '../vla/vla-model-manager.js';
import type { VLAStatus, VLAControllerConfig } from '../vla/types.js';
import {
  EmbodimentLoader,
  JointMapper,
  CameraConfigManager,
  DepthSensorManager,
  type EmbodimentConfig,
  type DepthSensorSpec,
} from '../embodiment/index.js';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  StatePersistence,
  defaultPersistedAgentState,
  PERSISTED_STATE_VERSION,
  PLACE_STALE_MS,
  type PersistedAgentState,
  type PersistedState,
} from './StatePersistence.js';
import { config as appConfig } from '../config/config.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const SIMULATION_CONFIG = {
  tickIntervalMs: 100,
  speedUnitsPerSecond: 2.0,
  batteryDrainPerSecond: 0.01,
  batteryChargePerSecond: 0.5,
};

const TASK_QUEUE_CONFIG = {
  maxQueueSize: 5,
};

const SAFETY_CONFIG = {
  communicationTimeoutMs: 30000, // 30 second timeout (was 1s — too short, caused immediate PROTECTIVE STOP)
  maxManualSpeedMmPerSec: 250,  // ISO 10218-1 limit
  maxAutoSpeedMmPerSec: 1500,
  forceLimitN: 140,              // Conservative default
  estopRequiresManualReset: true,
};

// Open-ended VLA control run (the /vla/start REST surface): generous bounds so
// an operator-triggered run doesn't die early — stopVLAControl aborts anytime.
const VLA_CONTROL_MAX_STEPS = 1000;
const VLA_CONTROL_TIMEOUT_MS = 10 * 60_000;

/**
 * Warnings that belong to an E-Stop / protective stop. These are the ones that
 * must NEVER be restored without the latch that justifies them — the same
 * substrings `SafetyMonitor.resetEmergencyStop()` clears.
 */
function isStopWarning(warning: string): boolean {
  return warning.includes('Emergency stop') || warning.includes('Protective stop');
}

/** Age of a persisted snapshot in ms, or null when `savedAt` is unusable. */
function snapshotAgeMs(savedAt: string): number | null {
  const saved = Date.parse(savedAt);
  if (!Number.isFinite(saved)) return null;
  return Math.max(0, Date.now() - saved);
}

/**
 * Remove a field group from a telemetry frame's `simulated` list — called when
 * real hardware data replaced that group's values (contract §3 semantics).
 */
function markGroupReal(telemetry: RobotTelemetry, group: TelemetryFieldGroup): void {
  if (telemetry.simulated) {
    telemetry.simulated = telemetry.simulated.filter((g) => g !== group);
  }
}

// Humanoid fall/tilt poll cadence (ms). IMU/leg-joint state is read over HTTP
// from the hardware sidecar, so this runs slower than the in-process 100Hz
// safety tick. 20Hz is a reasonable detection cadence for a fall-NET; on real
// hardware the IMU should ideally be read in-process at ≥100Hz (HARDWARE GAP).
const HUMANOID_SAFETY_POLL_MS = 50;

/**
 * Thrown by `startVLAControl()` when another owner (Agent Mode, a human at the
 * teleop controls) holds exclusive control. Distinct from a generic start
 * failure so the REST layer can answer 409 instead of 500 — and so the caller
 * knows it never owned the lock and must not release it.
 */
export class ControlBusyError extends Error {
  /** Honest, human-readable reason from the arbitration lock. */
  readonly reason: string;

  constructor(reason: string) {
    super(`Control is busy: ${reason}`);
    this.name = 'ControlBusyError';
    this.reason = reason;
  }
}

/**
 * Everything the robot currently believes about WHERE IT IS (TASK-195), in one
 * object so a consumer cannot pick up the place without the pose it rests on.
 *
 * Every field is independently nullable and `null` always means UNKNOWN. There
 * is no "last known" variant of any of them: a robot that has lost its pose has
 * lost its place, and saying otherwise is how an operator is told the robot is
 * in STAGING while a human has teleoperated it into AISLE-3.
 */
export interface PlaceBelief {
  /** Wire-shaped place, or null for UNKNOWN. */
  place: ScenePlace | null;
  /** Metric position in the place graph's frame, or null. */
  poseM: { x: number; y: number } | null;
  /** Provenance of that position — never presented as measured when it is not. */
  poseSource: PoseSource | null;
  /** Accumulated translation since the last re-anchor, in metres, or null. */
  driftSinceAnchorM: number | null;
  /** Age of the belief in ms, or null when there is none. */
  ageMs: number | null;
  /**
   * Whether the robot is inside a margined keepout (TASK-200). THREE-valued on
   * purpose: `true` / `false` are answers a known, trusted pose supports, and
   * `null` means the geofence could not decide — no pose, or a pose past its
   * drift budget. A consumer that collapses `null` into `false` has turned
   * "I cannot see the robot" into "the robot is safe".
   */
  insideKeepout: boolean | null;
}

/**
 * Something that has to STOP DRIVING when the safety monitor takes a stop.
 * Synchronous on purpose — see {@link RobotStateManager.onSafetyStop}.
 */
export type SafetyStopListener = (stop: StopActuation) => void;

/**
 * Why the teleop pose is not reaching the robot, as a code an operator UI can
 * render without parsing prose.
 *
 * `action_rejected` = the sidecar answered and said no (read-only mode, an
 * unknown joint name); `sidecar_down` = nothing answered at all. The
 * distinction is the whole point: the first is a setting somebody can change,
 * the second is a cable or a process.
 */
export type TeleopErrorCode = 'action_rejected' | 'sidecar_down';

export interface TeleopError {
  code: TeleopErrorCode;
  message: string;
}

/**
 * Notified when a teleop frame fails to reach the hardware.
 *
 * A seam rather than a console line, because the operator who needs to know is
 * wearing a headset and will never see a server log. Fired on EVERY failed
 * frame, not once per session: a socket that connects after the sidecar already
 * broke still has to be told, and the socket layer dedupes per code.
 */
export type TeleopErrorListener = (err: TeleopError) => void;

// ============================================================================
// ROBOT STATE MANAGER
// ============================================================================

/**
 * RobotStateManager - Facade coordinating robot state, commands, simulation, tasks, and safety
 */
export class RobotStateManager {
  private state: SimulatedRobotState;
  private publisher: StatePublisher;
  private commandExecutor: CommandExecutor;
  private simulation: SimulationEngine;
  private taskQueue: TaskQueue;
  private safetyMonitor: SafetyMonitor;
  private vlaModelManager: VLAModelManager;
  // Local VLA state — a background SkillExecutor run started via /vla/start.
  private vlaActiveLocal = false;
  private vlaInstructionLocal = '';
  /** Registry key of the active VLA-control SkillExecutor run (null = none). */
  private vlaSkillId: string | null = null;
  /**
   * Registry key of the run that currently holds `controlOwnerLock` for `vla`.
   * Tracked separately from `vlaSkillId` so a run that is stopped early (which
   * clears `vlaSkillId` immediately) still releases exactly its own claim, and
   * a late-settling run can never release a *newer* rollout's lock.
   */
  private vlaLockSkillId: string | null = null;
  /** Monotonic counter making every VLA run id unique (see startVLAControl). */
  private vlaRunSeq = 0;

  // Keyboard teleop override — when active, the simulated joints follow operator
  // input instead of the idle/walk animation. Map of joint name -> position (rad).
  private teleopJoints: Map<string, number> | null = null;

  // Embodiment integration (Task 51)
  private jointMapper: JointMapper;
  private cameraConfigManager: CameraConfigManager;
  private depthSensorManager: DepthSensorManager;

  // Point-cloud frame counter (monotonic, for drop detection on the stream)
  private pointCloudSequence = 0;

  // Real-recording replay source: undefined = unchecked, null = none configured.
  private replaySource: PointCloudReplaySource | null | undefined = undefined;

  // Active digital-twin scan session. Holds ONE fixed room (centered on the
  // twin's world origin = the robot's pose when scanning started) so successive
  // pose-stamped frames accumulate into a single map as the robot walks. Poses
  // are expressed relative to (originX, originY).
  private activeScan:
    | { sessionId: string; room: ScanRoom; startedAt: string; frames: number; originX: number; originY: number }
    | null = null;

  // State persistence (Task 39)
  private persistence: StatePersistence;

  // Durable safety state (TASK-196). `agentState` is the live snapshot written
  // to disk; `restoredAgentState` is what was read at boot, kept separately so
  // Agent Mode can re-latch itself from it without racing later transitions.
  private agentState: PersistedAgentState = defaultPersistedAgentState();
  private restoredAgentState: PersistedAgentState | null = null;

  // Place awareness (TASK-195). Null tracker = no PLACE_GRAPH_PATH configured,
  // in which case nothing subscribes to the pose feed and every place answer is
  // UNKNOWN — the honest state for a robot nobody handed a survey to.
  private placeTracker: PlaceTracker | null = null;
  private placeBelief: PlaceBelief | null = null;
  private unsubscribePose: (() => void) | null = null;
  /** The graph the geofence fences against (TASK-200). Null = no graph loaded. */
  private placeGraph: PlaceGraph | null = null;
  /**
   * Whether the graph's frame is registered to the frame the robot's pose
   * arrives in. Null = no graph. See {@link assessFrameRegistration}.
   */
  private placeFrame: FrameRegistration | null = null;
  /** Logged once per graph so an unregistered frame is visible, not silent. */
  private placeFrameWarned = false;
  /**
   * True when an operator re-anchor landed while a `zone_violation` stop was
   * latched. See {@link evaluateGeofenceForPose} — it is what stops a declared
   * PLACE from being read as evidence of CLEARANCE.
   */
  private reanchoredUnderZoneStop = false;

  /** Subscribers that must stop driving when a safety stop fires. */
  private safetyStopListeners = new Set<SafetyStopListener>();

  // Humanoid fall/tilt poll loop handle (null when not running / arm embodiment)
  private humanoidSafetyTimer: NodeJS.Timeout | null = null;
  /** Guards the humanoid safety loop against overlapping in-flight IMU fetches. */
  private imuPollInFlight = false;
  /** Latch so a protective stop propagates to the motion path once, not every tick. */
  private estopPropagated = false;

  constructor(config: RobotConfig) {
    // Initialize state
    const now = new Date().toISOString();
    this.state = {
      id: config.id,
      name: config.name,
      model: config.model,
      // Deterministic sim serial: derived from the robot id, NOT a per-boot
      // timestamp, so the agent and the server's fleet record agree across
      // restarts. When real hardware fronts this agent, getRobotInterface
      // reports 'unknown' instead of any fake SIM- value.
      serialNumber: `SIM-${config.id}`,
      robotClass: config.robotClass,
      robotType: config.robotType,
      maxPayloadKg: config.maxPayloadKg,
      description: config.description,
      status: 'online',
      batteryLevel: 95 + Math.random() * 5,
      location: { ...config.initialLocation, heading: 0 },
      capabilities: config.capabilities,
      firmware: 'sim-v1.0.0',
      ipAddress: '127.0.0.1',
      speed: 0,
      lastSeen: now,
      createdAt: now,
      updatedAt: now,
      errors: [],
      warnings: [],
    };

    // Initialize publisher
    this.publisher = new StatePublisher();

    // Create state accessor and updater functions
    const stateGetter = () => this.state;
    const stateUpdater = (updater: (state: SimulatedRobotState) => void) => {
      updater(this.state);
    };
    const changeNotifier = () => this.notifyListeners();

    // Initialize command executor
    this.commandExecutor = new CommandExecutor(
      { speedUnitsPerSecond: SIMULATION_CONFIG.speedUnitsPerSecond },
      stateGetter,
      stateUpdater
    );

    // Initialize simulation engine
    this.simulation = new SimulationEngine(
      stateGetter,
      stateUpdater,
      changeNotifier,
      SIMULATION_CONFIG
    );

    // Initialize task queue with command functions
    this.taskQueue = new TaskQueue(
      stateGetter,
      stateUpdater,
      changeNotifier,
      {
        moveTo: (loc) => this.moveTo(loc),
        pickup: (id) => this.pickup(id),
        drop: () => this.drop(),
        goToCharge: () => this.goToCharge(),
        returnHome: () => this.returnHome(),
        stop: () => this.stop(),
      },
      TASK_QUEUE_CONFIG
    );

    // Initialize safety monitor. For humanoids (G1/G1-EDU/H1) also pass the
    // embodiment + leg-joint travel limits so the SafetyMonitor can run its
    // fall/tilt safety net; arms (so101) get the unchanged ARM-shaped behavior.
    // NOTE: limits are resolved once here from the static embodiment joint
    // config (empty for arms / generic → net stays inert).
    this.safetyMonitor = new SafetyMonitor(
      stateGetter,
      stateUpdater,
      changeNotifier,
      SAFETY_CONFIG,
      {
        robotType: this.state.robotType,
        legJointLimits: getJointConfig(this.state.robotType)
          .filter((j) => /hip|knee|ankle/.test(j.name))
          .map((j) => ({
            name: j.name,
            limitLower: j.limitLower,
            limitUpper: j.limitUpper,
          })),
      }
    );

    // A stop that only writes a warning string is a witness statement, not a
    // stop. THIS is what makes the geofence (and every other protective stop)
    // reach the machine — see `actuateSafetyStop`.
    this.safetyMonitor.setStopActuator((stop) => this.actuateSafetyStop(stop));

    // Initialize VLA model manager (Task 47)
    this.vlaModelManager = new VLAModelManager();

    // Initialize embodiment utilities (Task 51)
    this.jointMapper = new JointMapper();
    this.cameraConfigManager = new CameraConfigManager();
    this.depthSensorManager = new DepthSensorManager();

    // Initialize state persistence — per-robot file to support multi-instance
    this.persistence = new StatePersistence(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), `../../data/state-${appConfig.robotId}.json`)
    );
    this.restorePersistedState();

    // TASK-194 arbitration: teleop preempting `vla` must STOP the rollout, not
    // just relabel the lock — the SkillExecutor closed loop knows nothing about
    // the lock and would keep POSTing actions under the operator's hands, and
    // once the last teleop socket closed the lock read `idle` while the rollout
    // still ran, letting Agent Mode claim it for a second concurrent driver.
    // Mirrors the Agent Mode controller's own takeover subscription.
    controlOwnerLock.subscribe((change) => {
      if (change.preempted && change.previous === 'vla' && change.next === 'teleop') {
        console.warn('[RobotStateManager/VLA] Teleop took over — aborting the VLA rollout');
        void this.stopVLAControl();
      }
    });

    this.initPlaceAwareness();
  }

  // ============================================================================
  // PLACE AWARENESS (TASK-195)
  // ============================================================================

  /**
   * Load the place graph and hook the pose feed up to the resolver.
   *
   * The pose comes from `HardwareClient`'s existing 2 s poll — NOT from
   * `BlockExecutor`, which already reads odometry before and after every walk
   * and is the tempting seam. Teleop and VLA rollouts never touch a block, so a
   * place derived from block completions goes stale silently the moment a human
   * takes the controls; sampling on the poll makes place correct under teleop,
   * under VLA, and while the agent is idle, for free.
   *
   * With neither `PLACE_GRAPH_PATH` nor `PLACE_TWIN_ID` this subscribes to
   * nothing at all — no tracker, no listener, no behaviour change whatsoever for
   * the SO-101 and room-scene profiles.
   *
   * TASK-200 adds the second source: a real site's places, generated from a
   * `DigitalTwin`'s zones and served by the platform. It boots from the DISK
   * CACHE and refreshes in the background, because Agent Mode's contract is that
   * the server being down never stalls anything — a robot that waits on the
   * network to find out where it is has already lost the argument. An explicit
   * local `PLACE_GRAPH_PATH` still wins: it is the sim/bench escape hatch.
   */
  private initPlaceAwareness(): void {
    const graphPath = appConfig.place.graphPath;
    const twinId = appConfig.place.twinId;
    if (!graphPath && !twinId) return;

    if (graphPath) {
      try {
        this.adoptPlaceGraph(loadPlaceGraph(graphPath), graphPath);
      } catch (err) {
        // Loud and inert. A broken map must not be indistinguishable from a robot
        // that has genuinely walked off the map, and it must not stop the agent
        // from booting either — everything else about this robot still works.
        console.error(
          `[RobotStateManager] Place graph ${graphPath} could not be loaded — place stays UNKNOWN:`,
          err instanceof Error ? err.message : err,
        );
        return;
      }
    } else if (twinId) {
      const source = new PlaceGraphSource({
        serverUrl: appConfig.serverUrl,
        twinId,
        cachePath: appConfig.place.cachePath,
      });
      const cached = source.loadCached();
      if (cached) this.adoptPlaceGraph(cached, `${source.cacheFile} (cache)`);
      else {
        console.warn(
          `[RobotStateManager] No cached place graph for twin ${twinId} — place stays UNKNOWN ` +
            'until the platform answers',
        );
      }
      // Fire-and-forget: nothing waits on it, and a failure leaves the cached
      // graph (or no graph) exactly as it was.
      void source
        .refresh()
        .then((result) => {
          if (result.origin === 'server' && result.graph) {
            this.adoptPlaceGraph(result.graph, source.url);
          }
        })
        .catch(() => {
          /* refresh() never rejects; this is belt and braces. */
        });
    }

    this.unsubscribePose = hardwareClient.onPoseSample((pose) => this.onPoseSample(pose));
    // The resolver now owns the robot's position, so the 10 Hz simulated zone
    // writer stands down as soon as a real pose has arrived. See
    // `SimulationEngine.setPoseAuthority`.
    this.simulation.setPoseAuthority(() => this.placeBelief?.poseM != null);
  }

  /**
   * Install a place graph — at boot, or later when the platform's copy arrives.
   *
   * Replacing the tracker deliberately discards the accumulated drift: the new
   * graph may describe a different frame, and carrying "22 m since the last
   * anchor" across that boundary would attach a number measured in one frame to
   * a belief expressed in another. The robot comes up `confident` in the new
   * graph, which is what an operator who just re-surveyed the site expects.
   */
  private adoptPlaceGraph(graph: PlaceGraph, origin: string): void {
    this.placeGraph = graph;
    this.placeTracker = new PlaceTracker({
      graph,
      hysteresisMarginM: appConfig.place.hysteresisMarginM,
      driftBudgetM: appConfig.place.driftBudgetM,
    });
    // A new graph is a new frame question, so the answer — and the "we told the
    // operator" latch — are recomputed rather than inherited.
    this.placeFrame = assessFrameRegistration(graph);
    this.placeFrameWarned = false;
    const fences = graph.places.filter((p) => p.keepout).length;
    console.log(
      `[RobotStateManager] Place graph loaded: ${graph.places.length} places ` +
        `(${fences} keepout) in frame '${graph.frame.id}' (${origin})`,
    );
    if (!this.placeFrame.registered) this.warnUnregisteredFrame();
  }

  /**
   * Say, once per graph, that the map cannot be compared with the pose.
   *
   * Once and not per sample: this fires at 0.5 Hz off the pose poll, and a log
   * line every two seconds is how an operator learns to stop reading the log.
   */
  private warnUnregisteredFrame(): void {
    if (this.placeFrameWarned || this.placeFrame?.registered !== false) return;
    this.placeFrameWarned = true;
    console.warn(`[RobotStateManager] PLACE FRAME NOT REGISTERED — ${this.placeFrame.reason}`);
  }

  /**
   * Whether this robot's pose may be compared with its place graph at all, or
   * null when no graph is loaded (in which case there is no frame to register).
   *
   * Operator-facing: a `registered: false` here is the reason every place reads
   * UNKNOWN and the geofence never fences, and it must be answerable without
   * reading the log.
   */
  getPlaceFrameRegistration(): FrameRegistration | null {
    return this.placeFrame;
  }

  /**
   * One pose sample from the hardware poll — possibly `null`, which is a
   * routine event on this stack (`getLocoOdometry()` has a 2 s timeout and
   * returns null on any hiccup) and is treated as UNKNOWN, never as "carry on
   * with the last one".
   */
  private onPoseSample(pose: CachedBasePose | null): void {
    const tracker = this.placeTracker;
    if (!tracker) return;

    // FAIL CLOSED on an unregistered frame (TASK-200 review). The pose is real
    // and keeps driving `location.x/y/heading` — it is the MAP that cannot be
    // compared with it, so the resolver is not consulted at all rather than
    // being consulted and disbelieved. See `agent-mode/place-frame.ts`.
    const frameBlocked = this.placeFrame !== null && !this.placeFrame.registered;
    if (frameBlocked) this.warnUnregisteredFrame();

    // Geometry answers nothing in an unregistered frame. An operator's
    // declaration is not geometry — a human who can see the robot does not need
    // the two frames registered — so it survives, and only it. What it does NOT
    // survive is unbounded motion: `updateUnregisteredFrame` keeps the sample
    // out of the map and still feeds the drift budget, because odometry
    // translation is frame-independent. Reading `tracker.current()` here instead
    // is what let a declared place stay `confident` at `drift: 0` after 200 m.
    const placePose = pose === null ? null : { x: pose.x, y: pose.y };
    const observation: PlaceObservation | null = frameBlocked
      ? tracker.updateUnregisteredFrame(placePose)
      : tracker.update(placePose);
    const previousPlaceId = this.placeBelief?.place?.id ?? null;

    // TASK-200: the same sample that names the place also enforces the fence.
    // The pose is trusted only while the drift budget holds — `stale` means it
    // may be tens of metres wrong, which is evidence neither that the robot is
    // inside a rack nor that it is out of one.
    const geofence = this.evaluateGeofenceForPose(pose, observation);

    this.placeBelief = {
      place: observation ? toScenePlace(observation) : null,
      poseM: pose === null ? null : { x: pose.x, y: pose.y },
      // The cached pose is read straight off the odometry topic. A dead-reckoned
      // or operator-declared position would have to say so here.
      poseSource: pose === null ? null : 'odometry',
      driftSinceAnchorM: observation ? observation.driftSinceAnchorM : null,
      ageMs: observation ? Math.max(0, Date.now() - observation.atMs) : null,
      insideKeepout: geofence.kind === 'unknown' ? null : geofence.kind === 'violating',
    };

    if (pose !== null) {
      this.state.location.x = pose.x;
      this.state.location.y = pose.y;
      this.state.location.heading = pose.yawDeg;
    }
    const placeId = this.placeBelief.place?.id ?? null;
    this.state.location.place = placeId;

    if (placeId === previousPlaceId) return;
    // Only a CHANGE is worth the publish + durable write. The pose itself moves
    // on every sample and is carried by the telemetry channel already; churning
    // the persisted snapshot twice a second would buy nothing.
    console.log(
      `[RobotStateManager] Place: ${previousPlaceId ?? 'UNKNOWN'} → ${placeId ?? 'UNKNOWN'}` +
        (this.placeBelief.poseM
          ? ` at (${this.placeBelief.poseM.x.toFixed(2)}, ${this.placeBelief.poseM.y.toFixed(2)})`
          : ' (no pose)'),
    );
    this.setAgentSafetyState({ place: placeId });
    this.notifyListeners();
  }

  /**
   * What the robot believes about where it is, or null when place awareness is
   * not configured at all. A configured-but-unknown place is a `PlaceBelief`
   * with `place: null` — the two are different answers and must stay so.
   */
  getPlaceBelief(): PlaceBelief | null {
    if (!this.placeTracker) return null;
    return (
      this.placeBelief ?? {
        place: null,
        poseM: null,
        poseSource: null,
        driftSinceAnchorM: null,
        ageMs: null,
        insideKeepout: null,
      }
    );
  }

  /**
   * Run the geofence over one sample and hand the verdict to the SafetyMonitor,
   * which owns the stop (TASK-200). Returns the verdict so the caller can put it
   * in the belief.
   *
   * `poseTrusted` is the belief's own confidence: a `stale` observation is a
   * pose past its drift budget, and the whole point of that budget is that such
   * a pose must not be enforced against. With no graph, or no observation to
   * judge the confidence from, the answer is UNKNOWN — which the monitor treats
   * as "change nothing", not as "all clear".
   *
   * KNOWN LIMITATION, worth stating rather than hiding: an operator re-anchor
   * resets the drift budget, so it also re-arms enforcement against a pose that
   * may still be metrically wrong — the operator declared a PLACE, not a
   * position, and v2 has no re-localisation to correct the coordinates with
   * (explicitly out of scope in TASK-200). The fence therefore keeps using the
   * only metric position that exists. If this bites on a real site, the fix is
   * pose correction at the re-anchor, not weakening the fence.
   *
   * The RELEASE direction of that same hazard is NOT a limitation, it is a bug,
   * and it is fixed here. A re-anchor zeroes the drift budget, which flips the
   * next observation back to `confident`, which makes `poseTrusted` true, which
   * lets the same uncorrected coordinates answer `clear` and un-latch a
   * `zone_violation` stop. Concretely: the robot has drifted 30 m, is physically
   * inside a rack, its drifted coordinates put it 2 m outside the polygon, and
   * saying "you are in aisle 3" releases the stop. The operator asserted a
   * PLACE, not a CLEARANCE. While {@link reanchoredUnderZoneStop} is set, a
   * `clear` verdict is downgraded to UNKNOWN — which the monitor treats as
   * "change nothing" — so releasing stays what TASK-200 says it is: an explicit
   * operator reset, taken by someone who can see the robot is nowhere near the
   * boundary. Re-arming is untouched: a `violating` verdict still stops.
   */
  private evaluateGeofenceForPose(
    pose: CachedBasePose | null,
    observation: PlaceObservation | null,
  ): GeofenceStatus {
    const graph = this.placeGraph;
    if (!graph) return { kind: 'unknown', reason: 'no place graph' };
    // An unregistered frame is not a pose problem, it is a MAP problem: the
    // polygons and the pose are numbers about different origins, so both
    // `violating` and `clear` would be fiction. UNKNOWN is the only honest
    // verdict, and the monitor changes nothing on it.
    if (this.placeFrame && !this.placeFrame.registered) {
      return { kind: 'unknown', reason: this.placeFrame.reason };
    }

    const status = evaluateGeofence(
      {
        pose: pose === null ? null : { x: pose.x, y: pose.y },
        // No observation at all means the pose resolved to no place — the robot
        // is somewhere off the map. That is still a real, freshly measured
        // position, so it IS enforceable: walking off the map into a keepout
        // must not be a way past the fence.
        poseTrusted: observation === null ? pose !== null : observation.confidence === 'confident',
      },
      graph,
      { marginM: appConfig.place.keepoutMarginM },
    );

    const guarded = this.guardReanchorRelease(status);
    this.safetyMonitor.updateGeofence(guarded);
    return guarded;
  }

  /**
   * Stop a re-anchor from releasing a latched `zone_violation` as a side effect.
   *
   * The flag is only ever set while the monitor holds a keepout, and it is
   * cleared the moment the monitor stops holding one — which, given the
   * downgrade below, can now only happen through
   * {@link SafetyMonitor.resetEmergencyStop}, i.e. a deliberate operator reset.
   */
  private guardReanchorRelease(status: GeofenceStatus): GeofenceStatus {
    if (!this.reanchoredUnderZoneStop) return status;
    if (this.safetyMonitor.getZoneViolation() === null) {
      // The stop the guard was protecting is gone (an operator reset it), so
      // the guard has nothing left to protect and stands down.
      this.reanchoredUnderZoneStop = false;
      return status;
    }
    if (status.kind !== 'clear') return status;
    return {
      kind: 'unknown',
      reason:
        'the pose was re-anchored by an operator declaring a PLACE, which is not evidence of ' +
        'clearance from a keepout — reset the protective stop to release it',
    };
  }

  /**
   * Declare the pose trustworthy again, spending the drift budget afresh.
   * v0's only re-anchor is an operator saying so — nothing the robot does to
   * itself may clear a `stale` belief.
   */
  anchorPlace(): void {
    if (!this.placeTracker) return;
    this.placeTracker.anchor();
    this.noteReanchor();
  }

  /**
   * Remember that the pose belief was re-anchored while a keepout stop was
   * latched. A re-anchor spends the drift budget afresh WITHOUT correcting a
   * single coordinate, so from here on a `clear` verdict is arithmetic on the
   * same wrong numbers — see {@link guardReanchorRelease}.
   */
  private noteReanchor(): void {
    if (this.safetyMonitor.getZoneViolation() === null) return;
    if (this.reanchoredUnderZoneStop) return;
    this.reanchoredUnderZoneStop = true;
    console.warn(
      '[RobotStateManager] re-anchor while a keepout protective stop is latched — the stop is HELD; ' +
        'releasing it needs an operator reset (POST /robots/:id/safety/estop/reset)',
    );
  }

  /**
   * *"You are in aisle 3."* — an operator re-anchors the robot (TASK-200).
   *
   * Returns the declared place, or `null` when the graph has no such place (in
   * which case nothing changed). The belief flips to `source: 'declared'` and
   * the drift budget is spent afresh — see `PlaceTracker.declare` for why this
   * one input is allowed to outrank geometry.
   */
  declarePlace(placeId: string): ScenePlace | null {
    const tracker = this.placeTracker;
    if (!tracker) return null;
    const observation = tracker.declare(placeId);
    if (!observation) return null;
    // Before anything else uses the re-anchored belief: a declaration must
    // never become a release. See `noteReanchor` / `guardReanchorRelease`.
    this.noteReanchor();

    const place = toScenePlace(observation);
    const previousPlaceId = this.placeBelief?.place?.id ?? null;
    this.placeBelief = {
      place,
      poseM: this.placeBelief?.poseM ?? null,
      // The POSE is still whatever odometry last said — the operator declared a
      // PLACE, not a position, and claiming 'declared' here would assert a
      // metric accuracy nobody supplied.
      poseSource: this.placeBelief?.poseSource ?? null,
      driftSinceAnchorM: observation.driftSinceAnchorM,
      ageMs: 0,
      insideKeepout: this.placeBelief?.insideKeepout ?? null,
    };
    this.state.location.place = place.id;

    console.log(
      `[RobotStateManager] Place DECLARED by operator: ${previousPlaceId ?? 'UNKNOWN'} → ${place.id} ` +
        '(drift budget reset)',
    );
    if (place.id !== previousPlaceId) this.setAgentSafetyState({ place: place.id });
    this.notifyListeners();
    return place;
  }

  /** The places this robot knows about, or an empty list when it has no graph. */
  getPlaces(): readonly Place[] {
    return this.placeGraph?.places ?? [];
  }

  // ============================================================================
  // STATE PERSISTENCE (Task 39)
  // ============================================================================

  /** Build a PersistedState snapshot from current in-memory state */
  private buildPersistedState(): PersistedState {
    return {
      // NEVER a literal: this used to be a hardcoded `1` while the schema
      // constant lived privately in StatePersistence, so bumping the constant
      // produced a build that wrote v1 and rejected it on the next load.
      version: PERSISTED_STATE_VERSION,
      savedAt: new Date().toISOString(),
      robotState: {
        status: this.state.status,
        batteryLevel: this.state.batteryLevel,
        location: { ...this.state.location },
        heldObject: this.state.heldObject,
        speed: this.state.speed,
        errors: [...this.state.errors],
        warnings: [...this.state.warnings],
      },
      taskQueue: this.taskQueue.getTasks(),
      agentState: { ...this.agentState },
    };
  }

  /** Trigger a debounced persist of current state */
  private persistState(): void {
    this.persistence.save(this.buildPersistedState());
  }

  /**
   * Write through a durable safety transition (TASK-196): the E-Stop latch was
   * taken or cleared, the base was damped or re-armed, the place changed.
   *
   * Called by the Agent Mode controller on each transition rather than sampled,
   * because the whole point is that the state on disk is correct at the instant
   * the process dies. The existing 500 ms debounce in `StatePersistence` covers
   * the write rate.
   */
  setAgentSafetyState(patch: Partial<PersistedAgentState>): void {
    this.agentState = { ...this.agentState, ...patch };
    this.persistState();
  }

  /** Current durable safety state (as it would be written to disk). */
  getAgentSafetyState(): PersistedAgentState {
    return { ...this.agentState };
  }

  /**
   * What was read off disk at boot, or null when there was nothing to read.
   * Agent Mode uses it to come back with the same latch and the same base
   * arming it had — see `AgentModeController.attach`.
   */
  getRestoredAgentState(): PersistedAgentState | null {
    return this.restoredAgentState ? { ...this.restoredAgentState } : null;
  }

  /**
   * Restore persisted state into memory (called once from constructor).
   *
   * Three rules, all of them safety rules (TASK-196):
   *
   * 1. **Latch and warning come back together, or neither.** `warnings` has
   *    always been persisted; the latch was not. A robot therefore came back
   *    displaying an E-Stop warning nothing could clear, while the latch that
   *    would have refused motion was gone — a lying state, not an amnesiac one.
   * 2. **A stale snapshot is not truth.** Past `PLACE_STALE_MS` the pose, the
   *    place and the held object are restored as unknown. A robot that was
   *    carried while powered off must not report where it used to stand.
   * 3. **The banner says plainly what came back.** Whoever walks up to a robot
   *    that refuses to move has to be able to read why.
   */
  private restorePersistedState(): void {
    const persisted = this.persistence.load();
    if (!persisted) return;

    const rs = persisted.robotState;
    const ageMs = snapshotAgeMs(persisted.savedAt);
    const stale = ageMs === null || ageMs > PLACE_STALE_MS;

    this.state.status = rs.status;
    this.state.batteryLevel = rs.batteryLevel;
    this.state.speed = rs.speed;
    this.state.errors = [...rs.errors];
    // Rule 1: a stop warning is only allowed back in the company of its latch,
    // which `restoreLatchedEmergencyStop` re-adds below through the very same
    // state mutation (`applyStopToState`) that writes it during a live stop.
    this.state.warnings = rs.warnings.filter((w) => !isStopWarning(w));

    const agent: PersistedAgentState = { ...defaultPersistedAgentState(), ...persisted.agentState };
    if (stale) {
      // Rule 2. The constructor's `initialLocation` stays in place — a
      // configured starting pose is a guess the operator made, not a claim the
      // robot invented about where it woke up.
      agent.place = null;
    } else {
      this.state.location = { ...rs.location };
      this.state.heldObject = rs.heldObject;
    }
    this.agentState = agent;
    this.restoredAgentState = { ...agent };

    // Restore queued tasks (before the latch, so the first persist triggered by
    // the restored stop already carries the queue).
    if (persisted.taskQueue.length > 0) {
      this.taskQueue.restoreQueue(persisted.taskQueue);
    }

    // IN MEMORY ONLY — the hardware stop and the durable write wait for
    // {@link reassertRestoredSafetyStop}. See TASK-201 there and in
    // `SafetyMonitor.restoreLatchedEmergencyStop`.
    if (agent.estopLatched) {
      this.safetyMonitor.restoreLatchedEmergencyStop({
        reason: agent.estopReason ?? 'E-Stop was latched when the robot last shut down',
        triggeredAt: agent.estopAt,
      });
    }

    // Rule 3.
    const ageText = ageMs === null ? 'unknown age' : `${Math.round(ageMs / 1000)}s old`;
    console.log(
      `[RobotStateManager] Restored persisted state (${ageText}): ` +
        `battery=${rs.batteryLevel.toFixed(1)}%, status=${rs.status}, ` +
        `estop=${agent.estopLatched ? `LATCHED (${agent.estopReason ?? 'no reason recorded'})` : 'clear'}, ` +
        `damped=${agent.damped}, place=${agent.place ?? 'unknown'}` +
        (stale ? ' — snapshot too old: pose, place and held object dropped' : ''),
    );
  }

  /**
   * Synchronous save — call during shutdown (SIGTERM / SIGINT).
   */
  saveStateSync(): void {
    this.persistence.saveSync(this.buildPersistedState());
  }

  /**
   * Get the StatePersistence instance (for shutdown hooks in index.ts).
   */
  getStatePersistence(): StatePersistence {
    return this.persistence;
  }

  // ============================================================================
  // STATE ACCESSORS
  // ============================================================================

  getState(): SimulatedRobotState {
    return { ...this.state };
  }

  /**
   * Rename the robot (TASK-198).
   *
   * The robot is authoritative for its own name — it lives in `IDENTITY.md` in
   * the agent's workspace, an operator sets it, and the fleet ADOPTS it through
   * the identity sync in `RobotManager.buildIdentityUpdate`. That sync reads
   * `GET /api/v1/robots/:id`, which serves this state, so a rename that never
   * reached here would be a robot answering to a name the fleet never learns.
   *
   * Blank names are refused: an identity that can be cleared is one a corrupted
   * write can erase.
   */
  setName(name: string): void {
    const clean = name.trim();
    if (!clean || clean === this.state.name) return;
    console.log(`[RobotStateManager] Robot renamed: "${this.state.name}" -> "${clean}"`);
    this.state.name = clean;
    this.state.updatedAt = new Date().toISOString();
  }

  getRobotInterface(): Robot {
    const hardwareConnected = hardwareClient.isConnected();
    // Single battery source: the same hardware-over-sim resolution as
    // getTelemetry(), so /robots/:id, /health and /telemetry never disagree.
    const realBattery = hardwareConnected ? hardwareClient.getBattery() : null;
    const batteryLevel =
      this.state.robotType === 'so101'
        ? null // SO-101 is AC-powered → null signals "no battery"
        : Math.round(realBattery ? realBattery.soc : this.state.batteryLevel);

    return {
      id: this.state.id,
      name: this.state.name,
      model: this.state.model,
      // Honest identity: with real hardware attached we have no way to read
      // the robot's serial/firmware/IP through the sidecar yet, so report
      // 'unknown' rather than fake SIM- values. In sim mode the stable
      // SIM-<robotId> serial and sim firmware are truthful.
      //
      // The serial is OMITTED, not 'unknown': it is `@unique` in the fleet
      // database, so two sidecar-driven robots both claiming the string
      // 'unknown' meant the second one could never register (TASK-207 found
      // this with two sims). Absent is what we know, and the server keeps
      // whatever it had.
      serialNumber: hardwareConnected ? undefined : this.state.serialNumber,
      status: this.state.status,
      batteryLevel,
      location: { ...this.state.location },
      lastSeen: this.state.lastSeen,
      currentTaskId: this.state.currentTaskId,
      currentTaskName: this.state.currentTaskName,
      capabilities: [...this.state.capabilities],
      firmware: hardwareConnected ? 'unknown' : this.state.firmware,
      ipAddress: hardwareConnected ? 'unknown' : this.state.ipAddress,
      metadata: {
        heldObject: this.state.heldObject,
        // Truthful sim flag: false while a real robot feeds this agent via the
        // sidecar (per-group honesty lives in telemetry.simulated[]).
        isSimulated: !hardwareConnected,
        hardwareConnected,
        robotClass: this.state.robotClass,
        robotType: this.state.robotType,
        maxPayloadKg: this.state.maxPayloadKg,
        description: this.state.description,
        powerSource: this.state.robotType === 'so101' ? 'ac_powered' : 'battery',
        footprintRadiusM: FOOTPRINT_RADIUS_M[this.state.robotType] ?? FOOTPRINT_RADIUS_M.generic,
      },
      createdAt: this.state.createdAt,
      updatedAt: this.state.updatedAt,
    };
  }

  getTelemetry(): RobotTelemetry {
    const telemetry = generateTelemetry(this.state);
    // Keyboard teleop override: when an operator is teleoperating in simulation,
    // the joints follow their commanded pose instead of the idle/walk animation.
    if (this.teleopJoints) {
      telemetry.jointStates = this.getActiveJointConfig().map((joint) => ({
        name: joint.name,
        position: this.teleopJoints!.get(joint.name) ?? joint.defaultPosition,
        velocity: 0,
      }));
    }
    // ── Real-over-sim override, PER FIELD GROUP (TASK-184) ──────────────────
    // The sim generator marked every group it fabricated in `simulated`; here
    // each group with fresh hardware data replaces the simulated values and is
    // unmarked. Groups the sidecar has no fresh data for (getter null) keep
    // their simulated values and stay marked — never zero-filled.
    const hardwareConnected = hardwareClient.isConnected();
    telemetry.hardwareConnected = hardwareConnected;

    // Joints: even if the sidecar is temporarily unreachable, keep showing the
    // last known real pose instead of snapping back to simulated defaults
    // (avoids confusion) — but only unmark the group while actually connected.
    const realJoints = hardwareClient.getJointStates();
    if (realJoints.length > 0) {
      telemetry.jointStates = realJoints;
      if (hardwareConnected) markGroupReal(telemetry, 'joints');
    }

    if (hardwareConnected) {
      const imu = hardwareClient.getImu();
      if (imu) {
        telemetry.imu = imu;
        markGroupReal(telemetry, 'imu');
      }

      const touch = hardwareClient.getTouch();
      if (touch) {
        telemetry.touch = touch;
        markGroupReal(telemetry, 'touch');
      }

      const battery = hardwareClient.getBattery();
      if (battery) {
        telemetry.battery = battery;
        // batteryLevel mirrors the real soc; powerSource stays 'battery'. The
        // legacy top-level voltage/temperature follow the real values too.
        telemetry.batteryLevel = Math.round(battery.soc);
        if (battery.voltage !== undefined) telemetry.batteryVoltage = battery.voltage;
        if (battery.temperature !== undefined) telemetry.batteryTemperature = battery.temperature;
        markGroupReal(telemetry, 'battery');
      }

      const motorTemperatures = hardwareClient.getMotorTemperatures();
      if (motorTemperatures) {
        telemetry.motorTemperatures = motorTemperatures;
        markGroupReal(telemetry, 'motorTemperatures');
      }

      const odometry = hardwareClient.getOdometry();
      if (odometry) {
        telemetry.odometry = odometry;
        markGroupReal(telemetry, 'odometry');
      }
    }

    return telemetry;
  }

  // ============================================================================
  // POINT CLOUD / DEPTH PERCEPTION
  // ============================================================================

  /**
   * Produce a point-cloud frame for the requested (or primary) depth sensor.
   *
   * This is the single sim↔hardware seam for perception: when the hardware
   * sidecar reports a connected robot we pull a real Livox/RealSense frame;
   * otherwise we synthesize a believable MID-360-style scan. Pulled on demand
   * (no simulation-loop coupling), exactly like {@link getTelemetry}.
   *
   * @param sensorName Specific depth sensor name, or undefined for the primary
   * @param opts.full  Request a full-resolution capture instead of a live frame
   */
  async getPointCloudFrame(
    sensorName?: string,
    opts: { full?: boolean } = {},
  ): Promise<PointCloudFrame> {
    const sequence = this.pointCloudSequence++;
    const spec = this.resolveDepthSensorSpec(sensorName);

    // Hardware seam — real Livox / RealSense via the sidecar when connected.
    if (hardwareClient.isConnected()) {
      try {
        const real = await hardwareClient.snapshotPointCloud(spec?.name ?? 'mid360_lidar');
        return { ...real, robotId: this.state.id, sequence, source: 'hardware', timestamp: new Date().toISOString() };
      } catch (err) {
        console.warn('[RobotStateManager] Hardware point cloud unavailable, using simulation:', err);
      }
    }

    // Replay seam — real recorded scans (KITTI / PCD) played back when configured
    // via POINTCLOUD_REPLAY_FILE / _DIR. Opt-in, so it never displaces hardware.
    const replay = this.getReplaySource();
    if (replay && replay.size > 0) {
      return replay.getFrame(spec, sequence, { full: opts.full, robotId: this.state.id, livePoints: LIVE_POINTS_PER_FRAME });
    }

    const targetPoints = opts.full ? (spec?.points_per_frame ?? 20000) : LIVE_POINTS_PER_FRAME;

    // Scan-session seam — when a digital-twin sweep is active (and we'd
    // otherwise synthesize), return a pose-dependent slice of one fixed world
    // room so frames accumulate into a map. Only replaces the synthetic
    // fallback, never hardware/replay, so live perception is unaffected.
    if (this.activeScan) {
      this.activeScan.frames++;
      return generatePosedScan(
        this.activeScan.room,
        this.state,
        this.currentScanPose(this.activeScan.originX, this.activeScan.originY),
        spec,
        sequence,
        { targetPoints, scanSessionId: this.activeScan.sessionId },
      );
    }

    return generateSyntheticScan(this.state, spec, sequence, { targetPoints });
  }

  /**
   * Toggle the physical LiDAR via the hardware sidecar. Hardware-only: in
   * sim/replay there is nothing to switch, so this reports that honestly
   * instead of pretending success.
   */
  async setLidarSwitch(on: boolean): Promise<{ ok: boolean; lidar?: string; error?: string }> {
    if (!hardwareClient.isConnected()) {
      return { ok: false, error: 'No hardware sidecar connected — the LiDAR switch only exists on the real robot' };
    }
    try {
      return await hardwareClient.setLidarSwitch(on);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Robot pose in the twin's world frame: position relative to the scan origin
   * (where scanning started), heading in radians. This is the ONLY place the
   * simulator's degree heading is converted to radians — keep it here to avoid a
   * deg/rad mix.
   */
  private currentScanPose(originX: number, originY: number): PointCloudPose {
    const loc = this.state.location;
    return {
      x: loc.x - originX,
      y: loc.y - originY,
      z: loc.z ?? 0,
      yaw: ((loc.heading ?? 0) * Math.PI) / 180,
    };
  }

  // ============================================================================
  // SCAN SESSIONS (digital-twin sweep)
  // ============================================================================

  /**
   * Begin a scan session: seed one fixed world room and switch the synthetic
   * perception path to pose-dependent slices of it. Idempotent per id — calling
   * again replaces the active session.
   */
  startScanSession(opts: { sessionId?: string } = {}): { sessionId: string; active: true } {
    const sessionId = opts.sessionId ?? `sess_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    this.activeScan = {
      sessionId,
      room: createScanRoom(seedFromString(sessionId)),
      startedAt: new Date().toISOString(),
      frames: 0,
      // Anchor the twin's world origin at the robot's current location.
      originX: this.state.location.x,
      originY: this.state.location.y,
    };
    console.log(
      `[RobotStateManager] Scan session started: ${sessionId} (origin ${this.state.location.x.toFixed(1)},${this.state.location.y.toFixed(1)})`,
    );
    return { sessionId, active: true };
  }

  /** End the active scan session (perception reverts to the standard sim). */
  stopScanSession(): { sessionId: string | null; frames: number } {
    if (!this.activeScan) return { sessionId: null, frames: 0 };
    const { sessionId, frames } = this.activeScan;
    this.activeScan = null;
    console.log(`[RobotStateManager] Scan session stopped: ${sessionId} (${frames} frames)`);
    return { sessionId, frames };
  }

  /** Current scan-session status. */
  getScanStatus(): { active: boolean; sessionId?: string; frames: number; startedAt?: string } {
    if (!this.activeScan) return { active: false, frames: 0 };
    return {
      active: true,
      sessionId: this.activeScan.sessionId,
      frames: this.activeScan.frames,
      startedAt: this.activeScan.startedAt,
    };
  }

  /**
   * Lazily resolve the real-recording replay source from the environment.
   * `null` once we've checked and found none configured (so we don't re-scan).
   */
  private getReplaySource(): PointCloudReplaySource | undefined {
    if (this.replaySource === undefined) {
      this.replaySource = PointCloudReplaySource.fromEnv() ?? null;
      if (this.replaySource) {
        console.log(
          `[RobotStateManager] Point-cloud replay active (${this.replaySource.size} recording(s): ${this.replaySource.labels.join(', ')})`,
        );
      }
    }
    return this.replaySource ?? undefined;
  }

  /**
   * Resolve a depth sensor spec from the loaded embodiment config (if any).
   * Falls back to undefined, in which case the generator uses MID-360 defaults.
   */
  private resolveDepthSensorSpec(sensorName?: string): DepthSensorSpec | undefined {
    const tag = this.embodimentTagForRobotType(this.state.robotType);
    if (!tag) return undefined;
    const config = EmbodimentLoader.getInstance().getEmbodiment(tag);
    if (!config) return undefined;
    return sensorName
      ? this.depthSensorManager.getDepthSensor(sensorName, config)
      : this.depthSensorManager.getPrimaryDepthSensor(config);
  }

  /** Map a robot type to its embodiment config tag. */
  private embodimentTagForRobotType(type: RobotType): string | undefined {
    switch (type) {
      case 'g1':
        return 'unitree_g1';
      case 'g1_edu':
        return 'unitree_g1_edu_dex3';
      case 'h1':
        return 'unitree_h1';
      default:
        return undefined;
    }
  }

  // ============================================================================
  // KEYBOARD TELEOP (simulation, embodiment-aware)
  // ============================================================================

  /** Joint configuration for the active embodiment (SO-101, G1, G1-EDU, …). */
  getActiveJointConfig(): JointConfig[] {
    return getJointConfig(this.state.robotType);
  }

  /** Whether keyboard teleop is currently driving the simulated joints. */
  isTeleopActive(): boolean {
    return this.teleopJoints !== null;
  }

  /**
   * Enter teleop mode. Idempotent — returns the current teleop pose (radians).
   *
   * Seeded from where the robot ACTUALLY IS whenever a sidecar is reporting
   * joints, and only from the embodiment's default pose otherwise. With
   * forwarding live (see `startTeleopForwarding`) the difference is a real
   * movement: the G1's defaults are all zero, which is the MJCF pose with both
   * arms straight out in front, so seeding from defaults would haul a standing
   * robot into a T-pose the moment somebody opened the VR view — before they
   * touched a controller.
   */
  enableTeleop(): Record<string, number> {
    if (!this.teleopJoints) {
      const live = new Map(hardwareClient.getJointStates().map((j) => [j.name, j.position]));
      this.teleopJoints = new Map();
      for (const joint of this.getActiveJointConfig()) {
        const at = live.get(joint.name);
        this.teleopJoints.set(
          joint.name,
          at === undefined
            ? joint.defaultPosition
            : Math.max(joint.limitLower, Math.min(joint.limitUpper, at)),
        );
      }
      this.startTeleopForwarding();
    }
    return this.getTeleopPositions();
  }

  /** Leave teleop mode; the simulation resumes its idle/walk animation. */
  disableTeleop(): void {
    this.teleopJoints = null;
    this.stopTeleopForwarding();
    this.notifyListeners();
  }

  // ────────────────────────────────────────────────────────────────
  // Teleop → hardware forwarding
  //
  // Without this the teleop pose lives only in `teleopJoints` and never leaves
  // the process: the 3D view showed the operator's commanded arm while the
  // robot — the MuJoCo sim or a real G1 — stood untouched, and `getTelemetry`
  // then overwrote the commanded pose with the real one, so the same robot
  // appeared in two different postures depending on which panel you looked at.
  // ────────────────────────────────────────────────────────────────

  /**
   * How often the teleop pose is pushed to the sidecar, in ms.
   *
   * 50 Hz, matching the sidecar's `G1_CONTROL_HZ`: `/action` advances the
   * commanded pose by a fixed step PER CALL, so the physical slew rate is set by
   * how often we call it. Forwarding on the teleop socket's own 30 Hz tick would
   * quietly move the robot at 60% of its configured rad/s.
   */
  private static readonly TELEOP_FORWARD_MS = 20;
  private teleopForwardTimer: ReturnType<typeof setInterval> | null = null;
  private teleopForwardInFlight = false;
  /** Logged once per teleop session, not once per failed frame. */
  private teleopForwardWarned = false;
  private teleopErrorListeners = new Set<TeleopErrorListener>();

  /**
   * Subscribe to teleop-forwarding failures (see {@link TeleopErrorListener}).
   * Returns an unsubscribe function.
   */
  onTeleopError(listener: TeleopErrorListener): () => void {
    this.teleopErrorListeners.add(listener);
    return () => this.teleopErrorListeners.delete(listener);
  }

  private emitTeleopError(err: TeleopError): void {
    for (const listener of this.teleopErrorListeners) {
      try {
        listener(err);
      } catch (e) {
        console.error('[RobotStateManager/Teleop] error listener failed:', e);
      }
    }
  }

  private startTeleopForwarding(): void {
    if (this.teleopForwardTimer) return;
    this.teleopForwardWarned = false;
    this.teleopForwardTimer = setInterval(() => {
      void this.forwardTeleopToHardware();
    }, RobotStateManager.TELEOP_FORWARD_MS);
    // Never hold the process open for a teleop session nobody is driving.
    this.teleopForwardTimer.unref?.();
  }

  private stopTeleopForwarding(): void {
    if (!this.teleopForwardTimer) return;
    clearInterval(this.teleopForwardTimer);
    this.teleopForwardTimer = null;
    // Hand the joints back so the next operator's first /action ramps from
    // where the robot stands, not from the last one's half-finished motion.
    void hardwareClient.releaseAction().catch(() => { /* sidecar already gone */ });
  }

  private async forwardTeleopToHardware(): Promise<void> {
    if (!this.teleopJoints || !hardwareClient.isConnected()) return;
    // THE E-STOP HAS TO REACH THE WRITERS, not just the record. This gate was
    // missing: the forwarder checked only "teleop is on" and "a sidecar is
    // attached", so a latched E-Stop kept POSTing /action at 50 Hz — the stop
    // zeroed the base and then the operator's arm pose walked straight back
    // out to the robot, one frame later. The latch is the single source of
    // truth (`isEStopTriggered`); releasing it needs a deliberate operator
    // reset, and forwarding resumes on its own when that happens.
    if (this.isEStopTriggered()) return;
    // One request in flight at a time. At 50 Hz a sidecar answering slowly would
    // otherwise queue a request per tick, and each would carry a target that was
    // already stale when it was sent.
    if (this.teleopForwardInFlight) return;
    this.teleopForwardInFlight = true;
    try {
      await hardwareClient.sendAction(this.getTeleopPositions());
    } catch (err) {
      // A refusal the sidecar ANSWERED (403 read-only, 400 unknown joint) is a
      // different problem from a sidecar that is not there, and an operator can
      // only act on the first — so they are not flattened into one code.
      this.emitTeleopError({
        code: err instanceof HardwareActionError ? 'action_rejected' : 'sidecar_down',
        message: err instanceof Error ? err.message : String(err),
      });
      if (!this.teleopForwardWarned) {
        this.teleopForwardWarned = true;
        console.warn('[RobotStateManager/Teleop] forwarding to the sidecar failed —'
          + ' the operator drives the view only:', err);
      }
    } finally {
      this.teleopForwardInFlight = false;
    }
  }

  /** Reset all teleop joints to their default (home) pose. */
  homeTeleopJoints(): Record<string, number> {
    if (!this.teleopJoints) this.enableTeleop();
    for (const joint of this.getActiveJointConfig()) {
      this.teleopJoints!.set(joint.name, joint.defaultPosition);
    }
    return this.getTeleopPositions();
  }

  /**
   * Apply a delta (radians) to a single teleop joint, clamped to its limits.
   * Returns the new clamped position, or null for an unknown joint.
   *
   * Note: intentionally does NOT notify state listeners — teleop runs at a high
   * tick rate and the telemetry stream re-reads getTelemetry() on its own cadence.
   */
  applyTeleopDelta(jointName: string, deltaRad: number): number | null {
    if (!this.teleopJoints) this.enableTeleop();
    const joint = this.getActiveJointConfig().find((j) => j.name === jointName);
    if (!joint) return null;
    const current = this.teleopJoints!.get(jointName) ?? joint.defaultPosition;
    const next = Math.max(joint.limitLower, Math.min(joint.limitUpper, current + deltaRad));
    this.teleopJoints!.set(jointName, next);
    return next;
  }

  /**
   * Set a single teleop joint to an absolute angle (radians), clamped to its
   * limits. Returns the new clamped position, or null for an unknown joint.
   *
   * Used by pose-streaming teleop (e.g. WebXR / Meta Quest) where the client
   * computes target joint angles each frame rather than incremental deltas.
   * Like applyTeleopDelta, it intentionally does NOT notify state listeners.
   */
  setTeleopJoint(jointName: string, positionRad: number): number | null {
    if (!this.teleopJoints) this.enableTeleop();
    const joint = this.getActiveJointConfig().find((j) => j.name === jointName);
    if (!joint) return null;
    const next = Math.max(joint.limitLower, Math.min(joint.limitUpper, positionRad));
    this.teleopJoints!.set(jointName, next);
    return next;
  }

  /** Current teleop joint positions as a plain map (radians). */
  getTeleopPositions(): Record<string, number> {
    const out: Record<string, number> = {};
    if (this.teleopJoints) {
      for (const [name, pos] of this.teleopJoints) out[name] = pos;
    }
    return out;
  }

  getCommandHistory(): RobotCommand[] {
    return this.commandExecutor.getHistory();
  }

  // ============================================================================
  // COMMAND HANDLERS (delegated to CommandExecutor)
  // ============================================================================

  async moveTo(location: RobotLocation): Promise<CommandResult> {
    const result = await this.commandExecutor.moveTo(location);
    if (result.success) {
      this.notifyListeners();
    }
    return result;
  }

  async pickup(objectId: string): Promise<CommandResult> {
    const result = await this.commandExecutor.pickup(objectId);
    if (result.success) {
      this.notifyListeners();
    }
    return result;
  }

  async drop(): Promise<CommandResult> {
    const result = await this.commandExecutor.drop();
    if (result.success) {
      this.notifyListeners();
    }
    return result;
  }

  async stop(): Promise<CommandResult> {
    const result = await this.commandExecutor.stop();
    if (result.success) {
      this.notifyListeners();
    }
    return result;
  }

  async emergencyStop(): Promise<CommandResult> {
    const result = await this.commandExecutor.emergencyStop();
    if (result.success) {
      this.notifyListeners();
    }
    return result;
  }

  async goToCharge(): Promise<CommandResult> {
    const result = await this.commandExecutor.goToCharge();
    if (result.success) {
      this.notifyListeners();
    }
    return result;
  }

  async returnHome(): Promise<CommandResult> {
    const result = await this.commandExecutor.returnHome();
    if (result.success) {
      this.notifyListeners();
    }
    return result;
  }

  // ============================================================================
  // COMMAND EXECUTION
  // ============================================================================

  async executeCommand(type: CommandType, payload: Record<string, unknown> = {}): Promise<RobotCommand> {
    return this.commandExecutor.execute(type, payload);
  }

  // ============================================================================
  // SIMULATION (delegated to SimulationEngine)
  // ============================================================================

  startSimulation(): void {
    this.simulation.start();
    // Try to connect to real hardware sidecar (non-blocking)
    void hardwareClient.init();
  }

  stopSimulation(): void {
    this.simulation.stop();
    // Shutdown path (index.ts): stop consuming pose samples too, so a listener
    // does not outlive the manager that owns the tracker.
    this.unsubscribePose?.();
    this.unsubscribePose = null;
  }

  /**
   * Update the zone cache used for real-time zone tracking in the simulation engine.
   */
  setZoneCache(zones: Zone[]): void {
    this.simulation.setZoneCache(zones);
  }

  // ============================================================================
  // EVENT LISTENERS (delegated to StatePublisher)
  // ============================================================================

  subscribe(listener: StateListener): () => void {
    return this.publisher.subscribe(listener);
  }

  private notifyListeners(): void {
    this.publisher.notify(this.getState());
    this.persistState();
  }

  // ============================================================================
  // TASK QUEUE MANAGEMENT (delegated to TaskQueue)
  // ============================================================================

  async acceptTask(task: PushedTask): Promise<boolean> {
    return this.taskQueue.accept(task);
  }

  getTaskQueue(): PushedTask[] {
    return this.taskQueue.getTasks();
  }

  getTaskQueueLength(): number {
    return this.taskQueue.length;
  }

  getCurrentTask(): PushedTask | null {
    return this.taskQueue.getCurrentTask();
  }

  async cancelTask(taskId: string): Promise<boolean> {
    return this.taskQueue.cancel(taskId);
  }

  // ============================================================================
  // SAFETY MANAGEMENT (delegated to SafetyMonitor)
  // ============================================================================

  /**
   * Re-assert an E-Stop latch that was restored from disk, on the HARDWARE and
   * on disk (TASK-201).
   *
   * The constructor restores such a latch in memory only — see
   * `restorePersistedState` and `SafetyMonitor.restoreLatchedEmergencyStop` —
   * because it runs while this process is still only a CANDIDATE for the port.
   * This is the other half, and it belongs to the port-owned start-up sequence
   * in `agent-runtime.ts`: `actuateSafetyStop` POSTs `StopMove` to the sidecar
   * (unconditionally, by design) and the notify it triggers persists the state
   * file — neither of which a process that is about to lose the port and exit
   * may do to the robot another agent is currently driving.
   *
   * Called once per boot. A robot that comes back latched still ends up
   * physically stopped and damped; it just happens a few milliseconds later,
   * when this process is entitled to say so.
   *
   * @returns whether there was a restored latch to re-assert.
   */
  reassertRestoredSafetyStop(): boolean {
    return this.safetyMonitor.reassertRestoredEmergencyStop();
  }

  /**
   * Start safety monitoring (call after simulation starts)
   */
  startSafetyMonitoring(): void {
    this.safetyMonitor.start();

    // Humanoid fall/tilt safety net: poll the IMU (and leg-joint state) and feed
    // the SafetyMonitor so it can protective-stop on a tip-over. Arms (SO-101)
    // have no IMU and no fall hazard, so this loop only runs for humanoids.
    //
    // HONESTY: this is fall DETECTION → stop, not fall PREVENTION (TASK-169
    // Stage 4 covers a real balance / whole-body controller).
    if (this.safetyMonitor.isHumanoidEmbodiment && !this.humanoidSafetyTimer) {
      // Shared contract (owned by the hardware agent): getImuNow() resolves to an
      // {rpy,gyro,accel} sample, or null when no IMU telemetry is available yet.
      // A rejected fetch (sidecar down) is treated as null so the net stays
      // visibly degraded and never false-trips.
      this.humanoidSafetyTimer = setInterval(() => {
        // Re-entrancy guard: getImuNow() can take up to its fetch timeout (≫ the
        // 50ms tick) when the sidecar lags. Without this, slow ticks stack
        // overlapping /state fetches. Skip a tick while one is still in flight —
        // the previous result keeps driving the net until it resolves.
        if (!this.imuPollInFlight) {
          this.imuPollInFlight = true;
          void hardwareClient
            .getImuNow()
            .then((imu) => this.safetyMonitor.updateOrientation(imu))
            .catch(() => this.safetyMonitor.updateOrientation(null))
            .finally(() => {
              this.imuPollInFlight = false;
            });
        }
        // Leg-joint balance-margin warnings (no-op until real joints arrive).
        this.safetyMonitor.updateJointStates(hardwareClient.getJointStates());

        // Propagate a protective stop to the MOTION-COMMAND path (once per
        // trigger): detection alone doesn't stop the robot. Abort any running VLA
        // executor so it stops emitting action chunks, and soft-stop the sidecar
        // ramp. Latched so we don't re-fire every 50ms tick; reset on E-stop
        // clear so a later stop propagates again.
        if (this.safetyMonitor.isEStopTriggered()) {
          if (!this.estopPropagated) {
            this.estopPropagated = true;
            const aborted = skillExecutorRegistry.abortAll();
            if (aborted > 0) {
              console.warn(
                `[Safety] Protective stop — aborted ${aborted} active skill executor(s)`,
              );
            }
            void hardwareClient.sendEstop();
          }
        } else {
          this.estopPropagated = false;
        }
      }, HUMANOID_SAFETY_POLL_MS);
    }
  }

  /**
   * Stop safety monitoring
   */
  stopSafetyMonitoring(): void {
    this.safetyMonitor.stop();
    if (this.humanoidSafetyTimer) {
      clearInterval(this.humanoidSafetyTimer);
      this.humanoidSafetyTimer = null;
    }
  }

  /**
   * Get current safety status
   */
  getSafetyStatus(): SafetyStatus {
    return this.safetyMonitor.getStatus();
  }

  /**
   * Get E-stop state
   */
  getEStopState(): EStopState {
    return this.safetyMonitor.getEStopState();
  }

  /**
   * Check if E-stop is triggered
   */
  isEStopTriggered(): boolean {
    return this.safetyMonitor.isEStopTriggered();
  }

  /**
   * Trigger emergency stop from external source
   */
  triggerEmergencyStop(
    triggeredBy: 'local' | 'remote' | 'server' | 'zone' | 'system',
    reason: string
  ): void {
    this.safetyMonitor.triggerEmergencyStop(triggeredBy, reason);
    // Durable (TASK-196): this is the E-Stop path that never touches Agent Mode
    // — the fleet route, A2A, a zone trigger. Without the write-through, a stop
    // taken here would be gone on the next boot while its warning survived.
    this.setAgentSafetyState({
      estopLatched: true,
      estopReason: reason,
      estopAt: new Date().toISOString(),
    });
  }

  /**
   * Trigger protective stop
   */
  triggerProtectiveStop(reason: string): void {
    this.safetyMonitor.triggerProtectiveStop('protective_stop', reason);
  }

  /**
   * Reset E-stop (requires deliberate action)
   */
  resetEmergencyStop(): boolean {
    const cleared = this.safetyMonitor.resetEmergencyStop();
    // Only a reset the monitor actually granted may clear the durable latch: a
    // refused reset that still wrote `estopLatched: false` would hand the robot
    // back un-latched at the next boot.
    if (cleared) {
      this.setAgentSafetyState({ estopLatched: false, estopReason: null, estopAt: null });
    }
    return cleared;
  }

  /**
   * Update server heartbeat (call when server communication is received)
   */
  updateServerHeartbeat(): void {
    this.safetyMonitor.updateServerHeartbeat();
  }

  /**
   * Set operating mode
   */
  setOperatingMode(mode: OperatingMode): void {
    this.safetyMonitor.setOperatingMode(mode);
  }

  /**
   * Get current operating mode
   */
  getOperatingMode(): OperatingMode {
    return this.safetyMonitor.getOperatingMode();
  }

  /**
   * Get safety events log
   */
  getSafetyEvents(limit = 50): SafetyEvent[] {
    return this.safetyMonitor.getSafetyEvents(limit);
  }

  /**
   * Subscribe to safety events
   */
  onSafetyEvent(callback: SafetyEventCallback): () => void {
    return this.safetyMonitor.onSafetyEvent(callback);
  }

  /**
   * Subscribe to the ACTUATION of a safety stop — "stop driving, now".
   *
   * Deliberately NOT {@link onSafetyEvent}: that one is a log feed nobody in
   * this process was ever obliged to act on (and, until TASK-200's review,
   * nobody did). This one runs inside the stop itself, before the caller of
   * `triggerProtectiveStop` gets control back, and every listener is expected to
   * abort whatever motion it is generating. Agent Mode registers here so a
   * geofence stop taken mid-plan actually ends the plan instead of letting the
   * running `walk` block finish driving into the rack.
   *
   * Listener errors are caught and logged: one broken subscriber must not stop
   * the others, and must not stop the base command below it.
   */
  onSafetyStop(listener: SafetyStopListener): () => void {
    this.safetyStopListeners.add(listener);
    return () => this.safetyStopListeners.delete(listener);
  }

  /**
   * What a safety stop DOES, as opposed to what it records.
   *
   * Two halves, in this order and for this reason:
   *
   *  1. **Tell the drivers.** A plan that keeps generating stages will keep
   *     issuing `/loco/move` after any single stop command we send, so stopping
   *     the source has to come first.
   *  2. **Command the base.** `StopMove` zeroes the commanded velocity — the
   *     robot may be several seconds into a multi-second move that no plan abort
   *     can recall, because the duration lives on the robot.
   *  3. **Drop the action ramp, for a category-0 stop only.** `StopMove` says
   *     nothing about the ARMS: the sidecar keeps ramping toward the last
   *     `/action` target it was given, so an E-Stop taken mid-teleop left the
   *     robot completing the operator's reach with its base stopped. Releasing
   *     the hold hands the joints back to the robot's own controller.
   *
   * What this deliberately does NOT do is damp. `/action` release + `StopMove`
   * is the right severity for a G1 that is STANDING; commanding damping from a
   * safety stop collapses it, which turns a stop into a fall.
   *
   * Best-effort by construction: nothing here may throw back into the monitor,
   * and a sidecar that is not there is reported, not hidden. `locoStop()` is
   * sent unconditionally rather than gated on `hardwareClient.isConnected()` —
   * that flag tracks the telemetry poll, and "we lost telemetry" is the worst
   * possible moment to decide not to tell the base to stop.
   */
  private async actuateSafetyStop(stop: StopActuation): Promise<void> {
    for (const listener of this.safetyStopListeners) {
      try {
        listener(stop);
      } catch (err) {
        console.error('[RobotStateManager] safety-stop listener failed:', err);
      }
    }

    const result = await hardwareClient.locoStop();
    if (!result.ok) {
      console.warn(
        `[RobotStateManager] ${stop.type} stop: base StopMove NOT delivered (${result.error ?? 'unknown error'}) — ` +
          'the robot may still be executing commanded velocity',
      );
    }

    // Category 0 only: a protective stop (category 2) is a pause that keeps the
    // controllers powered and the pose held, and dropping the ramp there would
    // make every recoverable stop hand the arms back and re-seed from wherever
    // they drifted to.
    if (stop.category === 0) {
      await hardwareClient.releaseAction().catch((err) => {
        console.warn(
          `[RobotStateManager] ${stop.type} stop: action-ramp release NOT delivered (${err instanceof Error ? err.message : String(err)})`,
        );
      });
    }
  }

  /**
   * Get effective speed limit for current mode
   */
  getEffectiveSpeedLimit(): number {
    return this.safetyMonitor.getEffectiveSpeedLimit();
  }

  // ============================================================================
  // VLA CONTROL (Task 46)
  // ============================================================================

  /**
   * Start VLA control mode with a language instruction.
   *
   * TASK-184: this used to delegate to the Python sidecar's `/vla/start`
   * (VLARunner) — that surface was removed with the orphaned vla_runner.py.
   * The live VLA path is the TS-owned SkillExecutor closed loop (observe →
   * vla-server /predict → execute), which resolves sim-vs-hardware itself via
   * the hardware sidecar. The run executes in the background; completion (or
   * failure) flips the active flag back and notifies listeners.
   *
   * TASK-194 arbitration: the exclusive control lock is claimed and released
   * HERE, not by the REST route, so its lifetime is exactly the rollout's. A
   * rollout ends far more often on its own (unreachable VLA server, max steps,
   * the 10-minute timeout) than through `POST /vla/stop`, and a lock released
   * only by that route stayed held for the life of the process — which killed
   * Agent Mode permanently, with no UI path to recover it.
   *
   * @param instruction Natural language task instruction
   * @param config Optional VLA controller configuration overrides (unused by
   *               the closed-loop executor; kept for API compatibility)
   * @throws ControlBusyError when another owner holds exclusive control
   */
  async startVLAControl(
    instruction: string,
    config?: Partial<VLAControllerConfig>
  ): Promise<void> {
    // Checked BEFORE claiming: `claim('vla')` succeeds trivially when a rollout
    // already owns the lock, so claiming first would make this throw with the
    // live rollout's claim in hand.
    if (this.vlaActiveLocal) {
      throw new Error('VLA control is already active');
    }
    void config; // accepted for API compatibility; the closed loop is self-configuring

    const claim = controlOwnerLock.claim('vla');
    if (!claim.ok) {
      throw new ControlBusyError(claim.reason ?? 'control is busy.');
    }

    // The sequence number matters: two runs started inside the same millisecond
    // would otherwise share an id, and every "is this still my run?" guard
    // (registry key, lock holder, active-run flag) would match the wrong one.
    const skillId = `vla-control-${Date.now()}-${++this.vlaRunSeq}`;
    const executor = new SkillExecutor(this);
    // Same registry as skill runs, so the safety loop's abortAll() halts this too.
    skillExecutorRegistry.register(skillId, executor);

    this.vlaLockSkillId = skillId;
    this.vlaActiveLocal = true;
    this.vlaInstructionLocal = instruction;
    this.vlaSkillId = skillId;
    console.log(`[RobotStateManager/VLA] Starting closed loop: instruction="${instruction}"`);

    void executor
      .run({
        skillId,
        taskPrompt: instruction,
        maxSteps: VLA_CONTROL_MAX_STEPS,
        timeoutMs: VLA_CONTROL_TIMEOUT_MS,
      })
      .then((result) => {
        console.log(
          `[RobotStateManager/VLA] Loop finished: ${result.status} after ${result.steps} steps` +
            (result.error ? ` (${result.error})` : ''),
        );
      })
      .catch((err) => {
        console.error('[RobotStateManager/VLA] Loop crashed:', err);
      })
      .finally(() => {
        skillExecutorRegistry.unregister(skillId);
        // This is where the rollout's lifecycle really ends — success, crash,
        // max steps or timeout all land here. Hand the lock back so the next
        // owner (Agent Mode, teleop) can take control.
        this.releaseVLAControlLock(skillId);
        if (this.vlaSkillId === skillId) {
          this.vlaActiveLocal = false;
          this.vlaInstructionLocal = '';
          this.vlaSkillId = null;
          this.notifyListeners();
        }
      });

    this.notifyListeners();
  }

  /**
   * Release the exclusive control lock held by one VLA run. A no-op when that
   * run is not the current lock holder — a rollout that settles late must never
   * pull the lock out from under the rollout that replaced it.
   */
  private releaseVLAControlLock(skillId: string): void {
    if (this.vlaLockSkillId !== skillId) return;
    this.vlaLockSkillId = null;
    controlOwnerLock.release('vla');
  }

  /**
   * Stop VLA control mode gracefully (aborts the background closed loop).
   */
  async stopVLAControl(): Promise<void> {
    console.log('[RobotStateManager/VLA] Stopping VLA control');
    if (this.vlaSkillId) {
      skillExecutorRegistry.abort(this.vlaSkillId);
    }
    // Release now rather than waiting for the aborted run's promise to settle,
    // so an operator can immediately hand control to Agent Mode. The run's own
    // `finally` then finds the lock already released and does nothing.
    if (this.vlaLockSkillId) {
      this.releaseVLAControlLock(this.vlaLockSkillId);
    } else {
      // Escape hatch: the lock still says `vla` but no run is tracked (e.g. a
      // leak from an earlier build). `POST /vla/stop` is the operator's only
      // UI path here, so let it clear the stale claim. No-op otherwise.
      controlOwnerLock.release('vla');
    }
    this.vlaActiveLocal = false;
    this.vlaInstructionLocal = '';
    this.vlaSkillId = null;
    this.notifyListeners();
    console.log('[RobotStateManager/VLA] VLA control stopped');
  }

  /**
   * Pause VLA control (holds current position).
   */
  pauseVLAControl(): void {
    // The closed-loop executor has no pause state — stop instead.
    console.warn('[RobotStateManager] VLA pause not supported by the closed-loop executor, use stop');
  }

  /**
   * Resume VLA control from paused state.
   */
  resumeVLAControl(): void {
    console.warn('[RobotStateManager] VLA resume not supported by the closed-loop executor, use start');
  }

  /**
   * Get current VLA control status.
   */
  getVLAStatus(): VLAStatus | null {
    if (!this.vlaActiveLocal) return null;
    // Return a minimal status compatible with VLAStatus shape
    return {
      phase: 'running',
      instruction: this.vlaInstructionLocal,
      bufferDepth: 0,
      lastInferenceMs: 0,
      totalSteps: 0,
      errors: 0,
    } as unknown as VLAStatus;
  }

  /**
   * Check if VLA control is currently active.
   */
  isVLAActive(): boolean {
    return this.vlaActiveLocal;
  }

  // NOTE (TASK-184): getVLASafetyStatus() was removed. It fetched the sidecar's
  // `/safety/status` — the safety wrapper of the deleted VLARunner path — and
  // had no live caller (nothing proxies GET /robots/:id/vla/safety). Closed-loop
  // safety is now the TS SafetyMonitor + SkillExecutor delta clipping.

  // ============================================================================
  // VLA MODEL MANAGEMENT (Task 47)
  // ============================================================================

  /**
   * Switch to a new VLA model version.
   * Used by deployment pipeline for canary/production rollouts.
   *
   * @param request Model switch request with version and artifact URI
   * @returns Result of the switch operation
   */
  async switchVLAModel(request: ModelSwitchRequest): Promise<ModelSwitchResult> {
    // If VLA is active, stop it first
    if (this.isVLAActive()) {
      await this.stopVLAControl();
    }

    // Perform model switch
    const result = await this.vlaModelManager.switchModel(request);

    // Log the switch
    if (result.success) {
      console.log(
        `[RobotStateManager] VLA model switched: ${result.previousModelVersion} -> ${result.newModelVersion}`
      );
    } else {
      console.error(`[RobotStateManager] VLA model switch failed: ${result.error}`);
    }

    return result;
  }

  /**
   * Get VLA inference metrics for deployment monitoring.
   */
  getVLAInferenceMetrics(): VLAInferenceMetrics {
    return this.vlaModelManager.getInferenceMetrics();
  }

  /**
   * Get current VLA model version.
   */
  getVLAModelVersion(): string | null {
    return this.vlaModelManager.getCurrentModelVersion();
  }

  // ============================================================================
  // RESET (for testing/recovery)
  // ============================================================================

  reset(): void {
    // Stop VLA control if active
    if (this.vlaActiveLocal) {
      this.stopVLAControl().catch(() => {});
    }

    this.state.batteryLevel = 95 + Math.random() * 5;
    this.state.status = 'online';
    this.state.errors = [];
    this.state.warnings = [];
    this.state.targetLocation = undefined;
    this.state.currentTaskId = undefined;
    this.state.currentTaskName = undefined;
    this.state.heldObject = undefined;
    this.state.speed = 0;
    this.state.updatedAt = new Date().toISOString();

    // Also reset E-stop if triggered
    if (this.safetyMonitor.isEStopTriggered()) {
      this.safetyMonitor.resetEmergencyStop();
    }
    // …and let the durable snapshot follow, or the "reset" robot comes back
    // latched on its next boot from a latch nothing in memory holds any more.
    if (this.agentState.estopLatched && !this.safetyMonitor.isEStopTriggered()) {
      this.setAgentSafetyState({ estopLatched: false, estopReason: null, estopAt: null });
    }

    this.notifyListeners();
    console.log(`[RobotStateManager] Robot ${this.state.name} reset to initial state`);
  }
}
