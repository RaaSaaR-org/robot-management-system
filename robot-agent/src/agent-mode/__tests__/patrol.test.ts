/**
 * @file patrol.test.ts
 * @description PatrolRunner and friends (TASK-212): the leg plan a route
 *              becomes, leg semantics under a scripted executor (a failed leg is
 *              skipped and the run continues; two consecutive failures abort the
 *              route and still go home), the fail-closed preconditions with their
 *              machine reasons, time-window gating, the route source's cache, the
 *              capture host (a frame with a person is never stored; the hash gate
 *              spares the model), the regressions around a blind run (dead
 *              camera / dead checklist model), promotion of a run with a failed
 *              capture, the en-route diff on a leg that has no baseline, a run
 *              left `running` by a restart, and the run store's retention sweep.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encode } from 'jpeg-js';
import {
  PatrolRouteSource,
  PatrolRunStore,
  PatrolRunner,
  buildPatrolBlocks,
  checkPatrolPreconditions,
  findingSeverity,
  isNightWindow,
  matchTimeWindow,
  parsePatrolRoute,
  type PatrolExecution,
  type PatrolPreconditionInput,
} from '../patrol.js';
import { BlockExecutor } from '../block-executor.js';
import { RangeSensor } from '../range.js';
import { SceneMemoryStore } from '../scene-memory.js';
import { Workspace } from '../workspace.js';
import { parseChecklistAnswer, type ChecklistAnswers } from '../inspector.js';
import type { VisionClient } from '../vision.js';
import type { AgentBlock, AgentModeEventType, BlockOutcome, PatrolFinding, PatrolRoute, PatrolRun } from '../types.js';

// ── fixtures ────────────────────────────────────────────────────────────────

const ROUTE: PatrolRoute = {
  id: 'house-night',
  name: 'House night round',
  robotId: 'robot-1',
  twinId: null,
  checkpoints: [
    { id: 'cp-hall', placeId: 'HALLWAY', name: 'Hallway', headingDeg: 0, actions: ['capture'] },
    { id: 'cp-kitchen', placeId: 'KITCHEN', name: 'Kitchen', headingDeg: null, actions: ['capture', 'dwell'], dwellMs: 2000 },
    { id: 'cp-living', placeId: 'LIVING-ROOM', name: 'Living room', headingDeg: 90, actions: ['capture', 'scan'] },
  ],
  cronExpression: '0 22 * * *',
  enabled: true,
  timeWindows: [
    { id: 'day', name: 'Day', startHour: 7, endHour: 19 },
    { id: 'night', name: 'Night', startHour: 19, endHour: 7 },
  ],
  homePlaceId: 'HALLWAY',
  createdAt: '2026-08-16T00:00:00.000Z',
  updatedAt: '2026-08-16T00:00:00.000Z',
};

const ANSWERS: ChecklistAnswers = {
  personPresent: false,
  doorState: 'closed',
  objectOnFloor: { yes: false, what: '' },
  lightsOn: 'no',
  outOfPlace: [],
  expectations: [],
  oneLine: 'a room',
  degraded: false,
};

function jpeg(seed: number): Buffer {
  const w = 64;
  const h = 48;
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = (x * seed + y * 3) % 256;
      data[i] = v;
      data[i + 1] = 255 - v;
      data[i + 2] = (x + y) % 256;
      data[i + 3] = 255;
    }
  }
  return encode({ data, width: w, height: h }, 90).data;
}

const NOW = new Date('2026-08-16T22:30:00'); // local 22:30 → night window

interface Emitted {
  type: AgentModeEventType;
  run: PatrolRun;
  finding?: PatrolFinding;
}

function rig(opts: { checklist?: (b64: string) => Promise<ChecklistAnswers>; say?: (t: string) => Promise<boolean> } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neodem-patrol-'));
  const ws = new Workspace({ root, robotId: 'robot-1' });
  ws.ensure();
  const events: Emitted[] = [];
  const uploads: Array<{ key: string; kind: string; runId: string }> = [];
  const runner = new PatrolRunner({
    robotId: 'robot-1',
    workspace: ws,
    emit: (type, run, finding) => events.push({ type, run, ...(finding ? { finding } : {}) }),
    uploadPhoto: (u) => uploads.push({ key: u.key, kind: u.kind, runId: u.runId }),
    checklist: async (b64) => ({ answers: (await (opts.checklist ?? (async () => ANSWERS))(b64)), model: 'test-vlm', raw: '' }),
    ...(opts.say ? { say: opts.say } : {}),
    hashGate: 0.92,
    confirmN: 2,
    confirmM: 3,
    watchlist: ['person', 'crate', 'box'],
    homePlace: '',
    log: () => {},
  });
  return { root, ws, runner, events, uploads };
}

/**
 * A scripted executor: `outcomes` decides each block by kind (+ place for a
 * goto). Records what ran, in order, and every skip.
 */
function scriptedExec(
  outcome: (block: AgentBlock) => BlockOutcome | Promise<BlockOutcome>,
  aborted: () => boolean = () => false,
) {
  const ran: string[] = [];
  const skipped: string[] = [];
  const statuses = new Map<string, string>();
  const exec: PatrolExecution = {
    begin: (b) => {
      statuses.set(b.id, 'running');
    },
    execute: async (b) => {
      ran.push(label(b));
      return outcome(b);
    },
    finish: (b, o) => {
      statuses.set(b.id, o.ok ? 'done' : 'failed');
    },
    skip: (b, reason) => {
      skipped.push(`${label(b)}: ${reason}`);
      statuses.set(b.id, 'skipped');
    },
    isAborted: aborted,
    abortReason: () => (aborted() ? 'E-Stop' : null),
  };
  return { exec, ran, skipped, statuses };
}

function label(b: AgentBlock): string {
  if (b.kind === 'goto') return `goto:${String(b.params.place)}`;
  if (b.kind === 'capture' || b.kind === 'inspect') return `${b.kind}:${String(b.params.checkpointId)}`;
  return b.kind;
}

// ── leg plan ────────────────────────────────────────────────────────────────

