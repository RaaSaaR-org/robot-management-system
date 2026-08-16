/**
 * @file RobotManager.ts
 * @description Service for managing robot registry and A2A connections
 */

import type { A2AAgentCard } from '../types/index.js';
import type {
  ImuTelemetry,
  HandTouch,
  BatteryState,
  OdometryState,
  TelemetryFieldGroup,
} from '../types/telemetry.types.js';
import { agentCardResolver } from './A2AClient.js';
import { conversationManager } from './ConversationManager.js';
import { robotRepository, agentRepository } from '../repositories/index.js';
import { getTenantId } from '../middleware/tenantContext.js';
import { HttpClient, HttpClientError, HTTP_TIMEOUTS } from './HttpClient.js';
// Safe to import directly: AlertService only depends on repositories (no service cycle)
import { alertService } from './AlertService.js';

// ============================================================================
// TYPES
// ============================================================================

/** Robot operational status */
export type RobotStatus =
  | 'online'
  | 'offline'
  | 'busy'
  | 'error'
  | 'charging'
  | 'maintenance';

/** Command execution status */
export type CommandStatus = 'pending' | 'executing' | 'completed' | 'failed' | 'cancelled';

/** Command types supported by robots */
export type CommandType =
  | 'move'
  | 'stop'
  | 'pickup'
  | 'drop'
  | 'charge'
  | 'return_home'
  | 'emergency_stop'
  | 'custom';

/** Robot type for 3D visualization */
export type RobotType = 'h1' | 'g1' | 'so101' | 'generic';

/** Joint state for 3D animation */
export interface JointState {
  name: string;
  position: number;
  velocity?: number;
  effort?: number;
  temperature?: number;
}

/** Robot location in the facility */
export interface RobotLocation {
  x: number;
  y: number;
  z?: number;
  floor?: string;
  zone?: string;
  heading?: number;
  /** Place-graph id the robot believes it stands in (TASK-195), null = unknown. */
  place?: string | null;
  /**
   * The odometry frame `x`/`y`/`heading` live in, as the agent reports it
   * (TASK-207). Two robots are drawn on each other's maps only when both frames
   * match on kind AND id; absent means comparable to nobody. Never invented here.
   */
  frame?: OdometryFrame | null;
}

/** See {@link RobotLocation.frame}. */
export interface OdometryFrame {
  kind: 'sim' | 'odom';
  id: string;
}

/**
 * Another robot, as `GET /api/robots/:id/peers` hands it to a robot-agent
 * (TASK-207). Everything the agent needs to draw and avoid it, nothing more.
 */
export interface FleetPeer {
  robotId: string;
  name: string;
  x: number;
  y: number;
  headingDeg: number | null;
  frame: OdometryFrame | null;
  place: string | null;
  zone: string | null;
  /** When this pose was last synced from the peer's agent. */
  updatedAt: string | null;
  /**
   * How old that pose is, in ms, measured on the SERVER's clock at response
   * time; null when the peer has never been pose-synced. The consumer cannot
   * derive this from `updatedAt` without importing agent/server clock skew,
   * and it needs it: a peer whose agent went silent keeps being listed (its
   * `isConnected` only flips on the 30 s health check) with a frozen pose, and
   * an agent that trusts that pose plans around a robot that has walked away.
   */
  poseAgeMs: number | null;
  footprintRadiusM: number;
}

/** Fallback when the agent's metadata carries no `footprintRadiusM`. */
export const DEFAULT_FOOTPRINT_RADIUS_M = 0.35;

/** Peer poses older than this are re-fetched from the agents before answering. */
export const PEER_POSE_MAX_AGE_MS = 1000;
/**
 * Budget for ONE agent's pose read inside `refreshPoses` (TASK-207). The
 * request is awaited by `GET /robots/:id/peers`, which every robot's
 * PeerTracker polls with a 2 s client timeout — so a single hung agent with
 * the generic 5 s budget blanked the peers of every OTHER robot in the fleet.
 * A slow agent simply keeps its last pose (the catch below).
 */
export const PEER_POSE_REFRESH_TIMEOUT_MS = 750;

/**
 * How long a tenant's visible-robot set is reused before it is re-read
 * (multi-tenancy only). Long enough that a 2 s peers poll does not query the
 * database on every tick, short enough that a colleague registered a moment
 * ago shows up on the next poll.
 */
export const PEER_TENANT_SCOPE_TTL_MS = 2000;

/** Core robot entity */
export interface Robot {
  id: string;
  name: string;
  model: string;
  serialNumber?: string;
  status: RobotStatus;
  batteryLevel: number | null;
  location: RobotLocation;
  lastSeen: string;
  currentTaskId?: string;
  currentTaskName?: string;
  capabilities: string[];
  firmware?: string;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  a2aEnabled?: boolean;
  a2aAgentUrl?: string;
}

