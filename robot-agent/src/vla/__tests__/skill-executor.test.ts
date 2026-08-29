/**
 * @file skill-executor.test.ts
 * @description Tests for the unified SkillExecutor closed loop. Covers
 * both sim mode (no hardware sidecar) and hardware mode (sidecar available),
 * plus TASK-183 Real-Time Chunking: prefetch trigger depth, crossfade math,
 * graceful fallback when a prefetch fails, abort/teleop cancellation of an
 * in-flight prefetch, the payoff policy (one attempt per boundary, and never a
 * prefetch that would cost the robot more than the serial refill), the latency
 * sweep that holds RTC to "never worse than serial", the measured reach of the
 * crossfade, the MAX_DELTA_DEGREES bound a boundary is allowed to command, the
 * loop period being a per-run knob, and proof that the disabled path is the
 * old one.
 *
 * The RTC timing tests drive a scripted vla-server whose round trip is the
 * independent variable, because the thing under test IS the relationship
 * between that round trip and the 200 ms loop period. The four that assert on
 * elapsed time — the A/B baseline, the latency sweep, the crossfade reach and
 * the loop-period A/B —
 * run on Vitest's virtual clock (see runOnVirtualClock), so their figures are
 * exact and reproducible rather than measurements of this host. Every other
 * test here uses real timers; none of them asserts a duration.
 * @feature vla
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { SkillExecutor, blendChunks, rtcPrefetchPaysOff, MAX_DELTA_DEGREES } from '../skill-executor.js';
import { config } from '../../config/config.js';
import { hardwareClient } from '../../hardware/HardwareClient.js';

function makeFakeFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>): typeof fetch {
  return (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    return impl(url, init);
  }) as unknown as typeof fetch;
}

/**
 * Pin the embodiment the hardware tests below are actually written for.
 *
 * `config.robotType` defaults to `'h1'` (config.ts:623) and every hardware test
 * in this file drives a SIX-value action against a six-value state — an SO-101,
 * not a 19-DOF humanoid whose first ten joints are its legs. They used to pass
 * on the default because the positional map silently took the overlap, which is
 * the same silence TASK-229 exists to remove: `requiresActionContract` now
 * refuses to index-map any action onto an embodiment that has legs, so a test
 * about the delta clip has to say which robot it is clipping.
 *
 * Call inside a `describe`, before its own `beforeEach`.
 */
function useSo101Embodiment(): void {
  const original = config.robotType;
  beforeEach(() => {
    config.robotType = 'so101';
  });
  afterEach(() => {
    config.robotType = original;
  });
}

function makeStateManager(
  joints: number[] = [0, 0, 0, 0, 0, 0],
  overrides: Record<string, unknown> = {},
) {
  return {
    getTelemetry: () => ({
      jointStates: joints.map((p, i) => ({
        name: `j${i}`,
        position: p,
        velocity: 0,
        effort: 0,
        temperature: 0,
        current: 0,
      })),
    }),
    // dagger needs these three; the RTC teleop test is the only user here.
    isTeleopActive: () => false,
    getTeleopPositions: () => ({}),
    getActiveJointConfig: () => joints.map((_, i) => ({ name: `j${i}`, defaultPosition: 0 })),
    ...overrides,
  } as unknown as import('../../robot/state.js').RobotStateManager;
}

const CONFIG_BODY = {
  cameras: ['front'],
  state_dim: 6,
  chunk_size: 4, // small so the test runs fast
};