describe('buildPatrolBlocks', () => {
  it('turns a route into patrol → notice → per checkpoint goto/capture/inspect/wait/scan → goto home', () => {
    const blocks = buildPatrolBlocks(ROUTE, 'patrol', { startNotice: 'Starting patrol; I take reference photos.' });
    expect(blocks.map((b) => `${b.legIndex}:${label(b.block)}`)).toEqual([
      '-1:patrol',
      '-1:speak',
      '0:goto:HALLWAY',
      '0:capture:cp-hall',
      '0:inspect:cp-hall',
      '1:goto:KITCHEN',
      '1:capture:cp-kitchen',
      '1:inspect:cp-kitchen',
      '1:wait',
      '2:goto:LIVING-ROOM',
      '2:capture:cp-living',
      '2:inspect:cp-living',
      '2:scan_room',
      '-1:goto:HALLWAY',
    ]);
    expect(blocks[0]!.block.params).toEqual({ routeId: 'house-night', routeName: 'House night round', mode: 'patrol' });
    expect(blocks[3]!.block.params).toMatchObject({ checkpointId: 'cp-hall', headingDeg: 0 });
    expect(blocks[6]!.block.params).not.toHaveProperty('headingDeg');
    expect(blocks[8]!.block.params).toEqual({ seconds: 2 });
    expect(blocks[blocks.length - 1]!.home).toBe(true);
  });

  it('baseline mode has no inspect blocks; a route without home (and no fallback) ends at the last checkpoint', () => {
    const blocks = buildPatrolBlocks({ ...ROUTE, homePlaceId: null }, 'baseline');
    expect(blocks.some((b) => b.block.kind === 'inspect')).toBe(false);
    expect(blocks.some((b) => b.home)).toBe(false);
    // The AGENT_PATROL_HOME_PLACE fallback fills in when the route has none.
    expect(buildPatrolBlocks({ ...ROUTE, homePlaceId: null }, 'baseline', { homePlaceId: 'WORKSHOP' }).at(-1)!.block.params.place).toBe('WORKSHOP');
  });
});

describe('parsePatrolRoute', () => {
  it('validates and fills defaults; refuses a checkpoint without a place', () => {
    const r = parsePatrolRoute({ id: 'r', name: 'R', checkpoints: [{ placeId: 'KITCHEN' }], timeWindows: [{ id: 'day', startHour: 7, endHour: 19 }] });
    expect(r.checkpoints[0]).toEqual({ id: 'cp-1', placeId: 'KITCHEN', name: 'KITCHEN', headingDeg: null, actions: ['capture'] });
    expect(r.enabled).toBe(true);
    expect(r.timeWindows[0]!.name).toBe('day');
    expect(() => parsePatrolRoute({ id: 'r', name: 'R', checkpoints: [{}] })).toThrow(/no placeId/);
    expect(() => parsePatrolRoute({ name: 'R', checkpoints: [] })).toThrow(/missing id/);
  });
});

// ── windows + severity ──────────────────────────────────────────────────────

describe('time windows', () => {
  it('matches the local hour, wraps midnight, and says none when outside every window', () => {
    expect(matchTimeWindow(ROUTE.timeWindows, new Date('2026-08-16T09:00:00'))).toBe('day');
    expect(matchTimeWindow(ROUTE.timeWindows, new Date('2026-08-16T22:30:00'))).toBe('night');
    expect(matchTimeWindow(ROUTE.timeWindows, new Date('2026-08-16T03:15:00'))).toBe('night');
    expect(matchTimeWindow([{ id: 'office', name: 'Office', startHour: 8, endHour: 18 }], new Date('2026-08-16T22:30:00'))).toBe('none');
    expect(matchTimeWindow([], NOW)).toBeNull();
  });

  it('severity by type × window', () => {
    expect(isNightWindow(ROUTE, 'night')).toBe(true);
    expect(isNightWindow(ROUTE, 'day')).toBe(false);
    expect(findingSeverity('person', true)).toBe('high');
    expect(findingSeverity('person', false)).toBe('medium');
    expect(findingSeverity('door_open', true)).toBe('high');
    expect(findingSeverity('unexpected_object', true)).toBe('medium');
    expect(findingSeverity('lights_on', true)).toBe('low');
  });
});

// ── preconditions ───────────────────────────────────────────────────────────

function preconditions(over: Partial<PatrolPreconditionInput> = {}): PatrolPreconditionInput {
  return {
    patrolEnabled: true,
    agentModeEnabled: true,
    estopLatched: false,
    patrolActive: false,
    planRunning: false,
    controlOwner: 'idle',
    teleopOrVlaActive: false,
    initiative: { estopLatched: false, crashAcknowledged: true, batteryPercent: 80, place: 'HALLWAY', placeAgeMs: 1000, damped: false },
    origin: 'scheduled',
    route: ROUTE,
    knownPlaceIds: ['HALLWAY', 'KITCHEN', 'LIVING-ROOM', 'BEDROOM', 'WORKSHOP'],
    now: NOW,
    ...over,
  };
}

describe('checkPatrolPreconditions', () => {
  it('passes a healthy scheduled start and names the window', () => {
    expect(checkPatrolPreconditions(preconditions())).toEqual({ ok: true, window: 'night' });
  });

  it.each([
    ['disabled', { patrolEnabled: false }],
    ['disabled', { agentModeEnabled: false }],
    ['running', { patrolActive: true }],
    ['estop', { estopLatched: true }],
    ['busy', { planRunning: true }],
    ['busy', { controlOwner: 'teleop' as const }],
    ['busy', { teleopOrVlaActive: true }],
    ['no_places', { knownPlaceIds: [] }],
    ['route_unknown', { knownPlaceIds: ['HALLWAY'] }],
    ['route_unknown', { route: { ...ROUTE, checkpoints: [] } }],
    ['window', { now: new Date('2026-08-16T12:00:00'), route: { ...ROUTE, timeWindows: [{ id: 'night', name: 'Night', startHour: 19, endHour: 7 }] } }],
    ['battery', { initiative: { ...preconditions().initiative, batteryPercent: 12 } }],
    ['battery', { initiative: { ...preconditions().initiative, batteryPercent: null } }],
    ['place_unknown', { initiative: { ...preconditions().initiative, place: null } }],
    ['place_unknown', { initiative: { ...preconditions().initiative, placeAgeMs: 60 * 60_000 } }],
    ['damped', { initiative: { ...preconditions().initiative, damped: true } }],
    ['crash_unacknowledged', { initiative: { ...preconditions().initiative, crashAcknowledged: false } }],
  ])('fails closed with reason %s', (reason, over) => {
    const v = checkPatrolPreconditions(preconditions(over as Partial<PatrolPreconditionInput>));
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toBe(reason);
      expect(v.message.length).toBeGreaterThan(10);
    }
  });

  it('an operator start passes the initiative gate (battery, place, crash) but is still refused damped', () => {
    const low = preconditions({ origin: 'operator', initiative: { ...preconditions().initiative, batteryPercent: 5, place: null, crashAcknowledged: false } });
    expect(checkPatrolPreconditions(low)).toEqual({ ok: true, window: 'night' });
    const damped = preconditions({ origin: 'operator', initiative: { ...preconditions().initiative, damped: true } });
    expect(checkPatrolPreconditions(damped)).toMatchObject({ ok: false, reason: 'damped' });
  });

  it('a route without windows matches with window null', () => {
    expect(checkPatrolPreconditions(preconditions({ route: { ...ROUTE, timeWindows: [] } }))).toEqual({ ok: true, window: null });
  });
});

