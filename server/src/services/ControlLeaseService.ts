/**
 * @file ControlLeaseService.ts
 * @description The server's authority for robot-wide control leases (TASK-317,
 *              epic TASK-313): acquire / release / observe, one database row
 *              per robot, exactly one winner across any number of replicas.
 * @feature robots
 *
 * The row is the arbiter (decision D1): every mutation is a conditional
 * `updateMany` or a primary-key `create`, so two replicas racing for the same
 * robot cannot both see "count 1". A won row is only USABLE once the robot
 * agent has acked the install of its generation (D2) — until then it sits in
 * `installing`, and if the agent refuses or cannot be reached it becomes
 * `unconfirmed` and blocks every further acquisition until a recheck shows the
 * agent holds nothing (fail closed).
 *
 * The raw `leaseId` leaves this module exactly once, in the acquire result.
 * Only its SHA-256 is stored or sent to the agent, and neither the secret nor
 * the hash is ever logged, audited, or returned by `observe`.
 *
 * Behind `CONTROL_LEASES_ENABLED` (default off) — the routes check the flag;
 * this service does not, so tests can drive it directly.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { HttpClient, HttpClientError } from './HttpClient.js';
import { agentServiceAuthHeaders } from './agentServiceAuth.js';

// ============================================================================
// CONFIG
// ============================================================================

/** Default lease lifetime without a renewal (decision D10, user-confirmed). */
export const DEFAULT_CONTROL_LEASE_TTL_MS = 5000;
/** Default client renew cadence (decision D10, user-confirmed). */
export const DEFAULT_CONTROL_LEASE_RENEW_MS = 1000;
/** The agent refuses a ttlMs outside this range (`robot-agent` rest-routes). */
const AGENT_TTL_MIN_MS = 500;
const AGENT_TTL_MAX_MS = 60_000;
/** How long one server→agent lease call may take before it counts as unreachable. */
const AGENT_CALL_TIMEOUT_MS = 2000;
/** Longest display name stored and sent to the agent. */
const DISPLAY_NAME_MAX = 80;

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** `CONTROL_LEASES_ENABLED=true` turns the acquire / release routes on. Read per call. */
export function controlLeasesEnabled(): boolean {
  return process.env.CONTROL_LEASES_ENABLED === 'true';
}

/** Lease TTL, clamped into the range the agent accepts. Read per call. */
export function controlLeaseTtlMs(): number {
  const ttl = intFromEnv('CONTROL_LEASE_TTL_MS', DEFAULT_CONTROL_LEASE_TTL_MS);
  return Math.min(AGENT_TTL_MAX_MS, Math.max(AGENT_TTL_MIN_MS, ttl));
}

/** Client renew cadence; never longer than half the TTL. Read per call. */
export function controlLeaseRenewMs(ttlMs = controlLeaseTtlMs()): number {
  const renew = intFromEnv('CONTROL_LEASE_RENEW_MS', DEFAULT_CONTROL_LEASE_RENEW_MS);
  return Math.min(renew, Math.floor(ttlMs / 2));
}

// ============================================================================
// TYPES
// ============================================================================

/** Row states. Only `released` and `expired` (or a lapsed deadline) are takeable. */
export type ControlLeaseState =
  | 'installing'
  | 'held'
  | 'stopping'
  | 'unconfirmed'
  | 'released'
  | 'expired';

/** The authenticated caller, as `authMiddleware` puts it on the request. */
export interface ControlLeaseUser {
  id: string;
  role: string;
  tenantId: string | null;
  name?: string;
  email?: string;
}

/** The robot a lease is for, resolved in the caller's tenant. */
export interface ControlLeaseRobot {
  robotId: string;
  /** The robot's own tenant — the only tenantId a lease row is ever written with. */
  tenantId: string | null;
  /** Where the robot agent answers. */
  baseUrl: string;
}

/** What the agent is sent on install (`POST …/control-lease/install`). */
export interface AgentInstallBody {
  generation: number;
  leaseIdHash: string;
  sessionId: string;
  userId: string;
  displayName: string;
  tenantId: string | null;
  ttlMs: number;
}

