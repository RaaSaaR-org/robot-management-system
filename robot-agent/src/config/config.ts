/**
 * @file config.ts
 * @description Environment configuration and validation
 * @status live
 */

import type { RobotType } from '../robot/types.js';
// The ONE default drift budget. It used to be written twice — an
// independent literal `15` here and another in `place-resolver.ts` — with
// only the resolver's pinned by a test, so retuning one would have moved the
// budget for a `PlaceTracker` built from config while leaving every tracker
// built from its own defaults on the old number (TASK-201, decision D1).
import { DEFAULT_PLACE_DRIFT_BUDGET_M } from '../agent-mode/place-resolver.js';

export type RobotClass = 'lightweight' | 'heavy-duty' | 'standard';

/**
 * How Agent Mode executes an in-place LEFT (CCW) rotation. See
 * {@link Config.agentMode.leftTurnStrategy} for the measurement behind it.
 */
export type LeftTurnStrategy = 'direct' | 'mirror' | 'auto';

export interface Config {
  port: number;
  robotId: string;
  robotName: string;
  robotModel: string;
  robotClass: RobotClass;
  robotType: RobotType;
  maxPayloadKg: number;
  robotDescription: string;
  geminiApiKey: string;
  /** LLM provider: 'gemini' (default), 'openrouter' or 'ollama' (local) */
  llmProvider: 'gemini' | 'openrouter' | 'ollama';
  /** OpenRouter API key (required when llmProvider is 'openrouter') */
  openrouterApiKey: string;
  /** Base URL of the local Ollama OpenAI-compatible endpoint (when llmProvider is 'ollama') */
  ollamaBaseUrl: string;
  /** Override default model name per provider */
  llmModel: string;
  initialLocation: {
    x: number;
    y: number;
    floor: string;
    zone: string;
  };
  /** Zone cache time-to-live in milliseconds */
  zoneCacheTtlMs: number;
  /** Server URL for API calls */
  serverUrl: string;
  /** VLA inference configuration */
  vla: {
    /** VLA inference server hostname */
    host: string;
    /** VLA inference server port */
    port: number;
    /** Connection pool size for parallel requests */
    poolSize: number;
    /** Health check interval in milliseconds */
    healthCheckIntervalMs: number;
    /** Request timeout in milliseconds */
    timeoutMs: number;
    /** Optional REST fallback URL for degraded mode */
    restFallbackUrl: string | undefined;
    /** Whether VLA inference is enabled */
    enabled: boolean;
    /**
     * Rollout control-loop period in milliseconds (`VLA_LOOP_PERIOD_MS`), i.e.
     * how long the skill executor sleeps between action sends. 200 ms (5 Hz)
     * is the historical default and matches the VLARunner/teleop conventions;
     * GR00T-N1.7 closed-loop control on the G1 wants 15 Hz, which is ~67 ms.
     *
     * It is a knob rather than a constant because everything RTC is tuned
     * against is a function of it (TASK-183): the crossfade's reach is
     * `chunkSize x overlap x loopPeriodMs`, and the prefetch payoff weighs the
     * observed round trip against `(queueLen + 1) x loopPeriodMs` of queued
     * lead. Changing the rate moves both, so an A/B at two rates has to be
     * expressible before either can be checked at anything but 5 Hz.
     *
     * Must be in (0, 5000]. Only the lower bound is derived: 0 or a negative
     * period turns the loop into a spin that floods the sidecar with
     * `/action`. The 5000 is a sanity ceiling, not a number computed from
     * anything — note it deliberately still admits periods longer than
     * `PREDICT_TIMEOUT_MS` (3000 ms in `skill-executor.ts`), because a slow
     * loop is a legitimate, if odd, way to run a rollout; it is only there to
     * catch a fat-fingered `VLA_LOOP_PERIOD_MS=200000`.
     */
    loopPeriodMs: number;
    /**
     * Real-Time Chunking (TASK-183): prefetch the next action chunk while the
     * current one is still executing and crossfade the two across the
     * boundary, so a chunk boundary no longer costs a full `/predict` of dead
     * air. Off by default — with `enabled: false` the rollout loop keeps the
     * serial pop-then-refill behaviour it has always had.
     */
    rtc: {
      /** RTC on for this agent (`VLA_RTC_ENABLED`). */
      enabled: boolean;
      /**
       * Fraction of a chunk still queued that triggers the prefetch
       * (`VLA_RTC_OVERLAP`) — 0.25 fires the next `/predict` once three
       * quarters of the current chunk has been consumed. Must be in (0, 1]:
       * 0 never fires (RTC silently off) and >1 asks to prefetch before the
       * chunk has arrived, so both are refused at parse time.
       */
      overlap: number;
      /**
       * Length of the boundary crossfade in steps (`VLA_RTC_BLEND_STEPS`).
       * 0 is legal and means "prefetch, then hard-splice" — that is the A/B
       * control that separates the prefetch's win from the blend's.
       */
      blendSteps: number;
    };
  };
  /** Telemetry push cadence (TASK-191 fast/slow channel split) */
  telemetry: {
    /** High-rate channel interval in ms (joints/imu/odometry only). 0 disables the fast channel. */
    fastIntervalMs: number;
    /** Full-frame interval in ms (temperatures, battery, touch, sensors, ...) */
    fullIntervalMs: number;
  };
  /**
   * Agent Mode (TASK-194): a local Ollama LLM translates plain-language
   * commands into executable blocks driven through the sidecar's `/loco/*`
   * LocoClient facade. Off by default — with `enabled: false` the A2A path is
   * byte-identical to the pre-TASK-194 behaviour.
   */
  agentMode: {
    /** Mode on at boot (`AGENT_MODE_ENABLED`). */
    enabled: boolean;
    /** Ollama model used for planning; never sees pixels (`AGENT_PLANNER_MODEL`). */
    plannerModel: string;
    /** Ollama VLM used for `look` / `scan_room` (`AGENT_VISION_MODEL`). */
    visionModel: string;
    /**
     * Let the planner model think before answering (`AGENT_PLANNER_THINKING`).
     * Default OFF — see `visionThinking` for why the two roles differ.
     */
    plannerThinking: boolean;
    /**
     * How long a whole planning round may take before the plan gives up
     * (`AGENT_PLANNER_TIMEOUT_MS`). One budget for the planner's two attempts,
     * not one per call — a wedged model must not cost twice the deadline.
     *
     * Default 300 s, chosen against two measurements rather than taste. A
     * legitimate plan took 3.5 minutes once on a healthy small model, so
     * anything under ~4 minutes would fail work that was going to succeed.
     * On the other side, GPU_BOX 2026-08-02: Ollama kept advertising
     * `gemma4:e2b` as loaded after its worker had died, every request hung, and
     * two commands sat in `planning` for the 240 s the harness allowed and were
     * still there when it gave up. Without a deadline those two states — "a
     * small model is thinking" and "the model is never going to answer" — are
     * the same screen forever. 300 s keeps the slow-but-working case and turns
     * the wedged one into an answer within minutes instead of a whole shift.
     */
    plannerTimeoutMs: number;
    /**
     * Let the vision model think before answering (`AGENT_VISION_THINKING`).
     * Default ON.
     *
     * Measured on gemma4:e2b (thinking is on by default in Ollama 0.32):
     * thinking costs ~10 s and ~500 generated tokens per call, so switching it
     * off roughly halves Agent Mode latency — a `scan_room 8` drops from ~3.5
     * to ~2.5 minutes. What it costs is rule adherence, and the two roles pay
     * different prices:
     *
     *  - Planner (3 of 7 commands degraded): "turn left" gains an invented
     *    `walk 0.5 m`, "dreh dich nach links" a `walk` with no distance at all,
     *    and "wave with your left hand" loses the `speak` block that says the
     *    gesture is right-arm only. The first two are caught downstream (schema
     *    validation, then the repair attempt); none of them steer the robot
     *    anywhere it was not told to go.
     *  - Vision (5 out-of-fan bearings across 3 of 4 real sim frames, against
     *    1 across 4 with thinking on): chair at 120°, door at 180°, wall at 90°
     *    on frames where the prompt allows ±60. `parseVisionAnswer` clamps
     *    those to ±90 rather than dropping them, so a hallucinated bearing
     *    enters scene memory as a confident hard-left heading, and
     *    `SceneMemoryStore.merge` lets it overwrite a real sighting. Bearings
     *    are already the weakest part of this pipeline; this is the one place
     *    where the speed is not worth it.
     */
    visionThinking: boolean;
    /**
     * Ollama OpenAI-compatible endpoint for the agent-mode models. Falls back to
     * the main `OLLAMA_BASE_URL`, then to the local default, so Agent Mode works
     * even when the main agent runs on Gemini/OpenRouter.
     */
    ollamaBaseUrl: string;
    /** Idle person-watcher period in ms (`AGENT_IDLE_WATCH_INTERVAL_MS`). */
    idleWatchIntervalMs: number;
    /** `goto` abort threshold in navigation stages (`AGENT_MAX_NAV_STAGES`). */
    maxNavStages: number;
    /** Walking speed used to convert `walk.distanceM` → duration (`AGENT_WALK_SPEED_MPS`). */
    walkSpeedMps: number;
    /**
     * COMMANDED forward velocity, m/s (`AGENT_WALK_COMMAND_MPS`). `0` — the
     * default — keeps the legacy coupling, in which `walkSpeedMps` supplies
     * both the commanded vx and the speed the DURATION is derived from.
     *
     * Those are not the same number on a base with a stepping threshold. The
     * Isaac G1 does not initiate a gait at all below ~0.5 m/s commanded
     * (measured: vx 0.3 -> 0.4% of commanded, vx 0.5 -> 16.6%), and the sim
     * clamps vx at MAX_VX = 1.5, so the commanded value has a floor AND a
     * ceiling that have nothing to do with how fast the robot actually gets
     * anywhere.
     */
    walkCommandMps: number;
    /**
     * ACHIEVED forward speed, m/s (`AGENT_WALK_ACHIEVED_MPS`), used to turn a
     * distance into a hold duration. `0` -> `walkSpeedMps`.
     *
     * Measured against the sim's true root pose (rt/sim_state), NOT against
     * odometry: vx 1.0 -> 0.276 m/s, vx 1.5 -> 0.341 m/s, i.e. roughly a
     * quarter of what is asked for. Deriving the duration from the COMMANDED
     * speed instead makes every walk about 4x too short, and a 1 m walk becomes
     * a 0.67 s command that does not outlast the base's own gait initiation --
     * the robot then does not move at all, which is exactly what it did.
     */
    walkAchievedMps: number;
    /** Turn rate used to convert `turn.angleDeg` → duration (`AGENT_TURN_SPEED_DPS`). */
    turnSpeedDps: number;
    /**
     * COMMANDED angular velocity for an IN-PLACE rotation, rad/s
     * (`AGENT_TURN_COMMAND_RAD_S`). `0` — the default — keeps the legacy
     * coupling, in which `turnSpeedDps` supplies both the commanded omega
     * (`turnSpeedDps × π/180`) and the rate the duration is derived from.
     *
     * It exists because those are two different physical quantities on a base
     * whose locomotion policy has a DEADBAND. Measured on the Isaac factory rig
     * (2026-08-29), in place, commanded rad/s → achieved deg/s:
     *
     * ```
     *   0.60 → left +0.11  right −0.25   (both effectively dead)
     *   0.79 → left +0.10  right −3.5
     *   0.90 → left +0.51  right −5.45
     *   1.20 → left +5.09  right −14.73
     *   1.60 → left +7.88  right −13.89
     *   2.00 → left +9.29  right −20.35
     * ```
     *
     * The default `turnSpeedDps` of 45 °/s is 0.785 rad/s — INSIDE that
     * deadband, which is why an in-place turn on that rig achieves ~0°. The
     * commanded omega has to go UP past ~0.9 rad/s while the duration has to be
     * computed from a much LOWER achieved rate, so one knob cannot do both.
     */
    turnCommandRadS: number;
    /**
     * ACHIEVED yaw rate turning LEFT (CCW, +omega) in deg/s, used to size a
     * turn's DURATION (`AGENT_TURN_ACHIEVED_DPS_LEFT`). `0` — the default —
     * falls back to `turnSpeedDps`, i.e. today's behaviour exactly.
     *
     * Split from the right-hand rate because the asymmetry is real and lives in
     * the vendor's trained locomotion policy, not in this code: at 2.00 rad/s
     * the rig measured +9.29 °/s left against −20.35 °/s right. It cannot be
     * fixed here, only compensated.
     */
    turnAchievedDpsLeft: number;
    /**
     * ACHIEVED yaw rate turning RIGHT (CW, −omega) in deg/s
     * (`AGENT_TURN_ACHIEVED_DPS_RIGHT`). `0` → `turnSpeedDps`. See
     * {@link AgentModeConfig.turnAchievedDpsLeft}.
     */
    turnAchievedDpsRight: number;
    /**
     * The same three numbers for an ARC — a rotation issued with `vx > 0`
     * (`AGENT_TURN_ARC_COMMAND_RAD_S`). Each falls back to its in-place
     * counterpart when unset, which falls back to `turnSpeedDps`.
     *
     * Separate because forward motion partially lifts the deadband. Measured on
     * the same rig at `vx = 0.5` m/s, commanded rad/s → achieved deg/s:
     *
     * ```
     *   0.785 → left +4.68  right −9.51
     *   1.200 → left +8.41  right −13.78
     * ```
     *
     * 0.785 rad/s is dead in place and turns at 4.68 °/s while walking.
     */
    turnArcCommandRadS: number;
    /** Achieved LEFT yaw rate while arcing, deg/s (`AGENT_TURN_ARC_ACHIEVED_DPS_LEFT`). */
    turnArcAchievedDpsLeft: number;
    /** Achieved RIGHT yaw rate while arcing, deg/s (`AGENT_TURN_ARC_ACHIEVED_DPS_RIGHT`). */
    turnArcAchievedDpsRight: number;
    /**
     * Fraction of a COMMANDED forward distance an arc actually covers
     * (`AGENT_ARC_TRAVEL_GAIN`), `0 < gain ≤ 1`. Default `1` — assume the base
     * goes as far as it is told, which is today's behaviour exactly.
     *
     * It converts a caller's budget that is denominated in REAL metres — the
     * navigator's stage alignment budget, which is a measured distance to the
     * target and which the navigator then reduces by the arc's MEASURED
     * displacement — into the commanded metres the executor actually spends.
     * Without it a base that covers 31% of what it commands is charged 3.2× for
     * every arc, and the alignment runs out of budget long before it has turned.
     * The `walk` loop's own budget is in commanded metres and is NOT converted.
     *
     * It is a PRIOR, not a promise: the arc measures its own ratio as it runs
     * and holds its measured travel to the caller's real metres either way, so
     * a gain set lower than the base actually achieves costs the arc some
     * rotation and can no longer drive it past the stage it was aligning for.
     */
    arcTravelGain: number;
    /**
     * How an in-place LEFT (CCW) rotation is executed (`AGENT_LEFT_TURN_STRATEGY`).
     *
     * Exists because a locomotion policy can be asymmetric. Measured on the G1
     * checkpoint this platform drives (TASK-203): turning in place, a commanded
     * yaw of +0.3 … +1.0 rad/s (left) achieves a ratio of **0.01** — the robot
     * does not even step — while −0.3 … −1.0 rad/s (right) achieves 0.26–0.53.
     * A left turn is not slow there; it does not happen.
     *
     * - `direct` — command positive omega and take what comes. Correct for any
     *   base whose gait is symmetric, and the only honest choice when the
     *   asymmetry is unknown to be present.
     * - `mirror` — execute a left turn of θ as a right turn of θ − 360 (left 90°
     *   becomes right 270°). Same final heading, no translation, and it uses the
     *   direction that works.
     * - `auto` (default) — start `direct`; if the first closed-loop iteration of
     *   a left turn measures no rotation, switch that turn to `mirror` and
     *   remember it. A base that CAN turn left never trips the switch and so
     *   behaves exactly as `direct` — the asymmetry is detected, never assumed.
     */
    leftTurnStrategy: LeftTurnStrategy;
    /** Lower-cased words that bypass the planner and trigger an E-Stop (`AGENT_STOP_WORDS`). */
    stopWords: string[];
    /** Camera used by `look` / `scan_room` (`AGENT_CAMERA_NAME`). */
    cameraName: string;
    /**
     * Horizontal field of view of that camera in degrees (`AGENT_CAMERA_HFOV_DEG`).
     * The vision model reports WHERE in the frame something is; this turns that
     * into a bearing. Wrong value → every bearing is scaled wrong → `goto`
     * walks the wrong way, so set it per camera:
     *   sim `head_camera` (fovy 89 at 4:3) = 105.3 — the default
     *   RealSense D435i RGB = 69, its depth stream = 87
     */
    cameraHfovDeg: number;
    /**
     * Whether `look`/`scan_room` measure distances with the LiDAR
     * (`AGENT_RANGE_ENABLED`, default true — set to `false` to disable).
     * Off, or with no sidecar answering, Agent Mode keeps the VLM's distance
     * guess and `goto` falls back to arriving by walking into things.
     */
    rangeEnabled: boolean;
    /**
     * Depth/LiDAR sensor name asked of the sidecar (`AGENT_RANGE_SENSOR`).
     * `mid360_lidar` is what `hardware/g1_sidecar.py` publishes the real Livox
     * MID-360 as, and what `hardware/sim_g1_dds/sim_node.py` ray-casts under the
     * same HTTP contract.
     */
    rangeSensor: string;
    /** Returns beyond this say nothing actionable about the current block (`AGENT_RANGE_MAX_M`). */
    rangeMaxM: number;
    /**
     * Half-width in degrees of the cone searched around an entity's bearing
     * (`AGENT_RANGE_CONE_DEG`). Sized to the VLM's 7.2° bearing MAE.
     */
    rangeConeDeg: number;
    /**
     * Returns nearer than this are rejected (`AGENT_RANGE_MIN_M`). On the real
     * MID-360 roughly half of every raw frame is the sensor seeing its own
     * housing at < 0.3 m, so without this every bearing reads ~0 m.
     */
    rangeMinM: number;
    /**
     * Occupancy map (TASK-206): the robot's own 2D grid built from the same
     * clouds range sensing snapshots (`AGENT_MAP_ENABLED`, default = range
     * enabled). Off, the clouds are used once per observation and dropped.
     */
    mapEnabled: boolean;
    /** Cell edge in metres (`AGENT_MAP_RESOLUTION_M`, default 0.1). */
    mapResolutionM: number;
    /** Grid side cap in metres (`AGENT_MAP_MAX_M`, default 60). */
    mapMaxM: number;
    /** Where the map is persisted between processes (`AGENT_MAP_PATH`). */
    mapPath: string;
    /**
     * Extra snapshots per second while a walk/turn/goto block runs so the map
     * fills in between observations (`AGENT_MAP_SWEEP_HZ`, default 0 = off).
     * Reuses the range sensor's cache and failure backoff.
     */
    mapSweepHz: number;
    /** Seconds after which an un-observed cell drifts back to unknown (`AGENT_MAP_DECAY_S`, 0 = off). */
    mapDecayS: number;
    /**
     * World point cloud (TASK-211): the same lidar frames the grid integrates,
     * kept in 3-D, one point per voxel, in the odometry frame
     * (`AGENT_CLOUD_ENABLED`, default = map enabled).
     */
    cloudEnabled: boolean;
    /** Voxel edge in metres (`AGENT_CLOUD_VOXEL_M`, default 0.05). */
    cloudVoxelM: number;
    /** Hard cap on stored points; oldest-seen go first (`AGENT_CLOUD_MAX_POINTS`, default 300000). */
    cloudMaxPoints: number;
    /** Where the cloud is persisted (`AGENT_CLOUD_PATH`, default = map path with `.cloud.json`). */
    cloudPath: string;
    /**
     * How often to ask the server where the OTHER robots are, in ms
     * (`AGENT_PEERS_POLL_MS`, default 2000 — the pose poll's cadence; 0 = off).
     * Peers in a different odometry frame are dropped, never drawn (TASK-207).
     */
    peersPollMs: number;
    /** A peer closer than this, ahead of the robot, enters scene memory (`AGENT_PEERS_NOTICE_M`, default 3). */
    peersNoticeM: number;
    /**
     * How `goto` chooses its stages (TASK-208): `grid` plans a path on the
     * occupancy map and walks its segments; `staged` is the pre-map loop —
     * turn toward the target, walk ≤ 1 m, look, repeat (`AGENT_NAV_PLANNER`,
     * default `grid` when the map is enabled, else `staged`).
     */
    navPlanner: 'grid' | 'staged';
    /** Cost multiplier for planning across UNKNOWN cells (`AGENT_NAV_UNKNOWN_COST`, default 3). */
    navUnknownCost: number;
    /** Longest single planned walk stage in metres (`AGENT_NAV_MAX_SEGMENT_M`, default 2). */
    navMaxSegmentM: number;
    /** A planned route looks (VLM + lidar) at least every this many metres (`AGENT_NAV_LOOK_EVERY_M`, default 2). */
    navLookEveryM: number;
    /**
     * Extra clearance, in metres, the map planner keeps beyond the robot's own
     * footprint radius (`AGENT_NAV_PATH_MARGIN_M`, default 0.05).
     *
     * Measured (TASK-209, house scene): a path string-pulled past the living-room
     * arch post at 0.353 m — a hair outside the 0.35 m footprint disc — was then
     * refused by the executor, whose lidar corridor is the same 0.35 m half-width
     * plus a 0.45 m stopping margin, and every re-plan gave the same segment. The
     * planner has to keep paths where the walk clamps will let the robot go.
     * As small as it is because the house's 1.1 m doorways map as a 1.0 m free
     * gap (post cells plus beam width): 0.10 already found "no path" through
     * the bedroom door on the live map, 0.05 passes it and clears the post.
     */
    navPathMarginM: number;
    /** Voice service for `speak`; text-only when unreachable (`VOICE_SERVICE_URL`). */
    voiceServiceUrl: string;
    /**
     * Heartbeat (TASK-199): the robot noticing things while nobody is talking
     * to it. Opt-IN per deployment — this is the pillar with the highest blast
     * radius, and a robot that speaks up on its own is a decision an operator
     * makes, not a default they discover.
     */
    heartbeat: {
      /** `AGENT_HEARTBEAT_ENABLED`, default **false**. */
      enabled: boolean;
      /** Shortest gap between two tier-1 passes (`AGENT_HEARTBEAT_MIN_INTERVAL_MS`). */
      minIntervalMs: number;
      /**
       * Local-time window in which the heartbeat may speak at all
       * (`AGENT_HEARTBEAT_ACTIVE_HOURS`, e.g. `8-20`; `22-6` wraps midnight).
       * Empty = always active. Kept as the RAW string: `heartbeat.ts` owns the
       * parse, and a typo has to be reportable rather than silently disabling
       * proactivity.
       */
      activeHours: string;
      /** Below this the robot says so (`AGENT_HEARTBEAT_BATTERY_PCT`). */
      batteryPct: number;
      /**
       * Self-initiated MOTION (`AGENT_HEARTBEAT_MOTION`), default **false**.
       * Still read by nothing.
       *
       * TASK-200 removed the reason it could not exist — `zone_violation` is
       * enforced now, so "the agent decided to walk somewhere" is bounded by a
       * real fence rather than by a prompt. What is missing is the other half:
       * a heartbeat that may WALK needs its own answer to where it is allowed
       * to walk TO, and the allow-list in `HEARTBEAT_ALLOWED_KINDS` is
       * deliberately still look/speak/wait/remember until it has one.
       */
      motion: boolean;
    };
    /**
     * Patrol (TASK-212): the robot walks an operator-defined route, takes
     * control photos at checkpoints and compares what it sees against a
     * baseline of "normal". Opt-in per deployment — a photographing robot that
     * walks unattended is a decision an operator makes.
     */
    patrol: {
      /** `AGENT_PATROL_ENABLED`, default **false**. Every start is refused (`disabled`) while off. */
      enabled: boolean;
      /** Disk cache of routes fetched from the server (`AGENT_PATROL_ROUTE_CACHE_PATH`). */
      routeCachePath: string;
      /** Confirmer: N of the last M consecutive observations must agree (`AGENT_PATROL_CONFIRM_N` / `_M`, 2 / 3). */
      confirmN: number;
      confirmM: number;
      /** Smallest map-diff blob reported as an object, m² (`AGENT_PATROL_MIN_BLOB_M2`, 0.15). */
      minBlobM2: number;
      /** Map diff radius around the pose, m (`AGENT_PATROL_DIFF_RADIUS_M`, 6). */
      diffRadiusM: number;
      /** Labels a new en-route entity must contain to become a candidate (`AGENT_PATROL_WATCHLIST`). */
      watchlist: string[];
      /** Plain control photos are deleted after this many hours (`AGENT_PATROL_PHOTO_RETENTION_H`, 72). */
      photoRetentionH: number;
      /** pHash similarity at or above which a checkpoint is `unchanged` without a model call (`AGENT_PATROL_HASH_GATE`, 0.97 — measured: 0.92 let a 0.6 m crate 4.5 m ahead pass as unchanged on the house scene, similarity 0.938). */
      hashGate: number;
      /** Fallback home place when the route names none (`AGENT_PATROL_HOME_PLACE`, empty = stay). */
      homePlace: string;
      /** Language of the two spoken patrol lines (`AGENT_PATROL_LANGUAGE`, `en` | `de`, default `en`). */
      language: 'en' | 'de';
    };
    /**
     * Host mode (TASK-213): the robot greets a visitor, offers a tour, walks
     * them to authored stops and answers their questions from authored facts.
     * Opt-in per deployment, like patrol — a robot that talks to the public
     * unprompted is a decision an operator makes, not a default.
     */
    tour: {
      /** `AGENT_HOST_ENABLED`, default **false**. Every start is refused (`disabled`) while off. */
      enabled: boolean;
      /** The route this robot hosts (`AGENT_TOUR_ROUTE_ID`); empty = no auto-greet, operator starts name a route. */
      routeId: string;
      /** Disk cache of tour routes fetched from the server (`AGENT_TOUR_ROUTE_CACHE_PATH`). */
      routeCachePath: string;
      /** How long the robot waits for a yes/no after asking (`AGENT_TOUR_REPLY_WINDOW_MS`, 30 000). */
      replyWindowMs: number;
      /** Default seconds a stop waits for questions when the route does not say (`AGENT_TOUR_DWELL_S`, 12). */
      dwellS: number;
      /**
       * Personal distance, m (`TOUR_MIN_PERSON_M`, 1.2 — the upper bound of
       * Hall's personal zone). The robot asks for room rather than walking
       * into somebody standing closer than this; `AGENT_RANGE_MIN_M` remains
       * the safety floor that actually stops it.
       */
      minPersonM: number;
      /**
       * What a `demo` block does (`TOUR_DEMO_MODE`, `narrate` | `execute`).
       * Defaults to `narrate` because the apple scene is a FIXED-BASE G1: a
       * robot that can walk a tour cannot, in that scene, also pick the apple.
       */
      demoMode: 'execute' | 'narrate';
      /** Keep the questions and answers of a tour (`TOUR_TRANSCRIPT_ENABLED`, true). */
      transcriptEnabled: boolean;
      /** Days a transcript is kept before it is cleared (`TOUR_TRANSCRIPT_RETENTION_DAYS`, 30). */
      transcriptRetentionDays: number;
      /**
       * Appended to the AI-disclosure sentence (`TOUR_DISCLOSURE_EXTRA`), e.g.
       * the name of the controller. It can only ADD — the disclosure itself
       * lives in `host.ts` and is not configurable away.
       */
      disclosureExtra: string;
    };
  };
  /**
   * Place awareness (TASK-195): the robot's continuously maintained answer to
   * "where am I?" — a metric pose from the existing 2 s hardware poll, resolved
   * against a hand-authored place graph.
   */
  place: {
    /**
     * Path to the place graph JSON (`PLACE_GRAPH_PATH`), e.g.
     * `hardware/sim_evaluator/places/places.warehouse.json`.
     *
     * Empty by default, and that default is the honest one: without a surveyed
     * map the robot has no vocabulary of places, so every answer is UNKNOWN.
     * Defaulting to the warehouse graph would make a robot in the room scene
     * confidently name warehouse aisles it has never been in.
     */
    graphPath: string;
    /**
     * Accumulated translation, in metres, after which the place belief degrades
     * to `stale` (`PLACE_DRIFT_BUDGET_M`, default
     * {@link DEFAULT_PLACE_DRIFT_BUDGET_M} = 15 — ONE constant, shared with the
     * resolver's own default so the two cannot drift apart).
     *
     * 15 m is roughly one length of the 20 m warehouse hall: far enough that a
     * normal errand does not spend the budget, short enough that a robot which
     * has crossed the building without a re-anchor says so.
     */
    driftBudgetM: number;
    /**
     * How far inside a polygon the robot must be before a place change commits
     * (`PLACE_HYSTERESIS_MARGIN_M`, default 0.30).
     *
     * Sized to the shared edges in the shipped graphs — aisle mouths and dock
     * thresholds — which is exactly where a naive resolver flaps. It is also
     * comfortably above the G1's own footprint jitter at a standstill.
     */
    hysteresisMarginM: number;
    /**
     * DEV-ONLY fault injection (`PLACE_FAULT_NULL_POSE`): make the cached pose
     * read as `null` while locomotion keeps working.
     *
     * It exists because the obvious way to demo the honesty rule — killing the
     * sidecar — also kills `driveFor`, so the plan aborts and you get a *failed
     * block* rather than a clean "Place unknown" rendered mid-walk.
     */
    faultNullPose: boolean;
    /**
     * `DigitalTwin` id whose zones define this robot's places (`PLACE_TWIN_ID`,
     * TASK-200). Empty by default.
     *
     * Load-bearing rather than convenient: twins are NOT mutually registered —
     * each one's origin is an arbitrary robot pose at scan start — so a graph
     * fetched for the wrong twin is expressed about the wrong origin and is
     * REJECTED, not adapted. `PLACE_GRAPH_PATH` still wins when both are set:
     * an explicit local file is the sim/bench escape hatch.
     */
    twinId: string;
    /**
     * Where the fetched place graph is cached (`PLACE_GRAPH_CACHE_PATH`).
     *
     * The robot boots from this file, not from the network: Agent Mode's
     * contract is that the platform being down never stalls a block, and that
     * has to include finding out where the robot is standing.
     */
    cachePath: string;
    /**
     * How far OUTSIDE a keepout polygon still counts as a violation, in metres
     * (`PLACE_KEEPOUT_MARGIN_M`, default 0.50).
     *
     * Sized to the robot, not the map — see `agent-mode/geofence.ts`. Fencing
     * the polygon exactly means the stop fires when the robot is already in the
     * rack.
     */
    keepoutMarginM: number;
  };
}

