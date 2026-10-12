/**
 * @file index.ts
 * @description WebSocket server for real-time A2A events
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage, Server } from 'http';
import { conversationManager } from '../services/ConversationManager.js';
import { robotManager, type RobotEvent } from '../services/RobotManager.js';
import { alertService, type AlertEvent } from '../services/AlertService.js';
import { processManager } from '../services/ProcessManager.js';
import { taskDistributor } from '../services/TaskDistributor.js';
import { safetyService, type EStopEvent } from '../services/SafetyService.js';
import { incidentService } from '../services/IncidentService.js';
import { trainingJobService } from '../services/TrainingJobService.js';
import { datasetService } from '../services/DatasetService.js';
import { deploymentService } from '../services/DeploymentService.js';
import { teleoperationService } from '../services/TeleoperationService.js';
import { sensorScanService } from '../services/SensorScanService.js';
import { scanSessionService } from '../services/ScanSessionService.js';
import { digitalTwinService } from '../services/DigitalTwinService.js';
import { twinZoneService } from '../services/TwinZoneService.js';
import { agentModeService } from '../services/AgentModeService.js';
import { authService } from '../services/AuthService.js';
import { MULTI_TENANCY_ENABLED } from '../config/features.js';
import { deliverEvent, deliverEventPerSocket, TenantResolver, UNRESOLVED_ROBOT_TENANT } from './eventFanout.js';
import { eStopEventFor, eventTenantKey, tenantKey, type TenantKey } from './eventTenancy.js';
import { lookupTenant } from './tenantLookups.js';
import { onControlLeaseTransition } from '../services/controlLeaseEvents.js';
import {
  deliverControlLeaseTransition,
  identityFromToken,
  identityFromUpgrade,
  type AccessTokenVerifier,
  type SocketIdentity,
} from './socketIdentity.js';
import type { AgentModeEvent } from '../types/agent-mode.types.js';
import type { SensorScanEvent } from '../types/pointcloud.types.js';
import type { DigitalTwinEvent, TwinZoneEvent } from '../types/twin.types.js';
import type { IncidentEvent } from '../types/incident.types.js';
import type { DeploymentEvent } from '../types/deployment.types.js';
import type { A2ATaskEvent } from '../types/index.js';
import type { ProcessEvent } from '../types/process.types.js';
import type { TaskEvent } from '../types/robotTask.types.js';
import type { TrainingJobEvent } from '../types/training.types.js';
import type { DatasetEvent } from '../types/dataset.types.js';
import type { TeleoperationEvent } from '../types/teleoperation.types.js';

// Configuration
const MAX_CLIENTS = 1000;
const MAX_BUFFERED_AMOUNT = 65536; // 64KB backpressure threshold
const HEARTBEAT_INTERVAL_MS = 30000; // 30 seconds
const PONG_TIMEOUT_MS = 10000; // 10 seconds to respond to ping

/**
 * Safely send a message to a WebSocket client with error handling and backpressure check
 */
function safeSend(client: WebSocket, message: string, clients: Set<WebSocket>): boolean {
  try {
    if (client.readyState !== WebSocket.OPEN) {
      return false;
    }
    // Check backpressure - skip if client is too slow
    if (client.bufferedAmount > MAX_BUFFERED_AMOUNT) {
      console.warn('[WebSocket] Client backpressure detected, skipping message');
      return false;
    }
    client.send(message);
    return true;
  } catch (error) {
    console.error('[WebSocket] Send error:', error);
    clients.delete(client);
    return false;
  }
}

const verifyAccessToken: AccessTokenVerifier = (token) => authService.verifyAccessToken(token);

/**
 * Setup WebSocket server for real-time communication
 */
