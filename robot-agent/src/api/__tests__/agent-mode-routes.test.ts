/**
 * @file agent-mode-routes.test.ts
 * @description Drives the `/api/v1/robots/:id/agent-mode/...` contract surface
 *              over real HTTP on an ephemeral port, with the Agent Mode
 *              controller singleton mocked, and checks that a VLA start is
 *              refused while Agent Mode owns control.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { AgentMemoryDigest, AgentModeState, SceneMemory } from '../../agent-mode/types.js';

const STATE: AgentModeState = {
  robotId: 'robot-1',
  enabled: true,
  controlOwner: 'idle',
  plan: null,
  scene: null,
  estopActive: false,
};

const SCENE: SceneMemory = {
  robotId: 'robot-1',
  currentView: 'a table',
  entities: [
    {
      label: 'table',
      bearingDeg: 30,
      distanceEstM: 2,
      // A measured range, so the fixture exercises the provenance the routes
      // now have to carry through untouched.
      distanceSource: 'lidar',
      confidence: 0.9,
      observedSeq: 1,
      lastSeen: '2026-07-25T10:00:00.000Z',
    },
  ],
  personVisible: false,
  forwardClearanceM: 1.8,
  updatedAt: '2026-07-25T10:00:00.000Z',
};

const MEMORY_DIGEST: AgentMemoryDigest = {
  robotId: 'robot-1',
  place: 'AISLE-3',
  memoryBytes: 64,
  memoryMaxBytes: 8192,
  memoryEntries: 1,
  places: [{ id: 'AISLE-3', entries: 2, bytes: 120 }],
  journalDays: ['2026-08-02'],
  retention: { retentionDays: 365, source: 'policy', legalHold: false },
  updatedAt: '2026-08-02T10:00:00.000Z',
};

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  setEnabled: vi.fn(),
  submitCommand: vi.fn(),
  estop: vi.fn(),
  resetEstop: vi.fn(),
  getScene: vi.fn(),
  sceneMarkdown: vi.fn(),
  memoryDigest: vi.fn(),
  memoryMarkdown: vi.fn(),
  eraseMemory: vi.fn(),
  standingIntents: vi.fn(),
  identitySnapshot: vi.fn(),
  identityProblem: vi.fn(),
  selfState: vi.fn(),
  selfReport: vi.fn(),
  bodyMarkdown: vi.fn(),
  writeIdentity: vi.fn(),
}));

vi.mock('../../agent-mode/agent-mode-controller.js', () => ({
  agentModeController: mocks,
}));

/**
 * The DELETE /memory handler drops the in-process ID card after erasure. Mocked
 * so a route test never reaches this developer box's real
 * `data/workspace-<robotId>/IDENTITY.md`.
 */
const identityMocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('../../agent-mode/identity.js', () => ({
  getIdentityStore: () => identityMocks,
}));

vi.mock('../../vla/skill-executor.js', () => ({
  SkillExecutor: class {
    run = vi.fn();
    abort(): void {}
    isAborted(): boolean {
      return false;
    }
  },
  skillExecutorRegistry: {
    register: (): void => {},
    unregister: (): void => {},
    abort: (): boolean => false,
    abortAll: (): number => 0,
  },
}));

import cors from 'cors';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRestRoutes, MEMORY_TOKEN_ENV, isLoopbackAddress } from '../rest-routes.js';
import { IntentStore } from '../../agent-mode/intents.js';
import { Workspace } from '../../agent-mode/workspace.js';
import { controlOwnerLock } from '../../agent-mode/control-owner.js';
import { ControlBusyError } from '../../robot/state.js';
import type { RobotStateManager } from '../../robot/state.js';

const ESTOP_STATE = { status: 'triggered', triggeredBy: 'remote', reason: 'Remote E-stop triggered' };

/**
 * Mirrors the real RobotStateManager's VLA lock lifecycle (claim inside
 * startVLAControl, release inside stopVLAControl / on run completion) so the
 * route tests exercise the routes, not a lock policy of their own. The
 * lifecycle itself is covered against the real manager in
 * `robot/__tests__/state-vla-control.test.ts`.
 */
