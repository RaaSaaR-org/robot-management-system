/**
 * @file SimFrameRecorder.test.ts
 * @description Unit tests for SimFrameRecorder — sampling at fps, pause gaps,
 *   batched persistence, episode handling, and degraded-agent behavior.
 *   Uses fake timers throughout.
 * @feature datacollection
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SimFrameRecorder,
  type RecordedFrame,
  type RecorderTelemetry,
} from '../SimFrameRecorder.js';

const TELEMETRY: RecorderTelemetry = {
  jointStates: [
    { name: 'shoulder_pan', position: 0.1, velocity: 0.01 },
    { name: 'shoulder_lift', position: -0.2, velocity: 0.02 },
  ],
};

function makeRecorder(overrides: Partial<ConstructorParameters<typeof SimFrameRecorder>[0]> = {}) {
  const persisted: RecordedFrame[] = [];
  const fetchTelemetry = vi.fn().mockResolvedValue(TELEMETRY);
  const persistFrames = vi.fn().mockImplementation(async (frames: RecordedFrame[]) => {
    persisted.push(...frames);
  });
  const onProgress = vi.fn();
  const onDegraded = vi.fn();

  const recorder = new SimFrameRecorder({
    sessionId: 'session-1',
    fps: 10,
    fetchTelemetry,
    persistFrames,
    onProgress,
    onDegraded,
    ...overrides,
  });

  return { recorder, persisted, fetchTelemetry, persistFrames, onProgress, onDegraded };
}

/** Advance fake timers AND drain the microtask queue between ticks. */
async function advance(ms: number, stepMs = 50): Promise<void> {
  let remaining = ms;
  while (remaining > 0) {
    const step = Math.min(stepMs, remaining);
    await vi.advanceTimersByTimeAsync(step);
    remaining -= step;
  }
}

