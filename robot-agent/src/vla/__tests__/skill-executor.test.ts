/**
 * @file skill-executor.test.ts
 * @description Tests for the unified SkillExecutor closed loop. Covers
 * both sim mode (no hardware sidecar) and hardware mode (sidecar available).
 * @feature vla
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SkillExecutor } from '../skill-executor.js';
import { hardwareClient } from '../../hardware/HardwareClient.js';

function makeFakeFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>): typeof fetch {
  return (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    return impl(url, init);
  }) as unknown as typeof fetch;
}

function makeStateManager(joints: number[] = [0, 0, 0, 0, 0, 0]) {
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
