/**
 * @file teleopEnvelope.ts
 * @description The `teleop:*` WebSocket envelope for teleoperation events —
 *              which service events are broadcast, under what name, and in
 *              what shape. Pure, so the mapping is testable without a socket.
 * @feature datacollection
 */

import type { TeleoperationEvent } from '../types/teleoperation.types.js';

/**
 * Service event → broadcast name. Event types are namespaced `teleop:*` so
 * feature clients can filter with a prefix check (mirrors `training:job:*`).
 * Created and frame-level events are not broadcast.
 */
export const TELEOP_EVENT_TYPES: Readonly<Record<string, string>> = {
  'session:progress': 'teleop:session:progress',
  'quality:warning': 'teleop:quality',
  'session:completed': 'teleop:session:completed',
  'session:exported': 'teleop:session:exported',
  'session:started': 'teleop:session:started',
  'session:paused': 'teleop:session:paused',
  'session:resumed': 'teleop:session:resumed',
  'session:failed': 'teleop:session:failed',
  // TASK-408: explicit episode control and the one shared live state.
  'episode:started': 'teleop:episode:started',
  'episode:stopped': 'teleop:episode:stopped',
  'episode:discarded': 'teleop:episode:discarded',
  'session:live': 'teleop:session:live',
};

/** The serialized broadcast for `event`, or null when it is not broadcast. */
export function teleopEnvelope(event: TeleoperationEvent, nowMs: number = Date.now()): string | null {
  const type = TELEOP_EVENT_TYPES[event.type];
  if (!type) return null;
  return JSON.stringify({
    type,
    data: {
      sessionId: event.sessionId,
      session: event.session,
      recordingProgress: event.recordingProgress,
      qualityFeedback: event.qualityFeedback,
      error: event.error,
      // TASK-408 — absent keys drop out of the JSON, so old events are unchanged.
      live: event.live,
      take: event.take,
      startedAt: event.startedAt,
      quickCheck: event.quickCheck,
      by: event.by,
      reason: event.reason,
    },
    timestamp: nowMs,
  });
}
