/**
 * @file socketIdentity.ts
 * @description Who is on the other end of an `/api/a2a/ws` socket, and whether
 *              they may see a tenant-scoped event (TASK-318, control leases).
 * @feature websocket
 *
 * The A2A socket has always been unauthenticated and every event on it went to
 * every client. Control-lease transitions name users, so they are delivered
 * only to a socket whose identity is known and belongs to the robot's tenant.
 * A socket proves itself with its access token — as `?token=` on the upgrade
 * URL, or later in-band as `{type:'auth', token}` — and one that never does
 * simply receives no lease events; nothing else on the socket changes.
 */

import type { IncomingMessage } from 'http';
import { DEFAULT_TENANT_ID } from '../config/features.js';

export interface SocketIdentity {
  userId: string;
  role: string;
  tenantId: string | null;
}

/** Verifies an access token; null when it is invalid or expired. */
export type AccessTokenVerifier = (
  token: string
) => { userId: string; role: string; tenantId?: string | null } | null;

/** Under `AUTH_DISABLED=true` every socket is the dev mock user, like every request. */
const DEV_IDENTITY: SocketIdentity = { userId: 'dev-user-id', role: 'super-admin', tenantId: DEFAULT_TENANT_ID };

export function identityFromToken(token: unknown, verify: AccessTokenVerifier): SocketIdentity | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096) return null;
  const payload = verify(token);
  if (!payload) return null;
  return { userId: payload.userId, role: payload.role, tenantId: payload.tenantId ?? null };
}

/** The identity an upgrade request carries, if any. */
export function identityFromUpgrade(
  req: IncomingMessage | undefined,
  verify: AccessTokenVerifier,
  authDisabled = process.env.AUTH_DISABLED === 'true'
): SocketIdentity | null {
  if (authDisabled) return DEV_IDENTITY;
  if (!req?.url) return null;
  let token: string | null = null;
  try {
    token = new URL(req.url, 'http://localhost').searchParams.get('token');
  } catch {
    return null;
  }
  return identityFromToken(token, verify);
}

/**
 * Whether `identity` may observe an event of a robot in `tenantId`. A
 * super-admin sees every tenant. Otherwise the rule is the lease routes' own
 * (`robotFor`): only two different, non-null tenants are foreign, so a robot
 * or a user with no tenant (single-tenant deployments) is visible.
 */
export function mayObserveTenant(identity: SocketIdentity | null | undefined, tenantId: string | null): boolean {
  if (!identity) return false;
  if (identity.role === 'super-admin') return true;
  if (tenantId === null || identity.tenantId === null) return true;
  return identity.tenantId === tenantId;
}
