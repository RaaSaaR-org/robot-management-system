/**
 * @file skill-rtc-payload.test.ts
 * @description TASK-183: what a rollout puts on the wire. The chunk-boundary
 * counters must reach the `/skills/execute` response and the evaluation
 * episode POSTed to the platform when RTC ran, and must be entirely absent
 * when it did not — an agent with RTC off has to be indistinguishable, on
 * every one of those payloads, from an agent that never heard of TASK-183.
 *
 * Unlike skill-execute-route.test.ts this drives the REAL SkillExecutor: the
 * defect being guarded against was the executor attaching the counters to every
 * result, which a mocked executor cannot show.
 * @feature vla
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

import { createRestRoutes } from '../rest-routes.js';
import { config } from '../../config/config.js';
import { hardwareClient } from '../../hardware/HardwareClient.js';
import type { RobotStateManager } from '../../robot/state.js';

const VLA_BASE = 'http://localhost:8000';

function makeStateStub(): RobotStateManager {
  return {
    getRobotInterface: () => ({ id: 'robot-1', status: 'idle' }),
    getVLAModelVersion: () => null,
    updateServerHeartbeat: (): void => {},
    getTelemetry: () => ({
      jointStates: Array.from({ length: 6 }, (_, i) => ({
        name: `j${i}`,
        position: 0,
        velocity: 0,
        effort: 0,
        temperature: 25,
        current: 0,
      })),
    }),
  } as unknown as RobotStateManager;
}

/**
 * A vla-server on `VLA_BASE`, with everything else passed through to the real
 * `fetch` — the test's own calls to the agent, and the agent's POST to the
 * platform recorder, both have to keep working.
 */
function stubVlaServer(chunkSize: number, delayMs: number): void {
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    if (!url.startsWith(VLA_BASE)) return realFetch(input as Parameters<typeof fetch>[0], init);
    if (url.endsWith('/config')) {
      return new Response(
        JSON.stringify({ cameras: ['front'], state_dim: 6, chunk_size: chunkSize }),
        { status: 200 },
      );
    }
    if (url.endsWith('/reset')) return new Response('{}', { status: 200 });
    if (url.endsWith('/predict')) {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      return new Response(
        JSON.stringify({
          actions: Array.from({ length: chunkSize }, () => Array.from({ length: 6 }, () => 0)),
        }),
        { status: 200 },
      );
    }
    throw new Error(`Unexpected URL: ${url}`);
  }) as unknown as typeof fetch);
}

describe('RTC counters on the wire (TASK-183)', () => {
  let agent: Server;
  let platform: Server;
  let base: string;
  let platformBase: string;
  /** Bodies the agent POSTed to the platform's /api/evaluation/episodes. */
  let episodes: Array<Record<string, unknown>>;
  const rtcDefaults = { ...config.vla.rtc };

  beforeEach(async () => {
    process.env.VLA_SERVER_URL = VLA_BASE;
    episodes = [];
    // Sim mode: no sidecar, so no camera or arm to capture from.
    vi.spyOn(hardwareClient, 'isAvailable').mockReturnValue(false);

    const app = express();
    app.use(express.json());
    app.use(createRestRoutes(makeStateStub()));
    await new Promise<void>((resolve) => {
      agent = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(agent.address() as AddressInfo).port}`;

    // Stand-in for the NeoDEM server, recording exactly what it is sent.
    const platformApp = express();
    platformApp.use(express.json());
    platformApp.post('/api/evaluation/episodes', (req, res) => {
      episodes.push(req.body as Record<string, unknown>);
      res.status(201).json({ id: 'ep-1' });
    });
    await new Promise<void>((resolve) => {
      platform = platformApp.listen(0, () => resolve());
    });
    platformBase = `http://127.0.0.1:${(platform.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    // `config` is read per run, so a run-scoped override has to be undone.
    Object.assign(config.vla.rtc, rtcDefaults);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await new Promise<void>((resolve) => agent.close(() => resolve()));
    await new Promise<void>((resolve) => platform.close(() => resolve()));
  });

  async function runEvaluation(): Promise<Response> {
    return fetch(`${base}/robots/robot-1/evaluation/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skillId: 'skill-eval',
        taskPrompt: 'wave',
        episodes: 1,
        maxStepsPerEpisode: 4,
        serverBaseUrl: platformBase,
      }),
    });
  }

  async function executeSkill(): Promise<Response> {
    return fetch(`${base}/robots/robot-1/skills/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId: 'skill-1', taskPrompt: 'wave', maxSteps: 4 }),
    });
  }

  it('sends the platform exactly the pre-TASK-183 metadata when RTC is off', async () => {
    expect(config.vla.rtc.enabled).toBe(false);
    stubVlaServer(2, 10);

    expect((await runEvaluation()).status).toBe(200);
    expect(episodes).toHaveLength(1);
    // Asserted as the whole object: the defect was an extra key on a payload
    // stored against every evaluation episode the fleet has ever run, so a
    // partial match would not have caught it.
    expect(episodes[0].metadata).toEqual({
      steps: 4,
      episodeIndex: 0,
      skillId: 'skill-eval',
    });
  }, 20_000);

  it('leaves both /skills/execute response bodies without an rtc key when RTC is off', async () => {
    stubVlaServer(2, 10);

    const ok = await executeSkill();
    expect(ok.status).toBe(200);
    const okJson = (await ok.json()) as { output: Record<string, unknown> };
    expect('rtc' in okJson.output).toBe(false);

    // The failure body is the other place it leaked. A 4xx from /predict is
    // deterministic, so the run fails on the first one.
    vi.unstubAllGlobals();
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (async (input: unknown, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input);
      if (!url.startsWith(VLA_BASE)) return realFetch(input as Parameters<typeof fetch>[0], init);
      if (url.endsWith('/config')) {
        return new Response(
          JSON.stringify({ cameras: ['front'], state_dim: 6, chunk_size: 2 }),
          { status: 200 },
        );
      }
      if (url.endsWith('/reset')) return new Response('{}', { status: 200 });
      return new Response(JSON.stringify({ detail: 'bad request' }), { status: 422 });
    }) as unknown as typeof fetch);

    const bad = await executeSkill();
    expect(bad.status).toBe(500);
    const badJson = (await bad.json()) as { output: Record<string, unknown> };
    expect(badJson.output).toEqual({ steps: 0, durationMs: expect.any(Number) });
  }, 20_000);

  it('sends the counters once RTC actually ran', async () => {
    config.vla.rtc.enabled = true;
    config.vla.rtc.overlap = 0.5;
    config.vla.rtc.blendSteps = 1;
    stubVlaServer(2, 10);

    expect((await runEvaluation()).status).toBe(200);
    const metadata = episodes[0].metadata as Record<string, unknown>;
    expect(Object.keys(metadata).sort()).toEqual(['episodeIndex', 'rtc', 'skillId', 'steps']);
    // Present and real — the boundary was carried by a prefetch, not a stall.
    expect(metadata.rtc).toMatchObject({ prefetchMerged: expect.any(Number), stalledTransitions: 0 });
  }, 20_000);
});
