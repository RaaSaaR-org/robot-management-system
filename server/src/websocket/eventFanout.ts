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
 * robot id → tenant, read once per robot and kept, because telemetry arrives
 * several times a second and the tenant of a robot does not change while it
 * stays registered. `forget` on (un)registration; a lookup that throws is not
 * cached, so the next event retries it.
 */
export class RobotTenantResolver {
  private readonly known = new Map<string, string | null>();
  private readonly pending = new Map<string, Promise<string | null>>();

  constructor(private readonly lookup: (robotId: string) => Promise<string | null>) {}

  /** The cached tenant; `undefined` = not looked up yet. */
  peek(robotId: string): string | null | undefined {
    return this.known.get(robotId);
  }

  resolve(robotId: string): Promise<string | null> {
    const inFlight = this.pending.get(robotId);
    if (inFlight) return inFlight;
    const request = this.lookup(robotId)
      .then((tenantId) => {
        this.known.set(robotId, tenantId);
        return tenantId;
      })
      .finally(() => this.pending.delete(robotId));
    this.pending.set(robotId, request);
    return request;
  }

  forget(robotId: string): void {
    this.known.delete(robotId);
  }
}