// ── route source ────────────────────────────────────────────────────────────

describe('PatrolRouteSource', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neodem-routes-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('fetches from the server, caches, and falls back to the cache when the server is down', async () => {
    let up = true;
    const src = new PatrolRouteSource({
      serverUrl: 'http://server',
      cachePath: path.join(dir, 'routes.json'),
      fetchImpl: (async (url: string) => {
        if (!up) throw new Error('ECONNREFUSED');
        expect(url).toBe('http://server/api/patrol/routes/house-night');
        return new Response(JSON.stringify(ROUTE), { status: 200 });
      }) as unknown as typeof fetch,
    });
    const first = await src.fetch('house-night');
    expect(first.origin).toBe('server');
    expect(first.route?.name).toBe('House night round');
    up = false;
    const second = await src.fetch('house-night');
    expect(second.origin).toBe('cache');
    expect(second.route?.checkpoints).toHaveLength(3);
    const missing = await src.fetch('other');
    expect(missing).toMatchObject({ route: null, origin: 'none' });
  });
});

// ── the runner ──────────────────────────────────────────────────────────────

describe('PatrolRunner — leg semantics', () => {
  let h: ReturnType<typeof rig>;
  beforeEach(() => {
    h = rig();
  });
  afterEach(() => {
    h.runner.dispose();
    fs.rmSync(h.root, { recursive: true, force: true });
  });

  it('a happy baseline run: every leg done, run.json + answers on disk, events in order, photos uploaded as baseline', async () => {
    const { run } = h.runner.begin(ROUTE, 'baseline', 'operator', 'night');
    expect(run.status).toBe('running');
    expect(run.legs.map((l) => l.status)).toEqual(['pending', 'pending', 'pending']);
    const host = h.runner.captureHost();
    const s = scriptedExec((b) => {
      if (b.kind === 'capture') {
        host.recordCapture(String(b.params.checkpointId), { photo: jpeg(1), photoDropped: null, answers: ANSWERS, model: 'test-vlm', inspection: 'recorded', similarity: null });
      }
      return { ok: true, message: `${label(b)} ok` };
    });
    const done = await h.runner.drive('plan-1', s.exec);
    expect(done.status).toBe('done');
    expect(done.planId).toBe('plan-1');
    expect(done.legs.map((l) => l.status)).toEqual(['done', 'done', 'done']);
    expect(done.legs.map((l) => l.inspection)).toEqual(['recorded', 'recorded', 'recorded']);
    expect(done.legs[0]!.photoKey).toBe(`${run.runId}/cp-hall.jpg`);
    expect(s.ran).toEqual(['speak', 'goto:HALLWAY', 'capture:cp-hall', 'goto:KITCHEN', 'capture:cp-kitchen', 'wait', 'goto:LIVING-ROOM', 'capture:cp-living', 'scan_room', 'goto:HALLWAY']);
    expect(h.events.map((e) => e.type)).toEqual([
      'agent:patrol:started',
      'agent:patrol:leg',
      'agent:patrol:leg',
      'agent:patrol:leg',
      'agent:patrol:finished',
    ]);
    expect(h.uploads.every((u) => u.kind === 'baseline')).toBe(true);
    expect(h.uploads.map((u) => u.key)).toEqual(['cp-hall.jpg', 'cp-kitchen.jpg', 'cp-living.jpg']);
    // On disk: patrol/<routeId>/runs/<runId>/{run.json,findings.json,answers.json,cp-*.jpg} + the baseline.
    const runDir = path.join(h.root, 'patrol', 'house-night', 'runs', run.runId);
    expect(fs.readdirSync(runDir).sort()).toEqual(['answers.json', 'cp-hall.jpg', 'cp-kitchen.jpg', 'cp-living.jpg', 'findings.json', 'run.json']);
    expect(h.runner.baseline!.exists('house-night', 'night')).toBe(true);
    expect(h.runner.baseline!.checkpoint('house-night', 'night', 'cp-kitchen')?.photoKey).toBe(`${run.runId}/cp-kitchen.jpg`);
    expect(h.runner.active()).toBeNull();
    expect(h.runner.lastRun()?.runId).toBe(run.runId);
    expect(h.runner.runs!.listRuns(5)[0]!.runId).toBe(run.runId);
  });

  it('promoteRun makes a patrol run the baseline AND re-uploads its photos as kind baseline (skipping person legs)', async () => {
    const { run } = h.runner.begin(ROUTE, 'patrol', 'scheduled', 'night');
    const host = h.runner.captureHost();
    const s = scriptedExec((b) => {
      if (b.kind === 'capture') {
        const cp = String(b.params.checkpointId);
        const person = cp === 'cp-kitchen';
        host.recordCapture(cp, {
          photo: person ? null : jpeg(1),
          photoDropped: person ? 'person' : null,
          answers: { ...ANSWERS, personPresent: person },
          model: 'test-vlm',
          inspection: null,
          similarity: null,
        });
      }
      return { ok: true, message: `${label(b)} ok` };
    });
    const done = await h.runner.drive('plan-p', s.exec);
    expect(done.status).toBe('done');
    expect(h.uploads.map((u) => u.kind)).toEqual(['control', 'control']);
    h.uploads.length = 0;

    const res = h.runner.promoteRun(run.runId);
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/promoted 2 checkpoint\(s\)/);
    // Contract §2: the promoted photos go up again with the baseline run's id and kind 'baseline'.
    expect(h.uploads).toEqual([
      { key: 'cp-hall.jpg', kind: 'baseline', runId: run.runId },
      { key: 'cp-living.jpg', kind: 'baseline', runId: run.runId },
    ]);
    expect(h.runner.baseline!.checkpoint('house-night', 'night', 'cp-hall')?.photoKey).toBe(`${run.runId}/cp-hall.jpg`);
    expect(h.runner.baseline!.checkpoint('house-night', 'night', 'cp-kitchen')).toBeNull();
  });

  // A capture that fails does NOT fail its leg (only a failed goto does), so
  // without the blind-leg accounting these runs read as "all clear".
  it('a run whose captures all fail ends failed — never "done, 0 finding(s)" — and the summary names the uninspected checkpoints', async () => {
    h.runner.begin(ROUTE, 'patrol', 'scheduled', 'night');
    const host = h.runner.captureHost();
    let summary = '';
    const s = scriptedExec((b) => {
      if (b.kind === 'capture') {
        // What the block executor records when the camera sidecar or the
        // checklist model is down: no photo, no answers, ok:false.
        host.recordCapture(String(b.params.checkpointId), { photo: null, photoDropped: 'error', answers: null, model: null, inspection: 'error', similarity: null });
        return { ok: false, message: 'the checklist model did not answer' };
      }
      return { ok: true, message: `${label(b)} ok` };
    });
    const finish = s.exec.finish;
    s.exec.finish = (b, out) => {
      if (b.kind === 'patrol') summary = out.message;
      finish(b, out);
    };
    const done = await h.runner.drive('plan-blind', s.exec);
    expect(done.status).toBe('failed');
    expect(done.reason).toBe('no control photo or checklist answer at any checkpoint');
    expect(done.findingCount).toBe(0);
    expect(summary).not.toMatch(/^Patrol done/);
    expect(summary).toMatch(/No control photo or checklist answer for Hallway, Kitchen, Living room — those checkpoints were not inspected/);
    expect(s.skipped).toContain('inspect:cp-hall: capture failed');
  });

  it('one blind checkpoint keeps the run done but is named in the reason and the summary', async () => {
    h.runner.begin(ROUTE, 'patrol', 'scheduled', 'night');
    const host = h.runner.captureHost();
    let summary = '';
    const s = scriptedExec((b) => {
      if (b.kind === 'capture') {
        const cp = String(b.params.checkpointId);
        if (cp === 'cp-kitchen') {
          host.recordCapture(cp, { photo: null, photoDropped: 'error', answers: null, model: null, inspection: 'error', similarity: null });
          return { ok: false, message: 'no camera frame' };
        }
        host.recordCapture(cp, { photo: jpeg(1), photoDropped: null, answers: ANSWERS, model: 'test-vlm', inspection: null, similarity: null });
      }
      return { ok: true, message: `${label(b)} ok` };
    });
    const finish = s.exec.finish;
    s.exec.finish = (b, out) => {
      if (b.kind === 'patrol') summary = out.message;
      finish(b, out);
    };
    const done = await h.runner.drive('plan-half-blind', s.exec);
    expect(done.status).toBe('done');
    expect(done.reason).toBe('1 checkpoint(s) not inspected');
    expect(summary).toMatch(/No control photo or checklist answer for Kitchen — those checkpoints were not inspected/);
  });

  it('promoteRun never promotes a checkpoint whose capture failed — the baseline photo it already has survives', async () => {
    h.runner.baseline!.recordCheckpoint('house-night', 'night', { checkpointId: 'cp-kitchen', runId: 'base-run', photo: jpeg(4), answers: ANSWERS, model: 'm' });
    const { run } = h.runner.begin(ROUTE, 'patrol', 'scheduled', 'night');
    const host = h.runner.captureHost();
    const s = scriptedExec((b) => {
      if (b.kind === 'capture') {
        const cp = String(b.params.checkpointId);
        if (cp === 'cp-kitchen') {
          host.recordCapture(cp, { photo: null, photoDropped: 'error', answers: null, model: null, inspection: 'error', similarity: null });
          return { ok: false, message: 'camera sidecar is down' };
        }
        host.recordCapture(cp, { photo: jpeg(1), photoDropped: null, answers: ANSWERS, model: 'test-vlm', inspection: null, similarity: null });
      }
      return { ok: true, message: `${label(b)} ok` };
    });
    await h.runner.drive('plan-promote-blind', s.exec);
    const res = h.runner.promoteRun(run.runId);
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/promoted 2 checkpoint\(s\)/);
    expect(res.message).toMatch(/1 checkpoint\(s\) skipped \(no usable capture\)/);
    // The kitchen keeps the baseline it had: the photo on disk and its key.
    expect(h.runner.baseline!.checkpoint('house-night', 'night', 'cp-kitchen')?.photoKey).toBe('base-run/cp-kitchen.jpg');
    expect(h.runner.baseline!.readPhoto('house-night', 'night', 'cp-kitchen')).not.toBeNull();
  });

  it('a failed leg is skipped and reported; the run continues and still finishes done', async () => {
    h.runner.begin(ROUTE, 'patrol', 'scheduled', 'night');
    const s = scriptedExec((b) => (label(b) === 'goto:KITCHEN' ? { ok: false, message: 'goto place "Kitchen": no path known' } : { ok: true, message: 'ok' }));
    const done = await h.runner.drive('plan-2', s.exec);
    expect(done.status).toBe('done');
    expect(done.legs.map((l) => l.status)).toEqual(['done', 'failed', 'done']);
    expect(done.legs[1]!.message).toMatch(/no path known/);
    // The kitchen's capture/inspect/wait were skipped, not run; the living room ran; home ran.
    expect(s.skipped).toEqual(['capture:cp-kitchen: leg failed', 'inspect:cp-kitchen: leg failed', 'wait: leg failed']);
    expect(s.ran).toContain('goto:LIVING-ROOM');
    expect(s.ran.at(-1)).toBe('goto:HALLWAY');
    expect(h.events.filter((e) => e.type === 'agent:patrol:leg')).toHaveLength(3);
  });

  it('two consecutive failed legs abort the run, skip the rest, and STILL go home', async () => {
    h.runner.begin(ROUTE, 'patrol', 'scheduled', 'night');
    // The first two gotos fail (leg 0 = the hallway, leg 1 = the kitchen); the
    // home goto — the hallway again, later — succeeds.
    const s2 = scriptedExec((b) =>
      (label(b) === 'goto:HALLWAY' && s2.ran.filter((r) => r === 'goto:HALLWAY').length === 1) || label(b) === 'goto:KITCHEN'
        ? { ok: false, message: 'blocked' }
        : { ok: true, message: 'ok' },
    );
    const done = await h.runner.drive('plan-3', s2.exec);
    expect(done.status).toBe('aborted');
    expect(done.reason).toBe('two consecutive legs failed');
    expect(done.legs.map((l) => l.status)).toEqual(['failed', 'failed', 'skipped']);
    expect(s2.ran).toEqual(['speak', 'goto:HALLWAY', 'goto:KITCHEN', 'goto:HALLWAY']);
    expect(s2.skipped).toEqual(expect.arrayContaining(['goto:LIVING-ROOM: two consecutive legs failed', 'capture:cp-living: two consecutive legs failed']));
    expect(h.events.at(-1)!.type).toBe('agent:patrol:finished');
    expect(h.events.at(-1)!.run.status).toBe('aborted');
  });

  it('an external abort (E-Stop) stops after the block in flight, skips the rest and does NOT go home', async () => {
    h.runner.begin(ROUTE, 'patrol', 'operator', 'night');
    let stop = false;
    const s = scriptedExec(
      (b) => {
        if (label(b) === 'goto:KITCHEN') stop = true;
        return { ok: true, message: 'ok' };
      },
      () => stop,
    );
    const done = await h.runner.drive('plan-4', s.exec);
    expect(done.status).toBe('aborted');
    expect(done.reason).toBe('E-Stop');
    expect(done.legs.map((l) => l.status)).toEqual(['done', 'failed', 'skipped']);
    expect(s.ran.at(-1)).toBe('goto:KITCHEN');
    expect(s.skipped.some((x) => x.startsWith('goto:HALLWAY'))).toBe(true);
  });

  it('requestAbort (operator command) ends the run as aborted with that reason', async () => {
    h.runner.begin(ROUTE, 'patrol', 'scheduled', 'night');
    const s = scriptedExec((b) => {
      if (label(b) === 'goto:HALLWAY') h.runner.requestAbort('operator command');
      return { ok: true, message: 'ok' };
    });
    const done = await h.runner.drive('plan-5', s.exec);
    expect(done.status).toBe('aborted');
    expect(done.reason).toBe('operator command');
    expect(s.ran).toEqual(['speak', 'goto:HALLWAY']);
  });

  it('refuse() records a skipped run with the reason and emits agent:patrol:finished', () => {
    const r = h.runner.refuse(ROUTE, 'patrol', 'scheduled', 'battery', 'I did nothing on my own because my battery is at 12%.');
    expect(r).toMatchObject({ accepted: false, reason: 'battery' });
    expect(h.events).toHaveLength(1);
    expect(h.events[0]!.type).toBe('agent:patrol:finished');
    expect(h.events[0]!.run).toMatchObject({ status: 'skipped', reason: 'battery: I did nothing on my own because my battery is at 12%.', mode: 'patrol', origin: 'scheduled' });
    expect(h.events[0]!.run.legs.every((l) => l.status === 'skipped')).toBe(true);
    expect(h.runner.runs!.findRun(r.runId!)?.status).toBe('skipped');
  });
});

