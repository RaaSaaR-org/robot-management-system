/**
 * @file TelemetryIngestionService.ts
 * @description Consumes live telemetry from robot agents (TASK-184 real-data flow).
 *
 * Robot agents are WebSocket SERVERS: each pushes a full RobotTelemetry frame
 * every ~2 s on `ws://<agent>/ws/telemetry/:robotId`. This service is the
 * "missing middle" between agents and the platform: it maintains one WS client
 * connection per registered robot (reconnect with backoff), re-broadcasts every
 * frame to app clients as a `robot_telemetry` event (same envelope/mechanism as
 * `robot_status_changed`), and persists frames DOWNSAMPLED to the
 * RobotTelemetry table — at most one row per TELEMETRY_PERSIST_INTERVAL_MS
 * (default 10000) per robot, plus an immediate row whenever errors/warnings
 * transition to non-empty.
 *
 * TASK-191: agents may additionally push `telemetry_fast` subset frames
 * (joints/imu/odometry, ~10 Hz). Those are relayed as `robot_telemetry_fast`
 * broadcast events and are never persisted.
 *
 * Lifecycle wiring: `initialize()` starts connections for all already-
 * registered robots and subscribes to RobotManager's registration events so
 * connections start on `robot_registered` and stop on `robot_unregistered`.
 */

import WebSocket from 'ws';
import {
  robotManager,
  type RegisteredRobot,
  type RobotTelemetry,
  type RobotTelemetryFast,
} from './RobotManager.js';
import { robotRepository } from '../repositories/index.js';

// ============================================================================
// CONFIG
// ============================================================================