/** Robot telemetry data */
export interface RobotTelemetry {
  robotId: string;
  robotType?: RobotType;
  batteryLevel: number | null;
  batteryVoltage?: number;
  batteryTemperature?: number;
  /**
   * CPU load percentage. Optional/null = the agent has no real measurement
   * (the agent omits the field on the wire; the app renders "n/a").
   */
  cpuUsage?: number | null;
  memoryUsage: number;
  diskUsage?: number;
  temperature: number;
  humidity?: number;
  speed?: number;
  sensors: Record<string, number | boolean | string>;
  jointStates?: JointState[];
  errors?: string[];
  warnings?: string[];
  // TASK-184 real-data flow — rich hardware fields (shared contract, see
  // types/telemetry.types.ts). Undefined when the agent has no fresh data.
  imu?: ImuTelemetry | null;
  touch?: HandTouch | null;
  battery?: BatteryState | null;
  motorTemperatures?: Record<string, number> | null; // joint name → °C
  odometry?: OdometryState | null;
  hardwareConnected?: boolean;
  /** Field groups whose values are SIMULATED this frame. */
  simulated?: TelemetryFieldGroup[];
  timestamp: string;
}

/**
 * High-rate telemetry frame (TASK-191): the joints/imu/odometry subset agents
 * push on the fast channel. Broadcast-only — never persisted.
 */
export type RobotTelemetryFast = Pick<
  RobotTelemetry,
  | 'robotId'
  | 'robotType'
  | 'jointStates'
  | 'imu'
  | 'odometry'
  | 'speed'
  | 'hardwareConnected'
  | 'simulated'
  | 'timestamp'
>;

/** Robot command request */
export interface RobotCommandRequest {
  type: CommandType;
  payload?: Record<string, unknown>;
  priority?: 'low' | 'normal' | 'high' | 'critical';
}