describe('SimFrameRecorder', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // SAMPLING AT FPS
  // --------------------------------------------------------------------------

  it('samples telemetry at the configured fps', async () => {
    const { recorder, fetchTelemetry } = makeRecorder();
    recorder.start();

    await advance(1000); // 1 second @ 10 fps
    expect(fetchTelemetry.mock.calls.length).toBeGreaterThanOrEqual(9);
    expect(fetchTelemetry.mock.calls.length).toBeLessThanOrEqual(11);

    await recorder.stop();
  });

  it('turns telemetry into frames with action = jointPositions (teleop passthrough)', async () => {
    const { recorder, persisted } = makeRecorder();
    recorder.start();

    await advance(1100); // > flush interval, so at least one batch persisted
    await recorder.stop();

    expect(persisted.length).toBeGreaterThan(0);
    const f = persisted[0];
    expect(f.jointPositions).toEqual([0.1, -0.2]);
    expect(f.action).toEqual(f.jointPositions);
    expect(f.jointVelocities).toEqual([0.01, 0.02]);
    expect(f.episodeIndex).toBe(0);
    expect(f.isIntervention).toBe(false);
  });

  it('assigns sequential frame indices starting at initialFrameIndex', async () => {
    const { recorder, persisted } = makeRecorder({ initialFrameIndex: 42 });
    recorder.start();

    await advance(1100);
    await recorder.stop();

    expect(persisted[0].frameIndex).toBe(42);
    for (let i = 1; i < persisted.length; i++) {
      expect(persisted[i].frameIndex).toBe(persisted[i - 1].frameIndex + 1);
    }
  });

  // --------------------------------------------------------------------------
  // PAUSE / RESUME
  // --------------------------------------------------------------------------

  it('records no frames while paused and resumes cleanly', async () => {
    const { recorder, fetchTelemetry } = makeRecorder();
    recorder.start();

    await advance(500);
    const callsBeforePause = fetchTelemetry.mock.calls.length;
    expect(callsBeforePause).toBeGreaterThan(0);

    recorder.pause();
    await advance(2000); // paused gap — no sampling
    expect(fetchTelemetry.mock.calls.length).toBe(callsBeforePause);

    recorder.resume();
    await advance(500);
    expect(fetchTelemetry.mock.calls.length).toBeGreaterThan(callsBeforePause);

    await recorder.stop();
  });

  it('excludes paused time from frame timestamps', async () => {
    const { recorder, persisted } = makeRecorder();
    recorder.start();

    await advance(500);
    recorder.pause();
    await advance(5000); // long pause
    recorder.resume();
    await advance(500);
    await recorder.stop();

    // Total active time ~1s: the last timestamp must not include the 5s pause
    const last = persisted[persisted.length - 1];
    expect(last.timestamp).toBeLessThan(2);
  });

  // --------------------------------------------------------------------------
  // BATCH PERSISTENCE
  // --------------------------------------------------------------------------

  it('persists frames in batches (~1x/second), not per frame', async () => {
    const { recorder, persistFrames, persisted } = makeRecorder();
    recorder.start();

    await advance(3000);
    await recorder.stop();

    // ~30 frames but only ~3-4 persist calls
    expect(persisted.length).toBeGreaterThanOrEqual(25);
    expect(persistFrames.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it('flushes remaining buffered frames on stop', async () => {
    const { recorder, persisted } = makeRecorder({ flushIntervalMs: 60_000 });
    recorder.start();

    await advance(500); // no flush tick yet
    expect(persisted.length).toBe(0);

    await recorder.stop();
    expect(persisted.length).toBeGreaterThan(0);
  });

  it('re-buffers and retries when persistence fails', async () => {
    const { recorder, persistFrames, persisted } = makeRecorder();
    persistFrames.mockRejectedValueOnce(new Error('db down'));
    recorder.start();

    await advance(2500);
    await recorder.stop();

    // The failed batch was retried — every sampled frame ends up persisted
    const indices = persisted.map((f) => f.frameIndex);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(new Set(indices).size).toBe(indices.length); // no duplicates
    expect(indices[0]).toBe(0);
  });

  // --------------------------------------------------------------------------
  // EPISODES
  // --------------------------------------------------------------------------

  it('stamps frames with the current episode and advances via nextEpisode', async () => {
    const { recorder, persisted } = makeRecorder();
    recorder.start();

    await advance(600);
    expect(recorder.nextEpisode()).toBe(1);
    await advance(600);
    await recorder.stop();

    const episodes = new Set(persisted.map((f) => f.episodeIndex));
    expect(episodes).toEqual(new Set([0, 1]));
    // Ordering: all ep-0 frames come before ep-1 frames
    const firstEp1 = persisted.findIndex((f) => f.episodeIndex === 1);
    expect(persisted.slice(0, firstEp1).every((f) => f.episodeIndex === 0)).toBe(true);
  });

  it('drops buffered frames of a discarded episode', async () => {
    const { recorder, persisted } = makeRecorder({ flushIntervalMs: 60_000 });
    recorder.start();

    await advance(500); // buffered, not yet flushed
    recorder.nextEpisode();
    await advance(500);

    recorder.discardBufferedEpisode(0);
    await recorder.stop();

    expect(persisted.length).toBeGreaterThan(0);
    expect(persisted.every((f) => f.episodeIndex === 1)).toBe(true);
  });

  // --------------------------------------------------------------------------
  // DEGRADED AGENT
  // --------------------------------------------------------------------------

  it('marks degraded after repeated telemetry failures and keeps retrying', async () => {
    const { recorder, fetchTelemetry, onDegraded } = makeRecorder();
    fetchTelemetry.mockRejectedValue(new Error('ECONNREFUSED'));
    recorder.start();

    await advance(1000);
    expect(onDegraded).toHaveBeenCalledTimes(1);
    expect(recorder.isDegraded()).toBe(true);
    const failedCalls = fetchTelemetry.mock.calls.length;

    // Still retrying while degraded
    await advance(500);
    expect(fetchTelemetry.mock.calls.length).toBeGreaterThan(failedCalls);

    // Agent comes back → recovers and records again
    fetchTelemetry.mockResolvedValue(TELEMETRY);
    await advance(500);
    expect(recorder.isDegraded()).toBe(false);
    expect(recorder.getFrameCount()).toBeGreaterThan(0);

    await recorder.stop();
  });

  it('treats empty joint states as a failure (no bogus frames)', async () => {
    const { recorder, persisted, onDegraded } = makeRecorder({
      fetchTelemetry: vi.fn().mockResolvedValue({ jointStates: [] }),
    });
    recorder.start();

    await advance(1500);
    await recorder.stop();

    expect(persisted.length).toBe(0);
    expect(onDegraded).toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // PROGRESS
  // --------------------------------------------------------------------------

  it('emits progress snapshots with frame count and episode', async () => {
    const { recorder, onProgress } = makeRecorder();
    recorder.start();

    await advance(2100);
    expect(onProgress).toHaveBeenCalled();
    const last = onProgress.mock.calls[onProgress.mock.calls.length - 1][0];
    expect(last.frameCount).toBeGreaterThan(0);
    expect(last.currentEpisode).toBe(0);
    expect(last.running).toBe(true);
    expect(last.degraded).toBe(false);
    expect(last.elapsedS).toBeGreaterThan(1);

    await recorder.stop();
  });
});