/** Minimum ms between persisted rows per robot (env-overridable). */
const PERSIST_INTERVAL_MS = (() => {
  const parsed = Number(process.env.TELEMETRY_PERSIST_INTERVAL_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10000;
})();

/** Reconnect backoff: start at 5 s, double up to 60 s. */
const RECONNECT_BASE_MS = 5000;
const RECONNECT_MAX_MS = 60000;

// ============================================================================
// TYPES
// ============================================================================

/** Per-robot connection state. */
interface AgentConnection {
  robotId: string;
  wsUrl: string;
  ws: WebSocket | null;
  reconnectTimer: NodeJS.Timeout | null;
  backoffMs: number;
  /** Set on stop — suppresses reconnects racing a close event. */
  stopped: boolean;
  lastPersistAt: number;
  /** Whether the previous frame already had errors/warnings (for edge-trigger). */
  hadIssues: boolean;
}

/** Agent WS message envelope (robot-agent/src/robot/telemetry.ts). */
interface AgentWsMessage {
  type?: string;
  payload?: RobotTelemetry | RobotTelemetryFast;
}

// ============================================================================
// SERVICE
// ============================================================================

export class TelemetryIngestionService {
  private connections: Map<string, AgentConnection> = new Map();
  private initialized = false;

  /**
   * Start ingestion for all already-registered robots and hook into the
   * registration/unregistration flow via RobotManager events.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    robotManager.onRobotEvent((event) => {
      if (event.type === 'robot_registered') {
        void robotManager
          .getRegisteredRobot(event.robotId)
          .then((registered) => {
            if (registered) this.startForRobot(registered);
          })
          .catch((err) =>
            console.error(
              `[TelemetryIngestion] Failed to start ingestion for ${event.robotId}:`,
              err
            )
          );
      } else if (event.type === 'robot_unregistered') {
        this.stopForRobot(event.robotId);
      }
    });

    // Boot: connect to every robot already in the registry.
    try {
      const robots = await robotRepository.getAllRegisteredRobots();
      for (const registered of robots) {
        this.startForRobot(registered);
      }
      console.log(
        `[TelemetryIngestion] Initialized (${this.connections.size} agent connection(s), persist interval ${PERSIST_INTERVAL_MS}ms)`
      );
    } catch (err) {
      console.error('[TelemetryIngestion] Failed to load registered robots:', err);
    }
  }

  /**
   * Start a telemetry WS connection for one robot. No-op if the registration
   * has no telemetry WS endpoint or a connection already exists (duplicate guard).
   */
  startForRobot(registered: RegisteredRobot): void {
    const robotId = registered.robot.id;
    const wsUrl = this.resolveTelemetryWsUrl(registered);
    if (!wsUrl) {
      console.warn(`[TelemetryIngestion] Robot ${robotId} has no telemetry WS endpoint, skipping`);
      return;
    }

    const existing = this.connections.get(robotId);
    if (existing) {
      if (existing.wsUrl === wsUrl) {
        return; // already connected/connecting to the same endpoint
      }
      // Endpoint changed on re-registration — replace the connection.
      this.stopForRobot(robotId);
    }

    const conn: AgentConnection = {
      robotId,
      wsUrl,
      ws: null,
      reconnectTimer: null,
      backoffMs: RECONNECT_BASE_MS,
      stopped: false,
      lastPersistAt: 0,
      hadIssues: false,
    };
    this.connections.set(robotId, conn);
    this.connect(conn);
  }

  /** Stop and forget the connection for one robot. */
  stopForRobot(robotId: string): void {
    const conn = this.connections.get(robotId);
    if (!conn) return;

    conn.stopped = true;
    if (conn.reconnectTimer) {
      clearTimeout(conn.reconnectTimer);
      conn.reconnectTimer = null;
    }
    if (conn.ws) {
      try {
        conn.ws.terminate();
      } catch {
        // best-effort
      }
      conn.ws = null;
    }
    this.connections.delete(robotId);
    console.log(`[TelemetryIngestion] Stopped ingestion for ${robotId}`);
  }

  /** Stop all connections (graceful shutdown). */
  stopAll(): void {
    for (const robotId of [...this.connections.keys()]) {
      this.stopForRobot(robotId);
    }
  }

  /** Number of active agent connections (for diagnostics/tests). */
  getConnectionCount(): number {
    return this.connections.size;
  }

  // ==========================================================================
  // INTERNAL: CONNECTION HANDLING
  // ==========================================================================

  /**
   * Resolve the agent's telemetry WS URL. Agents report a full URL
   * (`ws://localhost:<port>/ws/telemetry/<id>`) whose host is from the AGENT's
   * perspective — rewrite localhost to the registered base URL's host so the
   * server can reach remote agents. A path-only value is resolved against the
   * base URL (http→ws).
   */
  private resolveTelemetryWsUrl(registered: RegisteredRobot): string | null {
    const raw = registered.endpoints?.telemetryWs;
    if (!raw) return null;

    try {
      if (raw.startsWith('/')) {
        const base = new URL(registered.baseUrl);
        const proto = base.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${proto}//${base.host}${raw}`;
      }
      const url = new URL(raw);
      if (
        (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
        registered.baseUrl
      ) {
        const base = new URL(registered.baseUrl);
        if (base.hostname !== 'localhost' && base.hostname !== '127.0.0.1') {
          url.hostname = base.hostname;
        }
      }
      return url.toString();
    } catch {
      console.warn(
        `[TelemetryIngestion] Invalid telemetry WS endpoint for ${registered.robot.id}: ${raw}`
      );
      return null;
    }
  }

  private connect(conn: AgentConnection): void {
    if (conn.stopped) return;

    let ws: WebSocket;
    try {
      ws = new WebSocket(conn.wsUrl);
    } catch (err) {
      console.error(`[TelemetryIngestion] Failed to open WS for ${conn.robotId}:`, err);
      this.scheduleReconnect(conn);
      return;
    }
    conn.ws = ws;

    ws.on('open', () => {
      conn.backoffMs = RECONNECT_BASE_MS; // reset backoff on success
      console.log(`[TelemetryIngestion] Connected to ${conn.robotId} (${conn.wsUrl})`);
    });

    ws.on('message', (data: Buffer) => {
      this.handleMessage(conn, data);
    });

    ws.on('error', (err) => {
      // 'close' follows 'error'; reconnect is scheduled there.
      console.warn(
        `[TelemetryIngestion] WS error for ${conn.robotId}: ${err instanceof Error ? err.message : err}`
      );
    });

    ws.on('close', () => {
      conn.ws = null;
      this.scheduleReconnect(conn);
    });
  }

  private scheduleReconnect(conn: AgentConnection): void {
    if (conn.stopped || conn.reconnectTimer) return;

    const delay = conn.backoffMs;
    conn.backoffMs = Math.min(conn.backoffMs * 2, RECONNECT_MAX_MS);
    conn.reconnectTimer = setTimeout(() => {
      conn.reconnectTimer = null;
      this.connect(conn);
    }, delay);
  }

  // ==========================================================================
  // INTERNAL: FRAME HANDLING
  // ==========================================================================

  private handleMessage(conn: AgentConnection, data: Buffer): void {
    let message: AgentWsMessage;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return; // ignore malformed frames
    }

    // High-rate subset frames (TASK-191): relay straight to the broadcast path
    // as a distinct event and NEVER persist — the ≥PERSIST_INTERVAL_MS
    // downsampling below stays keyed off full frames only.
    if (message.type === 'telemetry_fast' && message.payload) {
      const fast: RobotTelemetryFast = {
        ...(message.payload as RobotTelemetryFast),
        robotId: conn.robotId,
      };
      robotManager.emitTelemetryFast(conn.robotId, fast);
      return;
    }

    // Agents also push 'alert' and 'pong' messages on this socket.
    if (message.type !== 'telemetry' || !message.payload) {
      return;
    }

    // Canonicalize: the registry's robot id wins over whatever the frame says.
    const telemetry: RobotTelemetry = {
      ...(message.payload as RobotTelemetry),
      robotId: conn.robotId,
    };

    // (a) Broadcast EVERY frame to app clients via RobotManager's event bus —
    // websocket/index.ts turns it into the same envelope as robot_status_changed.
    robotManager.emitTelemetry(conn.robotId, telemetry);

    // (b) Persist downsampled.
    const now = Date.now();
    const hasIssues =
      (telemetry.errors?.length ?? 0) > 0 || (telemetry.warnings?.length ?? 0) > 0;
    const issuesAppeared = hasIssues && !conn.hadIssues;
    conn.hadIssues = hasIssues;

    if (issuesAppeared || now - conn.lastPersistAt >= PERSIST_INTERVAL_MS) {
      conn.lastPersistAt = now;
      void robotRepository.saveTelemetry(telemetry).catch((err) => {
        console.error(`[TelemetryIngestion] Failed to persist telemetry for ${conn.robotId}:`, err);
      });
    }
  }
}

// Singleton instance
export const telemetryIngestionService = new TelemetryIngestionService();
