/**
 * @file baseline.test.ts
 * @description BaselineStore (TASK-212): a checkpoint's photo + answers round-
 *              trip through the workspace, `markNormal` folds a finding into
 *              the baseline (checklist item / leg labels / map blob), and two
 *              time windows never see each other's baseline.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BaselineStore, DEFAULT_WINDOW } from '../baseline.js';
import { Workspace } from '../workspace.js';
import type { ChecklistAnswers } from '../inspector.js';
import type { PatrolFinding } from '../types.js';

const ANSWERS: ChecklistAnswers = {
  personPresent: false,
  doorState: 'closed',
  objectOnFloor: { yes: false, what: '' },
  lightsOn: 'no',
  outOfPlace: [],
  expectations: [],
  oneLine: 'a hallway',
  degraded: false,
};

function finding(partial: Partial<PatrolFinding>): PatrolFinding {
  return {
    id: 'f-1',
    runId: 'run-2',
    routeId: 'route-a',
    robotId: 'robot-1',
    checkpointId: 'cp-1',
    legIndex: 0,
    type: 'object_on_floor',
    severity: 'medium',
    source: 'checkpoint',
    place: 'HALLWAY',
    pose: null,
    at: '2026-08-16T10:00:00.000Z',
    summary: 'box on the floor',
    evidence: {},
    model: null,
    confidence: 0.7,
    status: 'open',
    ...partial,
  };
}

describe('BaselineStore', () => {
  let root: string;
  let ws: Workspace;
  let store: BaselineStore;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'neodem-baseline-'));
    ws = new Workspace({ root, robotId: 'robot-1' });
    ws.ensure();
    store = new BaselineStore({ workspace: ws, now: () => new Date('2026-08-16T10:00:00.000Z') });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('round-trips a checkpoint (photo, answers, model) and the leg labels + map', () => {
    expect(store.exists('route-a', 'day')).toBe(false);
    const rec = store.recordCheckpoint('route-a', 'day', {
      checkpointId: 'cp-1',
      runId: 'run-1',
      photo: Buffer.from('JPEGBYTES'),
      answers: ANSWERS,
      model: 'ollama/qwen2.5vl:7b',
    });
    expect(rec.photoKey).toBe('run-1/cp-1.jpg');
    store.recordLegLabels('route-a', 'day', 0, ['Wall', 'crate', 'wall']);
    store.recordMap('route-a', 'day', null);

    const data = store.load('route-a', 'day');
    expect(data.runId).toBe('run-1');
    expect(data.checkpoints['cp-1']).toMatchObject({ checkpointId: 'cp-1', answers: ANSWERS, model: 'ollama/qwen2.5vl:7b', photoKey: 'run-1/cp-1.jpg' });
    expect(data.legs['0']).toEqual(['crate', 'wall']);
    expect(store.readPhoto('route-a', 'day', 'cp-1')?.toString()).toBe('JPEGBYTES');
    expect(store.legLabels('route-a', 'day', 0)).toEqual(['crate', 'wall']);
    expect(store.exists('route-a', 'day')).toBe(true);
    expect(store.windows('route-a')).toEqual(['day']);
    // On disk where the task says: patrol/<routeId>/baseline/<window>/
    expect(fs.existsSync(path.join(root, 'patrol', 'route-a', 'baseline', 'day', 'cp-1.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'patrol', 'route-a', 'baseline', 'day', 'checkpoints.json'))).toBe(true);
  });

  it('a retake without a photo (person in frame) removes the older photo rather than keeping it', () => {
    store.recordCheckpoint('route-a', null, { checkpointId: 'cp-1', runId: 'run-1', photo: Buffer.from('OLD'), answers: ANSWERS, model: null });
    store.recordCheckpoint('route-a', null, { checkpointId: 'cp-1', runId: 'run-2', photo: null, answers: { ...ANSWERS, personPresent: true }, model: null });
    expect(store.readPhoto('route-a', null, 'cp-1')).toBeNull();
    expect(store.checkpoint('route-a', null, 'cp-1')?.photoKey).toBeNull();
    expect(store.load('route-a', null).window).toBe(DEFAULT_WINDOW);
  });

  it('keeps windows apart: a day baseline is not a night baseline', () => {
    store.recordCheckpoint('route-a', 'day', { checkpointId: 'cp-1', runId: 'run-1', photo: Buffer.from('DAY'), answers: { ...ANSWERS, lightsOn: 'yes' }, model: null });
    store.recordCheckpoint('route-a', 'night', { checkpointId: 'cp-1', runId: 'run-9', photo: Buffer.from('NIGHT'), answers: { ...ANSWERS, lightsOn: 'no' }, model: null });
    expect(store.checkpoint('route-a', 'day', 'cp-1')?.answers?.lightsOn).toBe('yes');
    expect(store.checkpoint('route-a', 'night', 'cp-1')?.answers?.lightsOn).toBe('no');
    expect(store.readPhoto('route-a', 'night', 'cp-1')?.toString()).toBe('NIGHT');
    expect(store.windows('route-a').sort()).toEqual(['day', 'night']);
    expect(store.exists('route-b', 'day')).toBe(false);
  });

  it('markNormal folds a checklist finding, a label finding and a blob finding into the baseline', () => {
    store.recordCheckpoint('route-a', 'day', { checkpointId: 'cp-1', runId: 'run-1', photo: null, answers: ANSWERS, model: null });
    store.recordLegLabels('route-a', 'day', 0, ['wall']);

    const c = store.markNormal(finding({ evidence: { checklistDiff: [{ item: 'objectOnFloor', baseline: 'no', current: 'yes: box' }] } }), 'day');
    expect(c.ok).toBe(true);
    expect(store.checkpoint('route-a', 'day', 'cp-1')?.acceptedAnswers.objectOnFloor).toEqual(expect.arrayContaining(['yes', 'box']));

    const l = store.markNormal(finding({ type: 'unexpected_object', source: 'enroute_semantic', checkpointId: null, evidence: { labels: { added: ['crate'], missing: [] } } }), 'day');
    expect(l.ok).toBe(true);
    expect(store.legLabels('route-a', 'day', 0)).toEqual(['crate', 'wall']);

    const b = store.markNormal(finding({ type: 'unexpected_object', source: 'enroute_geometric', checkpointId: null, evidence: { blob: { x: 1.2, y: -0.4, areaM2: 0.36, cells: 36 } } }), 'day');
    expect(b.ok).toBe(true);
    const blobs = store.load('route-a', 'day').acceptedBlobs;
    expect(blobs).toHaveLength(1);
    expect(blobs[0]).toMatchObject({ x: 1.2, y: -0.4, place: 'HALLWAY' });
    expect(blobs[0]!.radiusM).toBeGreaterThan(0.5);

    // Nothing to fold → an honest refusal, and the night window was never touched.
    expect(store.markNormal(finding({ evidence: {} }), 'day').ok).toBe(false);
    expect(store.exists('route-a', 'night')).toBe(false);
  });

  it('refuses ids that are not safe path segments', () => {
    expect(() => store.dir('../etc', 'day')).toThrow(/not usable/);
    expect(store.photoFile('route-a', 'day', 'a/b')).toBeNull();
  });

  it('is erased with the workspace (GDPR) — photos and JSON alike', () => {
    store.recordCheckpoint('route-a', 'day', { checkpointId: 'cp-1', runId: 'run-1', photo: Buffer.from('X'), answers: ANSWERS, model: null });
    const result = ws.erase();
    expect(result.removed.some((f) => f.endsWith('cp-1.jpg'))).toBe(true);
    expect(fs.existsSync(ws.patrolDir)).toBe(false);
  });
});