/**
 * The shipped g1-edu profile (.env.g1-edu) carries a German, ASCII-transliterated
 * ROBOT_DESCRIPTION. Agent-facing surfaces (agent card, AI prompt context) must
 * be English, so the known legacy string is mapped here; any other value passes
 * through untouched. New profiles should set an English description directly.
 */
const LEGACY_DESCRIPTION_TRANSLATIONS: Record<string, string> = {
  'Physischer Unitree G1 EDU Humanoid (43 DOF inkl. Dex3-1 Haende), Telemetrie read-only ueber DDS-ZMQ-Bridge':
    'Physical Unitree G1 EDU humanoid (43 DOF incl. Dex3-1 hands), telemetry read-only via DDS-ZMQ bridge',
};

function normalizeRobotDescription(raw: string): string {
  return LEGACY_DESCRIPTION_TRANSLATIONS[raw] ?? raw;
}

/**
 * Default Ollama model for both Agent Mode roles (planner + vision). Declared
 * before `config` because the config initializer reads it (a `const` below the
 * initializer would still be in its temporal dead zone).
 */
export const DEFAULT_AGENT_MODEL = 'gemma3:4b';

/**
 * A number from the environment, or the fallback when it is missing OR unusable.
 *
 * `parseFloat('' )` and `parseFloat('105,3')`-style typos yield NaN, and NaN
 * propagates silently through geometry: a NaN camera HFOV makes every bearing
 * NaN, `normalizeDeg` folds NaN to 0 (types.ts), and the navigator then plans no
 * correction turn at all because `Math.abs(0) > BEARING_DEADBAND_DEG` is false —
 * the robot walks dead ahead past whatever it was aimed at, with nothing in any
 * log to say why. A misconfigured value must fall back to the default, loudly in
 * the startup banner, not disable steering.
 */
