/**
 * @file eventFanout.ts
 * @description Who receives a broadcast event on `/api/a2a/ws` (TASK-366).
 *              Only sockets that proved who they are, and for an event about a
 *              robot only sockets that may observe that robot's tenant.
 * @feature websocket
 *
 * Before this, every event — robot telemetry, registrations, commands, task
 * progress — went to every open socket, including one that never sent a token.
 * With auth on, an anonymous `new WebSocket(...)` read the whole platform's
 * live fleet; with multi-tenancy on, tenant B's dashboard received tenant A's
 * telemetry.
 *
 * Under `AUTH_DISABLED=true` every socket is identified as the dev super-admin
 * at upgrade (`identityFromUpgrade`), so local dev behaves as before.
 */

import { mayObserveTenant, type SocketIdentity } from './socketIdentity.js';

/**
 * The tenant a robot's events are routed by. A lookup that failed is not
 * "no tenant" — `null` would show the event to every tenant — so it gets a
 * tenant id no user has, which only a super-admin may observe.
 */
export const UNRESOLVED_ROBOT_TENANT = '\u0000unresolved';

/**
 * Deliver one event to the sockets allowed to see it. `robotTenantId` is
 * `undefined` for an event that names no robot (authenticated sockets only),
 * otherwise the robot's tenant (`null` = no tenant, i.e. single-tenant).
 */
export function deliverEvent<T extends object>(
  clients: Iterable<T>,
  identities: WeakMap<T, SocketIdentity>,
  message: string,
  send: (client: T, message: string) => void,
  robotTenantId?: string | null
): number {
  let delivered = 0;
  for (const client of clients) {
    const identity = identities.get(client);
    if (!identity) continue;
    if (robotTenantId !== undefined && !mayObserveTenant(identity, robotTenantId)) continue;
    send(client, message);
    delivered++;
  }
  return delivered;
}

/**
 * Deliver one event whose payload depends on who receives it: `build` returns
 * the message for a socket's identity, or `null` for "nothing for you". Used
 * where one event spans several tenants (a fleet E-stop) and each tenant may
 * see only its own part of it.
 */
export function deliverEventPerSocket<T extends object>(
  clients: Iterable<T>,
  identities: WeakMap<T, SocketIdentity>,
  build: (identity: SocketIdentity) => string | null,
  send: (client: T, message: string) => void
): number {
  let delivered = 0;
  for (const client of clients) {
    const identity = identities.get(client);
    if (!identity) continue;
    const message = build(identity);
    if (message === null) continue;
    send(client, message);
    delivered++;
  }
  return delivered;
}

/** How many entity → tenant answers a resolver keeps before dropping the oldest. */
const DEFAULT_MAX_ENTRIES = 10_000;

/**
 * key → tenant, read once per key and kept, because telemetry and job progress
 * arrive several times a second and the tenant of an entity does not change.
 * `forget` on (un)registration; a lookup that throws, or answers
 * `UNRESOLVED_ROBOT_TENANT` (row not found), is not cached, so the next event
 * retries it. The cache is bounded: the oldest answer goes first.
 */
export class TenantResolver {
  private readonly known = new Map<string, string | null>();
  private readonly pending = new Map<string, Promise<string | null>>();

  constructor(
    private readonly lookup: (key: string) => Promise<string | null>,
    private readonly maxEntries = DEFAULT_MAX_ENTRIES
  ) {}

  /** The cached tenant; `undefined` = not looked up yet. */
  peek(key: string): string | null | undefined {
    return this.known.get(key);
  }

  resolve(key: string): Promise<string | null> {
    const cached = this.known.get(key);
    if (cached !== undefined) return Promise.resolve(cached);
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;
    const request = this.lookup(key)
      .then((tenantId) => {
        if (tenantId !== UNRESOLVED_ROBOT_TENANT) this.remember(key, tenantId);
        return tenantId;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }

  forget(key: string): void {
    this.known.delete(key);
  }

  private remember(key: string, tenantId: string | null): void {
    this.known.delete(key);
    this.known.set(key, tenantId);
    if (this.known.size > this.maxEntries) {
      const oldest = this.known.keys().next().value;
      if (oldest !== undefined) this.known.delete(oldest);
    }
  }
}

/** robot id → tenant (TASK-366); the robot-keyed name of `TenantResolver`. */
export class RobotTenantResolver extends TenantResolver {}
