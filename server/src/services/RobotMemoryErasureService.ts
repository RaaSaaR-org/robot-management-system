/**
 * @file RobotMemoryErasureService.ts
 * @description Reaches the fleet on a GDPR Art. 17 erasure: wipes the durable
 *              memory workspace on every robot agent that has one (TASK-197).
 * @feature gdpr
 *
 * Why this exists: `GDPRRequestService.eraseUserData()` deletes and
 * pseudonymises rows keyed by `userId` and nothing else. A place note written
 * on a robot at a customer site — operator-authored free text, on a device with
 * no Prisma — is personal data that a database-only erasure never touches. The
 * moment such a file exists, an erasure that stops at the database is a false
 * Article 17 answer on a product whose pitch is the compliance machinery.
 *
 * Best-effort and fully reported: a robot that is switched off cannot be erased
 * now, and saying so is the only honest outcome. Silence would be worse than a
 * failure — an erasure that claims success while a note survives on a robot is
 * the one answer a data-subject request must never get.
 */

import { prisma } from '../database/index.js';
import { AGENT_SERVICE_TOKEN_ENV } from './agentServiceAuth.js';

/** One robot the erasure will try to reach. */
export interface RobotMemoryTarget {
  robotId: string;
  /** The agent's base URL (`Robot.a2aAgentUrl`). */
  agentUrl: string;
}

/** What happened for one robot. */
export interface RobotMemoryErasureOutcome {
  robotId: string;
  ok: boolean;
  /** Files the agent reported removing. */
  removed: number;
  /**
   * Files the agent reported REDACTING rather than deleting — today that is
   * `IDENTITY.md`, whose `Operator` and `Site` labels name a human and a site
   * while the rest of the card is the robot's own identity and stays.
   *
   * Counted separately because it is a different act, and reported at all
   * because a workspace where the card was the only personal data answers
   * `removed: 0` — which, on its own, reads as "there was nothing there".
   */
  redacted: number;
  /** Why it failed — unreachable, refused, no workspace. */
  error?: string;
}

export interface RobotMemoryErasureResult {
  attempted: number;
  succeeded: number;
  failed: number;
  /** Files removed across the fleet. */
  removed: number;
  /** Files redacted in place across the fleet — see the per-robot field. */
  redacted: number;
  outcomes: RobotMemoryErasureOutcome[];
  /**
   * Set when the fleet could NOT be enumerated at all (the robot list query
   * failed). Distinct from `attempted: 0` with no error, which means the fleet
   * WAS enumerated and holds no robot with an agent URL.
   *
   * Without this field both answers are the same object, and a database outage
   * reads as "there was nothing to erase" — an Article 17 response claiming a
   * complete erasure while the code never found out which robots exist. The
   * caller must turn this into a blocked reason, never into a clean result.
   */
  listError?: string;
}

export interface RobotMemoryErasureDeps {
  fetchImpl?: typeof fetch;
  /** Injected in tests; defaults to every robot with an `a2aAgentUrl`. */
  listTargets?: () => Promise<RobotMemoryTarget[]>;
  timeoutMs?: number;
  /**
   * Shared secret the robot agents' personal-data gate expects. Defaults to
   * `process.env[ROBOT_MEMORY_TOKEN_ENV]`.
   */
  agentToken?: string;
}

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * The robot agents' `AGENT_MEMORY_TOKEN` — same variable name on both sides,
 * and the same constant every other server→agent caller uses
 * ({@link AGENT_SERVICE_TOKEN_ENV}), re-exported here because this service
 * documented it first.
 *
 * `robot-agent/src/api/rest-routes.ts` (`personalDataGate`) refuses
 * `DELETE /robots/:id/memory` from off-box callers unless they present this as
 * a bearer token; with the variable unset there, the agent answers loopback
 * callers only. So a fleet where the server and the agents are separate hosts
 * MUST set it on both, or an Art. 17 erasure reports `HTTP 401` per robot —
 * loudly, which is the intended failure, but it is a deployment step. If the
 * name changes on either side, change it on the other (each names the other).
 */
export const ROBOT_MEMORY_TOKEN_ENV = AGENT_SERVICE_TOKEN_ENV;

export class RobotMemoryErasureService {
  private readonly fetchImpl: typeof fetch;
  private readonly listTargets: () => Promise<RobotMemoryTarget[]>;
  private readonly timeoutMs: number;
  private readonly agentToken: string;

  constructor(deps: RobotMemoryErasureDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    this.listTargets = deps.listTargets ?? defaultListTargets;
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.agentToken = deps.agentToken ?? process.env[ROBOT_MEMORY_TOKEN_ENV] ?? '';
  }