function envFloat(raw: string | undefined, fallback: number): number {
  const n = parseFloat(raw ?? '');
  return Number.isFinite(n) ? n : fallback;
}

/**
 * A number from the environment that must also satisfy `accepts`, or the
 * fallback — with the reason on stderr the moment it is parsed.
 *
 * `envFloat` above is enough wherever every finite number is meaningful. It is
 * not enough for a value with a legal *range*. `VLA_RTC_OVERLAP=25` parses as a
 * perfectly finite 25, and a prefetch threshold of `chunkSize * 25` sits above
 * the queue length from the first step on, so RTC would fire a `/predict` every
 * single step — a flood of the inference server wearing the costume of a typo.
 * `VLA_RTC_OVERLAP=0` is the mirror image: the threshold is never crossed, so
 * the banner says RTC is enabled while the loop behaves exactly like the serial
 * one, and the boundary stalls it was turned on to remove are still there.
 *
 * Out-of-range values are REJECTED — replaced by the documented default — not
 * clamped. Clamping invents a number the operator never wrote and then behaves
 * as if they had meant it, which is how a typo becomes a tuning result nobody
 * can reproduce. The default is at least written down in `.env.example` and
 * printed in the boot banner, so a run is explicable from what an operator can
 * read. Rejecting outright (throwing) was the third option and is wrong here
 * for the same reason `envFloat` exists: RTC is an opt-in optimisation, and a
 * mistyped optimisation must not be the thing that stops a robot from booting.
 */
