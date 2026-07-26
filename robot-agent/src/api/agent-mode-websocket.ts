/**
 * @file agent-mode-websocket.ts
 * @description Local WebSocket fan-out of Agent Mode events on
 *              `/ws/agent-mode`. The authoritative path to the app stays
 *              robot-agent → server → `/api/a2a/ws`; this endpoint exists so a
 *              directly-attached client (roboctl, a dev tool, a robot-local UI)
 *              can watch a plan without a server in between.
 * @feature agentmode
 * @status live
 */

import { WebSocketServer, WebSocket } from 'ws';
import { agentModeController } from '../agent-mode/agent-mode-controller.js';
import type { AgentModeController } from '../agent-mode/agent-mode-controller.js';

export function createAgentModeWebSocket(
  controller: AgentModeController = agentModeController
): WebSocketServer {
  // noServer: upgrades are routed by the shared dispatcher in index.ts.
  const wss = new WebSocketServer({ noServer: true });

  console.log('[AgentModeWS] WebSocket server ready on path: /ws/agent-mode');

  wss.on('connection', (ws: WebSocket) => {
    console.log('[AgentModeWS] Client connected');

    // Seed the client with the current state so it does not have to wait for
    // the next event to render something truthful.
    try {
      ws.send(
        JSON.stringify({
          type: 'agent:state:changed',
          robotId: controller.getState().robotId,
          state: controller.getState(),
          timestamp: new Date().toISOString(),
        })
      );
    } catch (err) {
      console.warn('[AgentModeWS] Failed to send initial state:', err);
    }

    const unsubscribe = controller.subscribe((event) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(JSON.stringify(event));
      } catch (err) {
        console.warn('[AgentModeWS] Failed to send event:', err);
      }
    });

    ws.on('close', () => {
      unsubscribe();
      console.log('[AgentModeWS] Client disconnected');
    });
    ws.on('error', (err) => {
      console.warn('[AgentModeWS] Socket error:', err);
    });
  });

  return wss;
}
