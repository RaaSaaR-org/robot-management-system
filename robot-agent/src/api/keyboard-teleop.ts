/**
 * @file keyboard-teleop.ts
 * @description WebSocket endpoint for keyboard-based teleoperation of the SO-101 arm.
 *              Accepts joint delta commands and presets, forwards to the hardware sidecar.
 * @feature teleop
 * @status orphaned
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';

const SIDECAR_URL = process.env.HARDWARE_SIDECAR_URL ?? 'http://localhost:8765';

/** Safe joint ranges in degrees */
const JOINT_LIMITS: Record<string, { min: number; max: number }> = {
  shoulder_pan:  { min: -100, max: 100 },
  shoulder_lift: { min: -100, max: 100 },
  elbow_flex:    { min: -135, max: 135 },
  wrist_flex:    { min: -45,  max: 45  },
  wrist_roll:    { min: -180, max: 180 },
  gripper:       { min: 0,    max: 65  },
};

const HOME_POSITION: Record<string, number> = {
  shoulder_pan:  0,
  shoulder_lift: 0,
  elbow_flex:    0,
  wrist_flex:    0,
  wrist_roll:    0,
  gripper:       30,
};

const JOINT_NAMES = [
  'shoulder_pan', 'shoulder_lift', 'elbow_flex',
  'wrist_flex', 'wrist_roll', 'gripper',
];

interface JointDeltaMessage {
  joint: string;
  delta: number;
}

interface PresetMessage {
  preset: 'home' | 'stop';
}

type TeleopMessage = JointDeltaMessage | PresetMessage;

function isPresetMessage(msg: TeleopMessage): msg is PresetMessage {
  return 'preset' in msg;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function fetchCurrentState(): Promise<Record<string, number>> {
  try {
    const res = await fetch(`${SIDECAR_URL}/state`, { signal: AbortSignal.timeout(1000) });
    const data = (await res.json()) as {
      joints: Array<{ name: string; position: number }>;
    };
    const state: Record<string, number> = {};
    for (const j of data.joints) {
      state[j.name] = j.position;
    }
    return state;
  } catch {
    // Return home position as fallback
    return { ...HOME_POSITION };
  }
}

async function sendActionToSidecar(joints: Record<string, number>): Promise<void> {
  try {
    await fetch(`${SIDECAR_URL}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(joints),
      signal: AbortSignal.timeout(1000),
    });
  } catch (err) {
    console.error('[KeyboardTeleop] Failed to send action to sidecar:', err);
  }
}

export function createKeyboardTeleopWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({
    server,
    path: '/ws/keyboard-teleop',
  });

  console.log('[KeyboardTeleop] WebSocket server listening on path: /ws/keyboard-teleop');

  wss.on('connection', async (ws: WebSocket) => {
    console.log('[KeyboardTeleop] Client connected');

    // Fetch initial joint positions from the sidecar
    let currentPositions = await fetchCurrentState();

    // Send initial state to client
    ws.send(JSON.stringify({
      type: 'state',
      positions: currentPositions,
    }));

    ws.on('message', async (data: Buffer) => {
      try {
        const msg: TeleopMessage = JSON.parse(data.toString());

        if (isPresetMessage(msg)) {
          if (msg.preset === 'home') {
            currentPositions = { ...HOME_POSITION };
            await sendActionToSidecar(currentPositions);
            ws.send(JSON.stringify({ type: 'state', positions: currentPositions }));
          } else if (msg.preset === 'stop') {
            // Re-read current state (effectively stops at current position)
            currentPositions = await fetchCurrentState();
            ws.send(JSON.stringify({ type: 'state', positions: currentPositions }));
          }
          return;
        }

        // Joint delta message
        const { joint, delta } = msg as JointDeltaMessage;
        if (!joint || typeof delta !== 'number') {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid message: need joint and delta' }));
          return;
        }

        if (!JOINT_LIMITS[joint]) {
          ws.send(JSON.stringify({ type: 'error', message: `Unknown joint: ${joint}` }));
          return;
        }

        const limits = JOINT_LIMITS[joint];
        const current = currentPositions[joint] ?? 0;
        const newPos = clamp(current + delta, limits.min, limits.max);
        currentPositions[joint] = newPos;

        // Send full joint positions to sidecar
        await sendActionToSidecar(currentPositions);

        // Acknowledge with updated state
        ws.send(JSON.stringify({
          type: 'state',
          positions: currentPositions,
        }));
      } catch (err) {
        console.error('[KeyboardTeleop] Error processing message:', err);
        ws.send(JSON.stringify({ type: 'error', message: 'Failed to process command' }));
      }
    });

    ws.on('close', () => {
      console.log('[KeyboardTeleop] Client disconnected');
    });

    ws.on('error', (error) => {
      console.error('[KeyboardTeleop] WebSocket error:', error);
    });
  });

  return wss;
}