function envNumberChecked(
  name: string,
  raw: string | undefined,
  fallback: number,
  accepts: (n: number) => boolean,
  expected: string
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = parseFloat(raw);
  if (Number.isFinite(n) && accepts(n)) return n;
  console.warn(
    `[Config] WARNING ${name}=${raw} is not ${expected} — ignoring it and using ${fallback}.`
  );
  return fallback;
}

/**
 * `AGENT_NAV_PLANNER`: `grid` | `staged`. Unset follows the map — a planner
 * without a map has nothing to plan on and would fall back to `staged` on
 * every navigation anyway, so it is not worth pretending otherwise at boot.
 */
function mapEnabledFromEnv(): boolean {
  return process.env.AGENT_MAP_ENABLED === undefined
    ? process.env.AGENT_RANGE_ENABLED !== 'false'
    : process.env.AGENT_MAP_ENABLED === 'true';
}

/**
 * `AGENT_LEFT_TURN_STRATEGY`: `direct` | `mirror` | `auto`. Anything else —
 * including a typo — falls back to `auto`, which is `direct` until a left turn
 * is MEASURED to do nothing. Failing open to `direct` would be the same choice
 * on a symmetric base and a worse one on the asymmetric checkpoint.
 */
function leftTurnStrategyFromEnv(): LeftTurnStrategy {
  const raw = (process.env.AGENT_LEFT_TURN_STRATEGY || '').trim().toLowerCase();
  if (raw === 'direct' || raw === 'mirror' || raw === 'auto') return raw;
  return 'auto';
}