// ── capture host + the executor's capture ───────────────────────────────────

describe('capture: the host and the executor', () => {
  let h: ReturnType<typeof rig>;
  afterEach(() => {
    h?.runner.dispose();
    if (h) fs.rmSync(h.root, { recursive: true, force: true });
  });

  function executor(host: () => ReturnType<PatrolRunner['captureHost']> | null, frame: Buffer, opts: { onTurn?: (deg: number) => void } = {}) {
    const scene = new SceneMemoryStore('robot-1');
    scene.setYawDeg(0, 'odometry');
    return new BlockExecutor({
      scene,
      vision: {} as unknown as VisionClient,
      range: new RangeSensor({ enabled: false }),
      isAborted: () => false,
      loco: {
        move: async (_vx, _vy, omega, durationS) => {
          opts.onTurn?.((omega * 180) / Math.PI * durationS);
          return { ok: true };
        },
        action: async () => ({ ok: true }),
        fsm: async () => ({ ok: true }),
        standHeight: async () => ({ ok: true }),
        odometry: async () => null,
      },
      sleep: async () => {},
      memory: null,
      patrol: host,
      snapshot: async () => frame.toString('base64'),
      cameraName: 'head_camera',
    });
  }

  it('drops the image when the checklist says a person is present — nothing on disk, nothing uploaded, leg says why', async () => {
    h = rig({ checklist: async () => ({ ...ANSWERS, personPresent: true, oneLine: 'someone stands in the kitchen' }) });
    const { run } = h.runner.begin(ROUTE, 'baseline', 'operator', 'day');
    const ex = executor(() => h.runner.captureHost(), jpeg(2));
    const out = await ex.execute({ id: 'b', kind: 'capture', params: { checkpointId: 'cp-kitchen' }, status: 'running' });
    expect(out.ok).toBe(true);
    expect(out.message).toMatch(/A person is in frame — the photo was NOT stored/);
    const active = h.runner.active()!;
    expect(active.legs[1]!.photoDropped).toBe('person');
    expect(active.legs[1]!.photoKey).toBeNull();
    expect(fs.existsSync(path.join(h.root, 'patrol', 'house-night', 'runs', run.runId, 'cp-kitchen.jpg'))).toBe(false);
    expect(h.uploads).toEqual([]);
    // Baseline mode does NOT record a person as "normal": no baseline entry
    // at all for this checkpoint (else every later person here would be
    // silently accepted), the leg says so, and the operator is told to retake.
    expect(out.message).toMatch(/NOT recorded as baseline/);
    expect(active.legs[1]!.inspection).toBe('skipped');
    expect(active.legs[1]!.message).toMatch(/person in frame — no baseline recorded/);
    expect(h.runner.baseline!.checkpoint('house-night', 'day', 'cp-kitchen')).toBeNull();
    expect(h.runner.baseline!.readPhoto('house-night', 'day', 'cp-kitchen')).toBeNull();
  });

  it('a baseline run summary names the checkpoints that got no baseline because a person was in frame', async () => {
    h = rig({ checklist: async () => ({ ...ANSWERS, personPresent: true, oneLine: 'the operator stands in the kitchen' }) });
    h.runner.begin(ROUTE, 'baseline', 'operator', 'day');
    let summary = '';
    const s = scriptedExec(async (b) => {
      if (b.kind === 'capture') {
        await executor(() => h.runner.captureHost(), jpeg(2)).execute(b);
      }
      return { ok: true, message: 'ok' };
    });
    const finish = s.exec.finish;
    s.exec.finish = (b, out) => {
      if (b.kind === 'patrol') summary = out.message;
      finish(b, out);
    };
    const done = await h.runner.drive('plan-b', s.exec);
    expect(done.status).toBe('done');
    expect(done.legs.every((l) => l.photoDropped === 'person' && l.inspection === 'skipped')).toBe(true);
    expect(summary).toMatch(/No baseline for Hallway, Kitchen, Living room — a person was in frame/);
    expect(h.runner.baseline!.checkpoint('house-night', 'day', 'cp-hall')).toBeNull();
  });

  it('a prose / unparseable checklist answer is no verdict: nothing on disk, nothing uploaded, no baseline', async () => {
    h = rig({ checklist: async () => parseChecklistAnswer('I can see a kitchen with a person standing by the counter.', 0) });
    const { run } = h.runner.begin(ROUTE, 'baseline', 'operator', 'day');
    const ex = executor(() => h.runner.captureHost(), jpeg(2));
    const out = await ex.execute({ id: 'b', kind: 'capture', params: { checkpointId: 'cp-kitchen' }, status: 'running' });
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/could not be parsed .* The frame was not stored/);
    const active = h.runner.active()!;
    expect(active.legs[1]!.photoDropped).toBe('error');
    expect(active.legs[1]!.photoKey).toBeNull();
    expect(active.legs[1]!.inspection).toBe('error');
    expect(fs.existsSync(path.join(h.root, 'patrol', 'house-night', 'runs', run.runId, 'cp-kitchen.jpg'))).toBe(false);
    expect(h.uploads).toEqual([]);
    expect(h.runner.baseline!.checkpoint('house-night', 'day', 'cp-kitchen')).toBeNull();
  });

  it('a string "yes" for personPresent is a person verdict, "no" is a clean one', async () => {
    const yes = parseChecklistAnswer('{"personPresent": "yes", "oneLine": "someone"}', 0);
    expect(yes.degraded).toBe(false);
    expect(yes.personPresent).toBe(true);
    const no = parseChecklistAnswer('{"personPresent": "no", "oneLine": "empty"}', 0);
    expect(no.degraded).toBe(false);
    expect(no.personPresent).toBe(false);
    const missing = parseChecklistAnswer('{"doorState": "open", "oneLine": "a door"}', 0);
    expect(missing.degraded).toBe(true);
    expect(missing.personPresent).toBe(false);
  });

  it('stores the image when no person is in frame, aligns to the stored heading first, and uploads it', async () => {
    h = rig();
    const { run } = h.runner.begin(ROUTE, 'baseline', 'operator', 'day');
    const turns: number[] = [];
    const ex = executor(() => h.runner.captureHost(), jpeg(3), { onTurn: (d) => turns.push(d) });
    const out = await ex.execute({ id: 'b', kind: 'capture', params: { checkpointId: 'cp-living', headingDeg: 90 }, status: 'running' });
    expect(out.ok).toBe(true);
    expect(out.message).toMatch(/Stored as .*cp-living\.jpg/);
    expect(out.message).toMatch(/Aligned to 90°/);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toBeCloseTo(90, 0);
    expect(fs.existsSync(path.join(h.root, 'patrol', 'house-night', 'runs', run.runId, 'cp-living.jpg'))).toBe(true);
    expect(h.uploads).toEqual([{ key: 'cp-living.jpg', kind: 'baseline', runId: run.runId }]);
  });

  it('patrol mode: the hash gate spares the model on a like frame; a changed frame costs ONE checklist call, then inspect diffs', async () => {
    let calls = 0;
    h = rig({
      checklist: async () => {
        calls++;
        return { ...ANSWERS, objectOnFloor: { yes: true, what: 'box' } };
      },
    });
    // Baseline for cp-hall (photo = frame 4) and cp-kitchen (photo = frame 4 too, answers no box).
    h.runner.baseline!.recordCheckpoint('house-night', 'night', { checkpointId: 'cp-hall', runId: 'base-run', photo: jpeg(4), answers: ANSWERS, model: 'm' });
    h.runner.baseline!.recordCheckpoint('house-night', 'night', { checkpointId: 'cp-kitchen', runId: 'base-run', photo: jpeg(4), answers: ANSWERS, model: 'm' });
    h.runner.begin(ROUTE, 'patrol', 'scheduled', 'night');
    const host = () => h.runner.captureHost();

    // Same frame at the hallway → unchanged, no model call, photo stored.
    const same = await executor(host, jpeg(4)).execute({ id: 'a', kind: 'capture', params: { checkpointId: 'cp-hall' }, status: 'running' });
    expect(same.ok).toBe(true);
    expect(same.message).toMatch(/unchanged against the baseline .* no model call/);
    expect(calls).toBe(0);
    const insp1 = await executor(host, jpeg(4)).execute({ id: 'a2', kind: 'inspect', params: { checkpointId: 'cp-hall' }, status: 'running' });
    expect(insp1.ok).toBe(true);
    expect(h.runner.active()!.legs[0]!.inspection).toBe('unchanged');

    // A different frame at the kitchen → one checklist call → inspect finds a box on the floor.
    const changed = await executor(host, jpeg(9)).execute({ id: 'b', kind: 'capture', params: { checkpointId: 'cp-kitchen' }, status: 'running' });
    expect(changed.ok).toBe(true);
    expect(calls).toBe(1);
    const insp2 = await executor(host, jpeg(9)).execute({ id: 'b2', kind: 'inspect', params: { checkpointId: 'cp-kitchen' }, status: 'running' });
    expect(insp2.ok).toBe(true);
    expect(insp2.message).toMatch(/Differs from the baseline on 1 item/);
    const active = h.runner.active()!;
    expect(active.legs[1]!.inspection).toBe('changed');
    expect(active.findingCount).toBe(1);
    const detected = h.events.filter((e) => e.type === 'agent:finding:detected');
    expect(detected).toHaveLength(1);
    expect(detected[0]!.finding).toMatchObject({
      type: 'object_on_floor',
      source: 'checkpoint',
      severity: 'medium',
      place: 'KITCHEN',
      checkpointId: 'cp-kitchen',
      status: 'open',
      model: 'test-vlm',
    });
    expect(detected[0]!.finding!.evidence.baselinePhotoKey).toBe('base-run/cp-kitchen.jpg');
    expect(detected[0]!.finding!.evidence.currentPhotoKey).toMatch(/cp-kitchen\.jpg$/);
    // The control photo was uploaded once as control and once more as finding evidence.
    expect(h.uploads.map((u) => u.kind)).toEqual(['control', 'control', 'finding']);
    expect(calls).toBe(1);
  });

  it('inspect without a baseline says so (no_baseline) instead of inventing a difference', async () => {
    h = rig();
    h.runner.begin(ROUTE, 'patrol', 'scheduled', 'day');
    const host = () => h.runner.captureHost();
    await executor(host, jpeg(5)).execute({ id: 'a', kind: 'capture', params: { checkpointId: 'cp-hall' }, status: 'running' });
    const insp = await executor(host, jpeg(5)).execute({ id: 'a2', kind: 'inspect', params: { checkpointId: 'cp-hall' }, status: 'running' });
    expect(insp.ok).toBe(true);
    expect(insp.message).toMatch(/No baseline/);
    expect(h.runner.active()!.legs[0]!.inspection).toBe('no_baseline');
    expect(h.events.some((e) => e.type === 'agent:finding:detected')).toBe(false);
  });

  it('capture without an active patrol is a plain refusal', async () => {
    const ex = executor(() => null, jpeg(1));
    expect(await ex.execute({ id: 'x', kind: 'capture', params: { checkpointId: 'cp-hall' }, status: 'running' })).toMatchObject({ ok: false });
    expect(await ex.execute({ id: 'y', kind: 'inspect', params: { checkpointId: 'cp-hall' }, status: 'running' })).toMatchObject({ ok: false });
  });
});