  /**
   * Ask every reachable robot agent to wipe its memory workspace.
   *
   * The robot keeps its `AGENTS.md` operating rules and its surveyed place
   * graph — configuration and site geometry, not anything observed about a
   * person. Everything else (curated memory, place notes, the whole activity
   * journal) goes.
   *
   * A failure to enumerate the fleet is reported in `listError` rather than
   * returned as an empty (and therefore clean-looking) result — see that field.
   */
  async eraseFleetMemory(): Promise<RobotMemoryErasureResult> {
    let targets: RobotMemoryTarget[] = [];
    try {
      targets = await this.listTargets();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[RobotMemoryErasure] Could not list robots:', error);
      return {
        attempted: 0,
        succeeded: 0,
        // The fleet itself is the one thing that failed, and it failed as a
        // whole: no robot was reached, and we do not even know how many there
        // are. Counting it as a single failure keeps `failed > 0` true for
        // every caller that only looks at the tally.
        failed: 1,
        removed: 0,
        redacted: 0,
        outcomes: [],
        listError: message,
      };
    }

    const outcomes = await Promise.all(targets.map((t) => this.eraseOne(t)));
    const succeeded = outcomes.filter((o) => o.ok).length;
    const removed = outcomes.reduce((sum, o) => sum + o.removed, 0);
    const redacted = outcomes.reduce((sum, o) => sum + o.redacted, 0);

    console.log(
      `[RobotMemoryErasure] ${succeeded}/${outcomes.length} robot workspace(s) erased ` +
        `(${removed} file(s) removed, ${redacted} redacted)`,
    );

    return {
      attempted: outcomes.length,
      succeeded,
      failed: outcomes.length - succeeded,
      removed,
      redacted,
      outcomes,
    };
  }

  private async eraseOne(target: RobotMemoryTarget): Promise<RobotMemoryErasureOutcome> {
    const base = target.agentUrl.replace(/\/$/, '');
    const url = `${base}/api/v1/robots/${encodeURIComponent(target.robotId)}/memory`;
    try {
      const res = await this.fetchImpl(url, {
        method: 'DELETE',
        signal: AbortSignal.timeout(this.timeoutMs),
        // No header when no secret is configured: the agent then answers
        // loopback callers only, which is exactly the single-box dev setup.
        ...(this.agentToken
          ? { headers: { Authorization: `Bearer ${this.agentToken}` } }
          : {}),
      });
      if (res.status === 404) {
        // NOT "nothing to erase". The agent answers 404 on this route from its
        // `wrongRobot` guard — the fleet row points at an agent that serves a
        // DIFFERENT robot id (a renamed `ROBOT_ID`, a recycled port, a stale
        // row) — or because the route does not exist on that build at all. In
        // every one of those cases the workspace is still on disk, untouched.
        // A missing workspace is not a 404: the agent answers that case with a
        // 500 and `errors: ['no memory workspace configured']`.
        return {
          robotId: target.robotId,
          ok: false,
          removed: 0,
          redacted: 0,
          error: describeNotFound(await readCode(res), target),
        };
      }
      if (!res.ok) {
        return {
          robotId: target.robotId,
          ok: false,
          removed: 0,
          redacted: 0,
          error: `HTTP ${res.status}`,
        };
      }
      const body = (await res.json()) as {
        removed?: unknown;
        redacted?: unknown;
        errors?: unknown;
      } | null;
      const removed = typeof body?.removed === 'number' ? body.removed : 0;
      // Absent on an older agent build, which is not the same as zero — but a
      // count is all this can be, so an agent that does not report it reads as
      // "redacted nothing", and its `removed` still carries the deletions.
      const redacted = typeof body?.redacted === 'number' ? body.redacted : 0;
      const errors = Array.isArray(body?.errors) ? (body.errors as unknown[]) : [];
      if (errors.length > 0) {
        return {
          robotId: target.robotId,
          ok: false,
          removed,
          redacted,
          error: errors.map((e) => String(e)).join('; '),
        };
      }
      return { robotId: target.robotId, ok: true, removed, redacted };
    } catch (error) {
      return {
        robotId: target.robotId,
        ok: false,
        removed: 0,
        redacted: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/** The agent's error code for "this agent serves a different robot". */
const CODE_WRONG_ROBOT = 'ROBOT_NOT_FOUND';

/** Read `{code}` off an error body without letting a non-JSON body throw. */
async function readCode(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { code?: unknown } | null;
    return typeof body?.code === 'string' ? body.code : undefined;
  } catch {
    return undefined;
  }
}

/** Turn a 404 into a sentence an operator can act on. */
function describeNotFound(code: string | undefined, target: RobotMemoryTarget): string {
  if (code === CODE_WRONG_ROBOT) {
    return (
      `HTTP 404 ${CODE_WRONG_ROBOT} — the agent at ${target.agentUrl} serves a different ` +
      `robot than '${target.robotId}'; its workspace was NOT erased. Fix the fleet record ` +
      `(or the agent's ROBOT_ID) and retry.`
    );
  }
  return (
    `HTTP 404 — no memory erasure endpoint at ${target.agentUrl} for robot ` +
    `'${target.robotId}'; nothing was erased. Upgrade the agent and retry.`
  );
}

/**
 * Every robot the platform knows an agent URL for.
 *
 * FLEET-WIDE BY CONSTRUCTION, and deliberately not filtered by data subject:
 * the robot's files are not keyed by `userId` (there is no speaker
 * identification — see the robot's AGENTS.md), so there is no per-subject
 * erasure for this service to perform. That makes a wipe a decision about
 * OTHER people's data too, which is why `GDPRRequestService.executeErasure()`
 * only reaches this code behind an explicit fleet-wide opt-in.
 */
async function defaultListTargets(): Promise<RobotMemoryTarget[]> {
  const robots = await prisma.robot.findMany({
    where: { a2aAgentUrl: { not: null } },
    select: { id: true, a2aAgentUrl: true },
  });
  return robots
    .filter((r): r is { id: string; a2aAgentUrl: string } => typeof r.a2aAgentUrl === 'string')
    .map((r) => ({ robotId: r.id, agentUrl: r.a2aAgentUrl }));
}

// Export singleton instance
export const robotMemoryErasureService = new RobotMemoryErasureService();
