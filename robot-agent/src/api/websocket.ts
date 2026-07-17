/**
 * @file websocket.ts
 * @description WebSocket server for real-time telemetry streaming
 * @status live
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { RobotStateManager } from '../robot/state.js';
import { config } from '../config/config.js';
import {
  formatTelemetryMessage,
  formatFastTelemetryMessage,
  generateAlerts,
  formatAlertMessage,
} from '../robot/telemetry.js';

export function createTelemetryWebSocket(
  robotStateManager: RobotStateManager
): WebSocketServer {
  const robotId = robotStateManager.getState().id;
  // noServer: upgrades are routed by the shared dispatcher in index.ts. Attaching
  // multiple {server}-bound ws servers makes the first one 400 every other path.
  const wss = new WebSocketServer({ noServer: true });

  const fullIntervalMs = config.telemetry.fullIntervalMs;
  // The fast channel only makes sense when it is actually faster than the full
  // frame; 0 (or any non-positive value) disables it entirely.
  const fastIntervalMs =
    config.telemetry.fastIntervalMs > 0 && config.telemetry.fastIntervalMs < fullIntervalMs
      ? config.telemetry.fastIntervalMs
      : 0;

  console.log(
    `[TelemetryWS] WebSocket server ready on path: /ws/telemetry/${robotId} ` +
      `(full ${fullIntervalMs}ms, fast ${fastIntervalMs > 0 ? `${fastIntervalMs}ms` : 'disabled'})`
  );

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

    // Full frames on the regular cadence (single source of full telemetry to
    // avoid duplicates).
    const fullInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        const telemetry = robotStateManager.getTelemetry();
        ws.send(formatTelemetryMessage(telemetry));
      }
    }, fullIntervalMs);

    // High-rate channel (TASK-191): joints/imu/odometry subset at the
    // SimulationEngine tick rate so the 3D viewer animates smoothly. Consumers
    // that don't opt in keep seeing only the full frames above.
    const fastInterval =
      fastIntervalMs > 0
        ? setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              const telemetry = robotStateManager.getTelemetry();
              ws.send(formatFastTelemetryMessage(telemetry));
            }
          }, fastIntervalMs)
        : null;

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

    const cleanup = () => {
      unsubscribe();
      clearInterval(fullInterval);
      if (fastInterval) clearInterval(fastInterval);
    };

    ws.on('close', () => {
      console.log('[TelemetryWS] Client disconnected');
      cleanup();
    });

    ws.on('error', (error) => {
      console.error('[TelemetryWS] WebSocket error:', error);
      cleanup();
    });
  });

  return wss;
}