function navPlannerFromEnv(): 'grid' | 'staged' {
  const raw = (process.env.AGENT_NAV_PLANNER || '').trim().toLowerCase();
  if (raw === 'grid' || raw === 'staged') return raw;
  const mapEnabled =
    process.env.AGENT_MAP_ENABLED === undefined
      ? process.env.AGENT_RANGE_ENABLED !== 'false'
      : process.env.AGENT_MAP_ENABLED === 'true';
  return mapEnabled ? 'grid' : 'staged';
}

export const config: Config = {
  port: parseInt(process.env.PORT || '41243', 10),
  robotId: process.env.ROBOT_ID || 'sim-robot-001',
  robotName: process.env.ROBOT_NAME || 'SimBot-01',
  robotModel: process.env.ROBOT_MODEL || 'SimBot H1',
  robotClass: (process.env.ROBOT_CLASS as RobotClass) || 'standard',
  robotType: (process.env.ROBOT_TYPE as RobotType) || 'h1',
  maxPayloadKg: parseFloat(process.env.MAX_PAYLOAD_KG || '10'),
  robotDescription: normalizeRobotDescription(
    process.env.ROBOT_DESCRIPTION || 'A versatile humanoid robot for general tasks'
  ),
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  llmProvider: (process.env.LLM_PROVIDER as 'gemini' | 'openrouter' | 'ollama') || 'gemini',
  openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
  llmModel: process.env.LLM_MODEL || '',
  initialLocation: {
    x: parseFloat(process.env.INITIAL_X || '10.0'),
    y: parseFloat(process.env.INITIAL_Y || '10.0'),
    floor: process.env.INITIAL_FLOOR || '1',
    zone: process.env.INITIAL_ZONE || 'Warehouse A',
  },
  zoneCacheTtlMs: parseInt(process.env.ZONE_CACHE_TTL_MS || '60000', 10), // 1 minute default
  serverUrl: process.env.SERVER_URL || 'http://localhost:3001',
  vla: {
    host: process.env.VLA_INFERENCE_HOST || 'localhost',
    port: parseInt(process.env.VLA_INFERENCE_PORT || '8000', 10),
    poolSize: parseInt(process.env.VLA_CONNECTION_POOL_SIZE || '4', 10),
    healthCheckIntervalMs: parseInt(process.env.VLA_HEALTH_CHECK_INTERVAL_MS || '5000', 10),
    timeoutMs: parseInt(process.env.VLA_TIMEOUT_MS || '5000', 10),
    restFallbackUrl: process.env.VLA_REST_FALLBACK_URL || undefined,
    enabled: process.env.VLA_ENABLED === 'true',
    // Range-checked for the same reason the RTC knobs are: 0 is a finite
    // number and an unthrottled rollout loop. The upper bound is a sanity
    // ceiling rather than a derived one — see the doc comment on
    // `loopPeriodMs` above. See envNumberChecked.
    loopPeriodMs: envNumberChecked(
      'VLA_LOOP_PERIOD_MS',
      process.env.VLA_LOOP_PERIOD_MS,
      200,
      (n) => n > 0 && n <= 5_000,
      'a period in ms in (0, 5000]'
    ),
    rtc: {
      // `=== 'true'` like every other opt-in flag here. hardware/vla_runner.py
      // reads the same VLA_RTC_ENABLED but accepts 'true'/'1'/'yes', so a `=1`
      // that switched RTC on for the orphaned Python runner leaves it off here.
      enabled: process.env.VLA_RTC_ENABLED === 'true',
      // Range-checked rather than a bare envFloat: an overlap of 0 or 25 is a
      // finite number and a broken rollout loop. See envNumberChecked.
      overlap: envNumberChecked(
        'VLA_RTC_OVERLAP',
        process.env.VLA_RTC_OVERLAP,
        0.25,
        (n) => n > 0 && n <= 1,
        'a fraction in (0, 1]'
      ),
      blendSteps: envNumberChecked(
        'VLA_RTC_BLEND_STEPS',
        process.env.VLA_RTC_BLEND_STEPS,
        5,
        (n) => Number.isInteger(n) && n >= 0,
        'a whole number of steps >= 0'
      ),
    },
  },
  telemetry: {
    fastIntervalMs: parseInt(process.env.TELEMETRY_FAST_INTERVAL_MS || '100', 10),
    fullIntervalMs: parseInt(process.env.TELEMETRY_FULL_INTERVAL_MS || '2000', 10),
  },
  agentMode: {
    enabled: process.env.AGENT_MODE_ENABLED === 'true',
    plannerModel: process.env.AGENT_PLANNER_MODEL || DEFAULT_AGENT_MODEL,
    visionModel: process.env.AGENT_VISION_MODEL || DEFAULT_AGENT_MODEL,
    // Opt-IN for the planner, opt-OUT for vision: both env vars accept
    // 'true'/'false' and fall back to the measured default (see the interface).
    plannerThinking: process.env.AGENT_PLANNER_THINKING === 'true',
    // envFloat, not parseInt: a NaN deadline is worse than a wrong one.
    // `setTimeout(NaN)` fires on the next tick, so a typo'd value would time
    // every plan out instantly — the failure this knob exists to prevent,
    // caused by the knob itself.
    plannerTimeoutMs: envFloat(process.env.AGENT_PLANNER_TIMEOUT_MS, 300_000),
    visionThinking: process.env.AGENT_VISION_THINKING !== 'false',
    ollamaBaseUrl:
      process.env.AGENT_OLLAMA_BASE_URL ||
      process.env.OLLAMA_BASE_URL ||
      'http://localhost:11434/v1',
    idleWatchIntervalMs: parseInt(process.env.AGENT_IDLE_WATCH_INTERVAL_MS || '3000', 10),
    maxNavStages: parseInt(process.env.AGENT_MAX_NAV_STAGES || '12', 10),
    walkSpeedMps: parseFloat(process.env.AGENT_WALK_SPEED_MPS || '0.4'),
    turnSpeedDps: parseFloat(process.env.AGENT_TURN_SPEED_DPS || '45'),
    // Every one of these defaults to the sentinel that means "keep the legacy
    // coupling" (0 for a rate, 1 for a gain), so an unconfigured robot — the
    // warehouse rig and every other embodiment — is driven byte-for-byte as it
    // was before the Isaac deadband measurements existed. The new tuning is
    // strictly opt-in, per rig, through these env vars.
    walkCommandMps: envFloat(process.env.AGENT_WALK_COMMAND_MPS, 0),
    walkAchievedMps: envFloat(process.env.AGENT_WALK_ACHIEVED_MPS, 0),
    turnCommandRadS: envFloat(process.env.AGENT_TURN_COMMAND_RAD_S, 0),
    turnAchievedDpsLeft: envFloat(process.env.AGENT_TURN_ACHIEVED_DPS_LEFT, 0),
    turnAchievedDpsRight: envFloat(process.env.AGENT_TURN_ACHIEVED_DPS_RIGHT, 0),
    turnArcCommandRadS: envFloat(process.env.AGENT_TURN_ARC_COMMAND_RAD_S, 0),
    turnArcAchievedDpsLeft: envFloat(process.env.AGENT_TURN_ARC_ACHIEVED_DPS_LEFT, 0),
    turnArcAchievedDpsRight: envFloat(process.env.AGENT_TURN_ARC_ACHIEVED_DPS_RIGHT, 0),
    arcTravelGain: envFloat(process.env.AGENT_ARC_TRAVEL_GAIN, 1),
    leftTurnStrategy: leftTurnStrategyFromEnv(),
    stopWords: (process.env.AGENT_STOP_WORDS || 'stopp,stop,halt')
      .split(',')
      .map((w) => w.trim().toLowerCase())
      .filter((w) => w.length > 0),
    cameraName: process.env.AGENT_CAMERA_NAME || 'head_camera',
    cameraHfovDeg: envFloat(process.env.AGENT_CAMERA_HFOV_DEG, 105.3),
    // Range sensing. Opt-OUT: the honest default is "try the sidecar, and fall
    // back to the old bearing-only behaviour when it is not there" — the VLM
    // cannot supply a distance (0.94 m MAE, usually null), so without this the
    // robot only ever "arrives" by walking into things.
    rangeEnabled: process.env.AGENT_RANGE_ENABLED !== 'false',
    // The name the G1 sidecar publishes the Livox MID-360 under, and the one the
    // MuJoCo sim mirrors — so the same value works against robot and sim.
    rangeSensor: process.env.AGENT_RANGE_SENSOR || 'mid360_lidar',
    rangeMaxM: parseFloat(process.env.AGENT_RANGE_MAX_M || '12'),
    // Cone half-width for "how far is the thing at that bearing". 8° is sized to
    // the VLM's own 7.2° bearing MAE (see vision.ts): a narrower cone would miss
    // the object it is aimed at and report "nothing there".
    rangeConeDeg: parseFloat(process.env.AGENT_RANGE_CONE_DEG || '8'),
    // Returns nearer than this are the sensor seeing its own housing — about
    // half of every raw MID-360 frame sits below 0.3 m.
    rangeMinM: parseFloat(process.env.AGENT_RANGE_MIN_M || '0.35'),
    // Occupancy map. Default follows range sensing: a map fed by nothing is
    // just an empty file, so there is no point keeping it on without a sensor.
    mapEnabled: mapEnabledFromEnv(),
    mapResolutionM: parseFloat(process.env.AGENT_MAP_RESOLUTION_M || '0.1'),
    mapMaxM: parseFloat(process.env.AGENT_MAP_MAX_M || '60'),
    mapPath: process.env.AGENT_MAP_PATH || './data/occupancy-map.json',
    mapSweepHz: parseFloat(process.env.AGENT_MAP_SWEEP_HZ || '0'),
    mapDecayS: parseFloat(process.env.AGENT_MAP_DECAY_S || '0'),
    cloudEnabled:
      process.env.AGENT_CLOUD_ENABLED === undefined
        ? mapEnabledFromEnv()
        : process.env.AGENT_CLOUD_ENABLED === 'true',
    cloudVoxelM: parseFloat(process.env.AGENT_CLOUD_VOXEL_M || '0.05'),
    cloudMaxPoints: parseInt(process.env.AGENT_CLOUD_MAX_POINTS || '300000', 10),
    cloudPath:
      process.env.AGENT_CLOUD_PATH ||
      (process.env.AGENT_MAP_PATH || './data/occupancy-map.json').replace(/\.json$/, '') + '.cloud.json',
    peersPollMs: parseInt(process.env.AGENT_PEERS_POLL_MS || '2000', 10),
    peersNoticeM: parseFloat(process.env.AGENT_PEERS_NOTICE_M || '3'),
    navPlanner: navPlannerFromEnv(),
    navUnknownCost: parseFloat(process.env.AGENT_NAV_UNKNOWN_COST || '3'),
    navMaxSegmentM: parseFloat(process.env.AGENT_NAV_MAX_SEGMENT_M || '2'),
    navLookEveryM: parseFloat(process.env.AGENT_NAV_LOOK_EVERY_M || '2'),
    navPathMarginM: parseFloat(process.env.AGENT_NAV_PATH_MARGIN_M || '0.05'),
    voiceServiceUrl: process.env.VOICE_SERVICE_URL || 'http://localhost:8768',
    heartbeat: {
      enabled: process.env.AGENT_HEARTBEAT_ENABLED === 'true',
      minIntervalMs: parseInt(process.env.AGENT_HEARTBEAT_MIN_INTERVAL_MS || '300000', 10),
      activeHours: process.env.AGENT_HEARTBEAT_ACTIVE_HOURS || '',
      batteryPct: envFloat(process.env.AGENT_HEARTBEAT_BATTERY_PCT, 20),
      motion: process.env.AGENT_HEARTBEAT_MOTION === 'true',
    },
    patrol: {
      enabled: process.env.AGENT_PATROL_ENABLED === 'true',
      routeCachePath: process.env.AGENT_PATROL_ROUTE_CACHE_PATH || './data/patrol-routes-cache.json',
      confirmN: parseInt(process.env.AGENT_PATROL_CONFIRM_N || '2', 10),
      confirmM: parseInt(process.env.AGENT_PATROL_CONFIRM_M || '3', 10),
      minBlobM2: envFloat(process.env.AGENT_PATROL_MIN_BLOB_M2, 0.15),
      diffRadiusM: envFloat(process.env.AGENT_PATROL_DIFF_RADIUS_M, 6),
      watchlist: (process.env.AGENT_PATROL_WATCHLIST || 'person,box,bag,crate,bottle,puddle,ladder,cable,open door')
        .split(',')
        .map((w) => w.trim().toLowerCase())
        .filter(Boolean),
      photoRetentionH: envFloat(process.env.AGENT_PATROL_PHOTO_RETENTION_H, 72),
      hashGate: envFloat(process.env.AGENT_PATROL_HASH_GATE, 0.97),
      homePlace: process.env.AGENT_PATROL_HOME_PLACE || '',
      language: process.env.AGENT_PATROL_LANGUAGE === 'de' ? 'de' : 'en',
    },
    tour: {
      enabled: process.env.AGENT_HOST_ENABLED === 'true',
      routeId: process.env.AGENT_TOUR_ROUTE_ID || '',
      routeCachePath: process.env.AGENT_TOUR_ROUTE_CACHE_PATH || './data/tour-routes-cache.json',
      replyWindowMs: envFloat(process.env.AGENT_TOUR_REPLY_WINDOW_MS, 30_000),
      dwellS: envFloat(process.env.AGENT_TOUR_DWELL_S, 12),
      minPersonM: envFloat(process.env.TOUR_MIN_PERSON_M, 1.2),
      demoMode: process.env.TOUR_DEMO_MODE === 'execute' ? 'execute' : 'narrate',
      transcriptEnabled: process.env.TOUR_TRANSCRIPT_ENABLED !== 'false',
      transcriptRetentionDays: envFloat(process.env.TOUR_TRANSCRIPT_RETENTION_DAYS, 30),
      disclosureExtra: process.env.TOUR_DISCLOSURE_EXTRA || '',
    },
  },
  place: {
    // No default map: see the interface. UNKNOWN is the honest answer for a
    // robot nobody has handed a survey to.
    graphPath: process.env.PLACE_GRAPH_PATH || '',
    driftBudgetM: envFloat(process.env.PLACE_DRIFT_BUDGET_M, DEFAULT_PLACE_DRIFT_BUDGET_M),
    hysteresisMarginM: envFloat(process.env.PLACE_HYSTERESIS_MARGIN_M, 0.3),
    faultNullPose: process.env.PLACE_FAULT_NULL_POSE === 'true',
    twinId: process.env.PLACE_TWIN_ID || '',
    cachePath: process.env.PLACE_GRAPH_CACHE_PATH || './data/place-graph-cache.json',
    keepoutMarginM: envFloat(process.env.PLACE_KEEPOUT_MARGIN_M, 0.5),
  },
};