/** Robot command entity */
export interface RobotCommand {
  id: string;
  robotId: string;
  type: CommandType;
  payload: Record<string, unknown>;
  status: CommandStatus;
  priority: 'low' | 'normal' | 'high' | 'critical';
  result?: Record<string, unknown>;
  errorMessage?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

/** Robot endpoints for communication */
export interface RobotEndpoints {
  robot: string;
  command: string;
  telemetry: string;
  telemetryWs: string;
}

/** Registration info from robot agent */
export interface RegistrationInfo {
  robot: Robot;
  endpoints: RobotEndpoints;
  a2a: {
    agentCard: string;
  };
}

/** Registered robot with full metadata */
export interface RegisteredRobot {
  robot: Robot;
  endpoints: RobotEndpoints;
  agentCard: A2AAgentCard;
  baseUrl: string;
  lastHealthCheck: string;
  isConnected: boolean;
  registeredAt: string;
  /** ISO time `robot.location` was last read off the agent; undefined = never. */
  poseSyncedAt?: string;
  /**
   * The pose the DATABASE row holds, as far as we know; undefined = unknown,
   * so the next writer persists. Both writers (the peers refresh and the
   * health check) diff against THIS, never against `robot.location` — the
   * cache is refreshed every peers poll (~2 s), so a cache diff is always ~0
   * and the row would silently stop being written at all.
   */
  lastPersistedLocation?: RobotLocation;
}

/** Below this, a pose "change" is sim jitter, not motion — no event, no write. */
export const POSE_EPSILON_M = 0.01;
export const HEADING_EPSILON_DEG = 0.5;

/** Position, heading, zone, place or frame changed (beyond the epsilons). */
export function locationDiffers(a: RobotLocation | undefined, b: RobotLocation): boolean {
  if (!a) return true;
  const headingA = a.heading ?? null;
  const headingB = b.heading ?? null;
  const headingChanged =
    headingA === null || headingB === null
      ? headingA !== headingB
      : Math.abs(headingA - headingB) > HEADING_EPSILON_DEG;
  return (
    Math.abs(a.x - b.x) > POSE_EPSILON_M ||
    Math.abs(a.y - b.y) > POSE_EPSILON_M ||
    a.zone !== b.zone ||
    headingChanged ||
    (a.place ?? null) !== (b.place ?? null) ||
    (a.frame?.kind ?? null) !== (b.frame?.kind ?? null) ||
    (a.frame?.id ?? null) !== (b.frame?.id ?? null)
  );
}

/** Robot event types */
export type RobotEventType =
  | 'robot_registered'
  | 'robot_unregistered'
  | 'robot_status_changed'
  | 'robot_telemetry'
  | 'robot_telemetry_fast'
  | 'robot_health_check';

/** Robot event */
export interface RobotEvent {
  type: RobotEventType;
  robotId: string;
  robot?: Robot;
  /** Full frame on `robot_telemetry`, subset frame on `robot_telemetry_fast`. */
  telemetry?: RobotTelemetry | RobotTelemetryFast;
  timestamp: string;
}

type RobotEventCallback = (event: RobotEvent) => void;

// ============================================================================
// IDENTITY SYNC
// ============================================================================

/**
 * A reported string worth adopting: present, a string, and not blank.
 *
 * The blank check is the whole point. `undefined` already meant "the agent did
 * not say", but `''` used to mean "the agent says its name is nothing" and was
 * written straight through — one agent booting with an unset `ROBOT_NAME` would
 * blank the fleet's record of a robot that has a perfectly good name on disk.
 */
function adoptable(reported: unknown, current: unknown): string | null {
  if (typeof reported !== 'string') return null;
  const value = reported.trim();
  if (!value) return null;
  return value === current ? null : value;
}

/**
 * Diff the identity fields the agent reports against the stored robot.
 *
 * OWNERSHIP (TASK-198, option **b**): **the robot is authoritative for its own
 * identity and the fleet ADOPTS it.** The robot keeps `IDENTITY.md` in its own
 * workspace, is named by the operator standing in front of it, and must still
 * know what it is called when the platform is unreachable — so the platform
 * cannot be the source of truth without handing the robot an amnesia mode the
 * moment the network drops. This function is therefore an adoption path, not an
 * overwrite: whatever the robot reports about ITSELF wins, and everything the
 * robot does not assert is left exactly as the fleet has it.
 *
 * What changed from the plain field-diff it used to be:
 *
 *  - A blank or non-string reported value never clears a stored one (see
 *    {@link adoptable}). "The agent did not say" and "the agent says it is
 *    nothing" are different, and only the second was ever a legitimate write —
 *    and it never is for an identity.
 *  - A rename is logged as a rename, because it also renames the agent-card row
 *    in `performHealthChecks` (delete-by-name, then upsert), which is the one
 *    place an identity change has a destructive step in it.
 *
 * `capabilities` and `metadata` keep their JSON-equality diff: they are
 * structured values where an empty array/object is a real assertion.
 *
 * @returns only the changed fields, or null when nothing changed.
 */
export function buildIdentityUpdate(current: Robot, reported: Robot): Partial<Robot> | null {
  const update: Partial<Robot> = {};

  const name = adoptable(reported.name, current.name);
  if (name !== null) {
    update.name = name;
    console.log(
      `[RobotManager] Robot ${current.id} renamed itself: "${current.name}" -> "${name}" — adopting.`
    );
  }

  const model = adoptable(reported.model, current.model);
  if (model !== null) update.model = model;

  const serialNumber = adoptable(reported.serialNumber, current.serialNumber);
  if (serialNumber !== null) update.serialNumber = serialNumber;

  const firmware = adoptable(reported.firmware, current.firmware);
  if (firmware !== null) update.firmware = firmware;

  const ipAddress = adoptable(reported.ipAddress, current.ipAddress);
  if (ipAddress !== null) update.ipAddress = ipAddress;

  if (
    reported.capabilities !== undefined &&
    JSON.stringify(reported.capabilities) !== JSON.stringify(current.capabilities)
  ) {
    update.capabilities = reported.capabilities;
  }
  if (
    reported.metadata !== undefined &&
    JSON.stringify(reported.metadata) !== JSON.stringify(current.metadata)
  ) {
    update.metadata = reported.metadata;
  }

  return Object.keys(update).length > 0 ? update : null;
}

// ============================================================================
// ROBOT MANAGER
// ============================================================================

/**
 * RobotManager - manages robot registry and A2A connections with database persistence
 */
export class RobotManager {
  // In-memory cache for active robot connections
  private robotCache: Map<string, RegisteredRobot> = new Map();
  private eventCallbacks: Set<RobotEventCallback> = new Set();
  private healthCheckInterval: NodeJS.Timeout | null = null;

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Load robots from database into cache on startup
   */
  async initialize(): Promise<void> {
    const registeredRobots = await robotRepository.getAllRegisteredRobots();
    for (const robot of registeredRobots) {
      // This pose came straight off the row, so cache and database agree —
      // record that, or the first writer would waste a write re-persisting it.
      // Mutated in place, not copied: callers hold on to this object.
      robot.lastPersistedLocation = robot.robot.location;
      this.robotCache.set(robot.robot.id, robot);
    }
    console.log(`[RobotManager] Loaded ${registeredRobots.length} robots from database`);
  }

  // ============================================================================
  // REGISTRATION
  // ============================================================================