function makeStateStub(): RobotStateManager & {
  triggerEmergencyStop: ReturnType<typeof vi.fn>;
  finishVlaRun: () => void;
} {
  let vlaActive = false;
  return {
    getRobotInterface: () => ({ id: 'robot-1', status: 'idle' }),
    updateServerHeartbeat: (): void => {},
    startVLAControl: async (): Promise<void> => {
      if (vlaActive) throw new Error('VLA control is already active');
      const claim = controlOwnerLock.claim('vla');
      if (!claim.ok) throw new ControlBusyError(claim.reason ?? 'control is busy.');
      vlaActive = true;
    },
    stopVLAControl: async (): Promise<void> => {
      vlaActive = false;
      controlOwnerLock.release('vla');
    },
    /** Simulates a rollout that ends on its own (max steps / timeout / no server). */
    finishVlaRun: (): void => {
      vlaActive = false;
      controlOwnerLock.release('vla');
    },
    isVLAActive: () => vlaActive,
    getVLAStatus: () => ({}),
    triggerEmergencyStop: vi.fn(),
    getEStopState: () => ESTOP_STATE,
  } as unknown as RobotStateManager & {
    triggerEmergencyStop: ReturnType<typeof vi.fn>;
    finishVlaRun: () => void;
  };
}

describe('Agent Mode REST contract', () => {
  let server: Server;
  let base: string;
  let state: ReturnType<typeof makeStateStub>;
  /**
   * The REAL intent store on a temp workspace, not a stub: the finding is that
   * `IntentStore.arm()` had no production caller, so a test that stubs the store
   * would assert the stub rather than the arming path.
   */
  let intentRoot: string;
  let intents: IntentStore;

  beforeEach(async () => {
    for (const fn of Object.values(mocks)) fn.mockReset();
    mocks.getState.mockReturnValue(STATE);
    mocks.setEnabled.mockReturnValue({ ...STATE, enabled: false });
    mocks.submitCommand.mockResolvedValue({
      accepted: true,
      planId: 'plan-1',
      message: 'Planning…',
    });
    mocks.estop.mockResolvedValue({ ok: true, stopped: true, delivered: true });
    mocks.resetEstop.mockReturnValue(STATE);
    mocks.getScene.mockReturnValue(SCENE);
    mocks.sceneMarkdown.mockReturnValue('# Current view\n\n- **Robot**: robot-1\n');
    mocks.memoryDigest.mockReturnValue(MEMORY_DIGEST);
    mocks.memoryMarkdown.mockReturnValue('# Memory\n\n- 2026-08-02 (self) a fact\n');
    mocks.eraseMemory.mockReturnValue({ ok: true, removed: 3, errors: [] });
    // The ID card carries `Operator` and `Site` — the two labels an Art. 17
    // erasure blanks — which is why its routes sit behind the same gate.
    mocks.identitySnapshot.mockReturnValue({
      name: 'Nova',
      emoji: '🤖',
      operator: 'Sebastian Heusser',
      site: 'Halle 3, Zürich',
    });
    mocks.identityProblem.mockReturnValue(null);
    mocks.selfState.mockReturnValue({ robotId: 'robot-1' });
    mocks.selfReport.mockReturnValue('I am Nova.');
    mocks.bodyMarkdown.mockReturnValue('# Body\n\n- 43 joints\n');
    mocks.writeIdentity.mockReturnValue({ ok: true, identity: { name: 'Renamed' } });
    intentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'neodem-intents-'));
    intents = new IntentStore({ workspace: new Workspace({ root: intentRoot }) });
    mocks.standingIntents.mockReturnValue(intents);
    identityMocks.load.mockReset();
    controlOwnerLock.reset();

    state = makeStateStub();
    const app = express();
    // The real agent mounts `cors()` with no origin restriction (index.ts), so
    // the personal-data gate is only meaningful when the test app has it too.
    app.use(cors());
    app.use(express.json());
    app.use('/api/v1', createRestRoutes(state));
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  });

  afterEach(async () => {
    controlOwnerLock.reset();
    vi.unstubAllEnvs();
    fs.rmSync(intentRoot, { recursive: true, force: true });
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('GET /robots/:id/agent-mode returns the AgentModeState', async () => {
    const res = await fetch(`${base}/robots/robot-1/agent-mode`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(STATE);
  });

  it('404s for a robot this agent does not serve', async () => {
    const res = await fetch(`${base}/robots/other/agent-mode`);

    expect(res.status).toBe(404);
    expect(mocks.getState).not.toHaveBeenCalled();
  });

  it('POST /toggle requires a boolean and forwards it', async () => {
    const bad = await fetch(`${base}/robots/robot-1/agent-mode/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: 'yes' }),
    });
    expect(bad.status).toBe(400);
    expect(mocks.setEnabled).not.toHaveBeenCalled();

    const ok = await fetch(`${base}/robots/robot-1/agent-mode/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(ok.status).toBe(200);
    expect(mocks.setEnabled).toHaveBeenCalledWith(false);
  });

  it('POST /command forwards text + contextId and returns the command result', async () => {
    const res = await fetch(`${base}/robots/robot-1/agent-mode/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'geh zum Tisch', contextId: 'ctx-9' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: true, planId: 'plan-1', message: 'Planning…' });
    expect(mocks.submitCommand).toHaveBeenCalledWith({ text: 'geh zum Tisch', contextId: 'ctx-9' });
  });

  it('POST /command rejects an empty body with 400', async () => {
    const res = await fetch(`${base}/robots/robot-1/agent-mode/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '   ' }),
    });

    expect(res.status).toBe(400);
    expect(mocks.submitCommand).not.toHaveBeenCalled();
  });

  it('answers 200 with accepted:false when the controller refuses', async () => {
    mocks.submitCommand.mockResolvedValue({ accepted: false, message: 'Agent Mode is off' });

    const res = await fetch(`${base}/robots/robot-1/agent-mode/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'lauf' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: false, message: 'Agent Mode is off' });
  });

  it('POST /estop uses the given reason and defaults sensibly', async () => {
    const res = await fetch(`${base}/robots/robot-1/agent-mode/estop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'operator hit STOPP' }),
    });
    expect(await res.json()).toEqual({ ok: true, stopped: true, delivered: true });
    expect(mocks.estop).toHaveBeenCalledWith('operator hit STOPP');

    await fetch(`${base}/robots/robot-1/agent-mode/estop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(mocks.estop).toHaveBeenLastCalledWith('Manual E-Stop from the operator UI');
  });

  it('POST /estop/reset returns the fresh state', async () => {
    const res = await fetch(`${base}/robots/robot-1/agent-mode/estop/reset`, { method: 'POST' });

    expect(res.status).toBe(200);
    expect(mocks.resetEstop).toHaveBeenCalled();
  });

  it('GET /scene and /scene.md serve the two scene representations', async () => {
    const json = await fetch(`${base}/robots/robot-1/agent-mode/scene`);
    expect(await json.json()).toEqual(SCENE);

    const md = await fetch(`${base}/robots/robot-1/agent-mode/scene.md`);
    expect(md.headers.get('content-type')).toMatch(/text\/markdown/);
    expect(await md.text()).toContain('# Current view');
  });

  it('GET /scene returns null before the first observation', async () => {
    mocks.getScene.mockReturnValue(null);

    const res = await fetch(`${base}/robots/robot-1/agent-mode/scene`);

    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  // ── durable memory (TASK-197) ─────────────────────────────────────────────

  it('GET /memory and /memory.md serve the digest and the file', async () => {
    const json = await fetch(`${base}/robots/robot-1/memory`);
    expect(json.status).toBe(200);
    expect(await json.json()).toEqual(MEMORY_DIGEST);

    const md = await fetch(`${base}/robots/robot-1/memory.md`);
    expect(md.headers.get('content-type')).toMatch(/text\/markdown/);
    expect(await md.text()).toContain('a fact');
  });

  it('GET /memory 404s when the agent has no workspace at all', async () => {
    // Not an empty digest: "no memory workspace" and "remembers nothing" are
    // different answers, and only one is a fact about the robot's experience.
    mocks.memoryDigest.mockReturnValue(null);

    const res = await fetch(`${base}/robots/robot-1/memory`);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'NO_MEMORY_WORKSPACE' });
  });

  it('DELETE /memory erases the workspace (GDPR Art. 17)', async () => {
    const res = await fetch(`${base}/robots/robot-1/memory`, { method: 'DELETE' });

    expect(res.status).toBe(200);
    expect(mocks.eraseMemory).toHaveBeenCalledOnce();
    expect(await res.json()).toEqual({ ok: true, removed: 3, errors: [] });
  });

  it('DELETE /memory reports a partial erasure as a failure', async () => {
    // An erasure that claims success while a note survives is the one answer a
    // data-subject request must never get.
    mocks.eraseMemory.mockReturnValue({ ok: false, removed: 1, errors: ['EPERM'] });

    const res = await fetch(`${base}/robots/robot-1/memory`, { method: 'DELETE' });

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, errors: ['EPERM'] });
  });

  it('DELETE /memory refuses a robot id this agent does not serve', async () => {
    const res = await fetch(`${base}/robots/someone-else/memory`, { method: 'DELETE' });

    expect(res.status).toBe(404);
    expect(mocks.eraseMemory).not.toHaveBeenCalled();
  });

  it('DELETE /memory drops the in-process ID card too', async () => {
    // The card was redacted on disk; the copy this process holds in memory has
    // to go with it, or the very next GET /identity answers with the operator's
    // name that was just erased.
    await fetch(`${base}/robots/robot-1/memory`, { method: 'DELETE' });

    expect(identityMocks.load).toHaveBeenCalledOnce();
  });

  // ── the personal-data gate ────────────────────────────────────────────────

  it('refuses a cross-origin read of MEMORY.md', async () => {
    // The finding, exactly: `app.use(cors())` with no origin restriction means
    // any page on the network can `fetch` the robot's durable memory.
    const res = await fetch(`${base}/robots/robot-1/memory.md`, {
      headers: { Origin: 'http://attacker.example' },
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'CROSS_ORIGIN_FORBIDDEN' });
    expect(mocks.memoryMarkdown).not.toHaveBeenCalled();
  });

  it('refuses a cross-origin DELETE — memory is destroyed, not just read', async () => {
    const res = await fetch(`${base}/robots/robot-1/memory`, {
      method: 'DELETE',
      headers: { Origin: 'http://attacker.example' },
    });

    expect(res.status).toBe(403);
    expect(mocks.eraseMemory).not.toHaveBeenCalled();
  });

  it('strips the wildcard Access-Control-Allow-Origin from every memory response', async () => {
    const md = await fetch(`${base}/robots/robot-1/memory.md`);
    const digest = await fetch(`${base}/robots/robot-1/memory`);

    // `cors()` put `*` on these; a browser must not be able to read personal
    // data off the robot whatever page it was served from.
    expect(md.status).toBe(200);
    expect(md.headers.get('access-control-allow-origin')).toBeNull();
    expect(md.headers.get('vary')).toContain('Origin');
    expect(digest.headers.get('access-control-allow-origin')).toBeNull();
    // …while the CONTROL verbs keep the agent's pre-existing behaviour. An
    // E-Stop that needs a bearer token is a worse failure than an ungated one,
    // so the open/gated line is drawn at "does this response carry personal
    // data", not at "is this an Agent Mode route". `GET /agent-mode` moved to
    // the gated side (it embeds `plan.command` and the scene captions).
    const open = await fetch(`${base}/robots/robot-1/agent-mode/toggle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(open.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('requires the shared secret when one is configured', async () => {
    vi.stubEnv(MEMORY_TOKEN_ENV, 's3cret');

    const none = await fetch(`${base}/robots/robot-1/memory.md`);
    expect(none.status).toBe(401);
    expect(await none.json()).toMatchObject({ code: 'MEMORY_TOKEN_REQUIRED' });

    const wrong = await fetch(`${base}/robots/robot-1/memory.md`, {
      headers: { Authorization: 'Bearer s3cre7' },
    });
    expect(wrong.status).toBe(401);
    expect(mocks.memoryMarkdown).not.toHaveBeenCalled();

    const right = await fetch(`${base}/robots/robot-1/memory.md`, {
      headers: { Authorization: 'Bearer s3cret' },
    });
    expect(right.status).toBe(200);
    expect(await right.text()).toContain('a fact');
  });

  // ── the gate covers every route serving the SAME data category ────────────
  //
  // Round-2 review, still-broken finding: the gate was mounted on `/memory`,
  // `/memory.md` and `/agent-mode/intents` only, while `GET|POST /identity`
  // served `Operator` and `Site` — literally the two labels
  // `Workspace.IDENTITY_PERSONAL_LABELS` blanks on an Art. 17 wipe — and
  // `/agent-mode` + `/agent-mode/scene.md` served `plan.command` (the
  // operator's typed instruction) and the VLM captions of whoever is in front
  // of the robot. The reviewer's live probe read all of them cross-origin:
  //   GET /identity CROSS-ORIGIN: 200 ACAO= *
  //   GET /agent-mode/scene.md CROSS-ORIGIN: 200 ACAO= *

  const attacker = { Origin: 'http://attacker.example' };

  it('refuses a cross-origin read of the ID card (Operator + Site)', async () => {
    const res = await fetch(`${base}/robots/robot-1/identity`, { headers: attacker });

    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(await res.json()).toMatchObject({ code: 'CROSS_ORIGIN_FORBIDDEN' });
    // The names never left the process.
    expect(mocks.identitySnapshot).not.toHaveBeenCalled();
  });

  it('refuses a cross-origin WRITE of the ID card', async () => {
    // Ungated, an off-box page could rename the robot and rewrite its operator.
    const res = await fetch(`${base}/robots/robot-1/identity`, {
      method: 'POST',
      headers: { ...attacker, 'Content-Type': 'application/json' },
      body: JSON.stringify({ Name: 'Pwned', Operator: 'Someone Else' }),
    });

    expect(res.status).toBe(403);
    expect(mocks.writeIdentity).not.toHaveBeenCalled();
  });

  it('refuses a cross-origin read of BODY.md, under the same prefix', async () => {
    const res = await fetch(`${base}/robots/robot-1/identity/body.md`, { headers: attacker });

    expect(res.status).toBe(403);
    expect(mocks.bodyMarkdown).not.toHaveBeenCalled();
  });

  it('refuses a cross-origin read of the scene — captions of the people in it', async () => {
    const md = await fetch(`${base}/robots/robot-1/agent-mode/scene.md`, { headers: attacker });
    const json = await fetch(`${base}/robots/robot-1/agent-mode/scene`, { headers: attacker });

    expect(md.status).toBe(403);
    expect(json.status).toBe(403);
    expect(mocks.sceneMarkdown).not.toHaveBeenCalled();
    expect(mocks.getScene).not.toHaveBeenCalled();
  });

  it('refuses a cross-origin read of the state — it embeds plan.command', async () => {
    const res = await fetch(`${base}/robots/robot-1/agent-mode`, { headers: attacker });

    expect(res.status).toBe(403);
    expect(mocks.getState).not.toHaveBeenCalled();
  });

  it('strips the wildcard ACAO from the identity and scene responses too', async () => {
    const identity = await fetch(`${base}/robots/robot-1/identity`);
    const scene = await fetch(`${base}/robots/robot-1/agent-mode/scene.md`);
    const state = await fetch(`${base}/robots/robot-1/agent-mode`);

    for (const res of [identity, scene, state]) {
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
      expect(res.headers.get('vary')).toContain('Origin');
    }
    // …and the loopback caller still gets the real answer.
    expect(await identity.json()).toMatchObject({
      identity: { operator: 'Sebastian Heusser' },
    });
  });

  it('requires the shared secret on identity, like every other personal-data route', async () => {
    vi.stubEnv(MEMORY_TOKEN_ENV, 's3cret');

    const none = await fetch(`${base}/robots/robot-1/identity`);
    expect(none.status).toBe(401);
    expect(mocks.identitySnapshot).not.toHaveBeenCalled();

    const right = await fetch(`${base}/robots/robot-1/identity`, {
      headers: { Authorization: 'Bearer s3cret' },
    });
    expect(right.status).toBe(200);
  });

  it('POST /identity clears a label the operator explicitly nulled', async () => {
    // The one way to UNSET Operator or Site. The label was read with
    // `body[label] ?? body[label.toLowerCase()]`, so an explicit `null` fell
    // through to the absent lower-case key, came out `undefined` and was
    // skipped — the request answered 200 while the old value stayed on the card.
    const res = await fetch(`${base}/robots/robot-1/identity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Site: null }),
    });

    expect(res.status).toBe(200);
    expect(mocks.writeIdentity).toHaveBeenCalledWith({ Site: null });
  });

  it('POST /identity leaves untouched labels out of the patch entirely', async () => {
    await fetch(`${base}/robots/robot-1/identity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Name: 'Nova' }),
    });

    // Not `{Name: 'Nova', Site: null}`: a rename must not blank the site.
    expect(mocks.writeIdentity).toHaveBeenCalledWith({ Name: 'Nova' });
  });

  it('leaves the CONTROL verbs open — an E-Stop must never need a token', async () => {
    vi.stubEnv(MEMORY_TOKEN_ENV, 's3cret');

    const estop = await fetch(`${base}/robots/robot-1/agent-mode/estop`, {
      method: 'POST',
      headers: { ...attacker, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'someone shouted stop' }),
    });

    expect(estop.status).toBe(200);
    expect(mocks.estop).toHaveBeenCalled();
  });

  it('answers loopback callers when no secret is configured', () => {
    // With no token set the gate falls back to loopback-only — which is what
    // every dev profile in this repo runs, and why the tests above pass.
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('192.168.1.40')).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });

  // ── standing intents (TASK-199): the arming path ──────────────────────────

  it('POST /agent-mode/intents arms an intent that the matcher then fires', async () => {
    // Before this route existed, `IntentStore.arm()` had no production caller at
    // all: the cooldown, the fire budget and the `intent_matched` predicate were
    // reachable only by hand-writing JSONL onto the robot's disk.
    const res = await fetch(`${base}/robots/robot-1/agent-mode/intents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'tell me if the ladder is still blocking the door',
        place: 'WORKSHOP',
        keywords: ['ladder'],
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; intent: { id: string; state: string } };
    expect(body.ok).toBe(true);
    expect(body.intent.state).toBe('armed');

    // It is on disk, and the heartbeat's matcher fires it — TASK-199's
    // integration test #4, now executable as written.
    const fired = intents.fireMatching({
      place: 'WORKSHOP',
      view: 'a ladder against the door',
      nowMs: Date.now(),
    });
    expect(fired).toHaveLength(1);
    expect(fired[0].id).toBe('intent_matched');
    expect(fired[0].trust).toBe('operator');
    expect(fired[0].message).toContain('ladder is still blocking the door');
  });

  it('GET /agent-mode/intents lists what the robot is holding', async () => {
    intents.arm({ trigger: { place: 'DOCK-1' }, text: 'the ramp is wet' }, 'operator');

    const res = await fetch(`${base}/robots/robot-1/agent-mode/intents`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { intents: Array<{ text: string; scope: string }> };
    expect(body.intents).toHaveLength(1);
    expect(body.intents[0]).toMatchObject({ text: 'the ramp is wet', scope: 'place' });
  });

  it('refuses an intent with no trigger — it would fire on every tick', async () => {
    const res = await fetch(`${base}/robots/robot-1/agent-mode/intents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'say something' }),
    });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toMatch(/place or a keyword/);
    expect(intents.list()).toEqual([]);
  });

  it('DELETE /agent-mode/intents/:intentId disarms one', async () => {
    const armed = intents.arm({ trigger: { place: 'DOCK-1' }, text: 'the ramp is wet' }, 'operator');
    const id = armed.intent!.id;

    const res = await fetch(`${base}/robots/robot-1/agent-mode/intents/${id}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    expect(intents.list()[0].state).toBe('disarmed');
    // A second disarm is a 404, not a silent success.
    const again = await fetch(`${base}/robots/robot-1/agent-mode/intents/${id}`, {
      method: 'DELETE',
    });
    expect(again.status).toBe(404);
  });

  it('gates the intents behind the same personal-data check', async () => {
    // Operator-authored free text is personal data wherever it is served from.
    const res = await fetch(`${base}/robots/robot-1/agent-mode/intents`, {
      headers: { Origin: 'http://attacker.example' },
    });

    expect(res.status).toBe(403);
  });

  // ── the platform E-Stop must reach Agent Mode (TASK-194 finding 15) ────────

  it('POST /safety/estop stops the running Agent Mode plan, not just the sim speed', async () => {
    const res = await fetch(`${base}/robots/robot-1/safety/estop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'operator hit the fleet E-Stop', triggeredBy: 'remote' }),
    });

    expect(res.status).toBe(200);
    // Without this the block executor keeps posting /loco/move and the robot
    // keeps walking while the product reports it as e-stopped.
    expect(mocks.estop).toHaveBeenCalledOnce();
    expect(mocks.estop.mock.calls[0][0]).toContain('operator hit the fleet E-Stop');
    // The existing safety path still latches, with the true trigger source.
    expect(state.triggerEmergencyStop).toHaveBeenCalledWith('remote', 'operator hit the fleet E-Stop');
    expect(await res.json()).toMatchObject({ agentModeStopped: true, ...ESTOP_STATE });
  });

  it('POST /safety/estop still latches when the Agent Mode stop fails, and says so', async () => {
    mocks.estop.mockRejectedValue(new Error('sidecar unreachable'));

    const res = await fetch(`${base}/robots/robot-1/safety/estop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    expect(state.triggerEmergencyStop).toHaveBeenCalledWith('remote', 'Remote E-stop triggered');
    // HONESTY: never claim a stop we could not deliver.
    expect(await res.json()).toMatchObject({
      agentModeStopped: false,
      agentModeError: 'sidecar unreachable',
    });
  });
});

describe('VLA start arbitration', () => {
  let server: Server;
  let base: string;
  let state: ReturnType<typeof makeStateStub>;

  beforeEach(async () => {
    controlOwnerLock.reset();
    state = makeStateStub();
    const app = express();
    app.use(express.json());
    app.use('/api/v1', createRestRoutes(state));
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  });

  afterEach(async () => {
    controlOwnerLock.reset();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  const startVla = () =>
    fetch(`${base}/robots/robot-1/vla/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: 'pick the cube' }),
    });

  it('refuses to start a VLA rollout while Agent Mode owns control', async () => {
    controlOwnerLock.claim('agent');

    const res = await startVla();

    expect(res.status).toBe(409);
    const json = (await res.json()) as { code: string; message: string; controlOwner: string };
    expect(json.code).toBe('CONTROL_BUSY');
    expect(json.message).toMatch(/Agent Mode/);
    expect(json.controlOwner).toBe('agent');
  });

  it('starts normally when nothing owns control, and takes the lock', async () => {
    const res = await startVla();

    expect(res.status).toBe(200);
    expect(controlOwnerLock.get()).toBe('vla');
  });

  it('hands the lock back on stop', async () => {
    await startVla();
    expect(controlOwnerLock.get()).toBe('vla');

    const res = await fetch(`${base}/robots/robot-1/vla/stop`, { method: 'POST' });

    expect(res.status).toBe(200);
    expect(controlOwnerLock.get()).toBe('idle');
  });

  it('a self-terminating rollout frees the lock without any /vla/stop call', async () => {
    await startVla();
    expect(controlOwnerLock.get()).toBe('vla');

    // Max steps / 10-minute timeout / no VLA server reachable: the loop ends on
    // its own and the operator UI never even shows a Stop button.
    state.finishVlaRun();

    expect(controlOwnerLock.get()).toBe('idle');
    // …and Agent Mode can take control again.
    expect(controlOwnerLock.claim('agent').ok).toBe(true);
  });

  it('a refused second start does not release the live rollout’s lock', async () => {
    await startVla();

    const res = await startVla();

    expect(res.status).toBe(500);
    expect(((await res.json()) as { message: string }).message).toMatch(/already active/);
    // The route must not hand back a lock it never claimed — the first rollout
    // is still driving the robot.
    expect(controlOwnerLock.get()).toBe('vla');
  });
});
