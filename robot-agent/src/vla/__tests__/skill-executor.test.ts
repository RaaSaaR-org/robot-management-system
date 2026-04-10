/**
 * @file skill-executor.test.ts
 * @description Tests for the closed-loop SkillExecutor (sim path).
 * @feature vla
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SkillExecutor } from '../skill-executor.js';
import { hardwareClient } from '../../hardware/HardwareClient.js';

// Force the simulated path: pretend hardware sidecar is not available.
vi.spyOn(hardwareClient, 'isAvailable').mockReturnValue(false);

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

describe('SkillExecutor (simulated path)', () => {
  beforeEach(() => {
    process.env.VLA_SERVER_URL = 'http://localhost:8000';
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
    // chunk_size=4, capped at 2 chunks → 8 steps
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

    // Abort after a couple of ms — the loop sleeps 50ms between steps.
    setTimeout(() => exec.abort(), 30);
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
      timeoutMs: 10, // expires before first step's 50ms sleep clears
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

  it('surfaces /predict 422 (missing camera) errors', async () => {
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
  });
});
