/**
 * @file websocket.ts
 * @description WebSocket server for real-time telemetry streaming
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { RobotStateManager } from '../robot/state.js';
import {
  formatTelemetryMessage,
  generateAlerts,
  formatAlertMessage,
} from '../robot/telemetry.js';

const TELEMETRY_INTERVAL_MS = 2000;

export function createTelemetryWebSocket(
  server: Server,
  robotStateManager: RobotStateManager
): WebSocketServer {
  const robotId = robotStateManager.getState().id;
  const wss = new WebSocketServer({
    server,
    path: `/ws/telemetry/${robotId}`,
  });

  console.log(`[TelemetryWS] WebSocket server listening on path: /ws/telemetry/${robotId}`);

  wss.on('connection', (ws: WebSocket) => {
    console.log('[TelemetryWS] Client connected');

    // Send initial telemetry
    const initialTelemetry = robotStateManager.getTelemetry();
    ws.send(formatTelemetryMessage(initialTelemetry));

    // Subscribe to state changes for immediate alert notifications only
    // (Telemetry is sent via periodic interval to avoid duplicates)
    const unsubscribe = robotStateManager.subscribe((state) => {
      if (ws.readyState === WebSocket.OPEN) {
        // Only send alerts on state changes - telemetry is sent periodically
        const alerts = generateAlerts(state);
        for (const alert of alerts) {
          ws.send(formatAlertMessage(alert));
        }
      }
    });

    // Set up periodic telemetry updates (single source of telemetry to avoid duplicates)
    const interval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        const telemetry = robotStateManager.getTelemetry();
        ws.send(formatTelemetryMessage(telemetry));
      }
    }, TELEMETRY_INTERVAL_MS);

    // Handle incoming messages (for potential future commands)
    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        console.log('[TelemetryWS] Received message:', message);

        // Handle ping/pong for keep-alive
        if (message.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
        }
      } catch (error) {
        console.error('[TelemetryWS] Error parsing message:', error);
      }
    });

    ws.on('close', () => {
      console.log('[TelemetryWS] Client disconnected');
      unsubscribe();
      clearInterval(interval);
    });

    ws.on('error', (error) => {
      console.error('[TelemetryWS] WebSocket error:', error);
      unsubscribe();
      clearInterval(interval);
    });
  });

  return wss;
}
