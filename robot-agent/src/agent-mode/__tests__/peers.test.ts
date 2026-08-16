/**
 * @file peers.test.ts
 * @description The peer tracker (TASK-207): a foreign-frame peer is dropped
 *              and counted, never kept; a silent peer expires after 3 polls; a
 *              peer the server stops listing leaves at once; obstacles are
 *              footprint + margin discs; nothing happens when disabled.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, vi } from 'vitest';
import { PeerTracker, parseFleetPeer, sameFrame, type FleetPeer } from '../peers.js';

const peer = (over: Partial<FleetPeer> = {}): FleetPeer => ({
  robotId: 'robot-b',
  name: 'Bravo',
  x: 2,
  y: 0,
  headingDeg: 90,
  frame: { kind: 'sim', id: 'g1_dex3_room_scene' },
  place: null,
  zone: null,
  updatedAt: '2026-08-15T10:00:00.000Z',
  footprintRadiusM: 0.35,
  ...over,
});

function tracker(over: Partial<ConstructorParameters<typeof PeerTracker>[0]> = {}) {
  let t = 1_000_000;
  const now = () => t;
  const changes: number[] = [];
  const tr = new PeerTracker({
    enabled: true,
    serverUrl: 'http://server:3001/',
    robotId: 'robot-a',
    pollMs: 2000,
    getFrame: () => ({ kind: 'sim', id: 'g1_dex3_room_scene' }),
    now,
    log: () => {},
    onChange: (p) => changes.push(p.length),
    ...over,
  });
  return { tr, tick: (ms: number) => (t += ms), changes };
}

describe('sameFrame', () => {
  it('matches on kind AND id, and never matches a missing frame', () => {
    expect(sameFrame({ kind: 'sim', id: 'a' }, { kind: 'sim', id: 'a' })).toBe(true);
    expect(sameFrame({ kind: 'sim', id: 'a' }, { kind: 'sim', id: 'b' })).toBe(false);
    expect(sameFrame({ kind: 'sim', id: 'a' }, { kind: 'odom', id: 'a' })).toBe(false);
    expect(sameFrame(null, null)).toBe(false);
    expect(sameFrame({ kind: 'sim', id: 'a' }, null)).toBe(false);
  });
});

describe('parseFleetPeer', () => {
  it('reads a wire peer, defaults the footprint, and rejects junk', () => {
    expect(parseFleetPeer({ robotId: 'r', x: 1, y: 2 })).toMatchObject({
      robotId: 'r',
      name: 'r',
      headingDeg: null,
      frame: null,
      footprintRadiusM: 0.35,
    });
    expect(parseFleetPeer({ robotId: 'r', x: 1, y: 2, frame: { kind: 'odom', id: 'boot-1' } })?.frame).toEqual({
      kind: 'odom',
      id: 'boot-1',
    });
    expect(parseFleetPeer({ robotId: 'r', x: 1, y: 2, frame: { kind: 'weird', id: 'x' } })?.frame).toBeNull();
    expect(parseFleetPeer({ robotId: 'r', x: 'no', y: 2 })).toBeNull();
    expect(parseFleetPeer(null)).toBeNull();
    expect(parseFleetPeer('robot')).toBeNull();
  });
});

describe('PeerTracker', () => {
  it('keeps a same-frame peer, drops a foreign-frame one and counts it', () => {
    const { tr, changes } = tracker();
    tr.ingest([
      peer(),
      peer({ robotId: 'robot-c', name: 'Charlie', frame: { kind: 'odom', id: 'boot-c' } }),
      peer({ robotId: 'robot-d', name: 'Delta', frame: null }),
    ]);
    expect(tr.list().map((p) => p.robotId)).toEqual(['robot-b']);
    expect(tr.status()).toMatchObject({ enabled: true, peers: 1, dropped: 2, lastError: null });
    expect(tr.status().frame).toEqual({ kind: 'sim', id: 'g1_dex3_room_scene' });
    expect(changes).toEqual([1]);
  });

  it('drops EVERY peer when this robot has no frame of its own', () => {
    const { tr } = tracker({ getFrame: () => null });
    tr.ingest([peer(), peer({ robotId: 'robot-c' })]);
    expect(tr.list()).toEqual([]);
    expect(tr.status().dropped).toBe(2);
    expect(tr.status().frame).toBeNull();
  });

  it('expires a peer that stays silent for three polls', async () => {
    let fail = false;
    const fetchImpl = vi.fn(async () => {
      if (fail) throw new Error('ECONNREFUSED');
      return new Response(JSON.stringify({ peers: [peer()] }), { status: 200 });
    }) as unknown as typeof fetch;
    const { tr, tick, changes } = tracker({ fetchImpl });
    await tr.pollOnce();
    expect(tr.list()).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://server:3001/api/robots/robot-a/peers',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    fail = true;
    tick(2000);
    await tr.pollOnce();
    expect(tr.list()).toHaveLength(1); // 1 poll late — still there
    expect(tr.status().lastError).toContain('ECONNREFUSED');
    tick(2000);
    await tr.pollOnce();
    expect(tr.list()).toHaveLength(1); // 2 polls late
    tick(2001);
    await tr.pollOnce();
    expect(tr.list()).toEqual([]); // > 3 polls: gone
    expect(changes.at(-1)).toBe(0);
  });

  it('forgets a peer the server no longer lists, at once', () => {
    const { tr } = tracker();
    tr.ingest([peer(), peer({ robotId: 'robot-c', name: 'Charlie' })]);
    expect(tr.list()).toHaveLength(2);
    tr.ingest([peer()]);
    expect(tr.list().map((p) => p.robotId)).toEqual(['robot-b']);
  });

  it('turns accepted peers into footprint+margin discs, labelled by name', () => {
    const { tr } = tracker();
    tr.ingest([peer({ x: 1.5, y: -0.5, footprintRadiusM: 0.4 })]);
    expect(tr.obstacles()).toEqual([{ x: 1.5, y: -0.5, radiusM: 0.65, label: 'robot Bravo' }]);
  });

  it('only fires onChange when something actually changed', () => {
    const { tr, changes } = tracker();
    tr.ingest([peer()]);
    tr.ingest([peer()]);
    tr.ingest([peer()]);
    expect(changes).toEqual([1]);
    tr.ingest([peer({ x: 2.5 })]);
    expect(changes).toEqual([1, 1]);
  });

  it('is inert when disabled or pollMs is 0', async () => {
    const fetchImpl = vi.fn();
    const off = new PeerTracker({
      enabled: true,
      pollMs: 0,
      serverUrl: 'http://s',
      robotId: 'r',
      getFrame: () => null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    off.start();
    await off.pollOnce();
    off.ingest([peer()]);
    expect(off.isEnabled()).toBe(false);
    expect(off.list()).toEqual([]);
    expect(off.status().enabled).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    off.dispose();
  });

  it('survives a malformed payload without dropping the last good set immediately', async () => {
    let body: unknown = { peers: [peer()] };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
    const { tr } = tracker({ fetchImpl });
    await tr.pollOnce();
    body = { nope: true };
    await tr.pollOnce();
    expect(tr.list()).toHaveLength(1);
    expect(tr.status().lastError).toContain('malformed');
  });
});