export type AgentInstallResult =
  | { ok: true }
  | { ok: false; reason: 'stale_generation'; highWater: number }
  | { ok: false; reason: 'refused' | 'unreachable' };

/** The server→agent half. The default speaks HTTP; tests pass a mock. */
export interface ControlLeaseAgentPort {
  install(robot: ControlLeaseRobot, body: AgentInstallBody): Promise<AgentInstallResult>;
  /** true when the agent answered (released or not); false when it could not be reached. */
  release(robot: ControlLeaseRobot, generation: number): Promise<boolean>;
  /** The agent's own view; null when it could not be reached. */
  observe(robot: ControlLeaseRobot): Promise<{ state: string; generation: number | null } | null>;
}

/** One audit entry. Never carries the lease secret or its hash. */
export interface ControlLeaseAuditEvent {
  action: 'acquire' | 'deny' | 'release' | 'unconfirmed';
  result: 'allowed' | 'denied';
  robotId: string;
  tenantId: string | null;
  userId: string;
  sessionId: string | null;
  generation: number | null;
  reason?: string;
}

/** Public holder fields — what `observe` and a 409 disclose. */
export interface ControlLeaseHolder {
  userId: string | null;
  displayName: string | null;
  state: ControlLeaseState;
  generation: number;
  expiresAt: string | null;
}

/** The acquire result — the only place `leaseId` ever appears. */
export interface ControlLeaseGrant {
  leaseId: string;
  generation: number;
  sessionId: string;
  ttlMs: number;
  renewEveryMs: number;
  expiresAt: string;
}

/** A refusal the routes turn into an HTTP answer verbatim. */
export class ControlLeaseError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: { code: string; holder?: ControlLeaseHolder | null }
  ) {
    super(body.code);
    this.name = 'ControlLeaseError';
  }
}

type LeaseDb = Pick<PrismaClient, 'robotControlLease'>;

export interface ControlLeaseServiceDeps {
  db: LeaseDb;
  /** Resolve the robot in the caller's tenant; null when it is not there. */
  resolveRobot: (robotId: string) => Promise<ControlLeaseRobot | null>;
  agent: ControlLeaseAgentPort;
  audit?: (event: ControlLeaseAuditEvent) => Promise<void> | void;
  now?: () => number;
  ttlMs?: () => number;
  renewEveryMs?: () => number;
}

// ============================================================================
// HELPERS
// ============================================================================

/** SHA-256 hex of the raw lease secret — the only form that is ever stored. */
export function hashLeaseId(leaseId: string): string {
  return createHash('sha256').update(leaseId, 'utf8').digest('hex');
}

/** States that can hold authority while their deadline has not lapsed. */
const ACTIVE_STATES: ControlLeaseState[] = ['installing', 'held', 'stopping'];

interface LeaseRow {
  robotId: string;
  generation: number;
  state: string;
  userId: string | null;
  displayName: string | null;
  sessionId: string | null;
  expiresAt: Date | null;
}