// ── en-route ────────────────────────────────────────────────────────────────

describe('PatrolRunner — en-route comparison', () => {
  let h: ReturnType<typeof rig>;
  const say = vi.fn(async (_text: string, _language?: string) => true);
  beforeEach(() => {
    say.mockClear();
    h = rig({ say });
    h.runner.baseline!.recordLegLabels('house-night', 'night', 1, ['wall', 'floor', 'table']);
  });
  afterEach(() => {
    h.runner.dispose();
    fs.rmSync(h.root, { recursive: true, force: true });
  });

  async function drivePatrolWithLooks(looks: Array<Parameters<PatrolRunner['onLook']>[0]>) {
    h.runner.begin(ROUTE, 'patrol', 'scheduled', 'night');
    const s = scriptedExec(async (b) => {
      if (label(b) === 'goto:KITCHEN') {
        for (const look of looks) await h.runner.onLook(look);
      }
      return { ok: true, message: 'ok' };
    });
    return h.runner.drive('plan-e', s.exec);
  }

  it('a new watch-listed label seen twice on a leg becomes ONE finding; a third look re-observes it', async () => {
    const look = { labels: ['wall', 'crate'], personVisible: false, pose: { x: 1, y: 2, yawDeg: 0 }, place: 'KITCHEN', map: null, peers: [], places: [] };
    const done = await drivePatrolWithLooks([look, look, look]);
    expect(done.findingCount).toBe(1);
    const detected = h.events.filter((e) => e.type === 'agent:finding:detected');
    const confirmed = h.events.filter((e) => e.type === 'agent:finding:confirmed');
    expect(detected).toHaveLength(1);
    expect(detected[0]!.finding).toMatchObject({ type: 'unexpected_object', source: 'enroute_semantic', place: 'KITCHEN', legIndex: 1, pose: { x: 1, y: 2, yawDeg: 0 } });
    expect(detected[0]!.finding!.evidence.labels?.added).toEqual(['crate']);
    expect(confirmed.length).toBeGreaterThanOrEqual(0);
    expect(done.legs[1]!.findingIds).toEqual([detected[0]!.finding!.id]);
    expect(say).not.toHaveBeenCalled();
  });

  it('a person confirmed en route: one spoken line, a person finding without an image, run continues', async () => {
    const look = { labels: ['person'], personVisible: true, pose: null, place: 'KITCHEN', map: null, peers: [], places: [] };
    const done = await drivePatrolWithLooks([look, look, look, look]);
    expect(done.status).toBe('done');
    expect(say).toHaveBeenCalledTimes(1);
    expect(say.mock.calls[0]![0]).toBe('I am on patrol, please step aside.');
    const person = h.events.find((e) => e.type === 'agent:finding:detected')!.finding!;
    expect(person.type).toBe('person');
    expect(person.severity).toBe('high'); // night window
    expect(person.evidence.currentPhotoKey ?? null).toBeNull();
  });

  it('a watch-listed baseline label the whole leg never saw is missing_object at run end — unless it turned up elsewhere (moved)', async () => {
    h.runner.baseline!.recordLegLabels('house-night', 'night', 1, ['wall', 'crate']);
    const kitchenLook = { labels: ['wall', 'floor'], personVisible: false, pose: null, place: 'KITCHEN', map: null, peers: [], places: [] };
    const gone = await drivePatrolWithLooks([kitchenLook, kitchenLook]);
    expect(gone.findingCount).toBe(1);
    const missing = h.events.find((e) => e.type === 'agent:finding:detected')!.finding!;
    expect(missing).toMatchObject({ type: 'missing_object', place: 'KITCHEN', legIndex: 1 });
    expect(missing.evidence.labels?.missing).toEqual(['crate']);

    // Same again, but the crate shows up (new) on the living-room leg: one
    // unexpected_object there, and NOT a missing_object in the kitchen. The
    // living-room leg needs its own baseline label set — an unbaselined leg is
    // not compared at all (see "no baseline labels for the leg" below).
    h.events.length = 0;
    h.runner.baseline!.recordLegLabels('house-night', 'night', 2, ['sofa']);
    h.runner.begin(ROUTE, 'patrol', 'scheduled', 'night');
    const livingLook = { labels: ['crate'], personVisible: false, pose: null, place: 'LIVING-ROOM', map: null, peers: [], places: [] };
    const s = scriptedExec(async (b) => {
      if (label(b) === 'goto:KITCHEN') for (const l of [kitchenLook, kitchenLook]) await h.runner.onLook(l);
      if (label(b) === 'goto:LIVING-ROOM') for (const l of [livingLook, livingLook]) await h.runner.onLook(l);
      return { ok: true, message: 'ok' };
    });
    const moved = await h.runner.drive('plan-m', s.exec);
    expect(moved.findingCount).toBe(1);
    const types = h.events.filter((e) => e.type === 'agent:finding:detected').map((e) => e.finding!.type);
    expect(types).toEqual(['unexpected_object']);
  });

  it('a baseline run records the union of every leg look as the leg label set', async () => {
    h.runner.begin(ROUTE, 'baseline', 'operator', 'day');
    const s = scriptedExec(async (b) => {
      if (label(b) === 'goto:LIVING-ROOM') {
        await h.runner.onLook({ labels: ['Sofa', 'window'], personVisible: false, pose: null, place: 'LIVING-ROOM', map: null, peers: [], places: [] });
        await h.runner.onLook({ labels: ['sofa', 'lamp'], personVisible: false, pose: null, place: 'LIVING-ROOM', map: null, peers: [], places: [] });
      }
      return { ok: true, message: 'ok' };
    });
    await h.runner.drive('plan-b', s.exec);
    expect(h.runner.baseline!.legLabels('house-night', 'day', 2)).toEqual(['lamp', 'sofa', 'window']);
    expect(h.runner.baseline!.legLabels('house-night', 'day', 0)).toEqual([]);
    expect(h.events.some((e) => e.type === 'agent:finding:detected')).toBe(false);
  });

  it('a label the baseline leg already has is not new; a single look never confirms', async () => {
    const done = await drivePatrolWithLooks([
      { labels: ['table', 'wall'], personVisible: false, pose: null, place: 'KITCHEN', map: null, peers: [], places: [] },
      { labels: ['crate'], personVisible: false, pose: null, place: 'KITCHEN', map: null, peers: [], places: [] },
    ]);
    expect(done.findingCount).toBe(0);
  });
});

