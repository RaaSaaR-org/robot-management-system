/**
 * @file PatrolPhotoStore.test.ts
 * @description Local-disk patrol photo store (TASK-212): put/get round trip
 *              with metadata, path-segment safety, listRun/existingKeys, and
 *              the retention sweep (control 72 h, baseline/finding 30 d, the
 *              live baseline exempt).
 * @feature patrol
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { PatrolPhotoStore, isSafePhotoKey, isSafeIdSegment, photoRetentionFromEnv } from '../services/PatrolPhotoStore.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

describe('PatrolPhotoStore (local disk)', () => {
  let dir: string;
  let now = Date.parse('2026-08-16T12:00:00.000Z');
  let store: PatrolPhotoStore;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'patrol-photos-'));
    now = Date.parse('2026-08-16T12:00:00.000Z');
    store = new PatrolPhotoStore({ localDir: dir, forceLocal: true, now: () => now });
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('validates path segments', () => {
    expect(isSafePhotoKey('cp-1.jpg')).toBe(true);
    expect(isSafePhotoKey('../etc/passwd')).toBe(false);
    expect(isSafePhotoKey('a/b.jpg')).toBe(false);
    expect(isSafePhotoKey('')).toBe(false);
    expect(isSafeIdSegment('robot-001')).toBe(true);
    expect(isSafeIdSegment('..')).toBe(false);
  });

  it('put/get round trip keeps bytes and metadata; missing → null', async () => {
    const meta = await store.put({ robotId: 'robot-001', runId: 'run-1', key: 'cp-1.jpg', data: JPEG, kind: 'control', checkpointId: 'cp-1', routeId: 'route-1', capturedAt: '2026-08-16T11:59:00.000Z' });
    expect(meta).toMatchObject({ robotId: 'robot-001', runId: 'run-1', key: 'cp-1.jpg', kind: 'control', contentType: 'image/jpeg', size: JPEG.length, uploadedAt: '2026-08-16T12:00:00.000Z' });
    const got = await store.get('robot-001', 'run-1', 'cp-1.jpg');
    expect(got).not.toBeNull();
    expect(Buffer.compare(got!.data, JPEG)).toBe(0);
    expect(got!.meta.kind).toBe('control');
    expect(got!.meta.checkpointId).toBe('cp-1');
    expect(await store.get('robot-001', 'run-1', 'nope.jpg')).toBeNull();
    expect(await store.get('robot-001', '../run-1', 'cp-1.jpg')).toBeNull();
    await expect(store.put({ robotId: 'r', runId: 'x', key: '../evil.jpg', data: JPEG, kind: 'control' })).rejects.toThrow(/invalid/);
    // stays under the root
    const files = await fs.readdir(path.join(dir, 'robot-001', 'run-1'));
    expect(files.sort()).toEqual(['cp-1.jpg', 'cp-1.jpg.json']);
  });

  it('listRun returns metadata for the run only', async () => {
    await store.put({ robotId: 'robot-001', runId: 'run-1', key: 'cp-1.jpg', data: JPEG, kind: 'control' });
    await store.put({ robotId: 'robot-001', runId: 'run-1', key: 'cp-2.jpg', data: JPEG, kind: 'finding' });
    await store.put({ robotId: 'robot-001', runId: 'run-2', key: 'cp-1.jpg', data: JPEG, kind: 'baseline' });
    const list = await store.listRun('robot-001', 'run-1');
    expect(list.map((m) => [m.key, m.kind]).sort()).toEqual([['cp-1.jpg', 'control'], ['cp-2.jpg', 'finding']]);
    expect(await store.listRun('robot-001', 'run-9')).toEqual([]);
  });

  it('sweep deletes control photos after 72 h and baseline/finding photos after 30 d', async () => {
    await store.put({ robotId: 'robot-001', runId: 'run-1', key: 'ctrl.jpg', data: JPEG, kind: 'control' });
    await store.put({ robotId: 'robot-001', runId: 'run-1', key: 'find.jpg', data: JPEG, kind: 'finding' });
    await store.put({ robotId: 'robot-001', runId: 'base', key: 'base.jpg', data: JPEG, kind: 'baseline' });

    now += 71 * 3600_000;
    let r = await store.sweep({ controlHours: 72, keepDays: 30 });
    expect(r).toEqual({ scanned: 3, deleted: 0, errors: [] });

    now += 2 * 3600_000; // 73 h
    r = await store.sweep({ controlHours: 72, keepDays: 30 });
    expect(r.deleted).toBe(1);
    expect(await store.get('robot-001', 'run-1', 'ctrl.jpg')).toBeNull();
    expect(await store.get('robot-001', 'run-1', 'find.jpg')).not.toBeNull();

    now += 31 * 86400_000;
    r = await store.sweep({ controlHours: 72, keepDays: 30 });
    expect(r.deleted).toBe(2);
    expect(await store.listRun('robot-001', 'run-1')).toEqual([]);
    expect(await store.listRun('robot-001', 'base')).toEqual([]);
    // empty run dirs are pruned
    expect(await fs.readdir(path.join(dir, 'robot-001'))).toEqual([]);
  });

  it('existingKeys lists the photos a run really still has (sidecars excluded)', async () => {
    await store.put({ robotId: 'robot-001', runId: 'run-1', key: 'cp-1.jpg', data: JPEG, kind: 'baseline' });
    await store.put({ robotId: 'robot-001', runId: 'run-1', key: 'cp-2.jpg', data: JPEG, kind: 'baseline' });
    expect([...(await store.existingKeys('robot-001', 'run-1'))].sort()).toEqual(['cp-1.jpg', 'cp-2.jpg']);
    await store.delete('robot-001', 'run-1', 'cp-2.jpg');
    expect([...(await store.existingKeys('robot-001', 'run-1'))]).toEqual(['cp-1.jpg']);
    expect(await store.existingKeys('robot-001', 'run-9')).toEqual(new Set());
  });

  it('sweep keeps the photos of the run still serving as a baseline, and lets a superseded one age out', async () => {
    // The baseline pointer (PatrolService.getBaseline) has no age bound, so a
    // site that baselined in January and patrols nightly used to lose the
    // frames on day 31 while the route still reported a baseline — every
    // photo pair then showed "photo unavailable" on its baseline half.
    const live = new PatrolPhotoStore({ localDir: dir, forceLocal: true, now: () => now, protectedRuns: async () => new Set(['base-live']) });
    await live.put({ robotId: 'robot-001', runId: 'base-live', key: 'cp-1.jpg', data: JPEG, kind: 'baseline' });
    await live.put({ robotId: 'robot-001', runId: 'base-old', key: 'cp-1.jpg', data: JPEG, kind: 'baseline' });
    await live.put({ robotId: 'robot-001', runId: 'base-live', key: 'ctrl.jpg', data: JPEG, kind: 'control' });

    now += 31 * 86400_000;
    const r = await live.sweep({ controlHours: 72, keepDays: 30 });
    expect(r.deleted).toBe(2); // the superseded baseline and the live run's control frame
    // Only the baseline kind is exempt: a control frame of the same run still
    // goes at 72 h, so nothing keeps a picture of a person longer than before.
    expect(r.errors).toEqual([]);
    expect(await live.get('robot-001', 'base-live', 'cp-1.jpg')).not.toBeNull();
    expect(await live.get('robot-001', 'base-old', 'cp-1.jpg')).toBeNull();
    expect(await live.get('robot-001', 'base-live', 'ctrl.jpg')).toBeNull();
  });

  it('sweep keeps every baseline photo when it cannot find out which run is the baseline', async () => {
    const blind = new PatrolPhotoStore({ localDir: dir, forceLocal: true, now: () => now, protectedRuns: async () => { throw new Error('db down'); } });
    await blind.put({ robotId: 'robot-001', runId: 'base', key: 'cp-1.jpg', data: JPEG, kind: 'baseline' });
    await blind.put({ robotId: 'robot-001', runId: 'run-1', key: 'find.jpg', data: JPEG, kind: 'finding' });
    now += 31 * 86400_000;
    const r = await blind.sweep({ controlHours: 72, keepDays: 30 });
    // A lost sweep round is recoverable; a lost baseline is not.
    expect(await blind.get('robot-001', 'base', 'cp-1.jpg')).not.toBeNull();
    expect(await blind.get('robot-001', 'run-1', 'find.jpg')).toBeNull();
    expect(r.errors[0]).toMatch(/protected runs: db down/);
  });

  it('sweep on an empty root is a no-op; retention env parsing has defaults', async () => {
    const empty = new PatrolPhotoStore({ localDir: path.join(dir, 'never-created'), forceLocal: true });
    expect(await empty.sweep()).toEqual({ scanned: 0, deleted: 0, errors: [] });
    expect(photoRetentionFromEnv({})).toEqual({ controlHours: 72, keepDays: 30 });
    expect(photoRetentionFromEnv({ PATROL_PHOTO_RETENTION_H: '24', PATROL_PHOTO_RETENTION_DAYS: '7' })).toEqual({ controlHours: 24, keepDays: 7 });
    expect(photoRetentionFromEnv({ PATROL_PHOTO_RETENTION_H: '-1' })).toEqual({ controlHours: 72, keepDays: 30 });
  });
});
