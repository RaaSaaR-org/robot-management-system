/**
 * @file pointcloud-websocket.ts
 * @description WebSocket server streaming binary point-cloud frames.
 *
 * Mirrors the telemetry WS (noServer mode, routed by the shared dispatcher in
 * index.ts) but sends compact binary frames (see pointcloud-binary.ts) at a few
 * Hz. Frames are dropped when the socket is backed up — point clouds are
 * inherently droppable, newest-wins. This is the production / high-fidelity
 * path; dev clients poll the REST snapshot instead.
 *
 * @status live
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { RobotStateManager } from '../robot/state.js';
import { encodePointCloudFrame } from '../robot/pointcloud-binary.js';

/** ~3 Hz — smooth enough for a perception dashboard without flooding the link. */
const POINTCLOUD_INTERVAL_MS = 333;
/** Skip a frame if the socket has more than this buffered (newest-wins). */
const MAX_BUFFERED_BYTES = 1_000_000;

export function createPointCloudWebSocket(
  robotStateManager: RobotStateManager,
): WebSocketServer {
  const robotId = robotStateManager.getState().id;
  const wss = new WebSocketServer({ noServer: true });

  console.log(`[PointCloudWS] WebSocket server ready on path: /ws/pointcloud/${robotId}`);

  wss.on('connection', (ws: WebSocket, req?: { url?: string }) => {
    console.log('[PointCloudWS] Client connected');

    // Optional ?sensor=<name> query selects a specific depth sensor.
    let sensorName: string | undefined;
    try {
      const url = new URL(req?.url ?? '/', 'http://localhost');
      sensorName = url.searchParams.get('sensor') ?? undefined;
    } catch {
      sensorName = undefined;
    }

    let streaming = false;
    const tick = async () => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (streaming) return; // don't overlap async frame generation
      if (ws.bufferedAmount > MAX_BUFFERED_BYTES) return; // backpressure: drop frame
      streaming = true;
      try {
        const frame = await robotStateManager.getPointCloudFrame(sensorName);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(encodePointCloudFrame(frame), { binary: true });
        }
      } catch (error) {
        console.error('[PointCloudWS] Frame generation failed:', error);
      } finally {
        streaming = false;
      }
    };

    // Kick off immediately, then on an interval.
    void tick();
    const interval = setInterval(() => void tick(), POINTCLOUD_INTERVAL_MS);

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
        }
      } catch {
        // Ignore non-JSON control frames.
      }
    });

    ws.on('close', () => {
      console.log('[PointCloudWS] Client disconnected');
      clearInterval(interval);
    });

    ws.on('error', (error) => {
      console.error('[PointCloudWS] WebSocket error:', error);
      clearInterval(interval);
    });
  });

  return wss;
}