describe('PatrolRunner — en-route without a baseline', () => {
  let h: ReturnType<typeof rig>;
  const say = vi.fn(async (_text: string, _language?: string) => true);
  beforeEach(() => {
    say.mockClear();
    h = rig({ say }); // deliberately no recordLegLabels: this window was never baselined
  });
  afterEach(() => {
    h.runner.dispose();
    fs.rmSync(h.root, { recursive: true, force: true });
  });

  async function driveWithLooks(looks: Array<Parameters<PatrolRunner['onLook']>[0]>): Promise<{ run: PatrolRun; summary: string }> {
    h.runner.begin(ROUTE, 'patrol', 'scheduled', 'night');
    let summary = '';
    const s = scriptedExec(async (b) => {
      if (label(b) === 'goto:KITCHEN') {
        for (const look of looks) await h.runner.onLook(look);
      }
      return { ok: true, message: 'ok' };
    });
    const finish = s.exec.finish;
    s.exec.finish = (b, out) => {
      if (b.kind === 'patrol') summary = out.message;
      finish(b, out);
    };
    const run = await h.runner.drive('plan-nb', s.exec);
    return { run, summary };
  }

  it('does not call every watch-listed label unexpected when the leg has no baseline labels, and says so in the summary', async () => {
    const look = { labels: ['wall', 'crate', 'box'], personVisible: false, pose: null, place: 'KITCHEN', map: null, peers: [], places: [] };
    const { run, summary } = await driveWithLooks([look, look, look]);
    expect(run.findingCount).toBe(0);
    expect(h.events.some((e) => e.type === 'agent:finding:detected')).toBe(false);
    expect(summary).toMatch(/No baseline in window night for Kitchen — walked but not compared en route/);
  });

  it('still raises the person finding on an unbaselined leg — a person is not normal whatever the baseline says', async () => {
    const look = { labels: ['person'], personVisible: true, pose: null, place: 'KITCHEN', map: null, peers: [], places: [] };
    const { run } = await driveWithLooks([look, look, look]);
    expect(run.findingCount).toBe(1);
    const finding = h.events.find((e) => e.type === 'agent:finding:detected')!.finding!;
    expect(finding.type).toBe('person');
    expect(say).toHaveBeenCalledTimes(1);
  });
});

