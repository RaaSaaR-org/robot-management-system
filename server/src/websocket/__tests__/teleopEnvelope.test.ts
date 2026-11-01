/**
 * @file teleopEnvelope.test.ts
 * @description Which teleoperation events reach the browser, under what name,
 *              and that the TASK-408 fields ride along without changing the
 *              old envelope.
 * @feature datacollection
 */

import { describe, it, expect } from 'vitest';
import { teleopEnvelope, TELEOP_EVENT_TYPES } from '../teleopEnvelope.js';
import type { TeleoperationEvent } from '../../types/teleoperation.types.js';

const AT = new Date('2026-10-17T12:00:00Z');
const BY = { userId: 'u1', displayName: 'Ana', source: 'vr' as const, clientId: 'quest-1' };

describe('teleopEnvelope', () => {
  it.each([
    ['episode:started', 'teleop:episode:started'],
    ['episode:stopped', 'teleop:episode:stopped'],
    ['episode:discarded', 'teleop:episode:discarded'],
    ['session:live', 'teleop:session:live'],
    ['session:progress', 'teleop:session:progress'],
    ['quality:warning', 'teleop:quality'],
  ])('maps %s to %s', (from, to) => {
    expect(TELEOP_EVENT_TYPES[from]).toBe(to);
  });

  it('does not broadcast frame-level events', () => {
    expect(teleopEnvelope({ type: 'frame:recorded', sessionId: 's1', timestamp: AT })).toBeNull();
  });

  it('carries take, quickCheck, by, reason and live on an episode event', () => {
    const event: TeleoperationEvent = {
      type: 'episode:stopped',
      sessionId: 's1',
      take: 3,
      reason: 'time_limit',
      quickCheck: null,
      by: { ...BY, source: 'auto' },
      live: { sessionId: 's1' } as TeleoperationEvent['live'],
      timestamp: AT,
    };
    const msg = JSON.parse(teleopEnvelope(event, 42)!);
    expect(msg).toEqual({
      type: 'teleop:episode:stopped',
      data: {
        sessionId: 's1',
        take: 3,
        reason: 'time_limit',
        quickCheck: null,
        by: { ...BY, source: 'auto' },
        live: { sessionId: 's1' },
      },
      timestamp: 42,
    });
  });

  it('leaves the old progress envelope unchanged', () => {
    const msg = JSON.parse(
      teleopEnvelope(
        { type: 'session:progress', sessionId: 's1', recordingProgress: { frameCount: 3 }, timestamp: AT },
        7
      )!
    );
    expect(msg).toEqual({ type: 'teleop:session:progress', data: { sessionId: 's1', recordingProgress: { frameCount: 3 } }, timestamp: 7 });
  });
});
