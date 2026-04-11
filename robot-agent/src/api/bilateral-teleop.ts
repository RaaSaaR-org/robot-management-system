/**
 * @file bilateral-teleop.ts
 * @description WebSocket endpoint for bilateral (ALOHA-style) teleoperation.
 *              Receives leader-arm joint positions, maps them to the follower arm,
 *              sends actions to the hardware sidecar, and streams follower state back.
 * @feature teleop
 * @deprecated TASK-117 (2026-04-12): superseded by the sidecar
 *             `lerobot-record` path. The leader/follower bridge now lives
 *             in `robot-agent/hardware/so101_sidecar.py` (`POST /record/start`)
 *             and is driven server-side by
 *             `server/src/services/TeleoperationService.ts` `startSession`/`endSession`.
 *             This file is unused as of TASK-117 (the WebSocket server is
 *             still wired up in `index.ts` so any in-flight clients keep
 *             working, but no UI in the app connects to it). Scheduled for
 *             removal in a follow-up cleanup task — find with
 *             `git grep "@deprecated TASK-117"`. Do not extend.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { IncomingMessage } from 'http';
import type { FrameRecorder, JointPositions } from '../teleop/FrameRecorder.js';

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

/**
 * Leader → Follower joint mapping configuration.
 * Each entry maps a leader joint to a follower joint with an optional sign flip.
 * For a single-arm setup the mapping is 1:1.
 */
export const LEADER_FOLLOWER_MAPPING: Array<{
  leader: string;
  follower: string;
  sign: 1 | -1;
}> = [
  { leader: 'shoulder_pan',  follower: 'shoulder_pan',  sign: 1 },
  { leader: 'shoulder_lift', follower: 'shoulder_lift', sign: 1 },
  { leader: 'elbow_flex',    follower: 'elbow_flex',    sign: 1 },
  { leader: 'wrist_flex',    follower: 'wrist_flex',    sign: 1 },
  { leader: 'wrist_roll',    follower: 'wrist_roll',    sign: 1 },
  { leader: 'gripper',       follower: 'gripper',       sign: 1 },
];

// ── Message types ────────────────────────────────────────────────────────

interface LeaderStateMessage {
  type: 'leader_state';
  joints: JointPositions;
  timestamp: number;
}

interface FollowerStateMessage {
  type: 'follower_state';
  joints: Record<string, number>;
  timestamp: number;
}

interface ErrorMessage {
  type: 'error';
  message: string;
}

interface ReadyMessage {
  type: 'ready';
}

type OutgoingMessage = FollowerStateMessage | ErrorMessage | ReadyMessage;

// ── Helpers ──────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mapLeaderToFollower(leaderJoints: JointPositions): Record<string, number> {
  const follower: Record<string, number> = {};
  for (const mapping of LEADER_FOLLOWER_MAPPING) {
    const raw = leaderJoints[mapping.leader];
    if (raw === undefined) continue;
    const limits = JOINT_LIMITS[mapping.follower];
    if (!limits) continue;
    follower[mapping.follower] = clamp(raw * mapping.sign, limits.min, limits.max);
  }
  return follower;
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
    console.error('[BilateralTeleop] Failed to send action to sidecar:', err);
  }
}

async function fetchFollowerState(): Promise<Record<string, number>> {
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
    return {};
  }
}

function send(ws: WebSocket, msg: OutgoingMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function extractSessionId(req: IncomingMessage): string | null {
  try {
    const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
    return url.searchParams.get('sessionId');
  } catch {
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────────

export function createBilateralTeleopWebSocket(
  server: Server,
  frameRecorder: FrameRecorder,
): WebSocketServer {
  const wss = new WebSocketServer({
    server,
    path: '/ws/bilateral-teleop',
  });

  console.log('[BilateralTeleop] WebSocket server listening on path: /ws/bilateral-teleop');

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const sessionId = extractSessionId(req);
    console.log(`[BilateralTeleop] Client connected — session: ${sessionId ?? '(none)'}`);

    if (sessionId) {
      frameRecorder.startSession(sessionId);
    }

    send(ws, { type: 'ready' });

    ws.on('message', async (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as LeaderStateMessage;

        if (msg.type !== 'leader_state' || !msg.joints) {
          send(ws, { type: 'error', message: 'Expected message type "leader_state" with joints' });
          return;
        }

        // Map leader positions → follower target
        const followerTarget = mapLeaderToFollower(msg.joints);

        // Send to hardware sidecar
        await sendActionToSidecar(followerTarget);

        // Read back actual follower state
        const followerActual = await fetchFollowerState();
        const followerJoints = Object.keys(followerActual).length > 0 ? followerActual : followerTarget;

        // Record frame if session is active
        if (frameRecorder.isRecording()) {
          frameRecorder.recordFrame(msg.joints, followerJoints as JointPositions);
        }

        // Send follower state back to client
        send(ws, {
          type: 'follower_state',
          joints: followerJoints,
          timestamp: Date.now(),
        });
      } catch (err) {
        console.error('[BilateralTeleop] Error processing message:', err);
        send(ws, { type: 'error', message: 'Failed to process leader state' });
      }
    });

    ws.on('close', () => {
      console.log('[BilateralTeleop] Client disconnected');
      if (frameRecorder.isRecording()) {
        frameRecorder.stopSession();
      }
    });

    ws.on('error', (error) => {
      console.error('[BilateralTeleop] WebSocket error:', error);
    });
  });

  return wss;
}