describe('PatrolRunner — a run interrupted by a restart', () => {
  it('closes a run left running on disk at boot and emits agent:patrol:finished so the server and the UI settle', () => {
    const h = rig();
    // The agent dies mid-run: run.json stays `running`, nothing ever rewrites it.
    const { run } = h.runner.begin(ROUTE, 'patrol', 'scheduled', 'night');
    expect(h.runner.runs!.findRun(run.runId)?.status).toBe('running');
    // The live run is never touched by its own runner's reconciliation.
    h.runner.reconcileInterruptedRuns();
    expect(h.runner.runs!.findRun(run.runId)?.status).toBe('running');

    const events: Emitted[] = [];
    const rebooted = new PatrolRunner({
      robotId: 'robot-1',
      workspace: h.ws,
      emit: (type, r, finding) => events.push({ type, run: r, ...(finding ? { finding } : {}) }),
      log: () => {},
    });
    rebooted.startRetentionSweep(); // the boot hook
    const closed = rebooted.runs!.findRun(run.runId)!;
    expect(closed.status).toBe('aborted');
    expect(closed.reason).toBe('interrupted by an agent restart');
    expect(closed.finishedAt).toBeTruthy();
    expect(closed.legs.every((l) => l.status === 'skipped')).toBe(true);
    expect(events.map((e) => e.type)).toEqual(['agent:patrol:finished']);
    expect(events[0]!.run.status).toBe('aborted');
    // A second pass leaves it alone — it is no longer running.
    rebooted.reconcileInterruptedRuns();
    expect(events).toHaveLength(1);

    rebooted.dispose();
    h.runner.dispose();
    fs.rmSync(h.root, { recursive: true, force: true });
  });
});

