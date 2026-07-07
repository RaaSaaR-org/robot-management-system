/**
 * @file rollout-strategies.test.ts
 * @description Tests for the TASK-179 rollout strategies layered on the
 * SkillExecutor closed loop: strategy plumbing into result metadata, sentry
 * sidecar recording (hardware + sim no-op + read-only refusal), highlight
 * ring-buffer bounding and incident/clip reporting (HTTP mocked), and dagger
 * human/policy step tagging with a fake teleop-active state.
 * @feature vla
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { SkillExecutor, HighlightRing } from '../skill-executor.js';
import { hardwareClient } from '../../hardware/HardwareClient.js';

const SERVER = 'http://server.test';

function makeFakeFetch(
  impl: (url: string, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    return impl(url, init);
  }) as unknown as typeof fetch;
}

const TEST_JOINTS = Array.from({ length: 6 }, (_, i) => ({
  name: `j${i}`,
  axis: 'z',
  limitLower: -3,
  limitUpper: 3,
  defaultPosition: 0,
}));

function makeStateManager(overrides: Record<string, unknown> = {}) {
  return {
    getTelemetry: () => ({
      jointStates: TEST_JOINTS.map((j) => ({
        name: j.name,
        position: 0,
        velocity: 0,
        effort: 0,
        temperature: 0,
        current: 0,
      })),
    }),
    isTeleopActive: () => false,
    getTeleopPositions: () => ({}),
    getActiveJointConfig: () => TEST_JOINTS,
    ...overrides,
  } as unknown as import('../../robot/state.js').RobotStateManager;
}

const CONFIG_BODY = { cameras: ['front'], state_dim: 6, chunk_size: 4 };

const PREDICT_BODY = {
  actions: [
    [0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
    [0.2, 0.2, 0.2, 0.2, 0.2, 0.2],
    [0.3, 0.3, 0.3, 0.3, 0.3, 0.3],
    [0.4, 0.4, 0.4, 0.4, 0.4, 0.4],
  ],
};

/** vla-server endpoints all strategies need; unknown URLs throw. */
function vlaOnlyFetch(extra?: (url: string, init?: RequestInit) => Response | undefined): typeof fetch {
  return makeFakeFetch(async (url, init) => {
    if (url.endsWith('/config')) return new Response(JSON.stringify(CONFIG_BODY), { status: 200 });
    if (url.endsWith('/reset')) return new Response('{}', { status: 200 });
    if (url.endsWith('/predict')) return new Response(JSON.stringify(PREDICT_BODY), { status: 200 });
    const handled = extra?.(url, init);
    if (handled) return handled;
    throw new Error(`Unexpected URL: ${url}`);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── HighlightRing bounding ─────────────────────────────────────────────

describe('HighlightRing', () => {
  it('bounds the buffer to its capacity, keeping the newest frames', () => {
    const ring = new HighlightRing(75);
    for (let i = 0; i < 100; i++) {
      ring.push({ t: i, camera: 'front', jpegB64: `frame-${i}` });
    }
    expect(ring.size).toBe(75);
    expect(ring.frames[0].t).toBe(25); // oldest 25 evicted
    expect(ring.frames[74].t).toBe(99);
  });
});

// ─── Strategy plumbing ──────────────────────────────────────────────────

describe('rollout strategy plumbing', () => {
  beforeEach(() => {
    process.env.VLA_SERVER_URL = 'http://localhost:8000';
    vi.spyOn(hardwareClient, 'isAvailable').mockReturnValue(false);
  });

  it("default strategy attaches no rollout metadata (zero regression)", async () => {
    const exec = new SkillExecutor(makeStateManager(), vlaOnlyFetch());
    const result = await exec.run({
      skillId: 'skill-default',
      taskPrompt: 'wave',
      maxSteps: 100,
      timeoutMs: 30_000,
    });
    expect(result.status).toBe('completed');
    expect(result.rollout).toBeUndefined();
  });

  it('non-default strategy is echoed in result.rollout.strategy', async () => {
    const exec = new SkillExecutor(makeStateManager(), vlaOnlyFetch());
    const result = await exec.run({
      skillId: 'skill-sentry-sim',
      taskPrompt: 'wave',
      maxSteps: 100,
      timeoutMs: 30_000,
      rolloutStrategy: 'sentry',
    });
    expect(result.rollout?.strategy).toBe('sentry');
  });
});

// ─── sentry ─────────────────────────────────────────────────────────────

describe('sentry strategy', () => {
  beforeEach(() => {
    process.env.VLA_SERVER_URL = 'http://localhost:8000';
  });

  it('sim mode: no-op with a note, no sidecar recording calls', async () => {
    vi.spyOn(hardwareClient, 'isAvailable').mockReturnValue(false);
    const startSpy = vi.spyOn(hardwareClient, 'startRecording');
    const stopSpy = vi.spyOn(hardwareClient, 'stopRecording');

    const exec = new SkillExecutor(makeStateManager(), vlaOnlyFetch());
    const result = await exec.run({
      skillId: 'skill-sentry-sim',
      taskPrompt: 'wave',
      maxSteps: 100,
      timeoutMs: 30_000,
      rolloutStrategy: 'sentry',
    });

    expect(result.status).toBe('completed');
    expect(startSpy).not.toHaveBeenCalled();
    expect(stopSpy).not.toHaveBeenCalled();
    expect(result.rollout?.recording).toBeUndefined();
    expect(result.rollout?.notes?.join(' ')).toMatch(/sim mode.*skipped/);
  });

  it('hardware mode: starts recording before the loop, stops after', async () => {
    vi.spyOn(hardwareClient, 'isAvailable').mockReturnValue(true);
    vi.spyOn(hardwareClient, 'getCameras').mockResolvedValue(['wrist']);
    vi.spyOn(hardwareClient, 'snapshot').mockResolvedValue('fake-jpeg-b64');
    vi.spyOn(hardwareClient, 'getStateNow').mockResolvedValue([0, 0, 0, 0, 0, 0]);
    vi.spyOn(hardwareClient, 'sendActionVector').mockResolvedValue();
    const startSpy = vi
      .spyOn(hardwareClient, 'startRecording')
      .mockResolvedValue({ ok: true, repoId: 'x', datasetPath: '/data/x' });
    const stopSpy = vi
      .spyOn(hardwareClient, 'stopRecording')
      .mockResolvedValue({ ok: true, episodesRecorded: 1, datasetPath: '/data/x', exitCode: 0 });

    const exec = new SkillExecutor(makeStateManager(), vlaOnlyFetch());
    const result = await exec.run({
      skillId: 'skill-sentry-hw',
      taskPrompt: 'pick up the cube',
      maxSteps: 2,
      timeoutMs: 10_000,
      rolloutStrategy: 'sentry',
    });

    expect(result.status).toBe('completed');
    expect(startSpy).toHaveBeenCalledTimes(1);
    const startOpts = startSpy.mock.calls[0][0];
    expect(startOpts.repoId).toMatch(/^sentry\/skill-sentry-hw-\d+$/);
    expect(startOpts.task).toBe('pick up the cube');
    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(result.rollout?.recording).toEqual({
      repoId: expect.stringMatching(/^sentry\/skill-sentry-hw-\d+$/),
      status: 'recorded',
    });
  });

  it('hardware mode: read-only sidecar (403) — rollout continues un-recorded', async () => {
    vi.spyOn(hardwareClient, 'isAvailable').mockReturnValue(true);
    vi.spyOn(hardwareClient, 'getCameras').mockResolvedValue(['wrist']);
    vi.spyOn(hardwareClient, 'snapshot').mockResolvedValue('fake-jpeg-b64');
    vi.spyOn(hardwareClient, 'getStateNow').mockResolvedValue([0, 0, 0, 0, 0, 0]);
    vi.spyOn(hardwareClient, 'sendActionVector').mockResolvedValue();
    vi.spyOn(hardwareClient, 'startRecording').mockResolvedValue({
      ok: false,
      readOnly: true,
      error: 'G1_READ_ONLY — recording disabled',
    });
    const stopSpy = vi.spyOn(hardwareClient, 'stopRecording');

    const exec = new SkillExecutor(makeStateManager(), vlaOnlyFetch());
    const result = await exec.run({
      skillId: 'skill-sentry-ro',
      taskPrompt: 'wave',
      maxSteps: 1,
      timeoutMs: 10_000,
      rolloutStrategy: 'sentry',
    });

    expect(result.status).toBe('completed');
    expect(stopSpy).not.toHaveBeenCalled();
    expect(result.rollout?.recording?.status).toBe('skipped');
    expect(result.rollout?.notes?.join(' ')).toMatch(/un-recorded/);
  });
});

// ─── highlight ──────────────────────────────────────────────────────────

describe('highlight strategy', () => {
  beforeEach(() => {
    process.env.VLA_SERVER_URL = 'http://localhost:8000';
  });

  it('hardware failure: creates an incident and uploads the frame clip', async () => {
    vi.spyOn(hardwareClient, 'isAvailable').mockReturnValue(true);
    vi.spyOn(hardwareClient, 'getCameras').mockResolvedValue(['wrist']);
    vi.spyOn(hardwareClient, 'snapshot').mockResolvedValue('fake-jpeg-b64');
    vi.spyOn(hardwareClient, 'getStateNow').mockResolvedValue([0, 0, 0, 0, 0, 0]);

    let incidentBody: Record<string, unknown> | null = null;
    let clipBody: Record<string, unknown> | null = null;
    const fakeFetch = makeFakeFetch(async (url, init) => {
      if (url.endsWith('/config')) return new Response(JSON.stringify(CONFIG_BODY), { status: 200 });
      if (url.endsWith('/reset')) return new Response('{}', { status: 200 });
      if (url.endsWith('/predict')) {
        // 422 = deterministic client error → immediate terminal failure.
        return new Response(JSON.stringify({ detail: 'bad camera' }), { status: 422 });
      }
      if (url === `${SERVER}/api/incidents` && init?.method === 'POST') {
        incidentBody = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ id: 'inc-123' }), { status: 201 });
      }
      if (url === `${SERVER}/api/incidents/inc-123/clip` && init?.method === 'PUT') {
        clipBody = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ status: 'ok', clipKey: 'incidents/inc-123/clip.json' }), {
          status: 200,
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const exec = new SkillExecutor(makeStateManager(), fakeFetch);
    const result = await exec.run({
      skillId: 'skill-hl-hw',
      taskPrompt: 'stack the blocks',
      maxSteps: 10,
      timeoutMs: 10_000,
      rolloutStrategy: 'highlight',
      robotId: 'robot-xyz',
      serverBaseUrl: SERVER,
    });

    expect(result.status).toBe('failed');
    expect(result.rollout?.incidentId).toBe('inc-123');

    // Incident create DTO shape (server/src/types/incident.types.ts).
    expect(incidentBody).toMatchObject({
      type: 'ai_malfunction',
      severity: 'medium',
      robotId: 'robot-xyz',
    });
    expect(incidentBody!.title).toMatch(/skill-hl-hw/);
    expect(incidentBody!.description).toMatch(/stack the blocks/);

    // Clip payload shape (contract §6).
    expect(clipBody).toMatchObject({ format: 'jpeg-frames' });
    expect(typeof clipBody!.fps).toBe('number');
    expect(typeof clipBody!.capturedAt).toBe('string');
    expect(clipBody!.frames).toEqual(['fake-jpeg-b64']);
  });

  it('sim failure: creates the incident but skips the clip upload', async () => {
    vi.spyOn(hardwareClient, 'isAvailable').mockReturnValue(false);

    let clipPutSeen = false;
    const fakeFetch = makeFakeFetch(async (url, init) => {
      if (url.endsWith('/config')) return new Response(JSON.stringify(CONFIG_BODY), { status: 200 });
      if (url.endsWith('/reset')) return new Response('{}', { status: 200 });
      if (url.endsWith('/predict')) {
        return new Response(JSON.stringify({ detail: 'model error' }), { status: 422 });
      }
      if (url === `${SERVER}/api/incidents` && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'inc-sim' }), { status: 201 });
      }
      if (url.includes('/clip')) {
        clipPutSeen = true;
        return new Response('{}', { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const exec = new SkillExecutor(makeStateManager(), fakeFetch);
    const result = await exec.run({
      skillId: 'skill-hl-sim',
      taskPrompt: 'wave',
      maxSteps: 10,
      timeoutMs: 10_000,
      rolloutStrategy: 'highlight',
      robotId: 'robot-sim',
      serverBaseUrl: SERVER,
    });

    expect(result.status).toBe('failed');
    expect(result.rollout?.incidentId).toBe('inc-sim');
    expect(clipPutSeen).toBe(false);
    expect(result.rollout?.notes?.join(' ')).toMatch(/without clip/);
  });

  it('incident POST failure is best-effort — result survives', async () => {
    vi.spyOn(hardwareClient, 'isAvailable').mockReturnValue(false);

    const fakeFetch = makeFakeFetch(async (url) => {
      if (url.endsWith('/config')) return new Response(JSON.stringify(CONFIG_BODY), { status: 200 });
      if (url.endsWith('/reset')) return new Response('{}', { status: 200 });
      if (url.endsWith('/predict')) {
        return new Response(JSON.stringify({ detail: 'model error' }), { status: 422 });
      }
      if (url.includes('/api/incidents')) throw new TypeError('fetch failed');
      throw new Error(`Unexpected URL: ${url}`);
    });

    const exec = new SkillExecutor(makeStateManager(), fakeFetch);
    const result = await exec.run({
      skillId: 'skill-hl-down',
      taskPrompt: 'wave',
      maxSteps: 10,
      timeoutMs: 10_000,
      rolloutStrategy: 'highlight',
      serverBaseUrl: SERVER,
    });

    expect(result.status).toBe('failed');
    expect(result.rollout?.incidentId).toBeUndefined();
    expect(result.rollout?.notes?.join(' ')).toMatch(/incident POST failed/);
  });
});

// ─── dagger ─────────────────────────────────────────────────────────────

describe('dagger strategy', () => {
  beforeEach(() => {
    process.env.VLA_SERVER_URL = 'http://localhost:8000';
    vi.spyOn(hardwareClient, 'isAvailable').mockReturnValue(false);
  });

  it('teleop-active steps pre-empt the policy, are tagged human, and the trace is POSTed', async () => {
    // Teleop active for the first 2 steps, then released.
    let teleopChecks = 0;
    const stateManager = makeStateManager({
      isTeleopActive: () => {
        teleopChecks += 1;
        return teleopChecks <= 2;
      },
      getTeleopPositions: () => ({ j0: 0.5, j1: 0.5, j2: 0.5, j3: 0.5, j4: 0.5, j5: 0.5 }),
    });

    let interventionBody: Record<string, unknown> | null = null;
    const fakeFetch = vlaOnlyFetch((url, init) => {
      if (url === `${SERVER}/api/datasets/interventions` && init?.method === 'POST') {
        interventionBody = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ id: 'int-1' }), { status: 201 });
      }
      return undefined;
    });

    const emitter = new EventEmitter();
    const stepEvents: Array<{ source?: string }> = [];
    emitter.on('skill:step', (e) => stepEvents.push(e));

    const exec = new SkillExecutor(stateManager, fakeFetch);
    const result = await exec.run({
      skillId: 'skill-dagger',
      taskPrompt: 'sort the parts',
      maxSteps: 4,
      timeoutMs: 30_000,
      rolloutStrategy: 'dagger',
      robotId: 'robot-dg',
      serverBaseUrl: SERVER,
      emitter,
    });

    expect(result.status).toBe('completed');
    expect(result.steps).toBe(4);
    expect(result.rollout?.strategy).toBe('dagger');
    expect(result.rollout?.interventionSteps).toBe(2);

    // Contract §7 wire shape.
    expect(interventionBody).toMatchObject({
      robotId: 'robot-dg',
      skillId: 'skill-dagger',
      taskPrompt: 'sort the parts',
      strategy: 'dagger',
    });
    expect(typeof interventionBody!.startedAt).toBe('string');
    expect(typeof interventionBody!.endedAt).toBe('string');

    const steps = interventionBody!.steps as Array<{
      t: number;
      source: string;
      action: number[];
    }>;
    expect(steps).toHaveLength(4);
    // First two steps: human, teleop pose pre-empts the VLA action.
    expect(steps[0].source).toBe('human');
    expect(steps[0].action).toEqual([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    expect(steps[1].source).toBe('human');
    // Remaining steps: policy actions from /predict pass through untouched.
    expect(steps[2].source).toBe('policy');
    expect(steps[2].action).toEqual([0.3, 0.3, 0.3, 0.3, 0.3, 0.3]);
    expect(steps[3].source).toBe('policy');
    expect(steps.every((s) => typeof s.t === 'number')).toBe(true);

    // skill:step events carry the source tag.
    expect(stepEvents.map((e) => e.source)).toEqual(['human', 'human', 'policy', 'policy']);
  });

  it('intervention POST failure is best-effort — result survives', async () => {
    const stateManager = makeStateManager({ isTeleopActive: () => true, getTeleopPositions: () => ({ j0: 1 }) });
    const fakeFetch = vlaOnlyFetch((url) => {
      if (url.includes('/api/datasets/interventions')) {
        return new Response('{}', { status: 500 });
      }
      return undefined;
    });

    const exec = new SkillExecutor(stateManager, fakeFetch);
    const result = await exec.run({
      skillId: 'skill-dagger-down',
      taskPrompt: 'wave',
      maxSteps: 1,
      timeoutMs: 10_000,
      rolloutStrategy: 'dagger',
      serverBaseUrl: SERVER,
    });

    expect(result.status).toBe('completed');
    expect(result.rollout?.interventionSteps).toBe(1);
    expect(result.rollout?.notes?.join(' ')).toMatch(/intervention POST failed/);
  });
});
