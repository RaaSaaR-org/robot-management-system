/**
 * @file controlLeaseFanout.test.ts
 * @description Control-lease transitions reach observers of the robot's tenant
 *              only (TASK-318): socket identity from the upgrade URL or an
 *              in-band token, the tenant rule, and the bus → socket path.
 * @feature websocket
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { IncomingMessage } from 'http';
import {
  deliverControlLeaseTransition,
  identityFromToken,
  identityFromUpgrade,
  mayObserveTenant,
  type AccessTokenVerifier,
  type SocketIdentity,
} from '../socketIdentity.js';
import { onControlLeaseTransition, publishControlLeaseTransition } from '../../services/controlLeaseEvents.js';
import type { ControlLeaseTransition } from '../../services/ControlLeaseService.js';

const TOKENS: Record<string, { userId: string; role: string; tenantId: string | null }> = {
  'tok-a': { userId: 'alice', role: 'viewer', tenantId: 'tenant-a' },
  'tok-b': { userId: 'mallory', role: 'owner', tenantId: 'tenant-b' },
  'tok-root': { userId: 'root', role: 'super-admin', tenantId: null },
};
const verify: AccessTokenVerifier = (token) => TOKENS[token] ?? null;

function upgrade(url: string): IncomingMessage {
  return { url } as IncomingMessage;
}

const SECRET = 'the-lease-secret';

function transition(tenantId: string | null): ControlLeaseTransition {
  return {
    tenantId,
    event: {
      type: 'control_lease',
      robotId: 'robot-1',
      state: 'held',
      generation: 3,
      holder: { userId: 'alice', displayName: 'Alice' },
      expiresAt: '2026-09-30T10:00:05.000Z',
    },
  };
}

class FakeSocket {
  sent: string[] = [];
}

describe('socket identity', () => {
  it('reads the token from the upgrade URL, and nothing without one', () => {
    expect(identityFromUpgrade(upgrade('/api/a2a/ws?token=tok-a'), verify, false)).toEqual({
      userId: 'alice',
      role: 'viewer',
      tenantId: 'tenant-a',
    });
    expect(identityFromUpgrade(upgrade('/api/a2a/ws'), verify, false)).toBeNull();
    expect(identityFromUpgrade(upgrade('/api/a2a/ws?token=forged'), verify, false)).toBeNull();
    expect(identityFromUpgrade(undefined, verify, false)).toBeNull();
  });

  it('is the dev mock user under AUTH_DISABLED, like every request', () => {
    expect(identityFromUpgrade(upgrade('/api/a2a/ws'), verify, true)).toMatchObject({ role: 'super-admin' });
  });

  it('accepts an in-band token and rejects junk', () => {
    expect(identityFromToken('tok-b', verify)?.tenantId).toBe('tenant-b');
    expect(identityFromToken(42, verify)).toBeNull();
    expect(identityFromToken('', verify)).toBeNull();
  });

  it('applies the lease routes\' tenant rule', () => {
    const a: SocketIdentity = { userId: 'a', role: 'viewer', tenantId: 'tenant-a' };
    expect(mayObserveTenant(a, 'tenant-a')).toBe(true);
    expect(mayObserveTenant(a, 'tenant-b')).toBe(false);
    expect(mayObserveTenant(a, null)).toBe(true);
    expect(mayObserveTenant({ ...a, role: 'super-admin', tenantId: null }, 'tenant-b')).toBe(true);
    expect(mayObserveTenant(undefined, 'tenant-a')).toBe(false);
  });
});

describe('control-lease fan-out, two tenants', () => {
  let stop: (() => void) | undefined;
  afterEach(() => stop?.());

  it('observers of the robot\'s tenant receive the transition; another tenant and anonymous sockets receive nothing', () => {
    const inA = new FakeSocket();
    const alsoA = new FakeSocket();
    const inB = new FakeSocket();
    const anonymous = new FakeSocket();
    const root = new FakeSocket();
    const clients = new Set([inA, alsoA, inB, anonymous, root]);
    const identities = new WeakMap<FakeSocket, SocketIdentity>();
    identities.set(inA, identityFromUpgrade(upgrade('/ws?token=tok-a'), verify, false)!);
    identities.set(alsoA, identityFromToken('tok-a', verify)!);
    identities.set(inB, identityFromToken('tok-b', verify)!);
    identities.set(root, identityFromToken('tok-root', verify)!);

    // The production path: the service publishes on the bus, the WS server listens.
    stop = onControlLeaseTransition((t) =>
      deliverControlLeaseTransition(clients, identities, t, (client, message) => client.sent.push(message))
    );
    publishControlLeaseTransition(transition('tenant-a'));

    expect(inA.sent).toHaveLength(1);
    expect(alsoA.sent).toHaveLength(1);
    expect(root.sent).toHaveLength(1);
    expect(inB.sent).toHaveLength(0);
    expect(anonymous.sent).toHaveLength(0);

    const wire = JSON.parse(inA.sent[0]);
    expect(wire).toMatchObject({
      type: 'control_lease',
      robotId: 'robot-1',
      state: 'held',
      generation: 3,
      holder: { userId: 'alice', displayName: 'Alice' },
      expiresAt: '2026-09-30T10:00:05.000Z',
    });
    // Routing only: the tenant is not part of the payload, and nothing secret is.
    expect(wire).not.toHaveProperty('tenantId');
    expect(wire).not.toHaveProperty('leaseId');
    expect(wire).not.toHaveProperty('leaseIdHash');
    expect(inA.sent[0]).not.toContain(SECRET);
  });

  it('a transition of tenant-b reaches tenant-b only', () => {
    const inA = new FakeSocket();
    const inB = new FakeSocket();
    const identities = new WeakMap<FakeSocket, SocketIdentity>();
    identities.set(inA, identityFromToken('tok-a', verify)!);
    identities.set(inB, identityFromToken('tok-b', verify)!);
    const delivered = deliverControlLeaseTransition([inA, inB], identities, transition('tenant-b'), (c, m) =>
      c.sent.push(m)
    );
    expect(delivered).toBe(1);
    expect(inA.sent).toHaveLength(0);
    expect(inB.sent).toHaveLength(1);
  });

  it('a throwing listener does not break the bus for the others', () => {
    const seen: string[] = [];
    const stopThrowing = onControlLeaseTransition(() => {
      throw new Error('boom');
    });
    stop = onControlLeaseTransition((t) => seen.push(t.event.state));
    publishControlLeaseTransition(transition('tenant-a'));
    stopThrowing();
    expect(seen).toEqual(['held']);
  });
});
