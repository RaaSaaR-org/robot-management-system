/**
 * @file index.ts
 * @description WebSocket server for real-time A2A events
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { conversationManager } from '../services/ConversationManager.js';
import { robotManager, type RobotEvent } from '../services/RobotManager.js';
import { alertService, type AlertEvent } from '../services/AlertService.js';
import { zoneService, type ZoneEvent } from '../services/ZoneService.js';
import { processManager } from '../services/ProcessManager.js';
import { taskDistributor } from '../services/TaskDistributor.js';
import { safetyService, type EStopEvent } from '../services/SafetyService.js';
import type { A2ATaskEvent } from '../types/index.js';
import type { ProcessEvent } from '../types/process.types.js';
import type { TaskEvent } from '../types/robotTask.types.js';

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

/**
 * Broadcast message to all connected clients with error handling
 */
function broadcast(clients: Set<WebSocket>, message: string): void {
  clients.forEach((client) => {
    safeSend(client, message, clients);
  });
}

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
  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  wss.on('connection', (ws: WebSocket) => {
    // Reject connection if at capacity
    if (clients.size >= MAX_CLIENTS) {
      console.warn(`[WebSocket] Connection rejected: max clients (${MAX_CLIENTS}) reached`);
      ws.close(1013, 'Server at capacity');
      return;
    }

    console.log(`[WebSocket] Client connected (total: ${clients.size + 1})`);
    clients.add(ws);
    clientAliveStatus.set(ws, true);

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
        handleClientMessage(ws, message);
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

  // Subscribe to task events and broadcast to all clients
  conversationManager.onTaskEvent((event: A2ATaskEvent) => {
    const message = JSON.stringify({
      type: 'task_event',
      event,
      timestamp: Date.now(),
    });
    broadcast(clients, message);
  });

  // Subscribe to robot events and broadcast to all clients
  robotManager.onRobotEvent((event: RobotEvent) => {
    const message = JSON.stringify({
      ...event,
      type: event.type, // Ensure type comes last to override spread
    });
    broadcast(clients, message);
  });

  // Subscribe to alert events and broadcast to all clients
  alertService.onAlertEvent((event: AlertEvent) => {
    const message = JSON.stringify({
      type: event.type,
      alert: event.alert,
      timestamp: event.timestamp,
    });
    broadcast(clients, message);
  });

  // Subscribe to zone events and broadcast to all clients
  zoneService.onZoneEvent((event: ZoneEvent) => {
    const message = JSON.stringify({
      type: event.type,
      zone: event.zone,
      timestamp: event.timestamp,
    });
    broadcast(clients, message);
  });

  // Subscribe to process events and broadcast to all clients
  processManager.onProcessEvent((event: ProcessEvent) => {
    const message = JSON.stringify({
      type: event.type,
      processInstance: 'processInstance' in event ? event.processInstance : undefined,
      stepInstance: 'stepInstance' in event ? event.stepInstance : undefined,
      processInstanceId: 'processInstanceId' in event ? event.processInstanceId : undefined,
      error: 'error' in event ? event.error : undefined,
      timestamp: Date.now(),
    });
    broadcast(clients, message);
  });

  // Subscribe to robot task events and broadcast to all clients
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
    broadcast(clients, message);
  });

  // Handle robot work assignment notifications (push to robot)
  taskDistributor.on('robot:work_assigned', (data: { robotId: string; task: unknown }) => {
    const message = JSON.stringify({
      type: 'robot:work_assigned',
      robotId: data.robotId,
      task: data.task,
      timestamp: Date.now(),
    });
    broadcast(clients, message);
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
    broadcast(clients, message);
  });

  // Subscribe to E-stop events and broadcast to all clients
  safetyService.onEStopEvent((event: EStopEvent) => {
    const message = JSON.stringify({
      type: 'safety:estop',
      event,
      timestamp: Date.now(),
    });
    broadcast(clients, message);
  });

  console.log('WebSocket server initialized');
}

/**
 * Handle messages from WebSocket clients
 */
function handleClientMessage(ws: WebSocket, message: unknown): void {
  if (!message || typeof message !== 'object') {
    return;
  }

  const msg = message as Record<string, unknown>;

  switch (msg.type) {
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      break;

    case 'subscribe':
      // Client wants to subscribe to specific events
      // For now, all clients receive all events
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