const PREDICT_BODY = {
  actions: [
    [0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
    [0.2, 0.2, 0.2, 0.2, 0.2, 0.2],
    [0.3, 0.3, 0.3, 0.3, 0.3, 0.3],
    [0.4, 0.4, 0.4, 0.4, 0.4, 0.4],
  ],
  timestamp: 0,
  inference_time_ms: 1,
};

// ─── Sim mode tests ─────────────────────────────────────────────────────

describe('SkillExecutor — sim mode', () => {
  beforeEach(() => {
    process.env.VLA_SERVER_URL = 'http://localhost:8000';
    vi.spyOn(hardwareClient, 'isAvailable').mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('completes after running through 2 chunks', async () => {
    const fakeFetch = makeFakeFetch(async (url) => {
      if (url.endsWith('/config')) return new Response(JSON.stringify(CONFIG_BODY), { status: 200 });
      if (url.endsWith('/reset')) return new Response('{}', { status: 200 });
      if (url.endsWith('/predict')) return new Response(JSON.stringify(PREDICT_BODY), { status: 200 });
      throw new Error(`Unexpected URL: ${url}`);
    });

    const exec = new SkillExecutor(makeStateManager(), fakeFetch);
    const result = await exec.run({
      skillId: 'skill-1',
      taskPrompt: 'wave hello',
      maxSteps: 100,
      timeoutMs: 30_000,
    });

    expect(result.status).toBe('completed');
    expect(result.mode).toBe('sim');
    // chunk_size=4, sim capped at 2 chunks → 8 steps
    expect(result.steps).toBe(8);
    expect(result.lastAction).toEqual([0.4, 0.4, 0.4, 0.4, 0.4, 0.4]);
  });

  it('respects abort flag — stops within one tick', async () => {
    const fakeFetch = makeFakeFetch(async (url) => {
      if (url.endsWith('/config')) return new Response(JSON.stringify(CONFIG_BODY), { status: 200 });
      if (url.endsWith('/reset')) return new Response('{}', { status: 200 });
      if (url.endsWith('/predict')) return new Response(JSON.stringify(PREDICT_BODY), { status: 200 });
      throw new Error(`Unexpected URL: ${url}`);
    });

    const exec = new SkillExecutor(makeStateManager(), fakeFetch);
    const promise = exec.run({
      skillId: 'skill-2',
      taskPrompt: 'wave',
      maxSteps: 100,
      timeoutMs: 30_000,
    });

    // Abort quickly — the loop sleeps 200ms between steps.
    setTimeout(() => exec.abort(), 100);
    const result = await promise;

    expect(result.status).toBe('aborted');
    expect(result.steps).toBeLessThanOrEqual(8);
    expect(result.message).toMatch(/Aborted/);
  });

  it('returns timeout when deadline exceeded', async () => {
    const fakeFetch = makeFakeFetch(async (url) => {
      if (url.endsWith('/config')) return new Response(JSON.stringify(CONFIG_BODY), { status: 200 });
      if (url.endsWith('/reset')) return new Response('{}', { status: 200 });
      if (url.endsWith('/predict')) return new Response(JSON.stringify(PREDICT_BODY), { status: 200 });
      throw new Error(`Unexpected URL: ${url}`);
    });

    const exec = new SkillExecutor(makeStateManager(), fakeFetch);
    const result = await exec.run({
      skillId: 'skill-3',
      taskPrompt: 'wave',
      maxSteps: 100,
      timeoutMs: 10, // expires before the first-step sleep clears
    });

    expect(result.status).toBe('timeout');
  });

  it('fails fast when /config is unreachable', async () => {
    const fakeFetch = makeFakeFetch(async () => {
      throw new TypeError('fetch failed');
    });

    const exec = new SkillExecutor(makeStateManager(), fakeFetch);
    const result = await exec.run({
      skillId: 'skill-4',
      taskPrompt: 'wave',
      maxSteps: 10,
      timeoutMs: 5_000,
    });

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/vla-server \/config unreachable/);
  });

  it('fails immediately on /predict 422 (client error, non-retryable)', async () => {
    const fakeFetch = makeFakeFetch(async (url) => {
      if (url.endsWith('/config')) return new Response(JSON.stringify(CONFIG_BODY), { status: 200 });
      if (url.endsWith('/reset')) return new Response('{}', { status: 200 });
      return new Response(JSON.stringify({ detail: "Missing camera(s): {'wrist'}" }), { status: 422 });
    });

    const exec = new SkillExecutor(makeStateManager(), fakeFetch);
    const result = await exec.run({
      skillId: 'skill-5',
      taskPrompt: 'wave',
      maxSteps: 10,
      timeoutMs: 5_000,
    });

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/Missing camera/);
    // Steps should be 0 — failed on first predict without retries.
    expect(result.steps).toBe(0);
  });

  it('retries on /predict 503 up to 3 times before bailing', async () => {
    let calls = 0;
    const fakeFetch = makeFakeFetch(async (url) => {
      if (url.endsWith('/config')) return new Response(JSON.stringify(CONFIG_BODY), { status: 200 });
      if (url.endsWith('/reset')) return new Response('{}', { status: 200 });
      if (url.endsWith('/predict')) {
        calls += 1;
        return new Response(JSON.stringify({ detail: 'temporarily unavailable' }), { status: 503 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const exec = new SkillExecutor(makeStateManager(), fakeFetch);
    const result = await exec.run({
      skillId: 'skill-6',
      taskPrompt: 'wave',
      maxSteps: 10,
      timeoutMs: 10_000,
    });

    expect(result.status).toBe('failed');
    expect(calls).toBe(3);
    expect(result.error).toMatch(/3x/);
  });
});

// ─── Hardware mode tests ────────────────────────────────────────────────

describe('SkillExecutor — hardware mode', () => {
  useSo101Embodiment();

  beforeEach(() => {
    process.env.VLA_SERVER_URL = 'http://localhost:8000';
    vi.spyOn(hardwareClient, 'isAvailable').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches real frames + state, applies delta-clipped actions', async () => {
    // Mock the sidecar-facing methods on HardwareClient.
    vi.spyOn(hardwareClient, 'getCameras').mockResolvedValue(['wrist', 'top']);
    vi.spyOn(hardwareClient, 'snapshot').mockResolvedValue('fake-jpeg-b64');
    // Seed state: arm is at the origin.
    vi.spyOn(hardwareClient, 'getStateNow').mockResolvedValue([0, 0, 0, 0, 0, 0]);
    const sendActionSpy = vi
      .spyOn(hardwareClient, 'sendActionVector')
      .mockResolvedValue();

    // Model predicts a 60° jump — should be clipped to 5°.
    const bigJumpPredict = {
      actions: [
        [60, 60, 60, 60, 60, 60],
        [60, 60, 60, 60, 60, 60],
      ],
    };

    const fakeFetch = makeFakeFetch(async (url) => {
      if (url.endsWith('/config')) {
        return new Response(
          JSON.stringify({ cameras: ['front'], state_dim: 6, chunk_size: 2 }),
          { status: 200 },
        );
      }
      if (url.endsWith('/reset')) return new Response('{}', { status: 200 });
      if (url.endsWith('/predict')) return new Response(JSON.stringify(bigJumpPredict), { status: 200 });
      throw new Error(`Unexpected URL: ${url}`);
    });

    const exec = new SkillExecutor(makeStateManager(), fakeFetch);
    const result = await exec.run({
      skillId: 'skill-hw-1',
      taskPrompt: 'wave hello',
      maxSteps: 2,
      timeoutMs: 10_000,
    });

    expect(result.status).toBe('completed');
    expect(result.mode).toBe('hardware');
    expect(result.steps).toBe(2);

    // First action: 5° (clipped from 60°), second: 10° (clipped from 60°).
    expect(sendActionSpy).toHaveBeenCalledTimes(2);
    const first = sendActionSpy.mock.calls[0][0];
    const second = sendActionSpy.mock.calls[1][0];
    expect(first).toEqual([5, 5, 5, 5, 5, 5]);
    expect(second).toEqual([10, 10, 10, 10, 10, 10]);
  });

  it('fails fast if the initial state read fails', async () => {
    vi.spyOn(hardwareClient, 'getStateNow').mockRejectedValue(new Error('sidecar down'));

    const fakeFetch = makeFakeFetch(async (url) => {
      if (url.endsWith('/config')) {
        return new Response(
          JSON.stringify({ cameras: ['front'], state_dim: 6, chunk_size: 4 }),
          { status: 200 },
        );
      }
      if (url.endsWith('/reset')) return new Response('{}', { status: 200 });
      throw new Error(`Unexpected URL: ${url}`);
    });

    const exec = new SkillExecutor(makeStateManager(), fakeFetch);
    const result = await exec.run({
      skillId: 'skill-hw-2',
      taskPrompt: 'wave',
      maxSteps: 10,
      timeoutMs: 5_000,
    });

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/seed initial state/);
  });

  it('abort stops the loop and skips remaining applies', async () => {
    vi.spyOn(hardwareClient, 'getCameras').mockResolvedValue(['wrist']);
    vi.spyOn(hardwareClient, 'snapshot').mockResolvedValue('fake-jpeg-b64');
    vi.spyOn(hardwareClient, 'getStateNow').mockResolvedValue([0, 0, 0, 0, 0, 0]);
    const sendActionSpy = vi
      .spyOn(hardwareClient, 'sendActionVector')
      .mockResolvedValue();

    const fakeFetch = makeFakeFetch(async (url) => {
      if (url.endsWith('/config')) {
        return new Response(
          JSON.stringify({ cameras: ['front'], state_dim: 6, chunk_size: 10 }),
          { status: 200 },
        );
      }
      if (url.endsWith('/reset')) return new Response('{}', { status: 200 });
      if (url.endsWith('/predict')) {
        return new Response(
          JSON.stringify({ actions: Array.from({ length: 10 }, () => [1, 1, 1, 1, 1, 1]) }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const exec = new SkillExecutor(makeStateManager(), fakeFetch);
    const promise = exec.run({
      skillId: 'skill-hw-3',
      taskPrompt: 'wave',
      maxSteps: 100,
      timeoutMs: 30_000,
    });

    setTimeout(() => exec.abort(), 150);
    const result = await promise;

    expect(result.status).toBe('aborted');
    expect(result.mode).toBe('hardware');
    // Abort came after ~150ms — we should have applied at most 1 action.
    expect(sendActionSpy.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

// ─── Real-Time Chunking (TASK-183) ──────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** A chunk of `n` identical 6-DOF rows, every joint at `value`. */
function chunkOf(value: number, n = 4): number[][] {
  return Array.from({ length: n }, () => Array.from({ length: 6 }, () => value));
}

/**
 * A scripted vla-server. `chunkFor` decides what the k-th `/predict` (1-based)
 * answers with; `delayMs` is how long it takes, which is the knob that creates
 * boundary pressure: a delay under the run's `loopPeriodMs` lets a prefetch
 * land in time and one over it does not. Most callers leave the period at its
 * `config.vla.loopPeriodMs` default of 200 ms, so a `delayMs` is read against
 * that unless the test passes its own `loopPeriodMs`. Most tests here drive it
 * on real timers; the four that assert elapsed time drive it through
 * runOnVirtualClock.
 *
 * It also records what the loop asked for and when, which is most of what the
 * RTC tests assert on: the step at which each `/predict` was issued (the
 * prefetch trigger depth) and the peak number in flight at once.
 */
function makeVlaServer(o: {
  chunkSize?: number;
  /** Round-trip time of the k-th `/predict`, flat or per call. */
  delayMs?: number | ((call: number) => number);
  /** Called with the 1-based predict number. Return a chunk, or a status to fail with. */
  chunkFor?: (call: number) => number[][] | 'reject' | 503 | 422;
  /** Steps applied so far, so a predict can be tagged with the step it was issued at. */
  steps?: () => number;
}) {
  const chunkSize = o.chunkSize ?? 4;
  const rec = {
    urls: [] as string[],
    predictCalls: 0,
    predictAtStep: [] as number[],
    signals: [] as Array<AbortSignal | null | undefined>,
    maxConcurrentPredicts: 0,
  };
  let concurrent = 0;

  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    rec.urls.push(url.replace(/^https?:\/\/[^/]+/, ''));
    if (url.endsWith('/config')) {
      return new Response(
        JSON.stringify({ cameras: ['front'], state_dim: 6, chunk_size: chunkSize }),
        { status: 200 },
      );
    }
    if (url.endsWith('/reset')) return new Response('{}', { status: 200 });
    if (url.endsWith('/predict')) {
      const call = (rec.predictCalls += 1);
      rec.predictAtStep.push(o.steps ? o.steps() : -1);
      rec.signals.push(init?.signal);
      concurrent += 1;
      rec.maxConcurrentPredicts = Math.max(rec.maxConcurrentPredicts, concurrent);
      try {
        const ms = typeof o.delayMs === 'function' ? o.delayMs(call) : o.delayMs ?? 0;
        if (ms > 0) await delay(ms);
        const answer = o.chunkFor ? o.chunkFor(call) : chunkOf(call, chunkSize);
        if (answer === 'reject') throw new TypeError('fetch failed');
        if (typeof answer === 'number') {
          return new Response(JSON.stringify({ detail: 'scripted failure' }), { status: answer });
        }
        return new Response(JSON.stringify({ actions: answer }), { status: 200 });
      } finally {
        concurrent -= 1;
      }
    }
    throw new Error(`Unexpected URL: ${url}`);
  }) as unknown as typeof fetch;

  return { fetch: fetchImpl, rec };
}

/**
 * Drive a `SkillExecutor.run()` to completion on Vitest's virtual clock.
 *
 * The loop is sleep-bound: every step is a `setTimeout`, and so is the
 * scripted server's round trip. On the real clock that makes elapsed time a
 * measurement of the host — eight of these racing in one process drifted by
 * milliseconds, which is enough to turn a wall-clock inequality into a coin
 * flip. On the virtual clock the same statements run in the same order and
 * `Date.now()` advances by exactly the timers that fired, so `durationMs` and
 * the stall counters derived from it are reproducible integers.
 *
 * Advancing in 10 ms slices (rather than `runAllTimersAsync`) keeps the
 * interleaving of the loop and an in-flight `/predict` honest: a prefetch that
 * lands mid-step still lands mid-step.
 */
async function runOnVirtualClock<T>(promise: Promise<T>): Promise<T> {
  let settled = false;
  const tracked = promise.then(
    (v) => {
      settled = true;
      return v;
    },
    (e) => {
      settled = true;
      throw e;
    },
  );
  // 30 000 slices = 300 s of virtual time; every run here is under 10 s.
  for (let i = 0; i < 30_000 && !settled; i += 1) {
    await vi.advanceTimersByTimeAsync(10);
  }
  if (!settled) throw new Error('run() did not settle on the virtual clock');
  return tracked;
}

interface StepEvent {
  step: number;
  action: number[];
  source?: string;
  stallMs?: number;
  blended?: boolean;
}

/** Emitter that records `skill:step`, plus a live count of steps applied. */
function makeStepRecorder() {
  const emitter = new EventEmitter();
  const events: StepEvent[] = [];
  const keys: string[][] = [];
  emitter.on('skill:step', (e: StepEvent) => {
    events.push(e);
    keys.push(Object.keys(e));
  });
  return { emitter, events, keys, steps: () => events.length };
}

describe('blendChunks — RTC crossfade math', () => {
  it('fades the aligned overlap on a linear ramp and drops the stale tail', () => {
    // 2-step fade: wNew runs 1/3, 2/3 — never fully old, never fully new.
    const { queue, blended } = blendChunks([[12], [12]], [[0], [0], [0]], 0, 2);
    expect(blended).toBe(2);
    expect(queue).toEqual([[8], [4], [0]]);
  });

  it('drops the actions the robot already lived through while inference ran', () => {
    // Issued 2 steps ago → incoming[0..1] describe the past; incoming[2] is
    // what lines up with queue[0].
    const { queue, blended } = blendChunks([[12]], [[99], [99], [0], [0]], 2, 1);
    expect(blended).toBe(1);
    // n=1 → wNew = 1/2 → (12 + 0) / 2 = 6, then the rest of the new chunk.
    expect(queue).toEqual([[6], [0]]);
  });

  it('blendSteps=0 is a hard splice — prefetch without a crossfade', () => {
    const { queue, blended } = blendChunks([[12], [12]], [[0], [0], [0]], 0, 0);
    expect(blended).toBe(0);
    expect(queue).toEqual([[0], [0], [0]]);
  });

  it('an entirely overtaken chunk leaves the queue alone', () => {
    const { queue, blended } = blendChunks([[12], [7]], [[0], [0]], 2, 5);
    expect(blended).toBe(0);
    expect(queue).toEqual([[12], [7]]);
  });

  it('splicing onto an empty queue is the serial refill, by another route', () => {
    const { queue, blended } = blendChunks([], [[1], [2]], 0, 5);
    expect(blended).toBe(0);
    expect(queue).toEqual([[1], [2]]);
  });

  it('caps the fade at the shorter side and never mutates its inputs', () => {
    const q = [[12]];
    const inc = [[0], [0], [0]];
    const { queue, blended } = blendChunks(q, inc, 0, 99);
    expect(blended).toBe(1); // queue has only 1 action to fade against
    expect(queue).toEqual([[6], [0], [0]]);
    expect(q).toEqual([[12]]);
    expect(inc).toEqual([[0], [0], [0]]);
  });

  it('takes a joint verbatim when only one side has it', () => {
    const { queue } = blendChunks([[10, 10]], [[0]], 0, 1);
    expect(queue).toEqual([[5, 10]]);
  });
});

describe('SkillExecutor — RTC prefetch', () => {
  beforeEach(() => {
    process.env.VLA_SERVER_URL = 'http://localhost:8000';
    vi.spyOn(hardwareClient, 'isAvailable').mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('issues /predict N+1 at the overlap depth, one at a time, and never stalls', async () => {
    const rec = makeStepRecorder();
    // chunk_size 4, overlap 0.25 → threshold 1: prefetch once a single action
    // is left. 80 ms is well inside the 200 ms loop period, so it lands early.
    const server = makeVlaServer({ chunkSize: 4, delayMs: 80, steps: rec.steps });

    const exec = new SkillExecutor(makeStateManager(), server.fetch);
    const result = await exec.run({
      skillId: 'rtc-trigger',
      taskPrompt: 'wave',
      maxSteps: 8,
      timeoutMs: 30_000,
      emitter: rec.emitter,
      rtc: { enabled: true, overlap: 0.25, blendSteps: 1 },
    });

    expect(result.status).toBe('completed');
    expect(result.steps).toBe(8);
    // Fired after the step that left 1 action queued, both times — and the
    // serial fill at step 0 is the only non-prefetch predict.
    expect(server.rec.predictAtStep).toEqual([0, 3, 6]);
    // Exactly one prefetch in flight at any moment.
    expect(server.rec.maxConcurrentPredicts).toBe(1);
    expect(result.rtc?.prefetchIssued).toBe(2);
    expect(result.rtc?.prefetchMerged).toBe(2);
    // The queue never ran dry, so the robot never waited.
    expect(result.rtc?.stalledTransitions).toBe(0);
    expect(result.rtc?.totalStallMs).toBe(0);
    expect(result.rtc?.chunkTransitions).toBe(2);
  }, 20_000);

  it('does not count a boundary the loop never waited at as a stall', async () => {
    // The queue CAN empty on a fully successful RTC boundary: with a threshold
    // of one action, the prefetch is issued with one step of lead, and a round
    // trip longer than the 200 ms loop period lands it during the step after
    // the queue ran dry. The chunk is then sitting in `rtc.pending` and the
    // merge takes microseconds — the robot waits for nothing. Timing that as a
    // stall reported `stalls=2/2 total=0 max=0`: every boundary stalled, for no
    // time. Both statements cannot be true, and it is the counter that is wrong.
    const rec = makeStepRecorder();
    const server = makeVlaServer({ chunkSize: 4, delayMs: 250, steps: rec.steps });

    const exec = new SkillExecutor(makeStateManager(), server.fetch);
    const result = await exec.run({
      skillId: 'rtc-zero-stall',
      taskPrompt: 'wave',
      maxSteps: 8,
      timeoutMs: 30_000,
      emitter: rec.emitter,
      rtc: { enabled: true, overlap: 0.25, blendSteps: 1 },
    });

    expect(result.status).toBe('completed');
    expect(result.steps).toBe(8);
    // Both boundaries were carried by a prefetch that had already landed…
    expect(result.rtc?.prefetchMerged).toBe(2);
    expect(result.rtc?.chunkTransitions).toBe(2);
    // …so neither is a stall, and no step reports having waited.
    expect(result.rtc?.stalledTransitions).toBe(0);
    expect(result.rtc?.totalStallMs).toBe(0);
    expect(result.rtc?.maxStallMs).toBe(0);
    expect(rec.events.every((e) => e.stallMs === 0)).toBe(true);
  }, 20_000);

  it('does not fire a second prefetch while one is in flight past the boundary', async () => {
    const rec = makeStepRecorder();
    // 700 ms is longer than the 3 remaining steps of lead, so the queue runs
    // dry with the prefetch still in the air. The loop must wait for THAT, not
    // open a second /predict for the same boundary.
    const server = makeVlaServer({ chunkSize: 4, delayMs: 700, steps: rec.steps });

    const exec = new SkillExecutor(makeStateManager(), server.fetch);
    const result = await exec.run({
      skillId: 'rtc-single-flight',
      taskPrompt: 'wave',
      maxSteps: 8,
      timeoutMs: 30_000,
      emitter: rec.emitter,
      rtc: { enabled: true, overlap: 0.5, blendSteps: 1 },
    });

    expect(result.status).toBe('completed');
    expect(server.rec.maxConcurrentPredicts).toBe(1);
    // Prefetch issued at step 2 (queue down to 2 of 4), merged after the wait.
    expect(server.rec.predictAtStep[1]).toBe(2);
    expect(result.rtc?.prefetchMerged).toBeGreaterThan(0);
    // It did stall — but for the residue of the round trip, not all of it.
    expect(result.rtc?.totalStallMs).toBeGreaterThan(0);
    expect(result.rtc?.maxStallMs).toBeLessThan(700);
  }, 20_000);

  it('crossfades the overlap per joint — exact values on the step stream', async () => {
    const rec = makeStepRecorder();
    // Chunk k answers with all-(k-1): chunk 1 is 0.0, chunk 2 is 1.0, so a
    // crossfade shows up as an exact fraction.
    const server = makeVlaServer({
      chunkSize: 4,
      delayMs: 80,
      steps: rec.steps,
      chunkFor: (call) => chunkOf(call - 1, 4),
    });

    const exec = new SkillExecutor(makeStateManager(), server.fetch);
    const result = await exec.run({
      skillId: 'rtc-blend',
      taskPrompt: 'wave',
      maxSteps: 6,
      timeoutMs: 30_000,
      emitter: rec.emitter,
      rtc: { enabled: true, overlap: 0.5, blendSteps: 2 },
    });

    expect(result.status).toBe('completed');
    // Steps 1–2 are pure chunk 1.
    expect(rec.events[0].action).toEqual(chunkOf(0, 1)[0]);
    expect(rec.events[1].action).toEqual(chunkOf(0, 1)[0]);
    // Steps 3–4 are the 2-step fade from chunk 1 (0.0) to chunk 2 (1.0):
    // wNew = 1/3 then 2/3, applied to every joint.
    for (const j of rec.events[2].action) expect(j).toBeCloseTo(1 / 3, 10);
    for (const j of rec.events[3].action) expect(j).toBeCloseTo(2 / 3, 10);
    expect(rec.events[2].blended).toBe(true);
    expect(rec.events[3].blended).toBe(true);
    expect(result.rtc?.blendedSteps).toBe(4); // two boundaries × 2 steps
    // No step jumped the full chunk-to-chunk gap: the fade is what keeps the
    // per-step delta under what hardware clipAction would have to absorb.
    const deltas = rec.events.slice(1).map((e, i) => Math.abs(e.action[0] - rec.events[i].action[0]));
    expect(Math.max(...deltas)).toBeCloseTo(2 / 3, 10);
  }, 20_000);
});

describe('SkillExecutor — RTC degrades to serial', () => {
  beforeEach(() => {
    process.env.VLA_SERVER_URL = 'http://localhost:8000';
    vi.spyOn(hardwareClient, 'isAvailable').mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a rejected prefetch is absorbed — the run finishes on the serial path', async () => {
    const rec = makeStepRecorder();
    const server = makeVlaServer({
      chunkSize: 4,
      delayMs: 40,
      steps: rec.steps,
      // The first prefetch (predict #2) dies at the socket.
      chunkFor: (call) => (call === 2 ? 'reject' : chunkOf(call, 4)),
    });

    const exec = new SkillExecutor(makeStateManager(), server.fetch);
    const result = await exec.run({
      skillId: 'rtc-prefetch-reject',
      taskPrompt: 'wave',
      maxSteps: 8,
      timeoutMs: 30_000,
      emitter: rec.emitter,
      rtc: { enabled: true, overlap: 0.25, blendSteps: 1 },
    });

    expect(result.status).toBe('completed');
    expect(result.steps).toBe(8);
    expect(result.rtc?.prefetchFailed).toBe(1);
    // That boundary fell back to the serial refill, and cost a real stall.
    expect(result.rtc?.stalledTransitions).toBe(1);
    expect(result.rtc?.totalStallMs).toBeGreaterThan(0);
    // The next boundary prefetched normally again.
    expect(result.rtc?.prefetchMerged).toBe(1);
  }, 20_000);

  it('a failed prefetch does not burn a MAX_PREDICT_FAILURES slot', async () => {
    const rec = makeStepRecorder();
    const server = makeVlaServer({
      chunkSize: 4,
      delayMs: 20,
      steps: rec.steps,
      // Everything after the first chunk is 503 — including the prefetch.
      chunkFor: (call) => (call === 1 ? chunkOf(1, 4) : 503),
    });

    const exec = new SkillExecutor(makeStateManager(), server.fetch);
    const result = await exec.run({
      skillId: 'rtc-retry-budget',
      taskPrompt: 'wave',
      maxSteps: 8,
      timeoutMs: 30_000,
      emitter: rec.emitter,
      rtc: { enabled: true, overlap: 0.25, blendSteps: 1 },
    });

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/failed 3x/);
    // 1 initial + 1 prefetch + exactly 3 serial retries. If the prefetch had
    // counted against the retry budget the run would have bailed after 2.
    expect(server.rec.predictCalls).toBe(5);
    expect(result.rtc?.prefetchFailed).toBe(1);
  }, 20_000);
});

describe('SkillExecutor — RTC cancellation', () => {
  beforeEach(() => {
    process.env.VLA_SERVER_URL = 'http://localhost:8000';
    vi.spyOn(hardwareClient, 'isAvailable').mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('abort cancels the in-flight prefetch and nothing writes into the dead run', async () => {
    const rejections: unknown[] = [];
    const onUnhandled = (e: unknown) => rejections.push(e);
    process.on('unhandledRejection', onUnhandled);

    const rec = makeStepRecorder();
    // Only the prefetch is slow — the initial fill has to be instant or the
    // abort would land before the loop has taken three steps.
    const server = makeVlaServer({
      chunkSize: 4,
      delayMs: (call) => (call === 1 ? 0 : 700),
      steps: rec.steps,
    });

    const exec = new SkillExecutor(makeStateManager(), server.fetch);
    const promise = exec.run({
      skillId: 'rtc-abort',
      taskPrompt: 'wave',
      maxSteps: 8,
      timeoutMs: 30_000,
      emitter: rec.emitter,
      rtc: { enabled: true, overlap: 0.25, blendSteps: 1 },
    });

    // Steps land at ~0/200/400 ms; the prefetch fires after step 3 and is still
    // in the air 700 ms later. Abort lands squarely inside that window.
    setTimeout(() => exec.abort(), 500);
    const result = await promise;

    expect(result.status).toBe('aborted');
    expect(result.steps).toBe(3);
    expect(server.rec.predictCalls).toBe(2);
    // The prefetch's request was actually cancelled, not merely ignored.
    expect(server.rec.signals[1]?.aborted).toBe(true);
    expect(result.rtc?.prefetchMerged).toBe(0);

    // Outlive the prefetch's delay: its resolution must not throw or emit.
    const stepsAtAbort = rec.events.length;
    await delay(900);
    expect(rec.events.length).toBe(stepsAtAbort);
    process.off('unhandledRejection', onUnhandled);
    expect(rejections).toEqual([]);
  }, 20_000);

  it('dagger teleop pre-emption abandons the in-flight prefetch', async () => {
    const rec = makeStepRecorder();
    // The human takes over from step 4 on. isTeleopActive is read once per pop
    // and once per prefetch attempt, so gate it on steps already applied: at
    // the step-2 prefetch attempt that is 2 (policy), at the step-4 pop it is 3.
    const stateManager = makeStateManager([0, 0, 0, 0, 0, 0], {
      isTeleopActive: () => rec.events.length >= 3,
      getTeleopPositions: () => ({ j0: 9, j1: 9, j2: 9, j3: 9, j4: 9, j5: 9 }),
    });
    const server = makeVlaServer({
      chunkSize: 4,
      delayMs: 700,
      steps: rec.steps,
      chunkFor: (call) => chunkOf(call, 4),
    });

    const exec = new SkillExecutor(stateManager, server.fetch);
    const result = await exec.run({
      skillId: 'rtc-dagger',
      taskPrompt: 'sort the parts',
      maxSteps: 6,
      timeoutMs: 30_000,
      emitter: rec.emitter,
      rolloutStrategy: 'dagger',
      serverBaseUrl: 'http://server.test',
      rtc: { enabled: true, overlap: 0.5, blendSteps: 2 },
    });

    expect(result.status).toBe('completed');
    // Prefetch #2 went out at step 2, before the human touched anything.
    expect(server.rec.predictAtStep[1]).toBe(2);
    // Step 4 is the human's, and it is the teleop vector verbatim — no blend.
    expect(rec.events[3].source).toBe('human');
    expect(rec.events[3].action).toEqual([9, 9, 9, 9, 9, 9]);
    expect(rec.events[3].blended).toBe(false);
    // The chunk it was fetching is discarded, request and all.
    expect(server.rec.signals[1]?.aborted).toBe(true);
    expect(result.rtc?.prefetchMerged).toBe(0);
    // Nothing from chunk 2 ever reached the robot.
    expect(rec.events.map((e) => e.action[0])).not.toContain(2);
  }, 20_000);
});

describe('SkillExecutor — RTC blend accounting', () => {
  beforeEach(() => {
    process.env.VLA_SERVER_URL = 'http://localhost:8000';
    vi.spyOn(hardwareClient, 'isAvailable').mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a crossfade the human pre-empted is neither reported nor counted', async () => {
    // A merge schedules a 2-step crossfade at the head of the queue; the first
    // is played, and the human takes the arm before the second. What the robot
    // executes on that second step is the teleop vector verbatim — so
    // `blended: true` there would be a claim about a vector nobody applied, and
    // counting both scheduled crossfades in `blendedSteps` would be a claim
    // about the queue rather than about the robot. One was scheduled and
    // played; one was scheduled and thrown away.
    const rec = makeStepRecorder();
    // overlap 0.75 → threshold 3: the prefetch goes out after step 1, before
    // the human touches anything, so the merge really does happen.
    const stateManager = makeStateManager([0, 0, 0, 0, 0, 0], {
      isTeleopActive: () => rec.events.length >= 2,
      getTeleopPositions: () => ({ j0: 9, j1: 9, j2: 9, j3: 9, j4: 9, j5: 9 }),
    });
    const server = makeVlaServer({ chunkSize: 4, delayMs: 80, steps: rec.steps });

    const exec = new SkillExecutor(stateManager, server.fetch);
    const result = await exec.run({
      skillId: 'rtc-blend-preempted',
      taskPrompt: 'sort the parts',
      maxSteps: 6,
      timeoutMs: 30_000,
      emitter: rec.emitter,
      rolloutStrategy: 'dagger',
      serverBaseUrl: 'http://server.test',
      rtc: { enabled: true, overlap: 0.75, blendSteps: 2 },
    });

    expect(result.status).toBe('completed');
    // A chunk really was spliced in with a crossfade at the head of the queue.
    expect(server.rec.predictAtStep[1]).toBe(1);
    expect(result.rtc?.prefetchMerged).toBe(1);
    // Step 2 plays the first crossfade for real.
    expect(rec.events[1].source).toBe('policy');
    expect(rec.events[1].blended).toBe(true);
    // Step 3 pops the second — and the human wins it, so the vector that
    // reaches the robot is theirs and nothing about it is a crossfade.
    expect(rec.events[2].source).toBe('human');
    expect(rec.events[2].action).toEqual([9, 9, 9, 9, 9, 9]);
    expect(rec.events[2].blended).toBe(false);
    // Two crossfades scheduled, one applied.
    expect(result.rtc?.blendedSteps).toBe(1);
  }, 20_000);
});

describe('SkillExecutor — RTC disabled is the pre-TASK-183 loop', () => {
  beforeEach(() => {
    process.env.VLA_SERVER_URL = 'http://localhost:8000';
    vi.spyOn(hardwareClient, 'isAvailable').mockReturnValue(false);
  });

  afterEach(() => {
    // The A/B baseline below is the only test here that takes the fake clock;
    // a no-op for the rest.
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('ships off by default', () => {
    expect(config.vla.rtc.enabled).toBe(false);
  });

  it('leaves the /predict sequence and the skill:step payload untouched', async () => {
    const rec = makeStepRecorder();
    const server = makeVlaServer({ chunkSize: 4, delayMs: 80, steps: rec.steps });

    const exec = new SkillExecutor(makeStateManager(), server.fetch);
    const result = await exec.run({
      skillId: 'rtc-off',
      taskPrompt: 'wave',
      maxSteps: 8,
      timeoutMs: 30_000,
      emitter: rec.emitter,
      rtc: { enabled: false },
    });

    expect(result.status).toBe('completed');
    expect(result.steps).toBe(8);
    // Serial: one /predict per chunk, issued only once the queue is empty.
    expect(server.rec.urls).toEqual(['/config', '/reset', '/predict', '/predict']);
    expect(server.rec.predictAtStep).toEqual([0, 4]);
    expect(server.rec.maxConcurrentPredicts).toBe(1);
    // Every event carries exactly the keys it carried before TASK-183 — no
    // stallMs, no blended.
    for (const k of rec.keys) {
      expect(k).toEqual(['skillId', 'step', 'mode', 'action', 'ts']);
    }
    // …and the result itself carries no `rtc` block, so the log line, both
    // response bodies and the evaluation-episode POST are byte-identical to
    // what an agent without TASK-183 produced.
    expect(result.rtc).toBeUndefined();
    expect(Object.keys(result).sort()).toEqual(
      ['durationMs', 'lastAction', 'message', 'mode', 'status', 'steps'],
    );
  }, 20_000);

  it('carries no rtc block on a failed run either', async () => {
    // The failure response body is the other place `rtc` leaked into.
    const server = makeVlaServer({ chunkSize: 4, chunkFor: () => 422 });

    const exec = new SkillExecutor(makeStateManager(), server.fetch);
    const result = await exec.run({
      skillId: 'rtc-off-failed',
      taskPrompt: 'wave',
      maxSteps: 4,
      timeoutMs: 30_000,
      rtc: { enabled: false },
    });

    expect(result.status).toBe('failed');
    expect('rtc' in result).toBe(false);
  }, 20_000);

  it('costs the boundary round trip RTC removes — the A/B baseline', async () => {
    // The off arm reports no counters any more (that block is what leaked
    // cross-service), so its stall is read the way an operator would have to
    // read it before TASK-183: off the clock. Both arms run the same 8 steps at
    // the same 200 ms period against the same 300 ms server, so the only thing
    // that can separate their durations is the mid-run /predict the serial loop
    // blocks on and the RTC loop overlaps. The clock is the virtual one — the
    // difference below is arithmetic, not a stopwatch reading.
    vi.useFakeTimers();
    const offRec = makeStepRecorder();
    const off = makeVlaServer({ chunkSize: 4, delayMs: 300, steps: offRec.steps });
    const on = makeVlaServer({ chunkSize: 4, delayMs: 300 });
    const opts = {
      taskPrompt: 'wave',
      maxSteps: 8,
      timeoutMs: 30_000,
    };

    const offResult = await runOnVirtualClock(
      new SkillExecutor(makeStateManager(), off.fetch).run({
        ...opts,
        skillId: 'ab-off',
        emitter: offRec.emitter,
        rtc: { enabled: false },
      }),
    );
    const onResult = await runOnVirtualClock(
      new SkillExecutor(makeStateManager(), on.fetch).run({
        ...opts,
        skillId: 'ab-on',
        rtc: { enabled: true, overlap: 0.5, blendSteps: 2 },
      }),
    );

    expect(offResult.steps).toBe(8);
    expect(onResult.steps).toBe(8);
    // Serial: the queue is refilled only once it is empty, so the mid-run
    // /predict at step 4 is dead air the robot sits through.
    expect(off.rec.predictAtStep).toEqual([0, 4]);
    expect(offResult.rtc).toBeUndefined();
    // RTC: the 300 ms round trip is spent inside the 400 ms of lead the
    // overlap buys, so the queue never empties and nothing waits.
    expect(onResult.rtc?.stalledTransitions).toBe(0);
    expect(onResult.rtc?.totalStallMs).toBe(0);
    expect(onResult.rtc?.prefetchMerged).toBe(3);
    // The whole of that mid-run round trip is the difference between the two
    // runs — all 300 ms of it, exactly, because neither arm is timing a host.
    expect(offResult.durationMs - onResult.durationMs).toBe(300);
    // eslint-disable-next-line no-console
    console.log(
      `[RTC A/B, mocked vla-server @300ms, 8 steps @200ms] off: ${offResult.durationMs}ms wall, ` +
        `serial /predict at steps ${off.rec.predictAtStep.join(' + ')} | ` +
        `on: ${onResult.durationMs}ms wall, ${onResult.rtc?.stalledTransitions} stall(s), ` +
        `${onResult.rtc?.totalStallMs}ms total (${onResult.rtc?.prefetchMerged} chunk(s) prefetched, ` +
        `${onResult.rtc?.blendedSteps} step(s) blended)`,
    );
  }, 30_000);
});

describe('rtcPrefetchPaysOff — the prefetch policy, in isolation', () => {
  // The loop period is 200 ms, so a queue of `q` is worth (q + 1) periods of
  // lead: one sleep after the prefetch is issued, one before each remaining pop.
  it('says yes before the first round trip has been measured', () => {
    expect(rtcPrefetchPaysOff({ latencyMs: 0, queueLen: 2, backendChunkLen: 8 })).toBe(true);
  });

  it('says yes whenever the queue can cover the whole round trip', () => {
    // 2 queued → 600 ms of lead. Anything inside that is a boundary for free.
    expect(rtcPrefetchPaysOff({ latencyMs: 600, queueLen: 2, backendChunkLen: 8 })).toBe(true);
    expect(rtcPrefetchPaysOff({ latencyMs: 100, queueLen: 2, backendChunkLen: 8 })).toBe(true);
  });

  it('refuses once the residual wait costs more per step than the serial boundary', () => {
    // At chunk 8 / overlap 0.25 the trigger depth is 2, so the break-even
    // falls at 1.2 s — above it, RTC's shortened chunks bring boundaries round
    // faster than the shorter waits repay. This is where that number comes
    // from: it is a property of the formula and RTC_PAYOFF_MARGIN, asserted
    // here directly, not a figure read off a rollout.
    expect(rtcPrefetchPaysOff({ latencyMs: 900, queueLen: 2, backendChunkLen: 8 })).toBe(true);
    expect(rtcPrefetchPaysOff({ latencyMs: 1150, queueLen: 2, backendChunkLen: 8 })).toBe(true);
    expect(rtcPrefetchPaysOff({ latencyMs: 1200, queueLen: 2, backendChunkLen: 8 })).toBe(false);
    expect(rtcPrefetchPaysOff({ latencyMs: 1800, queueLen: 2, backendChunkLen: 8 })).toBe(false);
    expect(rtcPrefetchPaysOff({ latencyMs: 2500, queueLen: 2, backendChunkLen: 8 })).toBe(false);
  });

  it('turns on queue depth, not on latency alone', () => {
    // The decision is a ratio, so the same 1.8 s round trip is refused against
    // a shallow queue and free against a deep one — 8 queued is 1800 ms of
    // lead exactly. This is the lever an operator has: a longer chunk from the
    // backend, or a larger `overlap`, buys latency tolerance directly.
    expect(rtcPrefetchPaysOff({ latencyMs: 1800, queueLen: 2, backendChunkLen: 16 })).toBe(false);
    expect(rtcPrefetchPaysOff({ latencyMs: 1800, queueLen: 8, backendChunkLen: 16 })).toBe(true);
  });
});

describe('SkillExecutor — RTC gives each boundary one prefetch attempt', () => {
  beforeEach(() => {
    process.env.VLA_SERVER_URL = 'http://localhost:8000';
    vi.spyOn(hardwareClient, 'isAvailable').mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // A prefetch that fails FAST — 503, connection refused — clears `inflight`
  // inside the same 200 ms sleep, so before TASK-183's attempt latch the next
  // step simply fired another, and the next, until the queue hit 0: one per
  // step at or below the threshold, which is 2 at the shipped default and 4 at
  // overlap 0.5. That is the threshold's arithmetic — the unlatched code is
  // gone, so nothing here reproduces it; what these two tests assert is the
  // latched result, one attempt either way. On hardware each extra attempt is
  // also a full getCameras + snapshot + getStateNow burst at a sidecar that is
  // evidently already sick.
  //
  // The suite's other RTC tests all run chunk 4 × overlap 0.25 ⇒ threshold 1,
  // the single parameterisation where the queue offers no second step to
  // re-fire on and the bug is therefore invisible. These two use the shipped
  // GR00T-shaped chunk of 8.
  const failingServer = (steps: () => number) =>
    makeVlaServer({
      chunkSize: 8,
      delayMs: 20,
      steps,
      // The initial fill succeeds; every predict after it — prefetch and serial
      // retry alike — is a 503.
      chunkFor: (call) => (call === 1 ? chunkOf(1, 8) : 503),
    });

  it('does not re-fire a failed prefetch on every remaining step (shipped default)', async () => {
    const rec = makeStepRecorder();
    const server = failingServer(rec.steps);

    const exec = new SkillExecutor(makeStateManager(), server.fetch);
    const result = await exec.run({
      skillId: 'rtc-one-attempt',
      taskPrompt: 'wave',
      maxSteps: 16,
      timeoutMs: 30_000,
      emitter: rec.emitter,
      rtc: { enabled: true, overlap: 0.25, blendSteps: 5 },
    });

    // The boundary got its one attempt, at the step that left 2 of 8 queued.
    expect(result.rtc?.prefetchIssued).toBe(1);
    expect(result.rtc?.prefetchFailed).toBe(1);
    // 1 initial fill + 1 prefetch + the 3 serial retries the boundary is
    // entitled to. The prefetch is the one at step 6; everything at step 8 is
    // the serial path burning its own budget.
    expect(server.rec.predictAtStep).toEqual([0, 6, 8, 8, 8]);
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/failed 3x/);
  }, 30_000);

  it('does not re-fire at overlap 0.5 either, where the queue offers four chances', async () => {
    const rec = makeStepRecorder();
    const server = failingServer(rec.steps);

    const exec = new SkillExecutor(makeStateManager(), server.fetch);
    const result = await exec.run({
      skillId: 'rtc-one-attempt-wide',
      taskPrompt: 'wave',
      maxSteps: 16,
      timeoutMs: 30_000,
      emitter: rec.emitter,
      rtc: { enabled: true, overlap: 0.5, blendSteps: 5 },
    });

    expect(result.rtc?.prefetchIssued).toBe(1);
    // Threshold 4 → the attempt is made at step 4 and never repeated at 5, 6, 7.
    expect(server.rec.predictAtStep).toEqual([0, 4, 8, 8, 8]);
  }, 30_000);
});

describe('SkillExecutor — RTC is never worse than serial', () => {
  beforeEach(() => {
    process.env.VLA_SERVER_URL = 'http://localhost:8000';
    vi.spyOn(hardwareClient, 'isAvailable').mockReturnValue(false);
    // The sweep is the one test whose subject IS elapsed time, so it is the one
    // test that cannot afford to measure the host. See runOnVirtualClock.
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('declines exactly where prefetching stops paying, and never runs longer than serial', async () => {
    // THE acceptance test for TASK-183. RTC shortens every chunk it merges (the
    // actions covering the timesteps that elapsed during inference are dropped),
    // so it buys shorter waits at the price of more of them, and past some
    // round trip that trade goes negative. An opt-in optimisation that makes
    // the robot slower is worse than no optimisation, so the invariant is not
    // "RTC is fast" — it is that RTC is never slower than leaving it off.
    //
    // Two things are checked, in that order of authority:
    //
    //  1. The payoff policy as a pure function of the numbers it is given. No
    //     clock is involved, so this is the part that cannot drift.
    //  2. The whole loop, on a virtual clock: both arms execute the same 16
    //     steps at the same 200 ms period against the same scripted server,
    //     and `Date.now()` advances by exactly the timers that fired. Every
    //     figure below is an exact integer, not a measurement of this host.
    //
    // Everything here is produced at LOOP_PERIOD_MS = 200 (5 Hz), a module
    // constant with no env or option override. Nothing on this branch has been
    // run at any other loop period.

    // ── 1. The payoff policy itself ────────────────────────────────
    // At chunk 8 / overlap 0.25 the prefetch fires with 2 actions still queued,
    // which is worth (2 + 1) * 200 ms = 600 ms of lead. That is the break-even:
    // at 600 ms the prefetch covers the whole round trip and the boundary is
    // free; past it the residual wait is charged against a chunk the merge has
    // already shortened, and RTC declines.
    const paysOffAtThreshold = (latencyMs: number) =>
      rtcPrefetchPaysOff({ latencyMs, queueLen: 2, backendChunkLen: 8 });
    expect(paysOffAtThreshold(600)).toBe(true);
    expect(paysOffAtThreshold(1200)).toBe(false);
    expect(paysOffAtThreshold(1800)).toBe(false);
    expect(paysOffAtThreshold(2500)).toBe(false);

    // ── 2. The loop, end to end ────────────────────────────────────
    // 800 and 1000 are the point of this sweep, not padding: they are the only
    // rows where the prefetch is BOTH issued and unable to cover the whole
    // round trip, which is the one regime `rtcPrefetchPaysOff` exists to
    // police. Below them the prefetch is free; above them it declines and the
    // arm is serial by construction. Without them `onMs <= offMs` is asserted
    // only where it cannot fail.
    const latencies = [600, 800, 1000, 1200, 1800, 2500];
    const rows: Array<Record<string, number>> = [];

    for (const latencyMs of latencies) {
      const off = makeVlaServer({ chunkSize: 8, delayMs: latencyMs });
      const on = makeVlaServer({ chunkSize: 8, delayMs: latencyMs });
      const opts = { taskPrompt: 'wave', maxSteps: 16, timeoutMs: 60_000 };
      const offResult = await runOnVirtualClock(
        new SkillExecutor(makeStateManager(), off.fetch).run({
          ...opts,
          skillId: `sweep-off-${latencyMs}`,
          rtc: { enabled: false },
        }),
      );
      const onResult = await runOnVirtualClock(
        new SkillExecutor(makeStateManager(), on.fetch).run({
          ...opts,
          skillId: `sweep-on-${latencyMs}`,
          rtc: { enabled: true, overlap: 0.25, blendSteps: 5 },
        }),
      );
      expect(offResult.steps).toBe(16);
      expect(onResult.steps).toBe(16);
      expect(offResult.rtc).toBeUndefined();
      rows.push({
        latencyMs,
        offMs: offResult.durationMs,
        onMs: onResult.durationMs,
        offPredicts: off.rec.predictCalls,
        onPredicts: on.rec.predictCalls,
        issued: onResult.rtc!.prefetchIssued,
        merged: onResult.rtc!.prefetchMerged,
        skipped: onResult.rtc!.prefetchSkipped,
        blended: onResult.rtc!.blendedSteps,
        stallMs: onResult.rtc!.totalStallMs,
        stalls: onResult.rtc!.stalledTransitions,
      });
    }

    for (const r of rows) {
      // eslint-disable-next-line no-console
      console.log(`[RTC sweep, virtual clock] ${JSON.stringify(r)}`);
      // The invariant, with no slack: the clock is virtual, so equal means equal.
      expect(r.onMs).toBeLessThanOrEqual(r.offMs);
    }

    // The whole sweep, exactly. On the virtual clock these are the run, not a
    // sample of it: three consecutive invocations produce byte-identical rows.
    //
    //  - 600 ms is at the break-even, so the prefetch covers the entire round
    //    trip: both boundaries are free, the queue never empties, and the run
    //    is one full `/predict` shorter than serial (3600 vs 4200 ms). It costs
    //    one extra `/predict` — 3 against serial's 2 — because each merge
    //    shortens the chunk and so brings the next boundary forward.
    //  - 800 and 1000 ms are the regime the payoff heuristic exists for, and
    //    the only rows where it is really under test: the prefetch is issued
    //    and still cannot cover the whole round trip, so the queue does empty
    //    (400 ms over two boundaries, then 800 ms) — and RTC is STILL ahead of
    //    serial, by exactly the lead the prefetch bought (4200 vs 4600, 4800 vs
    //    5000). A partial win is a win; `RTC_PAYOFF_MARGIN` would be mistuned
    //    if either of these rows had `onMs > offMs`, and that is what these two
    //    rows are here to catch.
    //  - Past 1200 ms RTC declines outright: zero prefetches issued, and the
    //    arm is the serial arm down to the millisecond.
    //
    // `blended: 0` in EVERY row is not a rounding artefact — it is the finding
    // of the crossfade-reach test below. At chunk 8 / overlap 0.25 the fade can
    // only weigh against actions still queued when the chunk lands, so it
    // reaches 8 * 0.25 * 200 ms = 400 ms of latency and no further. Every
    // boundary in this sweep is a hard splice.
    expect(rows).toEqual([
      // latency  off    on   off/on predicts   issued merged skipped blended  stall  stalls
      { latencyMs: 600, offMs: 4200, onMs: 3600, offPredicts: 2, onPredicts: 3,
        issued: 2, merged: 2, skipped: 0, blended: 0, stallMs: 0, stalls: 0 },
      { latencyMs: 800, offMs: 4600, onMs: 4200, offPredicts: 2, onPredicts: 3,
        issued: 2, merged: 2, skipped: 0, blended: 0, stallMs: 400, stalls: 2 },
      { latencyMs: 1000, offMs: 5000, onMs: 4800, offPredicts: 2, onPredicts: 3,
        issued: 2, merged: 2, skipped: 0, blended: 0, stallMs: 800, stalls: 2 },
      { latencyMs: 1200, offMs: 5400, onMs: 5400, offPredicts: 2, onPredicts: 2,
        issued: 0, merged: 0, skipped: 2, blended: 0, stallMs: 1200, stalls: 1 },
      { latencyMs: 1800, offMs: 6600, onMs: 6600, offPredicts: 2, onPredicts: 2,
        issued: 0, merged: 0, skipped: 2, blended: 0, stallMs: 1800, stalls: 1 },
      { latencyMs: 2500, offMs: 8000, onMs: 8000, offPredicts: 2, onPredicts: 2,
        issued: 0, merged: 0, skipped: 2, blended: 0, stallMs: 2500, stalls: 1 },
    ]);
  }, 60_000);
});

describe('SkillExecutor — RTC crossfade reach', () => {
  beforeEach(() => {
    process.env.VLA_SERVER_URL = 'http://localhost:8000';
    vi.spyOn(hardwareClient, 'isAvailable').mockReturnValue(false);
    // How much of a chunk is left to fade against when the next one lands is a
    // question about the clock, so it is asked on the virtual one.
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const blendedAt = async (overlap: number, latencyMs: number): Promise<number> => {
    const server = makeVlaServer({ chunkSize: 8, delayMs: latencyMs });
    const result = await runOnVirtualClock(
      new SkillExecutor(makeStateManager(), server.fetch).run({
        skillId: `reach-${overlap}-${latencyMs}`,
        taskPrompt: 'wave',
        maxSteps: 16,
        timeoutMs: 60_000,
        rtc: { enabled: true, overlap, blendSteps: 5 },
      }),
    );
    expect(result.steps).toBe(16);
    return result.rtc?.blendedSteps ?? -1;
  };

  it('reaches exactly as far as the overlap, and this is narrower than it looks', async () => {
    // Honest bound, measured rather than hoped for. A prefetched chunk is
    // merged at the loop top as soon as it lands, so by then the queue is down
    // to `threshold - latency/period` actions — and `blendChunks` can only fade
    // against actions that are still queued. Below zero it takes the
    // `queue.length === 0` early return and RTC degenerates to prefetch plus a
    // hard splice: the boundary is still free, but nothing is crossfaded.
    //
    // So the crossfade reaches `chunkSize * overlap * LOOP_PERIOD_MS` of
    // latency and no further. At the shipped chunk 8 / overlap 0.25 that is
    // 400 ms; every boundary at a longer round trip is a hard splice, which is
    // why the sweep below reports `blended: 0` in all four of its arms.
    //
    // Whether a real policy's round trip clears 400 ms is NOT measured here,
    // and this repo does not settle it either: docs/vla-integration-guide.md
    // says GR00T "should be <20ms" on an NVIDIA GPU, while
    // docs/real-g1-apple-runbook.md asks operators for "ideally < 300 ms"
    // against a 1 s watchdog. Both are expectations, not measurements. What
    // this test does establish is the shape of the failure — above 400 ms the
    // crossfade does nothing at all — so TASK-183's "no discontinuity at the
    // boundary" cannot be claimed at the shipped default. It would be bought
    // back by raising `overlap` (at the price of more /predict calls per step)
    // or by shortening LOOP_PERIOD_MS; neither is decided here.
    // Sequential: each call drives the shared virtual clock itself.
    const near = await blendedAt(0.25, 100);
    const farAtShippedDefault = await blendedAt(0.25, 600);
    const farAtWiderOverlap = await blendedAt(0.5, 600);

    // Exact, not directional: on the virtual clock these three are the run.
    expect(near).toBe(4);
    expect(farAtShippedDefault).toBe(0);
    expect(farAtWiderOverlap).toBe(6);
    // eslint-disable-next-line no-console
    console.log(
      `[RTC crossfade reach, chunk 8, blendSteps 5, 16 steps] overlap 0.25 @100ms: ${near} blended | ` +
        `overlap 0.25 @600ms: ${farAtShippedDefault} blended (criterion 2 unmet) | ` +
        `overlap 0.50 @600ms: ${farAtWiderOverlap} blended`,
    );
  }, 60_000);
});

describe('SkillExecutor — RTC aligns to the observation, not to the decision', () => {
  useSo101Embodiment();

  beforeEach(() => {
    process.env.VLA_SERVER_URL = 'http://localhost:8000';
    vi.spyOn(hardwareClient, 'isAvailable').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not skip the arm forward by the sidecar capture latency', async () => {
    // `consumed = step - issuedAtStep` is how many leading actions of an
    // arriving chunk describe timesteps the robot has already lived through.
    // Its zero has to be the OBSERVATION. In sim the two coincide; on hardware
    // `captureHardware` is a real sidecar round trip — getCameras, a snapshot
    // per camera, getStateNow — so stamping at the decision to prefetch made
    // `consumed` too big by however long that took, and the extra actions it
    // dropped were still in the robot's future. The arm skipped forward.
    //
    // 400 ms of capture at the 200 ms loop period is two steps of skew. The
    // chunk is a ramp, so the skew is legible in what reaches the arm: it must
    // resume at the chunk's own first action, not part-way in.
    vi.spyOn(hardwareClient, 'getCameras').mockImplementation(async () => {
      await delay(200);
      return ['wrist'];
    });
    vi.spyOn(hardwareClient, 'snapshot').mockImplementation(async () => {
      await delay(200);
      return 'fake-jpeg-b64';
    });
    vi.spyOn(hardwareClient, 'getStateNow').mockResolvedValue([0, 0, 0, 0, 0, 0]);
    vi.spyOn(hardwareClient, 'sendActionVector').mockResolvedValue();

    const rec = makeStepRecorder();
    const server = makeVlaServer({
      chunkSize: 8,
      delayMs: 0,
      steps: rec.steps,
      // Every chunk is the same 0.0 → 0.7 ramp, in 0.1 steps: small enough that
      // the 5° delta clip never touches it, distinct enough to read positions off.
      chunkFor: () => Array.from({ length: 8 }, (_, i) => Array.from({ length: 6 }, () => i * 0.1)),
    });

    const result = await new SkillExecutor(makeStateManager(), server.fetch).run({
      skillId: 'rtc-capture-skew',
      taskPrompt: 'wave',
      maxSteps: 12,
      timeoutMs: 60_000,
      emitter: rec.emitter,
      // Hard splice: a crossfade would average the boundary away and hide the
      // very thing under test.
      rtc: { enabled: true, overlap: 0.25, blendSteps: 0 },
    });

    expect(result.status).toBe('completed');
    expect(result.rtc?.prefetchMerged).toBe(1);
    const applied = rec.events.map((e) => e.action[0]);
    // The merge is the one place the ramp goes backwards.
    const boundary = applied.findIndex((v, i) => i > 0 && v < applied[i - 1]);
    expect(boundary).toBeGreaterThan(0);
    // Stamped before the capture, this was 0.1 or later — the arm silently
    // skipped the first action(s) of the fresh chunk.
    expect(applied[boundary]).toBeCloseTo(0, 10);
    // …and from there the ramp continues intact, one 0.1 step at a time.
    for (let i = boundary + 1; i < applied.length; i++) {
      expect(applied[i] - applied[i - 1]).toBeCloseTo(0.1, 10);
    }
  }, 60_000);
});

// ─── RTC in hardware mode: the sidecar (TASK-183) ───────────────────────

/**
 * A sidecar with a stopwatch. Every method `captureHardware` and the loop's
 * action send reach for is wrapped, so a test can see which sidecar calls were
 * in flight at the same instant.
 *
 * The delays are what make the question answerable: with a capture longer than
 * one loop period, a prefetch capturing off the loop's thread is *certain* to
 * still be reading the sidecar when the next `/action` goes out.
 */
function makeSidecarRecorder(o: {
  cameras?: string[];
  camerasMs?: number;
  snapshotMs?: number;
  stateMs?: number;
  sendMs?: number;
  /** 1-based snapshot call number to fail, for the capture-failure test. */
  failSnapshotCall?: number;
}) {
  const overlaps: string[] = [];
  const rec = {
    /** Every sidecar call, in start order. */
    calls: [] as string[],
    /** Action vectors that reached the arm. */
    sends: [] as number[][],
    snapshotCalls: 0,
    /** Every pair of sidecar calls caught in flight together, as `"a + b"`. */
    overlaps,
    /**
     * The overlaps that mean two INDEPENDENT sidecar operations were in flight.
     *
     * `captureHardware` fans its snapshots and `/state/fast` out through one
     * `Promise.all` — that pair has overlapped since TASK-146, predates RTC,
     * and is one capture, not two callers. Everything else on this list is a
     * second caller: a capture against an `/action`, or a capture against
     * another capture.
     */
    independentOverlaps: (): string[] =>
      overlaps.filter((p) => p !== 'snapshot + getStateNow' && p !== 'getStateNow + snapshot'),
  };
  // Keyed by a per-call token, not by name: two snapshots of the same camera
  // are two entries, and a call that throws must still leave the set.
  const inFlight = new Map<number, string>();
  let seq = 0;

  const track = async <T>(label: string, ms: number, fn: () => T): Promise<T> => {
    const id = seq++;
    rec.calls.push(label);
    for (const other of inFlight.values()) overlaps.push(`${other} + ${label}`);
    inFlight.set(id, label);
    try {
      if (ms > 0) await delay(ms);
      return fn();
    } finally {
      inFlight.delete(id);
    }
  };

  vi.spyOn(hardwareClient, 'isAvailable').mockReturnValue(true);
  vi.spyOn(hardwareClient, 'getCameras').mockImplementation(() =>
    track('getCameras', o.camerasMs ?? 0, () => o.cameras ?? ['wrist']),
  );
  vi.spyOn(hardwareClient, 'snapshot').mockImplementation(() =>
    track('snapshot', o.snapshotMs ?? 0, () => {
      rec.snapshotCalls += 1;
      if (o.failSnapshotCall === rec.snapshotCalls) {
        throw new Error('Sidecar /cameras/wrist/snapshot returned 503');
      }
      return 'fake-jpeg-b64';
    }),
  );
  vi.spyOn(hardwareClient, 'getStateNow').mockImplementation(() =>
    track('getStateNow', o.stateMs ?? 0, () => [0, 0, 0, 0, 0, 0]),
  );
  vi.spyOn(hardwareClient, 'sendActionVector').mockImplementation((action: number[]) =>
    track('sendActionVector', o.sendMs ?? 0, () => {
      rec.sends.push(action);
    }),
  );
  return rec;
}

/**
 * RTC's new concurrency is not with vla-server — the loop always talked to
 * that, and overlapping `/predict` with execution is the entire feature. It is
 * with the robot's OWN sidecar, which a prefetch reaches for to build an
 * observation at the same moment the loop is reaching for it to send an action.
 *
 * That process serialises every DDS touch on one lock (`g1_sidecar.py`'s
 * `robot_lock`) and its `/action` ramp is only physically correct while the
 * caller drives it at a steady ~`G1_CONTROL_HZ`; on SO-101 under `sentry` the
 * sidecar is additionally re-opening the cameras and the follower serial port
 * on demand. And TASK-169 — the commit before this work — was a race on
 * exactly this read path. So the loop keeps the sidecar to itself, and these
 * three tests are what says so.
 */
describe('SkillExecutor — RTC never gives the sidecar a second caller', () => {
  useSo101Embodiment();

  beforeEach(() => {
    process.env.VLA_SERVER_URL = 'http://localhost:8000';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('serialises the prefetch capture against the loop action send', async () => {
    // A 300 ms capture (getCameras, then snapshot ‖ getStateNow) against a
    // 200 ms loop period: a prefetch capturing off the loop's thread cannot
    // avoid still being in the sidecar when the next /action goes out.
    const sidecar = makeSidecarRecorder({
      camerasMs: 150,
      snapshotMs: 150,
      stateMs: 50,
      sendMs: 100,
    });
    const rec = makeStepRecorder();
    // 50 ms of inference — fast enough that the payoff policy always says yes,
    // so the prefetch under test definitely happens.
    const server = makeVlaServer({ chunkSize: 4, delayMs: 50, steps: rec.steps });

    const result = await new SkillExecutor(makeStateManager(), server.fetch).run({
      skillId: 'rtc-hw-serialised',
      taskPrompt: 'pick up the green cube',
      maxSteps: 8,
      timeoutMs: 60_000,
      emitter: rec.emitter,
      rtc: { enabled: true, overlap: 0.25, blendSteps: 1 },
    });

    expect(result.status).toBe('completed');
    expect(result.mode).toBe('hardware');
    expect(result.steps).toBe(8);
    // Not a vacuous pass: RTC really did prefetch, twice, and really did carry
    // both boundaries with it.
    expect(result.rtc?.prefetchIssued).toBe(2);
    expect(result.rtc?.prefetchMerged).toBe(2);

    // The assertion this whole describe exists for.
    expect(sidecar.independentOverlaps()).toEqual([]);

    // And the prefetch still did its job. Its /predict was issued mid-chunk,
    // with actions still queued — it overlapped execution, which is the part
    // of RTC that had to survive serialising the capture…
    expect(server.rec.predictAtStep).toEqual([0, 3, 6]);
    expect(server.rec.maxConcurrentPredicts).toBe(1);
    // …so the robot never waited at a chunk boundary.
    expect(result.rtc?.stalledTransitions).toBe(0);
    expect(result.rtc?.totalStallMs).toBe(0);
    // Every step reached the arm, one /action per step.
    expect(sidecar.sends).toHaveLength(8);
  }, 60_000);

  it('abort mid-prefetch leaves nothing talking to the sidecar', async () => {
    const rejections: unknown[] = [];
    const onUnhandled = (e: unknown) => rejections.push(e);
    process.on('unhandledRejection', onUnhandled);

    // Fast sidecar here — what is being aborted is the /predict still in the
    // air, not the capture.
    const sidecar = makeSidecarRecorder({ camerasMs: 5, snapshotMs: 5, stateMs: 5, sendMs: 5 });
    const rec = makeStepRecorder();
    // Only the prefetch is slow: the initial fill has to be instant or the
    // abort would land before the loop has taken three steps.
    const server = makeVlaServer({
      chunkSize: 4,
      delayMs: (call) => (call === 1 ? 0 : 700),
      steps: rec.steps,
    });

    const exec = new SkillExecutor(makeStateManager(), server.fetch);
    const promise = exec.run({
      skillId: 'rtc-hw-abort',
      taskPrompt: 'pick up the green cube',
      maxSteps: 8,
      timeoutMs: 60_000,
      emitter: rec.emitter,
      rtc: { enabled: true, overlap: 0.25, blendSteps: 1 },
    });

    // Steps land at ~0/200/400 ms; the prefetch goes out after step 3 and its
    // /predict is still in the air 700 ms later. 550 ms is inside that window.
    setTimeout(() => exec.abort(), 550);
    const result = await promise;
    const callsAtRunEnd = sidecar.calls.length;
    const sendsAtRunEnd = sidecar.sends.length;

    expect(result.status).toBe('aborted');
    expect(result.mode).toBe('hardware');
    expect(result.steps).toBeGreaterThanOrEqual(3);
    expect(result.rtc?.prefetchIssued).toBe(1);
    expect(result.rtc?.prefetchMerged).toBe(0);
    // The prefetch's request was cancelled, not merely ignored.
    expect(server.rec.signals[1]?.aborted).toBe(true);
    expect(sidecar.independentOverlaps()).toEqual([]);

    // Outlive the prefetch's delay: its late resolution must not command the
    // arm, touch the sidecar, emit a step, or throw into the process.
    await delay(900);
    expect(sidecar.calls.length).toBe(callsAtRunEnd);
    expect(sidecar.sends.length).toBe(sendsAtRunEnd);
    expect(rec.events.length).toBe(result.steps);
    process.off('unhandledRejection', onUnhandled);
    expect(rejections).toEqual([]);
  }, 60_000);

  it('a prefetch whose capture fails hands the boundary back to the serial refill', async () => {
    // Snapshot call 1 is the loop's own opening capture; call 2 is the
    // prefetch's. Failing the second is a sidecar that dropped exactly the
    // speculative read — the run must not notice beyond a warning and a stall.
    const sidecar = makeSidecarRecorder({
      camerasMs: 20,
      snapshotMs: 20,
      stateMs: 10,
      sendMs: 10,
      failSnapshotCall: 2,
    });
    const rec = makeStepRecorder();
    const server = makeVlaServer({ chunkSize: 4, delayMs: 50, steps: rec.steps });

    const result = await new SkillExecutor(makeStateManager(), server.fetch).run({
      skillId: 'rtc-hw-capture-fail',
      taskPrompt: 'pick up the green cube',
      maxSteps: 8,
      timeoutMs: 60_000,
      emitter: rec.emitter,
      rtc: { enabled: true, overlap: 0.25, blendSteps: 1 },
    });

    // A speculative observation that could not be taken is not a failed run.
    expect(result.status).toBe('completed');
    expect(result.steps).toBe(8);
    expect(sidecar.sends).toHaveLength(8);
    // ONE prefetch reached vla-server -- the second boundary's. The first
    // boundary's attempt died at the capture, so it is `prefetchFailed` and not
    // `prefetchIssued`: the counter is reconcilable against `predictAtStep`
    // below, and against the request count vla-server itself would report.
    expect(result.rtc?.prefetchIssued).toBe(1);
    expect(result.rtc?.prefetchFailed).toBe(1);

    // The failed prefetch never reached vla-server at all, and the boundary it
    // was for was served by the serial refill at step 4 — with the queue
    // empty, which is what a serial boundary costs.
    expect(server.rec.predictAtStep).toEqual([0, 4, 7]);
    expect(result.rtc?.stalledTransitions).toBe(1);
    expect(result.rtc?.totalStallMs).toBeGreaterThan(0);

    // One failure did not become a burst of retries at the sidecar: the
    // boundary gets one attempt, so the run made exactly four captures — the
    // opening fill, the failed prefetch, the serial refill that replaced it,
    // and the prefetch for the second boundary.
    expect(sidecar.calls.filter((c) => c === 'getCameras')).toHaveLength(4);
    expect(sidecar.independentOverlaps()).toEqual([]);
  }, 60_000);
});

// ─── The delta clip across a chunk boundary (TASK-183) ──────────────────

/**
 * Largest per-joint change between consecutive commanded vectors, counting the
 * pose the arm was seeded from as the step before the first one.
 *
 * This is the quantity `MAX_DELTA_DEGREES` bounds, and the quantity a chunk
 * boundary threatens: the incoming chunk was predicted from a different
 * observation, so its first row need not be anywhere near the last row of the
 * chunk it replaces.
 */
function maxJointStepDelta(sends: readonly number[][], seed: readonly number[]): number {
  let max = 0;
  let prev: readonly number[] = seed;
  for (const s of sends) {
    for (let j = 0; j < s.length; j += 1) {
      max = Math.max(max, Math.abs(s[j] - (prev[j] ?? 0)));
    }
    prev = s;
  }
  return max;
}

/**
 * A vla-server that answers the first `/predict` with a chunk of all-zeros and
 * every one after it with all-60. The boundary between chunk 1 and chunk 2 is
 * therefore a 60° discontinuity on every joint — twelve times the clip bound,
 * and far past anything a crossfade could smooth away on its own.
 */
function makeBoundaryJumpServer(o: { delayMs?: number; steps?: () => number }) {
  return makeVlaServer({
    chunkSize: 4,
    delayMs: o.delayMs ?? 0,
    steps: o.steps,
    chunkFor: (call) => chunkOf(call === 1 ? 0 : 60, 4),
  });
}

/**
 * The second acceptance criterion of TASK-183 is a BOUND — "no discontinuity
 * larger than the hardware `clipAction` bound at chunk boundaries" — and until
 * these tests `MAX_DELTA_DEGREES` appeared in no assertion anywhere in
 * `robot-agent/src`. Its value was pinned incidentally by the hardware test
 * near the top of this file (a 60° prediction arriving as 5 then 10), but that
 * test predates TASK-183 and nothing related a BOUNDARY discontinuity to it.
 *
 * What is asserted here is the property, not the number: whatever the two
 * chunks disagree by, and whether the boundary is a serial refill, a hard
 * splice or a crossfade, no single step commands a joint further than
 * `MAX_DELTA_DEGREES`. The blend narrows the discontinuity; the clip is what
 * bounds it, and the last test says so by taking the clip away.
 */
describe('SkillExecutor — a chunk boundary never commands more than MAX_DELTA_DEGREES', () => {
  useSo101Embodiment();

  const SEED = [0, 0, 0, 0, 0, 0];

  beforeEach(() => {
    process.env.VLA_SERVER_URL = 'http://localhost:8000';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('holds across a serial boundary (RTC off)', async () => {
    const sidecar = makeSidecarRecorder({});
    const rec = makeStepRecorder();
    const server = makeBoundaryJumpServer({ steps: rec.steps });

    const result = await new SkillExecutor(makeStateManager(), server.fetch).run({
      skillId: 'clip-serial-boundary',
      taskPrompt: 'pick up the green cube',
      maxSteps: 8,
      timeoutMs: 30_000,
      emitter: rec.emitter,
      rtc: { enabled: false },
    });

    expect(result.status).toBe('completed');
    expect(result.mode).toBe('hardware');
    expect(sidecar.sends).toHaveLength(8);
    // The boundary really is at step 5 and the raw chunk really does jump 60°
    // there — without that the bound below would be vacuous.
    expect(server.rec.predictAtStep).toEqual([0, 4]);
    expect(sidecar.sends[3]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(maxJointStepDelta(sidecar.sends, SEED)).toBeLessThanOrEqual(MAX_DELTA_DEGREES);
    // …and the arm walks toward the new chunk AT the bound rather than
    // stopping short of it: 5° on the first step past the boundary, 10° on the
    // next. The clip rate-limits the discontinuity, it does not reject it.
    expect(sidecar.sends[4]).toEqual(Array(6).fill(MAX_DELTA_DEGREES));
    expect(sidecar.sends[5]).toEqual(Array(6).fill(2 * MAX_DELTA_DEGREES));
  }, 30_000);

  it('holds across a hard-spliced RTC boundary (blendSteps 0)', async () => {
    const sidecar = makeSidecarRecorder({});
    const rec = makeStepRecorder();
    // 20 ms of inference: the prefetch lands with lead to spare, so the
    // boundary is carried by a splice rather than by a serial refill — and
    // with blendSteps 0 there is nothing fading it.
    const server = makeBoundaryJumpServer({ delayMs: 20, steps: rec.steps });

    const result = await new SkillExecutor(makeStateManager(), server.fetch).run({
      skillId: 'clip-spliced-boundary',
      taskPrompt: 'pick up the green cube',
      maxSteps: 8,
      timeoutMs: 30_000,
      emitter: rec.emitter,
      rtc: { enabled: true, overlap: 0.25, blendSteps: 0 },
    });

    expect(result.status).toBe('completed');
    expect(sidecar.sends).toHaveLength(8);
    // The boundary under test was a prefetch, spliced with no crossfade at all.
    expect(result.rtc?.prefetchMerged).toBeGreaterThan(0);
    expect(result.rtc?.blendedSteps).toBe(0);
    expect(maxJointStepDelta(sidecar.sends, SEED)).toBeLessThanOrEqual(MAX_DELTA_DEGREES);
  }, 30_000);

  it('holds across a crossfaded RTC boundary too', async () => {
    const sidecar = makeSidecarRecorder({});
    const rec = makeStepRecorder();
    const server = makeBoundaryJumpServer({ delayMs: 20, steps: rec.steps });

    const result = await new SkillExecutor(makeStateManager(), server.fetch).run({
      skillId: 'clip-blended-boundary',
      taskPrompt: 'pick up the green cube',
      maxSteps: 8,
      timeoutMs: 30_000,
      emitter: rec.emitter,
      rtc: { enabled: true, overlap: 0.5, blendSteps: 2 },
    });

    expect(result.status).toBe('completed');
    expect(sidecar.sends).toHaveLength(8);
    // A crossfade really did happen…
    expect(result.rtc?.blendedSteps).toBeGreaterThan(0);
    // …and it is still the clip that decides what the arm is allowed to do.
    expect(maxJointStepDelta(sidecar.sends, SEED)).toBeLessThanOrEqual(MAX_DELTA_DEGREES);
  }, 30_000);

  it('is the clip that enforces it — the same chunks in sim jump the full 60°', async () => {
    // The counterfactual. Sim mode runs the identical loop with `clipAction`
    // skipped, so the same scripted chunks produce the raw discontinuity. If
    // this arm ever stopped exceeding the bound, the three tests above would be
    // measuring the scripted data rather than the clip.
    vi.spyOn(hardwareClient, 'isAvailable').mockReturnValue(false);
    const rec = makeStepRecorder();
    const server = makeBoundaryJumpServer({ steps: rec.steps });

    const result = await new SkillExecutor(makeStateManager(), server.fetch).run({
      skillId: 'clip-sim-counterfactual',
      taskPrompt: 'pick up the green cube',
      maxSteps: 8,
      timeoutMs: 30_000,
      emitter: rec.emitter,
      rtc: { enabled: false },
    });

    expect(result.status).toBe('completed');
    expect(result.mode).toBe('sim');
    const actions = rec.events.map((e) => e.action);
    expect(actions).toHaveLength(8);
    expect(maxJointStepDelta(actions, SEED)).toBe(60);
    expect(maxJointStepDelta(actions, SEED)).toBeGreaterThan(MAX_DELTA_DEGREES);
  }, 30_000);
});

// ─── The loop period is a knob, not a constant (TASK-183) ───────────────

/**
 * `LOOP_PERIOD_MS` used to be a bare module constant, which made TASK-183's
 * fifth acceptance criterion — validate at 15 Hz — not merely unmet but
 * inexpressible: no configuration of the executor produced any rate but 5 Hz,
 * and every RTC figure in that task is a 5 Hz figure because of it.
 *
 * These two tests are what says the rate is now a property of the run. They do
 * NOT re-tune anything at 15 Hz: the crossfade reach, the prefetch break-even
 * and `RTC_PAYOFF_MARGIN` are all functions of the period and remain measured
 * only at 200 ms. What has changed is that an A/B between two rates can now be
 * written at all.
 */
describe('SkillExecutor — the rollout loop period', () => {
  beforeEach(() => {
    process.env.VLA_SERVER_URL = 'http://localhost:8000';
    vi.spyOn(hardwareClient, 'isAvailable').mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('still ships the historical 5 Hz when VLA_LOOP_PERIOD_MS is unset', async () => {
    // `config` is a module-level object literal, so the copy this file imported
    // statically froze whatever the environment held at first import. Asserting
    // on that copy could not fail for the reason this test names. Re-read the
    // module with the variable genuinely removed instead — the same trick
    // `config/__tests__/config-rtc.test.ts` uses, and the only thing that makes
    // the "when unset" in the title true.
    const saved = process.env.VLA_LOOP_PERIOD_MS;
    delete process.env.VLA_LOOP_PERIOD_MS;
    try {
      vi.resetModules();
      const fresh = await import('../../config/config.js');
      expect(fresh.config.vla.loopPeriodMs).toBe(200);
    } finally {
      if (saved === undefined) delete process.env.VLA_LOOP_PERIOD_MS;
      else process.env.VLA_LOOP_PERIOD_MS = saved;
      vi.resetModules();
    }
  });

  it('paces the run at the requested rate — 5 Hz against ~15 Hz, same steps', async () => {
    // Both arms run the same 8 steps against the same instant server, so the
    // only thing that can separate their wall clocks is the sleep between
    // steps. The clock is the virtual one, so the ratio below is arithmetic.
    vi.useFakeTimers();
    const opts = {
      taskPrompt: 'wave',
      maxSteps: 8,
      timeoutMs: 60_000,
      rtc: { enabled: false },
    };

    const slow = await runOnVirtualClock(
      new SkillExecutor(makeStateManager(), makeVlaServer({ chunkSize: 4 }).fetch).run({
        ...opts,
        skillId: 'period-5hz',
        loopPeriodMs: 200,
      }),
    );
    // 1000/15 is not a whole number of milliseconds; 67 ms is the closest a
    // setTimeout-paced loop gets to the 15 Hz the criterion names.
    const fast = await runOnVirtualClock(
      new SkillExecutor(makeStateManager(), makeVlaServer({ chunkSize: 4 }).fetch).run({
        ...opts,
        skillId: 'period-15hz',
        loopPeriodMs: 67,
      }),
    );

    expect(slow.steps).toBe(8);
    expect(fast.steps).toBe(8);
    // Same number of sleeps, different length: the durations are in exactly
    // the ratio of the two periods, and neither is zero.
    expect(slow.durationMs).toBeGreaterThan(0);
    expect(slow.durationMs % 200).toBe(0);
    expect(fast.durationMs % 67).toBe(0);
    expect(slow.durationMs / 200).toBe(fast.durationMs / 67);
    // eslint-disable-next-line no-console
    console.log(
      `[loop period A/B, mocked vla-server @0ms, 8 steps] 200ms: ${slow.durationMs}ms wall | ` +
        `67ms: ${fast.durationMs}ms wall`,
    );
  }, 30_000);
});

// ─── The action contract (TASK-229) ─────────────────────────────────────

describe('SkillExecutor — what a 43-DOF humanoid is allowed to be commanded with', () => {
  const originalRobotType = config.robotType;

  beforeEach(() => {
    process.env.VLA_SERVER_URL = 'http://localhost:8000';
    vi.spyOn(hardwareClient, 'isAvailable').mockReturnValue(true);
    vi.spyOn(hardwareClient, 'getCameras').mockResolvedValue(['front']);
    vi.spyOn(hardwareClient, 'snapshot').mockResolvedValue('fake-jpeg-b64');
    config.robotType = 'g1_edu';
  });

  afterEach(() => {
    config.robotType = originalRobotType;
    vi.restoreAllMocks();
  });

  function serverWith(configBody: Record<string, unknown>, action: number[]): typeof fetch {
    return makeFakeFetch(async (url) => {
      if (url.endsWith('/config')) return new Response(JSON.stringify(configBody), { status: 200 });
      if (url.endsWith('/reset')) return new Response('{}', { status: 200 });
      if (url.endsWith('/predict')) {
        return new Response(JSON.stringify({ actions: [action, action] }), { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
  }

  it('sends joint targets by NAME, with the left-hand grip decoded', async () => {
    vi.spyOn(hardwareClient, 'getStateNow').mockResolvedValue(new Array(43).fill(0));
    const byName = vi.spyOn(hardwareClient, 'sendJointTargets').mockResolvedValue();
    const byIndex = vi.spyOn(hardwareClient, 'sendActionVector').mockResolvedValue();

    const action = new Array(31).fill(0);
    const exec = new SkillExecutor(
      makeStateManager(),
      serverWith({ cameras: ['front'], state_dim: 43, action_dim: 31, chunk_size: 2 }, action),
    );
    const result = await exec.run({
      skillId: 'apple-1',
      taskPrompt: 'move the apple to the plate',
      maxSteps: 1,
      timeoutMs: 10_000,
    });

    expect(result.status).toBe('completed');
    expect(byIndex).not.toHaveBeenCalled();
    expect(byName).toHaveBeenCalledTimes(1);

    const joints = byName.mock.calls[0]![0] as Record<string, number>;
    // The regression, at the level the robot actually sees it: no leg.
    expect(Object.keys(joints).filter((n) => /hip|knee|ankle/.test(n))).toEqual([]);
    expect(joints['left_shoulder_pitch_joint']).toBe(0);
    // An all-zero action is the OPEN hand, not a zero pose — the decoder ran.
    expect(joints['left_hand_middle_0_joint']).toBeCloseTo(-0.07636, 9);
    expect(joints['left_hand_thumb_1_joint']).toBeCloseTo(0.06824, 9);
  });

  it('seeds the delta clip from the ARM, not from whatever joint shares its index', async () => {
    // The clip's step-0 seed is the 43-dim observation (STATE order, legs
    // first) and the vector it clips is the 31-dim action (arms first), so
    // zipping them by index rate-limited `left_shoulder_pitch` against
    // `left_hip_pitch`. That was inert only because MAX_DELTA_DEGREES = 5 is
    // compared against RADIANS here — and only just: the two joints' ranges
    // are 5.20 rad apart at their extremes, which is over the bound. This is
    // that pair, at those extremes.
    const state = new Array(43).fill(0);
    state[0] = -2.53; // left_hip_pitch, pitched back
    const action = new Array(31).fill(0);
    action[0] = 2.67; // left_shoulder_pitch, arm up

    vi.spyOn(hardwareClient, 'getStateNow').mockResolvedValue(state);
    const byName = vi.spyOn(hardwareClient, 'sendJointTargets').mockResolvedValue();

    const exec = new SkillExecutor(
      makeStateManager(),
      serverWith({ cameras: ['front'], state_dim: 43, action_dim: 31, chunk_size: 2 }, action),
    );
    const result = await exec.run({
      skillId: 'clip-seed',
      taskPrompt: 'move the apple to the plate',
      maxSteps: 1,
      timeoutMs: 10_000,
    });

    expect(result.status).toBe('completed');
    const joints = byName.mock.calls[0]![0] as Record<string, number>;
    // Seeded by name from left_shoulder_pitch (state index 15, = 0), so the
    // 2.67 delta is inside the bound and the commanded pose is the policy's.
    expect(joints['left_shoulder_pitch_joint']).toBeCloseTo(2.67, 9);
    // Seeded by index it would have been -2.53 + 5 = 2.47: a shoulder target
    // computed from a hip angle.
    expect(joints['left_shoulder_pitch_joint']).not.toBeCloseTo(2.47, 6);
  });

  it('ends the run, commanding nothing, when no contract matches the width', async () => {
    vi.spyOn(hardwareClient, 'getStateNow').mockResolvedValue(new Array(43).fill(0));
    const byName = vi.spyOn(hardwareClient, 'sendJointTargets').mockResolvedValue();
    const byIndex = vi.spyOn(hardwareClient, 'sendActionVector').mockResolvedValue();

    const exec = new SkillExecutor(
      makeStateManager(),
      serverWith(
        { cameras: ['front'], state_dim: 43, action_dim: 6, chunk_size: 2 },
        [0, 0, 0, 0, 0, 0],
      ),
    );
    const result = await exec.run({
      skillId: 'wrong-checkpoint',
      taskPrompt: 'move the apple to the plate',
      maxSteps: 4,
      timeoutMs: 10_000,
    });

    // The old behaviour was to map the overlap onto the first six joints of
    // the body order — five leg joints and a hip — and carry on.
    expect(result.status).toBe('failed');
    expect(result.steps).toBe(0);
    expect(result.error).toMatch(/action length 6/);
    expect(result.error).toMatch(/known: 31/);
    expect(byName).not.toHaveBeenCalled();
    expect(byIndex).not.toHaveBeenCalled();
  });

  it('refuses just as hard when /config never said how wide the actions are', async () => {
    // `action_dim` lets the mismatch be caught before the first `/predict`;
    // without it the first chunk is the first evidence. Either way nothing is
    // written — the check precedes the send, not the other way round.
    vi.spyOn(hardwareClient, 'getStateNow').mockResolvedValue(new Array(43).fill(0));
    const byName = vi.spyOn(hardwareClient, 'sendJointTargets').mockResolvedValue();
    const byIndex = vi.spyOn(hardwareClient, 'sendActionVector').mockResolvedValue();

    const exec = new SkillExecutor(
      makeStateManager(),
      serverWith({ cameras: ['front'], state_dim: 43, chunk_size: 2 }, new Array(28).fill(0.1)),
    );
    const result = await exec.run({
      skillId: 'silent-config',
      taskPrompt: 'move the apple to the plate',
      maxSteps: 4,
      timeoutMs: 10_000,
    });

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/action length 28/);
    expect(byName).not.toHaveBeenCalled();
    expect(byIndex).not.toHaveBeenCalled();
  });
});