export function setupWebSocket(server: Server): void {
  const wss = new WebSocketServer({
    server,
    path: '/api/a2a/ws',
  });

  const clients = new Set<WebSocket>();
  // Track alive status for heartbeat - use WeakMap to avoid memory leaks
  const clientAliveStatus = new WeakMap<WebSocket, boolean>();
  // Who each socket proved to be (TASK-318); absent → no tenant-scoped events.
  const clientIdentity = new WeakMap<WebSocket, SocketIdentity>();

  // Event fan-out (TASK-366, TASK-368): identified sockets only, and every
  // event only to sockets that may observe the tenant of the entity it is
  // about (eventTenancy.ts names that entity per family).
  const send = (client: WebSocket, message: string): void => {
    safeSend(client, message, clients);
  };
  const tenants = new TenantResolver(lookupTenant);
  /**
   * An event about the entity `key` names. Without multi-tenancy every event
   * goes to every identified socket; with it, an event that names no entity
   * goes to super-admins only.
   */
  const deliverFor = (message: string, key: TenantKey | null): void => {
    if (!MULTI_TENANCY_ENABLED) {
      deliverEvent(clients, clientIdentity, message, send, null);
      return;
    }
    if (key === null) {
      deliverEvent(clients, clientIdentity, message, send, UNRESOLVED_ROBOT_TENANT);
      return;
    }
    const known = tenants.peek(key);
    if (known !== undefined) {
      deliverEvent(clients, clientIdentity, message, send, known);
      return;
    }
    tenants.resolve(key).then(
      (tenantId) => deliverEvent(clients, clientIdentity, message, send, tenantId),
      () => deliverEvent(clients, clientIdentity, message, send, UNRESOLVED_ROBOT_TENANT)
    );
  };
  const robotKey = (robotId: string | null | undefined): TenantKey | null =>
    robotId ? tenantKey('robot', robotId) : null;

  // Heartbeat interval to detect dead connections
  const heartbeatInterval = setInterval(() => {
    clients.forEach((ws) => {
      const isAlive = clientAliveStatus.get(ws);
      if (isAlive === false) {
        // Client didn't respond to previous ping, terminate
        console.log('[WebSocket] Terminating unresponsive client');
        clients.delete(ws);
        ws.terminate();
        return;
      }
      // Mark as not alive, will be set to true when pong received
      clientAliveStatus.set(ws, false);
      ws.ping();
    });
  }, HEARTBEAT_INTERVAL_MS);

  // Clean up interval when server closes
  // Control-lease transitions (TASK-318) go only to identified sockets of the
  // robot's tenant — they name users, unlike everything broadcast below.
  const stopLeaseEvents = onControlLeaseTransition((transition) =>
    deliverControlLeaseTransition(clients, clientIdentity, transition, (client, message) =>
      safeSend(client, message, clients)
    )
  );

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
    stopLeaseEvents();
  });

  wss.on('connection', (ws: WebSocket, req?: IncomingMessage) => {
    // Reject connection if at capacity
    if (clients.size >= MAX_CLIENTS) {
      console.warn(`[WebSocket] Connection rejected: max clients (${MAX_CLIENTS}) reached`);
      ws.close(1013, 'Server at capacity');
      return;
    }

    console.log(`[WebSocket] Client connected (total: ${clients.size + 1})`);
    clients.add(ws);
    clientAliveStatus.set(ws, true);
    const identity = identityFromUpgrade(req, verifyAccessToken);
    if (identity) clientIdentity.set(ws, identity);

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      message: 'Connected to A2A WebSocket server',
      timestamp: Date.now(),
    }));

    // Handle pong responses (heartbeat)
    ws.on('pong', () => {
      clientAliveStatus.set(ws, true);
    });

    // Handle incoming messages
    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        handleClientMessage(ws, message, clientIdentity);
      } catch (error) {
        console.error('Invalid WebSocket message:', error);
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Invalid message format',
        }));
      }
    });

    // Handle close
    ws.on('close', () => {
      console.log(`[WebSocket] Client disconnected (total: ${clients.size - 1})`);
      clients.delete(ws);
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error('[WebSocket] Client error:', error);
      clients.delete(ws);
    });
  });

  // Subscribe to task events and fan them out (eventFanout.ts)
  conversationManager.onTaskEvent((event: A2ATaskEvent) => {
    const message = JSON.stringify({
      type: 'task_event',
      event,
      timestamp: Date.now(),
    });
    deliverFor(message, eventTenantKey.a2aTask(event));
  });

  // Subscribe to robot events and fan them out (eventFanout.ts)
  robotManager.onRobotEvent((event: RobotEvent) => {
    const message = JSON.stringify({
      ...event,
      type: event.type, // Ensure type comes last to override spread
    });
    // A (re-)registration may have moved the robot to another tenant.
    if (event.type === 'robot_registered' || event.type === 'robot_unregistered') {
      tenants.forget(tenantKey('robot', event.robotId));
    }
    deliverFor(message, robotKey(event.robotId));
  });

  // Subscribe to alert events and fan them out (eventFanout.ts)
  alertService.onAlertEvent((event: AlertEvent) => {
    const message = JSON.stringify({
      type: event.type,
      alert: event.alert,
      timestamp: event.timestamp,
    });
    deliverFor(message, eventTenantKey.alert(event));
  });

  // Subscribe to process events and fan them out (eventFanout.ts)
  processManager.onProcessEvent((event: ProcessEvent) => {
    const message = JSON.stringify({
      type: event.type,
      processInstance: 'processInstance' in event ? event.processInstance : undefined,
      stepInstance: 'stepInstance' in event ? event.stepInstance : undefined,
      processInstanceId: 'processInstanceId' in event ? event.processInstanceId : undefined,
      error: 'error' in event ? event.error : undefined,
      timestamp: Date.now(),
    });
    deliverFor(message, eventTenantKey.process(event));
  });

  // Subscribe to robot task events and fan them out (eventFanout.ts)
  taskDistributor.onTaskEvent((event: TaskEvent) => {
    const message = JSON.stringify({
      type: event.type,
      task: 'task' in event ? event.task : undefined,
      taskId: 'taskId' in event ? event.taskId : undefined,
      robotId: 'robotId' in event ? event.robotId : undefined,
      progress: 'progress' in event ? event.progress : undefined,
      result: 'result' in event ? event.result : undefined,
      error: 'error' in event ? event.error : undefined,
      timestamp: Date.now(),
    });
    deliverFor(message, eventTenantKey.robotTask(event));
  });

  // Handle robot work assignment notifications (push to robot)
  taskDistributor.on('robot:work_assigned', (data: { robotId: string; task: unknown }) => {
    const message = JSON.stringify({
      type: 'robot:work_assigned',
      robotId: data.robotId,
      task: data.task,
      timestamp: Date.now(),
    });
    deliverFor(message, robotKey(data.robotId));
  });

  // Handle robot work cancellation notifications
  taskDistributor.on('robot:work_cancelled', (data: { robotId: string; taskId: string; reason?: string }) => {
    const message = JSON.stringify({
      type: 'robot:work_cancelled',
      robotId: data.robotId,
      taskId: data.taskId,
      reason: data.reason,
      timestamp: Date.now(),
    });
    deliverFor(message, robotKey(data.robotId));
  });

  // Subscribe to E-stop events and fan them out (eventFanout.ts)
  // A fleet or zone stop can span tenants: each socket gets its own robots'
  // part of it (eventTenancy.ts `eStopEventFor`).
  safetyService.onEStopEvent((event: EStopEvent) => {
    const timestamp = Date.now();
    const render = (part: EStopEvent): string => JSON.stringify({ type: 'safety:estop', event: part, timestamp });
    if (!MULTI_TENANCY_ENABLED) {
      deliverEvent(clients, clientIdentity, render(event), send, null);
      return;
    }
    const robotIds = [...new Set(event.affectedRobots)];
    void Promise.all(
      robotIds.map((robotId) =>
        tenants.resolve(tenantKey('robot', robotId)).then(
          (tenantId): [string, string | null] => [robotId, tenantId],
          (): [string, string | null] => [robotId, UNRESOLVED_ROBOT_TENANT]
        )
      )
    ).then((pairs) => {
      const robotTenants = new Map(pairs);
      const full = render(event);
      deliverEventPerSocket(
        clients,
        clientIdentity,
        (identity) => {
          const part = eStopEventFor(event, identity, robotTenants, UNRESOLVED_ROBOT_TENANT);
          if (part === null) return null;
          return part === event ? full : render(part);
        },
        send
      );
    });
  });

  // Subscribe to incident events and fan them out (eventFanout.ts)
  incidentService.onIncidentEvent((event: IncidentEvent) => {
    const message = JSON.stringify({
      type: event.type,
      incident: event.incident,
      notification: event.notification,
      timestamp: event.timestamp,
    });
    deliverFor(message, eventTenantKey.incident(event));
  });

  // Subscribe to training job events and fan them out (eventFanout.ts)
  trainingJobService.onJobEvent((event: TrainingJobEvent) => {
    const message = JSON.stringify({
      type: event.type,
      jobId: event.jobId,
      job: event.job,
      progress: event.progress,
      error: event.error,
      timestamp: event.timestamp,
    });
    deliverFor(message, eventTenantKey.trainingJob(event));
  });

  // Subscribe to dataset events and fan them out (eventFanout.ts)
  datasetService.onDatasetEvent((event: DatasetEvent) => {
    const message = JSON.stringify({
      type: event.type,
      datasetId: event.datasetId,
      dataset: event.dataset,
      progress: event.progress,
      importProgress: event.importProgress,
      log: event.log,
      error: event.error,
      timestamp: event.timestamp,
    });
    deliverFor(message, eventTenantKey.dataset(event));
  });

  // Subscribe to sensor-scan events (point clouds) and fan them out (eventFanout.ts).
  // Lightweight notifications only — the point bytes are fetched on demand.
  sensorScanService.onSensorScanEvent((event: SensorScanEvent) => {
    const message = JSON.stringify({
      type: event.type,
      scanId: event.scanId,
      robotId: event.robotId,
      scan: event.scan,
      timestamp: event.timestamp,
    });
    deliverFor(message, robotKey(event.robotId));
  });

  // Subscribe to digital-twin scan-session + build events (TASK-170).
  // The capture-loop progress comes from scanSessionService; the sidecar
  // build progress + ready/failed come from digitalTwinService. Both emit the
  // same DigitalTwinEvent union, broadcast field-by-field per the contract.
  const broadcastTwinEvent = (event: DigitalTwinEvent): void => {
    const base: Record<string, unknown> = { type: event.type, timestamp: event.timestamp };
    if (event.type === 'session:progress') {
      base.sessionId = event.sessionId;
      base.twinId = event.twinId;
      base.status = event.status;
      base.frameCount = event.frameCount;
      base.progress = event.progress;
      base.stage = event.stage;
    } else if (event.type === 'twin:ready') {
      base.twinId = event.twinId;
      base.sessionId = event.sessionId;
      base.twin = event.twin;
    } else if (event.type === 'twin:failed') {
      base.twinId = event.twinId;
      base.sessionId = event.sessionId;
      base.error = event.error;
    }
    deliverFor(JSON.stringify(base), eventTenantKey.twin(event));
  };
  scanSessionService.onDigitalTwinEvent(broadcastTwinEvent);
  digitalTwinService.onDigitalTwinEvent(broadcastTwinEvent);

  // Subscribe to twin-zone authoring events (TASK-170 L2).
  twinZoneService.onTwinZoneEvent((event: TwinZoneEvent) => {
    const message = JSON.stringify({
      type: event.type,
      twinId: event.twinId,
      zone: 'zone' in event ? event.zone : undefined,
      zoneId: 'zoneId' in event ? event.zoneId : undefined,
      timestamp: event.timestamp,
    });
    deliverFor(message, eventTenantKey.twin(event));
  });

  // Subscribe to teleoperation (data collection) events and fan them out to the robot's
  // tenant. Event types are namespaced 'teleop:*' so feature clients can
  // filter with a simple prefix check (mirrors 'training:job:*').
  teleoperationService.on('teleoperation:event', (event: TeleoperationEvent) => {
    const typeMap: Record<string, string> = {
      'session:progress': 'teleop:session:progress',
      'quality:warning': 'teleop:quality',
      'session:completed': 'teleop:session:completed',
      'session:exported': 'teleop:session:exported',
      'session:started': 'teleop:session:started',
      'session:paused': 'teleop:session:paused',
      'session:resumed': 'teleop:session:resumed',
      'session:failed': 'teleop:session:failed',
    };
    const mappedType = typeMap[event.type];
    if (!mappedType) return; // created / frame-level events are not broadcast

    const message = JSON.stringify({
      type: mappedType,
      data: {
        sessionId: event.sessionId,
        session: event.session,
        recordingProgress: event.recordingProgress,
        qualityFeedback: event.qualityFeedback,
        error: event.error,
      },
      timestamp: Date.now(),
    });
    deliverFor(message, eventTenantKey.teleop(event));
  });

  // Subscribe to Agent Mode events (TASK-194) and fan them out (eventFanout.ts).
  // Event types are namespaced 'agent:*' so the /agent feature can filter with
  // a simple prefix check (mirrors 'teleop:*'). The envelope is flat and the
  // event's own ISO timestamp is preserved; absent fields drop out of the JSON.
  agentModeService.onAgentModeEvent((event: AgentModeEvent) => {
    const message = JSON.stringify({
      type: event.type,
      robotId: event.robotId,
      plan: event.plan,
      block: event.block,
      scene: event.scene,
      state: event.state,
      // `agent:memory:updated` carries nothing else — without this field the
      // event reaches the app as an empty envelope and the MemoryPanel never
      // learns that the robot's durable memory changed.
      memory: event.memory,
      // Patrol (TASK-212): `agent:patrol:*` carries the run, `agent:finding:*`
      // the finding (+ run). Absent fields drop out of the JSON as before.
      patrol: event.patrol,
      finding: event.finding,
      // Host mode (TASK-213): `agent:tour:*` carries the run; `agent:tour:turn`
      // also carries the question that was just answered. Same channel as
      // patrol — the app filters on the `agent:` prefix, not on a new socket.
      tour: event.tour,
      turn: event.turn,
      timestamp: event.timestamp,
    });
    deliverFor(message, robotKey(event.robotId));
  });

  // Subscribe to deployment events and fan them out (eventFanout.ts) (Task 47)
  deploymentService.onDeploymentEvent((event: DeploymentEvent) => {
    const message = JSON.stringify({
      type: event.type,
      deploymentId: event.deploymentId,
      deployment: event.deployment,
      robotId: event.robotId,
      stage: event.stage,
      totalStages: event.totalStages,
      metrics: event.metrics,
      error: event.error,
      reason: event.reason,
      timestamp: event.timestamp,
    });
    deliverFor(message, eventTenantKey.deployment(event));
  });

  console.log('WebSocket server initialized');
}

