/**
 * @file telemetryLive.test.ts
 * @description Tests for the transient fast-telemetry store (TASK-191).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  pushFastTelemetry,
  getFastTelemetry,
  clearFastTelemetry,
  FAST_FRAME_FRESHNESS_MS,
} from '../telemetryLive';

afterEach(() => {
  clearFastTelemetry();
  vi.useRealTimers();
});

describe('telemetryLive', () => {
  it('returns the latest frame per robot', () => {
    pushFastTelemetry('r1', { jointStates: [{ name: 'a', position: 0.1 }] });
    pushFastTelemetry('r1', { jointStates: [{ name: 'a', position: 0.2 }] });
    pushFastTelemetry('r2', { jointStates: [{ name: 'b', position: 0.5 }] });

    expect(getFastTelemetry('r1')?.frame.jointStates?.[0].position).toBe(0.2);
    expect(getFastTelemetry('r2')?.frame.jointStates?.[0].position).toBe(0.5);
  });

  it('returns null when no frame exists', () => {
    expect(getFastTelemetry('unknown')).toBeNull();
  });

  it('expires frames after the freshness window (graceful degradation)', () => {
    vi.useFakeTimers();
    pushFastTelemetry('r1', { jointStates: [] });

    vi.advanceTimersByTime(FAST_FRAME_FRESHNESS_MS - 1);
    expect(getFastTelemetry('r1')).not.toBeNull();

    vi.advanceTimersByTime(2);
    expect(getFastTelemetry('r1')).toBeNull();
  });

  it('clears frames per robot and globally', () => {
    pushFastTelemetry('r1', {});
    pushFastTelemetry('r2', {});

    clearFastTelemetry('r1');
    expect(getFastTelemetry('r1')).toBeNull();
    expect(getFastTelemetry('r2')).not.toBeNull();

    clearFastTelemetry();
    expect(getFastTelemetry('r2')).toBeNull();
  });
});