  /**
   * Register a robot from its base URL
   * Fetches registration info and agent card
   */
  async registerRobot(robotUrl: string): Promise<RegisteredRobot> {
    // Normalize URL
    const baseUrl = robotUrl.endsWith('/') ? robotUrl.slice(0, -1) : robotUrl;

    console.log(`[RobotManager] Registering robot from ${baseUrl}`);

    try {
      // Fetch registration info from robot
      const registerUrl = `${baseUrl}/api/v1/register`;
      console.log(`[RobotManager] Fetching registration info from ${registerUrl}`);

      const httpClient = new HttpClient(baseUrl, HTTP_TIMEOUTS.MEDIUM);
      const registrationInfo = await httpClient.get<RegistrationInfo>('/api/v1/register');

      if (!registrationInfo.robot || !registrationInfo.endpoints) {
        throw new Error('Invalid registration info: missing robot or endpoints');
      }

      // Fetch agent card
      console.log(`[RobotManager] Fetching agent card from ${baseUrl}`);
      const agentCard = await agentCardResolver.fetchAgentCard(baseUrl);

      // Build full endpoint URLs
      const endpoints: RobotEndpoints = {
        robot: `${baseUrl}${registrationInfo.endpoints.robot}`,
        command: `${baseUrl}${registrationInfo.endpoints.command}`,
        telemetry: `${baseUrl}${registrationInfo.endpoints.telemetry}`,
        telemetryWs: registrationInfo.endpoints.telemetryWs,
      };

      // Update robot with A2A info
      const robotWithA2A: Robot = {
        ...registrationInfo.robot,
        a2aEnabled: true,
        a2aAgentUrl: baseUrl,
      };

      // Persist to database
      await robotRepository.upsertWithRegistration(robotWithA2A, endpoints, agentCard, baseUrl);

      // Create registered robot entry
      const now = new Date().toISOString();
      const registeredRobot: RegisteredRobot = {
        robot: robotWithA2A,
        endpoints,
        agentCard,
        baseUrl,
        lastHealthCheck: now,
        isConnected: true,
        registeredAt: now,
        // `upsertWithRegistration` above wrote this pose, so cache = row.
        lastPersistedLocation: robotWithA2A.location,
      };

      // Cache in memory
      this.robotCache.set(registeredRobot.robot.id, registeredRobot);

      // Also register as A2A agent in ConversationManager
      await conversationManager.registerAgent(agentCard);

      // Emit event
      this.emitEvent({
        type: 'robot_registered',
        robotId: registeredRobot.robot.id,
        robot: registeredRobot.robot,
        timestamp: now,
      });

      console.log(
        `[RobotManager] Successfully registered robot: ${registeredRobot.robot.name} (${registeredRobot.robot.id})`
      );

      return registeredRobot;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[RobotManager] Failed to register robot from ${baseUrl}:`, message);
      throw new Error(`Failed to register robot: ${message}`);
    }
  }

  /**
   * Unregister a robot by ID
   */
  async unregisterRobot(robotId: string): Promise<boolean> {
    const registered = this.robotCache.get(robotId);
    if (!registered) {
      // Check database
      const dbRobot = await robotRepository.getRegisteredRobot(robotId);
      if (!dbRobot) {
        return false;
      }
    }

    // Remove from cache
    this.robotCache.delete(robotId);

    // Delete from database
    await robotRepository.delete(robotId);

    // Also unregister from A2A agents
    if (registered) {
      await conversationManager.unregisterAgent(registered.agentCard.name);
      agentCardResolver.clearCache(registered.baseUrl);
    }

    // Emit event
    this.emitEvent({
      type: 'robot_unregistered',
      robotId,
      timestamp: new Date().toISOString(),
    });

    console.log(`[RobotManager] Unregistered robot: ${robotId}`);

    return true;
  }

  // ============================================================================
  // ROBOT ACCESS
  // ============================================================================

  /**
   * Normalize robot status for presentation.
   * Robots without a live, connected agent (e.g. DB-only rows with a2aEnabled=false)
   * can carry a stale 'online'/'busy' status forever — present them as 'offline'
   * instead. Does NOT write to the database; 'maintenance'/'charging'/'error'
   * are left untouched.
   */
  private normalizePresentedStatus(robot: Robot): Robot {
    const cached = this.robotCache.get(robot.id);
    const isLive = cached !== undefined && cached.isConnected;
    if (!isLive && (robot.status === 'online' || robot.status === 'busy')) {
      return { ...robot, status: 'offline' };
    }
    return robot;
  }

  /**
   * Get all registered robots
   */
  async listRobots(): Promise<Robot[]> {
    const robots = await robotRepository.findAll();
    return robots.map((robot) => this.normalizePresentedStatus(robot));
  }

  /**
   * Get a single robot by ID
   */
  async getRobot(robotId: string): Promise<Robot | undefined> {
    // Check cache first
    const cached = this.robotCache.get(robotId);
    if (cached) {
      return this.normalizePresentedStatus(cached.robot);
    }

    const robot = await robotRepository.findById(robotId);
    return robot ? this.normalizePresentedStatus(robot) : undefined;
  }

  /**
   * Get full registered robot data
   */
  async getRegisteredRobot(robotId: string): Promise<RegisteredRobot | undefined> {
    // Check cache first
    if (this.robotCache.has(robotId)) {
      return this.robotCache.get(robotId);
    }

    // Load from database
    const registered = await robotRepository.getRegisteredRobot(robotId);
    if (registered) {
      this.robotCache.set(robotId, registered);
    }
    return registered ?? undefined;
  }

  /**
   * Get agent cards for connected robots only
   * Used by orchestrator to route messages only to online robots
   */
  getConnectedAgents(): A2AAgentCard[] {
    return Array.from(this.robotCache.values())
      .filter((r) => r.isConnected)
      .map((r) => r.agentCard);
  }

  // ============================================================================
  // FLEET PEERS (TASK-207)
  // ============================================================================

  private poseRefreshInFlight: Promise<void> | null = null;

  /** tenantId → the robot ids that tenant may see, and when we read them. */
  private tenantPeerScope = new Map<string, { ids: Set<string>; readAtMs: number }>();

  /**
   * Refresh (at most every {@link PEER_TENANT_SCOPE_TTL_MS}) the set of robots
   * the CALLING tenant is allowed to see.
   *
   * `robotCache` is a process-wide map: `initialize()` fills it at startup,
   * outside any request, so the Prisma tenant extension is a passthrough and
   * every tenant's robots land in one map. Reading it unfiltered in
   * {@link getPeers} handed any authenticated user of tenant A the id, name,
   * live pose, place and zone of every connected robot of tenant B — a bulk
   * cross-tenant fleet enumeration. `robotRepository.findAll()` runs inside the
   * request's tenant scope, so the extension answers the one question we need:
   * which robots exist FOR THIS CALLER.
   */
  private async syncTenantPeerScope(tenantId: string): Promise<void> {
    const cached = this.tenantPeerScope.get(tenantId);
    if (cached && Date.now() - cached.readAtMs <= PEER_TENANT_SCOPE_TTL_MS) return;
    try {
      const visible = await robotRepository.findAll();
      this.tenantPeerScope.set(tenantId, {
        ids: new Set(visible.map((r) => r.id)),
        readAtMs: Date.now(),
      });
    } catch (err) {
      // Leave the previous (or absent) scope in place: getPeers fails closed.
      console.warn('[RobotManager] Failed to read tenant robot scope:', err);
    }
  }

  /**
   * Write the cached pose to the row when the two have drifted apart.
   *
   * Fire-and-forget on purpose: `GET /:id/peers` waits for poses, never for the
   * database. `lastPersistedLocation` is set optimistically so the ~1 s refresh
   * cadence cannot turn into a write storm while a write is in flight, and is
   * cleared again on failure so the next refresh (or the health check) retries.
   */
  private persistLocation(registered: RegisteredRobot): void {
    const target = registered.robot.location;
    if (!target || !locationDiffers(registered.lastPersistedLocation, target)) return;
    registered.lastPersistedLocation = target;
    void (async () => {
      try {
        const row = await robotRepository.update(registered.robot.id, { location: target });
        if (!row) throw new Error('row not updated');
      } catch (err) {
        if (registered.lastPersistedLocation === target) {
          registered.lastPersistedLocation = undefined;
        }
        console.warn(
          `[RobotManager] Failed to persist refreshed pose for ${registered.robot.id}:`,
          err
        );
      }
    })();
  }

  /**
   * Bring every connected robot's cached pose to within `maxAgeMs`, reading
   * `GET /api/v1/robots/:id` off each agent in parallel. The 30 s health check
   * is far too slow for a robot that wants to avoid a colleague; this is the
   * on-demand path `GET /:id/peers` takes. Concurrent callers share one
   * refresh. A changed pose is written back to the row as well (see
   * {@link persistLocation}) and emits the same `robot_status_changed` the
   * health check would, so the fleet map gets fresher too.
   */
  async refreshPoses(maxAgeMs: number = PEER_POSE_MAX_AGE_MS): Promise<void> {
    // Before anything else — and before the in-flight short-circuit, which a
    // second tenant would otherwise ride — learn which robots this caller may
    // see. `getTenantId()` is undefined with multi-tenancy off or outside a
    // request, and then this costs nothing and changes nothing.
    const tenantId = getTenantId();
    if (tenantId) await this.syncTenantPeerScope(tenantId);
    if (this.poseRefreshInFlight) return this.poseRefreshInFlight;
    const nowMs = Date.now();
    const stale = Array.from(this.robotCache.values()).filter(
      (r) => r.isConnected && (!r.poseSyncedAt || nowMs - Date.parse(r.poseSyncedAt) > maxAgeMs),
    );
    if (stale.length === 0) return;
    this.poseRefreshInFlight = (async () => {
      const client = new HttpClient(undefined, PEER_POSE_REFRESH_TIMEOUT_MS);
      await Promise.all(
        stale.map(async (registered) => {
          try {
            const data = await client.get<Robot>(registered.endpoints.robot);
            const now = new Date().toISOString();
            registered.poseSyncedAt = now;
            if (data.location && locationDiffers(registered.robot.location, data.location)) {
              registered.robot.location = data.location;
              this.emitEvent({
                type: 'robot_status_changed',
                robotId: registered.robot.id,
                robot: registered.robot,
                timestamp: now,
              });
            }
            // …and persist it. This used to be "the health check persists",
            // but the health check diffed against this very cache, which we
            // refresh every ~2 s — so its diff was always ~0 and `Robot.location`
            // stopped being written the moment peer polling started. A robot
            // that walked and stopped between two health checks then stayed on
            // the fleet map (and in zone-scoped E-stop) at its old position
            // indefinitely, because `GET /api/robots` reads the row, not this map.
            this.persistLocation(registered);
          } catch {
            // Leave the cached pose (and its age) alone: an unreachable agent
            // is the health check's business, and a peer with an old pose is
            // still better than a peer that vanishes for one dropped request.
          }
        }),
      );
    })().finally(() => {
      this.poseRefreshInFlight = null;
    });
    return this.poseRefreshInFlight;
  }

  /**
   * Every OTHER connected robot, as a {@link FleetPeer}. Frames are passed
   * through exactly as reported — the CONSUMER drops the ones it cannot
   * compare with its own; the server never pretends two odometries agree.
   */
  getPeers(robotId: string): FleetPeer[] {
    // Multi-tenancy: never enumerate the process-wide cache for a tenant.
    // Fails closed — a scope we have not read yet (see syncTenantPeerScope,
    // which the peers route always awaits via refreshPoses) hides peers rather
    // than leaking a foreign fleet.
    const tenantId = getTenantId();
    const visible = tenantId ? (this.tenantPeerScope.get(tenantId)?.ids ?? new Set<string>()) : null;
    const nowMs = Date.now();
    return Array.from(this.robotCache.values())
      .filter((r) => r.isConnected && r.robot.id !== robotId)
      .filter((r) => visible === null || visible.has(r.robot.id))
      .map((r) => {
        const loc = r.robot.location;
        const meta = r.robot.metadata ?? {};
        const footprint = typeof meta.footprintRadiusM === 'number' && Number.isFinite(meta.footprintRadiusM)
          ? meta.footprintRadiusM
          : DEFAULT_FOOTPRINT_RADIUS_M;
        return {
          robotId: r.robot.id,
          name: r.robot.name,
          x: loc.x,
          y: loc.y,
          headingDeg: typeof loc.heading === 'number' ? loc.heading : null,
          frame: loc.frame && loc.frame.kind && loc.frame.id ? { kind: loc.frame.kind, id: loc.frame.id } : null,
          place: loc.place ?? null,
          zone: loc.zone ?? null,
          updatedAt: r.poseSyncedAt ?? null,
          // Measured here, on one clock, so the agent does not have to guess
          // how stale a colleague's pose is from an ISO string of ours.
          poseAgeMs: r.poseSyncedAt ? Math.max(0, nowMs - Date.parse(r.poseSyncedAt)) : null,
          footprintRadiusM: footprint,
        };
      });
  }

  // ============================================================================
  // ROBOT COMMANDS
  // ============================================================================

  /**
   * Send a command to a robot
   */
  async sendCommand(robotId: string, command: RobotCommandRequest): Promise<RobotCommand> {
    const registered = await this.getRegisteredRobot(robotId);
    if (!registered) {
      throw new Error(`Robot ${robotId} not found`);
    }

    if (!registered.isConnected) {
      throw new Error(`Robot ${robotId} is not connected`);
    }

    try {
      console.log(`[RobotManager] Sending command to ${robotId}:`, command);

      const httpClient = new HttpClient(undefined, HTTP_TIMEOUTS.LONG);
      return await httpClient.post<RobotCommand>(registered.endpoints.command, command);
    } catch (error) {
      const message = error instanceof HttpClientError ? error.message :
        (error instanceof Error ? error.message : 'Unknown error');
      throw new Error(`Failed to send command: ${message}`);
    }
  }

  // ============================================================================
  // TELEMETRY
  // ============================================================================

  /**
   * Get current telemetry from a robot
   */
  async getTelemetry(robotId: string): Promise<RobotTelemetry> {
    const registered = await this.getRegisteredRobot(robotId);
    if (!registered) {
      throw new Error(`Robot ${robotId} not found`);
    }

    try {
      const httpClient = new HttpClient(undefined, HTTP_TIMEOUTS.MEDIUM);
      return await httpClient.get<RobotTelemetry>(registered.endpoints.telemetry);
    } catch (error) {
      const message = error instanceof HttpClientError ? error.message :
        (error instanceof Error ? error.message : 'Unknown error');
      throw new Error(`Failed to get telemetry: ${message}`);
    }
  }

  // ============================================================================
  // HEALTH CHECKS
  // ============================================================================

  /**
   * Start periodic health checks
   */
  startHealthChecks(intervalMs: number = 30000): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    console.log(`[RobotManager] Starting health checks every ${intervalMs}ms`);

    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks().catch((error) => {
        console.error('[RobotManager] Health check cycle error:', error);
      });
    }, intervalMs);

    // Run immediately with error handling
    this.performHealthChecks().catch((error) => {
      console.error('[RobotManager] Initial health check error:', error);
    });
  }

  /**
   * Stop health checks
   */
  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      console.log('[RobotManager] Stopped health checks');
    }
  }

  /**
   * Perform health check on all robots
   */
  private async performHealthChecks(): Promise<void> {
    const robots = Array.from(this.robotCache.values());

    for (const registered of robots) {
      try {
        // Create HTTP client for this robot's base URL
        const httpClient = new HttpClient(registered.baseUrl, HTTP_TIMEOUTS.SHORT);

        const healthData = await httpClient.get<{
          status: string;
          robotStatus: RobotStatus;
          batteryLevel: number | null;
        }>('/api/v1/health');

        const now = new Date().toISOString();
        registered.lastHealthCheck = now;

        // Update connection status
        const wasConnected = registered.isConnected;
        registered.isConnected = true;

        // Always update battery level from health check
        // null is a valid value (AC-powered robots have no battery), only fall back for undefined
        const newBatteryLevel = healthData.batteryLevel !== undefined
          ? healthData.batteryLevel
          : registered.robot.batteryLevel;
        const statusChanged = healthData.robotStatus && healthData.robotStatus !== registered.robot.status;
        const batteryChanged = newBatteryLevel !== registered.robot.batteryLevel;

        // Also fetch robot data to sync position + identity
        let locationChanged = false;
        let identityChanged = false;
        try {
          const robotHttpClient = new HttpClient(undefined, HTTP_TIMEOUTS.SHORT);
          const robotData = await robotHttpClient.get<Robot>(registered.endpoints.robot);
          if (robotData.location) {
            const newLoc = robotData.location;
            if (locationDiffers(registered.robot.location, newLoc)) {
              registered.robot.location = newLoc;
              registered.poseSyncedAt = now;
            }
            // Diff against what the ROW holds, not against the cache: the peers
            // refresh (refreshPoses) writes fresh poses into the cache every
            // ~2 s, so a cache diff here is ~0 and the 30 s guaranteed write
            // silently disappeared. This keeps the health check an honest
            // second writer — and a retry when a refresh write failed.
            locationChanged = locationDiffers(
              registered.lastPersistedLocation,
              registered.robot.location
            );
          }

          // SIM-honesty: sync identity fields the agent reports (serial,
          // firmware, ip, metadata incl. isSimulated, …) instead of freezing
          // them at first-registration values forever.
          const identityUpdate = this.buildIdentityUpdate(registered.robot, robotData);
          if (identityUpdate) {
            Object.assign(registered.robot, identityUpdate);
            registered.robot.updatedAt = now;
            identityChanged = true;
            await robotRepository.update(registered.robot.id, identityUpdate);
            console.log(
              `[RobotManager] Synced identity for ${registered.robot.id}: ${Object.keys(identityUpdate).join(', ')}`
            );
          }
        } catch {
          // Log but don't fail health check - position sync is secondary
          console.warn(`[RobotManager] Failed to sync position for ${registered.robot.id}`);
        }

        // Re-fetch the live agent card so agent-side edits (description,
        // skills, …) propagate to the stored registry copy instead of
        // freezing at first-registration values forever.
        try {
          agentCardResolver.clearCache(registered.baseUrl);
          const liveCard = await agentCardResolver.fetchAgentCard(registered.baseUrl);
          if (JSON.stringify(liveCard) !== JSON.stringify(registered.agentCard)) {
            // Non-destructive rename (TASK-198): keyed on the robot id, which
            // is stable, instead of the name, which is exactly the thing that
            // changed. The old delete-then-upsert destroyed the AgentCard row
            // (and its uuid) first, so a failing write left the robot with NO
            // card at all — and unrecoverably so, because the in-memory copy
            // had already been reassigned, making the next health check see no
            // diff and never retry.
            //
            // Hence also: the cache is updated only AFTER the write succeeds.
            // A throw here lands in the catch below and the next health check
            // finds the same diff and tries again.
            await agentRepository.upsertByRobotId(liveCard, registered.robot.id);
            registered.agentCard = liveCard;
            console.log(
              `[RobotManager] Refreshed agent card for ${registered.robot.id} (${liveCard.name})`
            );
          }
        } catch {
          // Log but don't fail health check - agent card refresh is secondary
          console.warn(`[RobotManager] Failed to refresh agent card for ${registered.robot.id}`);
        }

        // Update in-memory cache
        registered.robot.batteryLevel = newBatteryLevel;
        registered.robot.lastSeen = now;

        if (statusChanged) {
          const previousStatus = registered.robot.status;
          registered.robot.status = healthData.robotStatus;
          registered.robot.updatedAt = now;

          // Fire-and-forget alerts on status transitions (never fail the health check)
          // Note: the robot name lives in the alert title only — repeating it in
          // the message produced double-name renderings in the UI.
          const robotName = registered.robot.name;
          if (healthData.robotStatus === 'error') {
            alertService
              .createRobotAlert(
                registered.robot.id,
                'critical',
                `Robot error: ${robotName}`,
                `Reported status 'error' (was '${previousStatus}').`
              )
              .catch((err) =>
                console.error('[RobotManager] Failed to create robot error alert:', err)
              );
          } else if (
            (previousStatus === 'error' || previousStatus === 'offline') &&
            (healthData.robotStatus === 'online' ||
              healthData.robotStatus === 'busy' ||
              healthData.robotStatus === 'charging')
          ) {
            alertService
              .createRobotAlert(
                registered.robot.id,
                'info',
                `Robot recovered: ${robotName}`,
                `Recovered from '${previousStatus}' to '${healthData.robotStatus}'.`
              )
              .catch((err) =>
                console.error('[RobotManager] Failed to create robot recovery alert:', err)
              );

            // Auto-resolve the offline/error alerts this recovery supersedes
            alertService
              .resolveRobotStatusAlerts(registered.robot.id)
              .catch((err) =>
                console.error('[RobotManager] Failed to auto-resolve robot alerts:', err)
              );
          }
        }

        // Persist battery level and location to database
        await robotRepository.updateHealthCheck(
          registered.robot.id,
          true,
          statusChanged ? healthData.robotStatus : undefined,
          newBatteryLevel,
          locationChanged ? registered.robot.location : undefined
        );
        if (locationChanged) {
          registered.lastPersistedLocation = registered.robot.location;
        }

        // Emit event if status, battery, location, or identity changed
        if (statusChanged || batteryChanged || locationChanged || identityChanged) {
          this.emitEvent({
            type: 'robot_status_changed',
            robotId: registered.robot.id,
            robot: registered.robot,
            timestamp: now,
          });
        }

        // Emit reconnection event if was disconnected
        if (!wasConnected) {
          this.emitEvent({
            type: 'robot_status_changed',
            robotId: registered.robot.id,
            robot: registered.robot,
            timestamp: now,
          });

          // Robot answered health checks again — resolve its stale
          // offline/error alerts even without a formal status transition.
          alertService
            .resolveRobotStatusAlerts(registered.robot.id)
            .catch((err) =>
              console.error('[RobotManager] Failed to auto-resolve robot alerts:', err)
            );
        }
      } catch {
        // Mark as disconnected
        if (registered.isConnected) {
          registered.isConnected = false;
          registered.robot.status = 'offline';
          registered.robot.updatedAt = new Date().toISOString();

          // Persist to database
          await robotRepository.updateHealthCheck(registered.robot.id, false, 'offline');

          // Fire-and-forget alert on connectivity loss (never fail the health check)
          alertService
            .createRobotAlert(
              registered.robot.id,
              'warning',
              `Robot offline: ${registered.robot.name}`,
              'Stopped responding to health checks and is now offline.'
            )
            .catch((err) =>
              console.error('[RobotManager] Failed to create robot offline alert:', err)
            );

          this.emitEvent({
            type: 'robot_status_changed',
            robotId: registered.robot.id,
            robot: registered.robot,
            timestamp: new Date().toISOString(),
          });

          console.warn(`[RobotManager] Robot ${registered.robot.id} health check failed`);
        }
      }
    }
  }

  /** @see {@link buildIdentityUpdate} — kept as a method so the call site reads unchanged. */
  private buildIdentityUpdate(current: Robot, reported: Robot): Partial<Robot> | null {
    return buildIdentityUpdate(current, reported);
  }

  // ============================================================================
  // EVENTS
  // ============================================================================

  /**
   * Emit a `robot_telemetry` event for a live telemetry frame (TASK-184).
   * Used by TelemetryIngestionService so frames reach app clients through the
   * exact same envelope/broadcast mechanism as `robot_status_changed`.
   */
  emitTelemetry(robotId: string, telemetry: RobotTelemetry): void {
    this.emitEvent({
      type: 'robot_telemetry',
      robotId,
      telemetry,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Emit a `robot_telemetry_fast` event for a high-rate subset frame
   * (TASK-191). Distinct event type so existing consumers keep their full-frame
   * cadence and only opted-in consumers (the 3D viewer) see the fast stream.
   */
  emitTelemetryFast(robotId: string, telemetry: RobotTelemetryFast): void {
    this.emitEvent({
      type: 'robot_telemetry_fast',
      robotId,
      telemetry,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Subscribe to robot events
   */
  onRobotEvent(callback: RobotEventCallback): () => void {
    this.eventCallbacks.add(callback);
    return () => this.eventCallbacks.delete(callback);
  }

  /**
   * Emit an event to all subscribers
   */
  private emitEvent(event: RobotEvent): void {
    this.eventCallbacks.forEach((cb) => {
      try {
        cb(event);
      } catch (error) {
        console.error('[RobotManager] Event callback error:', error);
      }
    });
  }
}

// Singleton instance
export const robotManager = new RobotManager();
