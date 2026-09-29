/**
 * @file control-lease.test.ts
 * @description The control-lease registry (TASK-314): generation fencing, the
 *              persisted high-water across a "restart", local-clock expiry,
 *              stale releases, `verify`, and the zero-stop wiring.
 * @feature robot
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ControlLeaseRegistry,
  hashLeaseId,
  wireControlLeaseStops,
  type InstallRequest,
  type LeaseEvent,
} from '../control-lease.js';

const SECRET = 'raw-lease-id-secret';

function req(generation: number, overrides: Partial<InstallRequest> = {}): InstallRequest {
  return {
    generation,
    leaseIdHash: hashLeaseId(SECRET),
    sessionId: `session-${generation}`,
    userId: 'user-1',
    displayName: 'Ada',
    tenantId: null,
    ttlMs: 5_000,
    ...overrides,
  };
}

describe('ControlLeaseRegistry', () => {
  let dir: string;
  let file: string;
  let clock: number;
  const registries: ControlLeaseRegistry[] = [];

  const make = (): ControlLeaseRegistry => {
    const r = new ControlLeaseRegistry({ robotId: 'robot-1', filePath: file, now: () => clock });
    registries.push(r);
    return r;
  };

  /** Advance the injected clock and the fake timers together. */
  const advance = (ms: number): void => {
    clock += ms;
    vi.advanceTimersByTime(ms);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    clock = 1_000;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'control-lease-'));
    file = path.join(dir, 'control-lease-robot-1.json');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    for (const r of registries.splice(0)) r.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('starts with nothing installed and high-water 0 when no file exists', () => {
    const r = make();
    expect(r.highWaterMark).toBe(0);
    expect(r.observe()).toMatchObject({ state: 'none', generation: null, bound: 0, enforced: false });
  });

  it('refuses a generation at or below the high-water and fences the previous lease on a higher one', () => {
    const r = make();
    const events: LeaseEvent[] = [];
    r.subscribe((e) => events.push(e));

    expect(r.install(req(3))).toEqual({ ok: true, generation: 3, fencedGeneration: null });
    expect(r.install(req(3))).toEqual({ ok: false, code: 'stale_generation', highWater: 3 });
    expect(r.install(req(2))).toEqual({ ok: false, code: 'stale_generation', highWater: 3 });
    expect(r.observe().generation).toBe(3);

    expect(r.install(req(4, { userId: 'user-2' }))).toEqual({ ok: true, generation: 4, fencedGeneration: 3 });
    expect(events).toEqual([
      { type: 'installed', generation: 3 },
      { type: 'fenced', generation: 3 },
      { type: 'installed', generation: 4 },
    ]);
    expect(r.observe()).toMatchObject({ state: 'held', generation: 4, userId: 'user-2' });
    expect(r.verify(SECRET, 3)).toBe(false);
    expect(r.verify(SECRET, 4)).toBe(true);
  });

  it('persists the high-water before install returns; a new registry has nothing installed and refuses the old generation', () => {
    const r1 = make();
    expect(r1.install(req(7)).ok).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ robotId: 'robot-1', highWater: 7 });

    const r2 = make();
    expect(r2.highWaterMark).toBe(7);
    expect(r2.observe()).toMatchObject({ state: 'none', generation: null });
    expect(r2.install(req(7))).toEqual({ ok: false, code: 'stale_generation', highWater: 7 });
    expect(r2.renew({ generation: 7, ttlMs: 5_000 })).toEqual({ ok: false, code: 'not_installed' });
    expect(r2.verify(SECRET, 7)).toBe(false);
    expect(r2.install(req(8)).ok).toBe(true);
  });

  it('fails closed on a corrupt high-water file', () => {
    fs.writeFileSync(file, '{not json');
    const r = make();
    expect(r.install(req(1))).toEqual({ ok: false, code: 'high_water_unreadable' });
    expect(r.install(req(1_000_000))).toEqual({ ok: false, code: 'high_water_unreadable' });
    expect(r.observe()).toMatchObject({ state: 'none', error: 'high_water_unreadable' });
  });

  it('fails closed on a high-water that is not a non-negative integer', () => {
    fs.writeFileSync(file, JSON.stringify({ robotId: 'robot-1', highWater: -1 }));
    expect(make().install(req(5))).toEqual({ ok: false, code: 'high_water_unreadable' });
  });

  it('refuses an install whose high-water cannot be written and keeps the old lease in charge', () => {
    const r = make();
    expect(r.install(req(1)).ok).toBe(true);
    // Replace the file's directory with a plain file so the atomic write fails.
    fs.rmSync(dir, { recursive: true, force: true });
    fs.writeFileSync(dir, 'blocker');
    try {
      expect(r.install(req(2))).toEqual({ ok: false, code: 'high_water_unwritable' });
      expect(r.observe()).toMatchObject({ state: 'held', generation: 1 });
      expect(r.highWaterMark).toBe(1);
    } finally {
      fs.rmSync(dir, { force: true });
      fs.mkdirSync(dir);
    }
  });

  it('expires at the deadline on its own timer, with no call, and a late renew does not resurrect it', () => {
    const r = make();
    const events: LeaseEvent[] = [];
    r.subscribe((e) => events.push(e));
    r.install(req(1, { ttlMs: 2_000 }));

    advance(1_999);
    expect(events.map((e) => e.type)).toEqual(['installed']);
    advance(1);
    expect(events).toEqual([
      { type: 'installed', generation: 1 },
      { type: 'expired', generation: 1 },
    ]);
    expect(r.observe()).toMatchObject({ state: 'expired', generation: 1, expiresInMs: null });

    expect(r.renew({ generation: 1, ttlMs: 5_000 })).toEqual({ ok: false, code: 'expired' });
    expect(r.observe().state).toBe('expired');
    expect(r.verify(SECRET, 1)).toBe(false);
  });

  it('renew extends the deadline and reports the bound count; wrong generation is not_installed', () => {
    const r = make();
    const events: LeaseEvent[] = [];
    r.subscribe((e) => events.push(e));
    r.install(req(1, { ttlMs: 2_000 }));
    r.setBoundCount(1, 2);
    r.setBoundCount(99, 7); // not the installed generation: ignored

    advance(1_500);
    expect(r.renew({ generation: 1, ttlMs: 2_000 })).toEqual({ ok: true, bound: 2 });
    expect(r.renew({ generation: 2, ttlMs: 2_000 })).toEqual({ ok: false, code: 'not_installed' });
    advance(1_500);
    expect(r.observe()).toMatchObject({ state: 'held', expiresInMs: 500, bound: 2 });
    advance(500);
    expect(r.observe().state).toBe('expired');
    expect(events.map((e) => e.type)).toEqual(['installed', 'renewed', 'expired']);
  });

  it('a lazy check expires the lease even if the timer has not run', () => {
    const r = make();
    r.install(req(1, { ttlMs: 1_000 }));
    clock += 1_000; // clock only, timers not advanced
    expect(r.verify(SECRET, 1)).toBe(false);
    expect(r.observe().state).toBe('expired');
  });

  it('a release for a stale generation is a no-op; the current one releases once and emits fenced', () => {
    const r = make();
    const events: LeaseEvent[] = [];
    r.install(req(1));
    r.install(req(2));
    r.subscribe((e) => events.push(e));

    expect(r.release({ generation: 1 })).toEqual({ ok: true, released: false });
    expect(r.observe()).toMatchObject({ state: 'held', generation: 2 });
    expect(r.verify(SECRET, 2)).toBe(true);
    expect(events).toEqual([]);

    expect(r.release({ generation: 2 })).toEqual({ ok: true, released: true });
    expect(r.release({ generation: 2 })).toEqual({ ok: true, released: false });
    expect(events).toEqual([{ type: 'fenced', generation: 2 }]);
    expect(r.observe().state).toBe('released');
    expect(r.renew({ generation: 2, ttlMs: 5_000 })).toEqual({ ok: false, code: 'not_installed' });
  });

  it('verify rejects a wrong secret, a wrong generation, an expired and a released lease', () => {
    const r = make();
    r.install(req(1, { ttlMs: 1_000 }));
    expect(r.verify(SECRET, 1)).toBe(true);
    expect(r.verify('wrong', 1)).toBe(false);
    expect(r.verify(SECRET, 2)).toBe(false);
    advance(1_000);
    expect(r.verify(SECRET, 1)).toBe(false);

    r.install(req(2));
    expect(r.verify(SECRET, 2)).toBe(true);
    r.release({ generation: 2 });
    expect(r.verify(SECRET, 2)).toBe(false);
  });

  it('observe never exposes the hash', () => {
    const r = make();
    r.install(req(1));
    const text = JSON.stringify(r.observe());
    expect(text).not.toContain(hashLeaseId(SECRET));
    expect(Object.keys(r.observe())).not.toContain('leaseIdHash');
  });

  it('reports enforcement from the injected flag', () => {
    const r = new ControlLeaseRegistry({ robotId: 'robot-1', filePath: file, now: () => clock, enforced: () => true });
    registries.push(r);
    expect(r.observe().enforced).toBe(true);
  });

  describe('wireControlLeaseStops', () => {
    it('sends exactly one zero-velocity stop per fence and per expiry, none on install or renew', () => {
      const r = make();
      const client = { locoMove: vi.fn().mockResolvedValue({ ok: true }) };
      wireControlLeaseStops(r, client);

      r.install(req(1, { ttlMs: 1_000 }));
      r.renew({ generation: 1, ttlMs: 1_000 });
      expect(client.locoMove).not.toHaveBeenCalled();

      r.install(req(2, { ttlMs: 1_000 })); // fences 1
      expect(client.locoMove).toHaveBeenCalledTimes(1);
      expect(client.locoMove).toHaveBeenLastCalledWith(0, 0, 0, 0);

      advance(1_000); // 2 expires
      expect(client.locoMove).toHaveBeenCalledTimes(2);
      expect(client.locoMove).toHaveBeenLastCalledWith(0, 0, 0, 0);

      r.install(req(3));
      r.release({ generation: 3 });
      expect(client.locoMove).toHaveBeenCalledTimes(3);
    });

    it('swallows a failing stop instead of throwing into the registry', async () => {
      const r = make();
      const client = { locoMove: vi.fn().mockRejectedValue(new Error('sidecar down')) };
      wireControlLeaseStops(r, client);
      r.install(req(1));
      expect(r.release({ generation: 1 })).toEqual({ ok: true, released: true });
      await vi.runAllTimersAsync();
      expect(client.locoMove).toHaveBeenCalledTimes(1);
    });
  });
});
