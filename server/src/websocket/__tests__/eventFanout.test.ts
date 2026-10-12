/**
 * @file eventFanout.test.ts
 * @description Who receives a broadcast event (TASK-366): identified sockets
 * only, and a robot's events only within the robot's tenant.
 * @feature websocket
 */

import { describe, it, expect, vi } from 'vitest';
import {
  deliverEvent,
  deliverEventPerSocket,
  RobotTenantResolver,
  TenantResolver,
  UNRESOLVED_ROBOT_TENANT,
} from '../eventFanout.js';
import type { SocketIdentity } from '../socketIdentity.js';

type Client = { name: string };

function fixture() {
  const anonymous: Client = { name: 'anonymous' };
  const ownerA: Client = { name: 'ownerA' };
  const ownerB: Client = { name: 'ownerB' };
  const admin: Client = { name: 'admin' };
  const identities = new WeakMap<Client, SocketIdentity>([
    [ownerA, { userId: 'a', role: 'owner', tenantId: 'tenant-a' }],
    [ownerB, { userId: 'b', role: 'owner', tenantId: 'tenant-b' }],
    [admin, { userId: 'root', role: 'super-admin', tenantId: null }],
  ]);
  const received: string[] = [];
  const send = (client: Client) => received.push(client.name);
  return { clients: [anonymous, ownerA, ownerB, admin], identities, received, send };
}

describe('deliverEvent', () => {
  it('never sends to a socket that has not proved an identity', () => {
    const f = fixture();
    deliverEvent(f.clients, f.identities, '{}', f.send);
    expect(f.received).toEqual(['ownerA', 'ownerB', 'admin']);
  });

  it("sends a robot's event only to its tenant and to super-admins", () => {
    const f = fixture();
    deliverEvent(f.clients, f.identities, '{}', f.send, 'tenant-a');
    expect(f.received).toEqual(['ownerA', 'admin']);
  });

  it('treats a robot without a tenant as visible to every identified socket', () => {
    const f = fixture();
    deliverEvent(f.clients, f.identities, '{}', f.send, null);
    expect(f.received).toEqual(['ownerA', 'ownerB', 'admin']);
  });

  it('shows an event whose robot tenant could not be read to super-admins only', () => {
    const f = fixture();
    deliverEvent(f.clients, f.identities, '{}', f.send, UNRESOLVED_ROBOT_TENANT);
    expect(f.received).toEqual(['admin']);
  });
});

describe('RobotTenantResolver', () => {
  it('reads a robot once and serves the next events from memory', async () => {
    const lookup = vi.fn(async () => 'tenant-a');
    const resolver = new RobotTenantResolver(lookup);
    expect(resolver.peek('r1')).toBeUndefined();
    await Promise.all([resolver.resolve('r1'), resolver.resolve('r1')]);
    expect(resolver.peek('r1')).toBe('tenant-a');
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('reads again after forget (a robot re-registered elsewhere)', async () => {
    const lookup = vi.fn().mockResolvedValueOnce('tenant-a').mockResolvedValueOnce('tenant-b');
    const resolver = new RobotTenantResolver(lookup);
    await resolver.resolve('r1');
    resolver.forget('r1');
    expect(resolver.peek('r1')).toBeUndefined();
    expect(await resolver.resolve('r1')).toBe('tenant-b');
  });

  it('does not cache a failed lookup', async () => {
    const lookup = vi.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce(null);
    const resolver = new RobotTenantResolver(lookup);
    await expect(resolver.resolve('r1')).rejects.toThrow('db down');
    expect(resolver.peek('r1')).toBeUndefined();
    expect(await resolver.resolve('r1')).toBeNull();
    expect(resolver.peek('r1')).toBeNull();
  });
});

describe('TenantResolver (TASK-368)', () => {
  it('does not remember an entity that was not found, so a later event retries', async () => {
    const lookup = vi.fn().mockResolvedValueOnce(UNRESOLVED_ROBOT_TENANT).mockResolvedValueOnce('tenant-a');
    const resolver = new TenantResolver(lookup);
    expect(await resolver.resolve('dataset:d1')).toBe(UNRESOLVED_ROBOT_TENANT);
    expect(resolver.peek('dataset:d1')).toBeUndefined();
    expect(await resolver.resolve('dataset:d1')).toBe('tenant-a');
    expect(resolver.peek('dataset:d1')).toBe('tenant-a');
  });

  it('keeps at most maxEntries answers, dropping the oldest first', async () => {
    const resolver = new TenantResolver(async (key) => `tenant-of-${key}`, 2);
    await resolver.resolve('a');
    await resolver.resolve('b');
    await resolver.resolve('c');
    expect(resolver.peek('a')).toBeUndefined();
    expect(resolver.peek('b')).toBe('tenant-of-b');
    expect(resolver.peek('c')).toBe('tenant-of-c');
  });
});

describe('deliverEventPerSocket', () => {
  it('builds each identified socket its own message and skips a null one', () => {
    const f = fixture();
    const sent: string[] = [];
    deliverEventPerSocket(
      f.clients,
      f.identities,
      (identity) => (identity.tenantId === 'tenant-b' ? null : `for-${identity.userId}`),
      (_client, message) => sent.push(message)
    );
    expect(sent).toEqual(['for-a', 'for-root']);
  });
});