/** Default model names per provider */
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
export const DEFAULT_OPENROUTER_MODEL = 'stepfun/step-3.5-flash:free';
export const DEFAULT_OLLAMA_MODEL = 'gpt-oss:20b';

/** Resolve the active model name based on provider config */
export function getActiveModelName(): string {
  if (config.llmProvider === 'openrouter') {
    return config.llmModel || DEFAULT_OPENROUTER_MODEL;
  }
  if (config.llmProvider === 'ollama') {
    return config.llmModel || DEFAULT_OLLAMA_MODEL;
  }
  return config.llmModel || DEFAULT_GEMINI_MODEL;
}

export function validateConfig(): void {
  if (config.llmProvider === 'openrouter') {
    if (!config.openrouterApiKey) {
      console.warn('[Config] Warning: LLM_PROVIDER=openrouter but OPENROUTER_API_KEY not set. AI features will fail.');
    }
  } else if (config.llmProvider === 'ollama') {
    console.log(`[Config] Using local Ollama provider at ${config.ollamaBaseUrl}. Ensure the model is pulled (ollama pull ${getActiveModelName()}).`);
  } else if (!config.geminiApiKey) {
    console.warn('[Config] Warning: GEMINI_API_KEY not set. AI features will be limited.');
  }

  if (!config.robotId) {
    throw new Error('[Config] ROBOT_ID is required');
  }

  console.log('[Config] Loaded configuration:');
  console.log(`  - Port: ${config.port}`);
  console.log(`  - Robot ID: ${config.robotId}`);
  console.log(`  - Robot Name: ${config.robotName}`);
  console.log(`  - Robot Class: ${config.robotClass}`);
  console.log(`  - Robot Type: ${config.robotType}`);
  console.log(`  - LLM Provider: ${config.llmProvider}`);
  console.log(`  - LLM Model: ${getActiveModelName()}`);
  console.log(`  - Max Payload: ${config.maxPayloadKg}kg`);
  console.log(`  - Initial Location: (${config.initialLocation.x}, ${config.initialLocation.y}) in ${config.initialLocation.zone}`);
  console.log(`  - VLA Inference: ${config.vla.enabled ? 'enabled' : 'disabled'}`);
  if (config.vla.enabled) {
    console.log(`    - Host: ${config.vla.host}:${config.vla.port}`);
    console.log(`    - Pool Size: ${config.vla.poolSize}`);
    console.log(`    - Health Check Interval: ${config.vla.healthCheckIntervalMs}ms`);
  }
  // Outside the `vla.enabled` guard on purpose: the skill executor's rollout
  // loop — the only thing RTC touches — runs whether or not VLA_ENABLED is set,
  // so hiding this line behind that flag would hide it from every profile that
  // actually uses it. Same for the loop period below, which every RTC figure
  // is a function of: a run is not explicable without the rate it ran at.
  console.log(
    `    - Rollout Loop Period: ${config.vla.loopPeriodMs}ms (${
      Math.round((1000 / config.vla.loopPeriodMs) * 10) / 10
    } Hz)`
  );
  console.log(
    `    - Real-Time Chunking: ${
      config.vla.rtc.enabled
        ? `ENABLED (prefetch with ${config.vla.rtc.overlap} of a chunk left, ` +
          `${
            config.vla.rtc.blendSteps > 0
              ? `${config.vla.rtc.blendSteps}-step crossfade`
              : 'hard splice — no crossfade'
          })`
        : 'off — every chunk boundary stalls for a full /predict'
    }`
  );
  // The RTC knobs shipped in .env.so101.example long before anything in
  // TypeScript read them, under a different name and different units (whole
  // steps, not a fraction). Anyone carrying that file forward gets the default
  // overlap silently; say so instead.
  if (config.vla.rtc.enabled && process.env.VLA_RTC_CHUNK_OVERLAP !== undefined) {
    console.warn(
      `[Config] WARNING VLA_RTC_CHUNK_OVERLAP=${process.env.VLA_RTC_CHUNK_OVERLAP} is set, but nothing in the ` +
        'agent reads it — it belongs to the orphaned hardware/vla_runner.py, where it counts whole steps. ' +
        `The agent's knob is VLA_RTC_OVERLAP, a fraction of a chunk (in effect: ${config.vla.rtc.overlap}).`
    );
  }
  console.log(`  - Agent Mode: ${config.agentMode.enabled ? 'ENABLED' : 'disabled'}`);
  console.log(
    `    - Planner Model: ollama/${config.agentMode.plannerModel} ` +
      `(thinking ${config.agentMode.plannerThinking ? 'on' : 'off'}, ` +
      `timeout ${Math.round(config.agentMode.plannerTimeoutMs / 1000)}s)`
  );
  console.log(
    `    - Vision Model: ollama/${config.agentMode.visionModel} ` +
      `(thinking ${config.agentMode.visionThinking ? 'on' : 'off'})`
  );
  console.log(`    - Ollama Base URL: ${config.agentMode.ollamaBaseUrl}`);
  // Genkit reaches Ollama through its OpenAI-compatible API, which is served
  // under /v1. A bare host:11434 looks right and 404s on every call, and the
  // planner reports that as "could not produce a plan" — true, but it points
  // at the model rather than at the URL. Say it once, at boot.
  if (!/\/v1\/?$/.test(config.agentMode.ollamaBaseUrl)) {
    console.warn(
      `[Config] WARNING AGENT_OLLAMA_BASE_URL (${config.agentMode.ollamaBaseUrl}) does not end in /v1. ` +
        `Ollama's OpenAI-compatible endpoint is http://<host>:11434/v1 — without it every planner and ` +
        `vision call returns 404 and Agent Mode will refuse to plan.`
    );
  }
  console.log(
    `    - Camera: ${config.agentMode.cameraName} (HFOV ${config.agentMode.cameraHfovDeg}°)`
  );
  console.log(
    `    - Range Sensor: ${config.agentMode.rangeSensor} ` +
      `(${config.agentMode.rangeEnabled ? 'enabled' : 'DISABLED — distances stay VLM guesses'}, ` +
      `${config.agentMode.rangeMinM}–${config.agentMode.rangeMaxM} m, ±${config.agentMode.rangeConeDeg}° cone)`
  );
  console.log(
    `    - Occupancy Map: ${
      config.agentMode.mapEnabled
        ? `enabled (${config.agentMode.mapResolutionM} m cells, ≤${config.agentMode.mapMaxM} m, ` +
          `sweep ${config.agentMode.mapSweepHz > 0 ? `${config.agentMode.mapSweepHz} Hz` : 'off'}, ` +
          `decay ${config.agentMode.mapDecayS > 0 ? `${config.agentMode.mapDecayS} s` : 'off'}, ` +
          `${config.agentMode.mapPath})`
        : 'DISABLED — clouds are used once and dropped'
    }`
  );
  console.log(
    `    - Fleet Peers: ${
      config.agentMode.peersPollMs > 0
        ? `polled every ${config.agentMode.peersPollMs} ms, noticed within ${config.agentMode.peersNoticeM} m`
        : 'off — this robot never learns where the others are'
    }`
  );
  console.log(
    `    - Walk/Turn Speed: ${config.agentMode.walkSpeedMps} m/s, ${config.agentMode.turnSpeedDps} deg/s` +
      ` (left turns: ${config.agentMode.leftTurnStrategy})`
  );
  // The turn tuning is opt-in and easy to forget, and a rig running with it OFF
  // looks identical to one running with it on until the robot fails to turn.
  // Say which of the two this process is.
  {
    const a = config.agentMode;
    const tuned =
      a.turnCommandRadS > 0 || a.turnAchievedDpsLeft > 0 || a.turnAchievedDpsRight > 0;
    console.log(
      `    - Turn Profile: ${
        tuned
          ? `commanded ${a.turnCommandRadS || (a.turnSpeedDps * Math.PI) / 180} rad/s, achieved ` +
            `${a.turnAchievedDpsLeft || a.turnSpeedDps}/${a.turnAchievedDpsRight || a.turnSpeedDps} deg/s (left/right)` +
            (a.turnArcCommandRadS > 0 ? `, arcs at ${a.turnArcCommandRadS} rad/s` : '') +
            (a.arcTravelGain < 1 ? `, arc travel gain ${a.arcTravelGain}` : '')
          : `coupled to ${a.turnSpeedDps} deg/s (untuned — set AGENT_TURN_COMMAND_RAD_S to split ` +
            `the commanded rate from the achieved one)`
      }`
    );
  }
  console.log(`    - Max Nav Stages: ${config.agentMode.maxNavStages}`);
  console.log(
    `    - Navigator: ${
      config.agentMode.navPlanner === 'grid'
        ? `grid (plans on the map; ≤${config.agentMode.navMaxSegmentM} m per stage, looks every ` +
          `${config.agentMode.navLookEveryM} m, unknown ×${config.agentMode.navUnknownCost}; falls back to staged without a path)`
        : 'staged (turn, walk ≤1 m, look, repeat)'
    }`
  );
  console.log(`    - Idle Watch Interval: ${config.agentMode.idleWatchIntervalMs}ms`);
  console.log(`    - Stop Words: ${config.agentMode.stopWords.join(', ') || '(none)'}`);
  console.log(`    - Voice Service: ${config.agentMode.voiceServiceUrl}`);
  console.log(
    `    - Heartbeat: ${
      config.agentMode.heartbeat.enabled
        ? `ENABLED (min ${config.agentMode.heartbeat.minIntervalMs}ms, ` +
          `battery < ${config.agentMode.heartbeat.batteryPct}%, ` +
          `hours ${config.agentMode.heartbeat.activeHours || 'always'}` +
          `${config.agentMode.heartbeat.motion ? ', MOTION requested (v2 — ignored)' : ''})`
        : 'disabled'
    }`
  );
  console.log(
    `    - Patrol: ${
      config.agentMode.patrol.enabled
        ? `ENABLED (confirm ${config.agentMode.patrol.confirmN}/${config.agentMode.patrol.confirmM}, ` +
          `hash gate ${config.agentMode.patrol.hashGate}, min blob ${config.agentMode.patrol.minBlobM2} m², ` +
          `photos ${config.agentMode.patrol.photoRetentionH} h)`
        : 'disabled'
    }`
  );
  console.log(
    `  - Place Graph: ${config.place.graphPath || 'none — every place resolves as UNKNOWN'}` +
      (config.place.graphPath
        ? ` (drift budget ${config.place.driftBudgetM} m, hysteresis ${config.place.hysteresisMarginM} m)`
        : '')
  );
  // Loud on purpose: this makes the robot report no pose at all while it walks
  // perfectly well, which looks exactly like a broken odometry topic.
  if (config.place.faultNullPose) {
    console.warn(
      '[Config] WARNING PLACE_FAULT_NULL_POSE=true — the cached base pose is forced to null. ' +
        'Place will always read UNKNOWN. This is a DEV fault-injection switch; unset it on a real robot.'
    );
  }
  if (config.agentMode.enabled) {
    console.log(
      `[Config] Agent Mode is ON — inbound A2A messages are planned into blocks. ` +
        `Ensure the models are pulled (ollama pull ${config.agentMode.plannerModel}` +
        `${config.agentMode.visionModel !== config.agentMode.plannerModel ? ` && ollama pull ${config.agentMode.visionModel}` : ''}).`
    );
  }
}