function isP2002(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

// ============================================================================
// SERVICE
// ============================================================================

export class ControlLeaseService {
  private readonly now: () => number;
  private readonly ttl: () => number;
  private readonly renew: () => number;

  constructor(private readonly deps: ControlLeaseServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.ttl = deps.ttlMs ?? (() => controlLeaseTtlMs());
    this.renew = deps.renewEveryMs ?? (() => controlLeaseRenewMs(this.ttl()));
  }

  /** The capability block `GET …/control-lease` advertises. */
  capability(enabled: boolean): { version: 1; enabled: boolean; ttlMs: number; renewEveryMs: number } {
    return { version: 1, enabled, ttlMs: this.ttl(), renewEveryMs: this.renew() };
  }

  /** Public holder fields for one robot; never the secret or its hash. */
  async observe(user: ControlLeaseUser, robotId: string): Promise<ControlLeaseHolder | null> {
    await this.robotFor(user, robotId);
    return this.holderOf(await this.readRow(robotId));
  }

  /**
   * Take the robot for `user`, install it on the agent, and hand back the
   * secret. 409 when someone (anyone — the same user's other session included)
   * holds it; 503 `agent_unconfirmed` when the agent did not ack the install.
   */
  async acquire(
    user: ControlLeaseUser,
    robotId: string,
    requestedName?: string
  ): Promise<ControlLeaseGrant> {
    const robot = await this.robotFor(user, robotId);
    const displayName = this.displayNameFor(user, requestedName);
    const ttlMs = this.ttl();
    const leaseId = randomBytes(16).toString('base64url');
    const leaseIdHash = hashLeaseId(leaseId);
    const sessionId = randomUUID();
    const claim = { leaseIdHash, sessionId, userId: user.id, displayName };

    let won = await this.take(robot, claim, ttlMs);
    if (!won) {
      const current = await this.readRow(robotId);
      if (current?.state === 'unconfirmed' && (await this.recheck(robot, current))) {
        won = await this.take(robot, claim, ttlMs);
      }
    }
    if (!won) {
      const current = await this.readRow(robotId);
      const code = current?.state === 'unconfirmed' ? 'lease_unconfirmed' : 'lease_held';
      await this.audit({
        action: 'deny',
        result: 'denied',
        robotId,
        tenantId: robot.tenantId,
        userId: user.id,
        sessionId: null,
        generation: current?.generation ?? null,
        reason: code,
      });
      throw new ControlLeaseError(409, { code, holder: this.holderOf(current) });
    }

    const generation = won.generation;
    const installed = await this.deps.agent.install(robot, {
      generation,
      leaseIdHash,
      sessionId,
      userId: user.id,
      displayName,
      tenantId: robot.tenantId,
      ttlMs,
    });

    if (!installed.ok) {
      // Fail closed: the row stays blocked until a recheck shows the agent
      // holds nothing. A stale generation means the agent's high-water is ahead
      // of this row (a restored database, say) — lift the row to it so the next
      // acquisition's increment clears the fence instead of failing forever.
      const lifted =
        installed.reason === 'stale_generation' && installed.highWater > generation
          ? { generation: installed.highWater }
          : {};
      await this.deps.db.robotControlLease.updateMany({
        where: { robotId, generation, sessionId },
        data: { state: 'unconfirmed', ...lifted },
      });
      await this.audit({
        action: 'unconfirmed',
        result: 'denied',
        robotId,
        tenantId: robot.tenantId,
        userId: user.id,
        sessionId,
        generation,
        reason: `install_${installed.reason}`,
      });
      throw new ControlLeaseError(503, { code: 'agent_unconfirmed' });
    }

    const expiresAt = new Date(this.now() + ttlMs);
    const confirmed = await this.deps.db.robotControlLease.updateMany({
      where: { robotId, generation, sessionId, state: 'installing' },
      data: { state: 'held', expiresAt },
    });
    if (confirmed.count !== 1) {
      // The row moved on while the agent was installing (the install window
      // lapsed and another replica took it). The newer generation fences ours
      // on the agent anyway; release ours so it does not linger until expiry.
      await this.deps.agent.release(robot, generation).catch(() => false);
      const current = await this.readRow(robotId);
      await this.audit({
        action: 'deny',
        result: 'denied',
        robotId,
        tenantId: robot.tenantId,
        userId: user.id,
        sessionId,
        generation,
        reason: 'lost_during_install',
      });
      throw new ControlLeaseError(409, { code: 'lease_held', holder: this.holderOf(current) });
    }

    await this.audit({
      action: 'acquire',
      result: 'allowed',
      robotId,
      tenantId: robot.tenantId,
      userId: user.id,
      sessionId,
      generation,
    });
    return {
      leaseId,
      generation,
      sessionId,
      ttlMs,
      renewEveryMs: this.renew(),
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Give the robot back. Only the holder that presents the secret AND the
   * current generation can; anything else (an old generation, another user, a
   * wrong secret) is a no-op answering `released: false`, so a stale tab can
   * never release the lease a newer session holds.
   */
  async release(
    user: ControlLeaseUser,
    robotId: string,
    leaseId: string,
    generation: number
  ): Promise<{ released: boolean }> {
    const robot = await this.robotFor(user, robotId);
    const stopping = await this.deps.db.robotControlLease.updateMany({
      where: {
        robotId,
        generation,
        leaseIdHash: hashLeaseId(leaseId),
        userId: user.id,
        state: { in: ['installing', 'held', 'stopping', 'unconfirmed'] },
      },
      data: { state: 'stopping' },
    });
    if (stopping.count !== 1) return { released: false };

    const sessionId = (await this.readRow(robotId))?.sessionId ?? null;
    const answered = await this.deps.agent.release(robot, generation).catch(() => false);
    if (!answered) {
      await this.deps.db.robotControlLease.updateMany({
        where: { robotId, generation, state: 'stopping' },
        data: { state: 'unconfirmed' },
      });
      await this.audit({
        action: 'unconfirmed',
        result: 'denied',
        robotId,
        tenantId: robot.tenantId,
        userId: user.id,
        sessionId,
        generation,
        reason: 'release_unreachable',
      });
      throw new ControlLeaseError(503, { code: 'agent_unconfirmed' });
    }

    await this.deps.db.robotControlLease.updateMany({
      where: { robotId, generation, state: 'stopping' },
      data: { state: 'released', leaseIdHash: null, expiresAt: null },
    });
    await this.audit({
      action: 'release',
      result: 'allowed',
      robotId,
      tenantId: robot.tenantId,
      userId: user.id,
      sessionId,
      generation,
    });
    return { released: true };
  }

  // --------------------------------------------------------------------------
  // internals
  // --------------------------------------------------------------------------

  /**
   * The atomic take. One conditional UPDATE over the existing row, or — when
   * there is no row yet — a primary-key create, whose unique violation is the
   * loser's answer. Returns the won row, or null.
   */
  private async take(
    robot: ControlLeaseRobot,
    claim: { leaseIdHash: string; sessionId: string; userId: string; displayName: string },
    ttlMs: number
  ): Promise<LeaseRow | null> {
    const nowMs = this.now();
    const issuedAt = new Date(nowMs);
    const data = {
      ...claim,
      state: 'installing',
      tenantId: robot.tenantId,
      issuedAt,
      // The install window: a replica that dies mid-install must not wedge the
      // robot forever. The agent's own TTL bounds the lease there too.
      expiresAt: new Date(nowMs + ttlMs),
    };
    const updated = await this.deps.db.robotControlLease.updateMany({
      where: {
        robotId: robot.robotId,
        OR: [
          { state: { in: ['released', 'expired'] } },
          { state: { not: 'unconfirmed' }, expiresAt: { lt: issuedAt } },
        ],
      },
      data: { ...data, generation: { increment: 1 } },
    });
    if (updated.count === 1) {
      const row = await this.readRow(robot.robotId);
      return row && row.sessionId === claim.sessionId ? row : null;
    }
    if (await this.readRow(robot.robotId)) return null;
    try {
      return await this.deps.db.robotControlLease.create({
        data: { robotId: robot.robotId, ...data, generation: 1 },
      });
    } catch (error) {
      if (isP2002(error)) return null;
      throw error;
    }
  }

  /**
   * Clear an `unconfirmed` row when the agent, asked directly, holds nothing.
   * Unreachable or still holding → stays blocked (fail closed).
   */
  private async recheck(robot: ControlLeaseRobot, row: LeaseRow): Promise<boolean> {
    const seen = await this.deps.agent.observe(robot).catch(() => null);
    // Only a positive "nothing installed" clears it; anything unrecognised is
    // treated as held.
    if (!seen || !['none', 'expired', 'released'].includes(seen.state)) return false;
    await this.deps.db.robotControlLease.updateMany({
      where: { robotId: robot.robotId, state: 'unconfirmed', generation: row.generation },
      data: { state: 'released', leaseIdHash: null, expiresAt: null },
    });
    return true;
  }

  private async readRow(robotId: string): Promise<LeaseRow | null> {
    return this.deps.db.robotControlLease.findUnique({ where: { robotId } });
  }

  private holderOf(row: LeaseRow | null): ControlLeaseHolder | null {
    if (!row) return null;
    const state = row.state as ControlLeaseState;
    const live =
      state === 'unconfirmed' ||
      (ACTIVE_STATES.includes(state) && row.expiresAt !== null && row.expiresAt.getTime() >= this.now());
    if (!live) return null;
    return {
      userId: row.userId,
      displayName: row.displayName,
      state,
      generation: row.generation,
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    };
  }

  /** The robot in the caller's tenant, or 404 — never a hint that it exists elsewhere. */
  private async robotFor(user: ControlLeaseUser, robotId: string): Promise<ControlLeaseRobot> {
    const robot = await this.deps.resolveRobot(robotId);
    const foreign =
      robot !== null &&
      user.role !== 'super-admin' &&
      user.tenantId !== null &&
      robot.tenantId !== null &&
      user.tenantId !== robot.tenantId;
    if (!robot || foreign) {
      throw new ControlLeaseError(404, { code: 'robot_not_found' });
    }
    return robot;
  }

  private displayNameFor(user: ControlLeaseUser, requested?: string): string {
    const candidates = [requested, user.name, user.email, user.id];
    for (const c of candidates) {
      const trimmed = typeof c === 'string' ? c.trim() : '';
      if (trimmed) return trimmed.slice(0, DISPLAY_NAME_MAX);
    }
    return user.id;
  }

  private async audit(event: ControlLeaseAuditEvent): Promise<void> {
    if (!this.deps.audit) return;
    try {
      await this.deps.audit(event);
    } catch (error) {
      // An audit outage must not change who holds the robot. Log the event
      // shape only — it carries no secret by construction.
      console.error('[ControlLeaseService] audit write failed:', event.action, event.robotId, error);
    }
  }
}

// ============================================================================
// HTTP AGENT PORT
// ============================================================================

function leasePath(robot: ControlLeaseRobot, suffix = ''): string {
  return `/api/v1/robots/${encodeURIComponent(robot.robotId)}/control-lease${suffix}`;
}

/**
 * A client per call, so a rotated `AGENT_MEMORY_TOKEN` is picked up without a
 * restart — the agent's lease routes sit behind its personal-data gate.
 */
function clientFor(robot: ControlLeaseRobot): HttpClient {
  return new HttpClient(robot.baseUrl.replace(/\/$/, ''), AGENT_CALL_TIMEOUT_MS, agentServiceAuthHeaders());
}

/** The real server→agent calls (TASK-314 routes on the robot agent). */
export const httpControlLeaseAgent: ControlLeaseAgentPort = {
  async install(robot, body) {
    try {
      const answer = await clientFor(robot).post<{ installed?: boolean; generation?: number }>(
        leasePath(robot, '/install'),
        body
      );
      return answer?.installed === true && answer.generation === body.generation
        ? { ok: true }
        : { ok: false, reason: 'refused' };
    } catch (error) {
      if (error instanceof HttpClientError && error.statusCode !== undefined) {
        const reply = (error.responseBody ?? {}) as { code?: unknown; highWater?: unknown };
        if (reply.code === 'stale_generation' && typeof reply.highWater === 'number') {
          return { ok: false, reason: 'stale_generation', highWater: reply.highWater };
        }
        return { ok: false, reason: 'refused' };
      }
      return { ok: false, reason: 'unreachable' };
    }
  },

  async release(robot, generation) {
    try {
      await clientFor(robot).post(leasePath(robot, '/release'), { generation });
      return true;
    } catch {
      return false;
    }
  },

  async observe(robot) {
    try {
      const seen = await clientFor(robot).get<{ state?: unknown; generation?: unknown }>(leasePath(robot));
      return {
        state: typeof seen?.state === 'string' ? seen.state : 'unknown',
        generation: typeof seen?.generation === 'number' ? seen.generation : null,
      };
    } catch {
      return null;
    }
  },
};