/**
 * Handle messages from WebSocket clients
 */
function handleClientMessage(
  ws: WebSocket,
  message: unknown,
  identities: WeakMap<WebSocket, SocketIdentity>
): void {
  if (!message || typeof message !== 'object') {
    return;
  }

  const msg = message as Record<string, unknown>;

  switch (msg.type) {
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      break;

    case 'auth': {
      // In-band identification for clients that cannot put the token on the
      // upgrade URL. A bad token clears nothing and grants nothing. A socket
      // may send `auth` again at any time (after a token refresh) to
      // re-identify. A rejection says why, so the client can refresh its
      // token and try once more instead of staying unidentified (TASK-366).
      const identity = identityFromToken(msg.token, verifyAccessToken);
      if (identity) {
        identities.set(ws, identity);
        ws.send(JSON.stringify({ type: 'auth', authenticated: true }));
      } else {
        ws.send(JSON.stringify({ type: 'auth', authenticated: false, error: 'invalid_token' }));
      }
      break;
    }

    case 'subscribe':
      // Client wants to subscribe to specific events
      // No per-topic subscriptions: an identified client gets every event it may see
      ws.send(JSON.stringify({
        type: 'subscribed',
        message: 'Subscribed to all events',
      }));
      break;

    default:
      ws.send(JSON.stringify({
        type: 'unknown',
        message: `Unknown message type: ${msg.type}`,
      }));
  }
}