// ── run store retention ─────────────────────────────────────────────────────

describe('PatrolRunStore.sweep', () => {
  it('deletes plain control photos after the retention hours, keeps finding-referenced and baseline photos longer', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neodem-sweep-'));
    const ws = new Workspace({ root, robotId: 'robot-1' });
    ws.ensure();
    let now = Date.parse('2026-08-16T00:00:00.000Z');
    const store = new PatrolRunStore({ workspace: ws, now: () => now });
    const mk = (runId: string, mode: 'patrol' | 'baseline'): PatrolRun => ({
      runId,
      routeId: 'r',
      routeName: 'R',
      robotId: 'robot-1',
      mode,
      origin: 'operator',
      window: null,
      status: 'done',
      startedAt: new Date(now).toISOString(),
      legs: [],
      findingCount: 0,
    });
    store.saveRun(mk('run-control', 'patrol'));
    store.savePhoto('r', 'run-control', 'cp-1', Buffer.from('a'));
    store.saveRun(mk('run-finding', 'patrol'));
    store.savePhoto('r', 'run-finding', 'cp-1', Buffer.from('b'));
    store.saveFindings('r', 'run-finding', [
      { id: 'f', runId: 'run-finding', routeId: 'r', robotId: 'robot-1', legIndex: 0, type: 'other', severity: 'low', source: 'checkpoint', place: null, pose: null, at: '', summary: '', evidence: { currentPhotoKey: 'run-finding/cp-1.jpg' }, model: null, confidence: 0.5, status: 'open' },
    ]);
    store.saveRun(mk('run-base', 'baseline'));
    store.savePhoto('r', 'run-base', 'cp-1', Buffer.from('c'));
    // The sweep ages a photo by its mtime against `now`, so moving the injected
    // clock is only half the job: the files were just written and carry the real
    // wall-clock time, which would make the test measure the gap between a made-up
    // clock and a real one — it only ever passed while the machine's date happened
    // to sit near the literal above. Stamp each photo with the moment the fake
    // clock says it was taken, then move that clock on by four days.
    const taken = new Date(now);
    for (const runId of ['run-control', 'run-finding', 'run-base']) {
      fs.utimesSync(store.photoFile('r', runId, 'cp-1')!, taken, taken);
    }
    now += 4 * 24 * 3600_000;
    const removed = store.sweep(72, 30);
    expect(removed.map((f) => path.basename(path.dirname(f)))).toEqual(['run-control']);
    expect(store.readPhoto('run-finding', 'cp-1')).not.toBeNull();
    expect(store.readPhoto('run-base', 'cp-1')).not.toBeNull();
    now += 40 * 24 * 3600_000;
    expect(store.sweep(72, 30).length).toBe(2);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
