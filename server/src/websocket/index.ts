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
import type { A2ATaskEvent } from '../types/index.js';

/**
 * Setup WebSocket server for real-time communication
 */
export function setupWebSocket(server: Server): void {
  const wss = new WebSocketServer({
    server,
    path: '/api/a2a/ws',
  });

  const clients = new Set<WebSocket>();

  wss.on('connection', (ws: WebSocket) => {
    console.log('WebSocket client connected');
    clients.add(ws);

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      message: 'Connected to A2A WebSocket server',
      timestamp: Date.now(),
    }));

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
      console.log('WebSocket client disconnected');
      clients.delete(ws);
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
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

    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });

  // Subscribe to robot events and broadcast to all clients
  robotManager.onRobotEvent((event: RobotEvent) => {
    const message = JSON.stringify({
      ...event,
      type: event.type, // Ensure type comes last to override spread
    });

    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });

  // Subscribe to alert events and broadcast to all clients
  alertService.onAlertEvent((event: AlertEvent) => {
    const message = JSON.stringify({
      type: event.type,
      alert: event.alert,
      timestamp: event.timestamp,
    });

    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });

  // Subscribe to zone events and broadcast to all clients
  zoneService.onZoneEvent((event: ZoneEvent) => {
    const message = JSON.stringify({
      type: event.type,
      zone: event.zone,
      timestamp: event.timestamp,
    });

    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
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
