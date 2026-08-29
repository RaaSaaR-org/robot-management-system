/**
 * @file journal.ts
 * @description Append-only JSONL of what the robot did and how it went, one
 *              file per day under `workspace-<robotId>/journal/`, pruned at a
 *              retention boundary the platform's own `RetentionPolicy` sets.
 * @feature agentmode
 * @status live
 *
 * This is a TEE, not new instrumentation: `ServerMirror.logBlock()` already
 * builds this record for the compliance log. That framing has a sharp edge
 * worth stating — the compliance copy is AES-256-GCM encrypted, hash-chained
 * and carries a `retentionExpiresAt`; this copy is plaintext on the robot's own
 * disk. It is the same data category with fewer protections, so it gets a
 * retention boundary, a legal-hold check and an erasure path rather than being
 * treated as a free side effect.
 */

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/config.js';
import {
  dayKey,
  getWorkspace,
  type JournalRecord,
  type TrustLevel,
  type Workspace,
} from './workspace.js';

/**
 * The compliance event type this journal duplicates. `ServerMirror.logBlock()`
 * writes every finished block as `command_execution`, so that policy's
 * retention is the one this file must follow — not a second regime invented
 * here and running beside `ComplianceLog.retentionExpiresAt`.
 */
export const JOURNAL_EVENT_TYPE = 'command_execution';

/**
 * Used only when the server cannot be asked (offline robot, unreachable
 * platform). It is deliberately SHORTER than any configured policy would be:
 * an unreachable server is not permission to keep plaintext operational text on
 * a robot indefinitely.
 */
export const JOURNAL_FALLBACK_RETENTION_DAYS = 30;

/**
 * How long a retention answer is reused before the server is asked again — and,
 * because those are the same event, how often {@link startJournalRetentionLoop}
 * re-prunes. A robot at a customer site stays up for months; a boundary applied
 * exactly once at boot is not a boundary.
 */
export const RETENTION_CACHE_TTL_MS = 60 * 60_000;

/**
 * Environment variable holding the platform API token this robot authenticates
 * its compliance reads with.
 *
 * A service-account token (`ndsa_…`, TASK-165) — the mechanism the server
 * ALREADY has for machine callers, so no route needed an auth exemption. Read
 * from the environment at call time rather than from `config`, which is frozen
 * at import: a rotated token must not need a robot restart.
 */
export const SERVICE_TOKEN_ENV = 'NEODEM_SERVICE_TOKEN';

/** What governs pruning right now. */
export interface JournalRetention {
  retentionDays: number;
  /** `policy` = the platform's RetentionPolicy answered; `fallback` = it did not. */
  source: 'policy' | 'fallback';
  /**
   * True while ANY legal hold is active on the platform.
   *
   * The hold pins compliance logs by id, and this journal is a second copy of
   * that same data category — deleting the local copy of records a hold is
   * preserving is the thing a hold exists to forbid. So an active hold
   * suppresses pruning entirely rather than being resolved per record, which
   * the robot has no ids to do.
   */
  legalHold: boolean;
  /**
   * Whether the legal-hold question was ANSWERED. `legalHold: false` with
   * `legalHoldKnown: false` is "nobody told me", not "there is no hold" — and
   * those two must never look the same to a compliance reader.
   */
  legalHoldKnown: boolean;
  /**
   * Why the lookup did not produce a policy, when it did not. Null on success.
   *
   * Carried in the value rather than only logged because the fallback window is
   * a number this file invented, and a second hardcoded retention regime running
   * unnoticed beside the platform's own `retentionExpiresAt` is precisely what
   * this file exists not to be.
   */
  error: string | null;
}

export interface JournalDeps {
  workspace?: Workspace;
  /** Injected clock, for deterministic tests. */
  now?: () => Date;
}

/** What one prune pass did. */
export interface PruneResult {
  /** Day files deleted. */
  deleted: string[];
  /** Day files kept because they are inside the retention window. */
  kept: string[];
  /** Set when an active legal hold stopped the prune before it deleted anything. */
  suppressedByLegalHold: boolean;
}

/** Parse one JSONL line into a record, or null when it is not one. */
export function parseJournalLine(line: string): JournalRecord | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const obj: unknown = JSON.parse(trimmed);
    if (typeof obj !== 'object' || obj === null) return null;
    const rec = obj as Record<string, unknown>;
    if (typeof rec.t !== 'string' || typeof rec.msg !== 'string') return null;
    // Trust is never defaulted. A line whose provenance we cannot read is not
    // silently promoted to `self`; it is not a record at all.
    if (rec.trust !== 'self' && rec.trust !== 'operator' && rec.trust !== 'untrusted') return null;
    return obj as JournalRecord;
  } catch {
    return null;
  }
}

/**
 * The robot's own history on disk. All I/O is synchronous: the writer is called
 * from `finishBlock`, where an unawaited promise is a line lost to the next
 * crash — which is exactly the event the journal is there to explain.
 */
export class Journal {
  private readonly workspace: Workspace;
  private readonly now: () => Date;

  constructor(deps: JournalDeps = {}) {
    this.workspace = deps.workspace ?? getWorkspace();
    this.now = deps.now ?? (() => new Date());
  }

  /** `journal/YYYY-MM-DD.jsonl` for a given day. */
  fileFor(date: Date): string {
    return path.join(this.workspace.journalDir, `${dayKey(date)}.jsonl`);
  }

  /**
   * Append one record. Never throws: a journal that cannot be written must not
   * take a block down with it — the block already happened.
   */
  append(record: JournalRecord): boolean {
    try {
      const at = record.t ? new Date(record.t) : this.now();
      const file = this.fileFor(Number.isNaN(at.getTime()) ? this.now() : at);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf-8');
      return true;
    } catch (err) {
      console.warn('[Journal] could not append:', err);
      return false;
    }
  }

  /** Day keys present on disk, oldest first. */
  listDays(): string[] {
    try {
      if (!fs.existsSync(this.workspace.journalDir)) return [];
      return fs
        .readdirSync(this.workspace.journalDir)
        .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
        .map((f) => f.slice(0, -6))
        .sort();
    } catch {
      return [];
    }
  }

  /** Every record of one day, in file order. Unparseable lines are skipped. */
  readDay(day: string): JournalRecord[] {
    const file = path.join(this.workspace.journalDir, `${day}.jsonl`);
    try {
      if (!fs.existsSync(file)) return [];
      return fs
        .readFileSync(file, 'utf-8')
        .split('\n')
        .map(parseJournalLine)
        .filter((r): r is JournalRecord => r !== null);
    } catch (err) {
      console.warn(`[Journal] could not read ${file}:`, err);
      return [];
    }
  }

  /**
   * The last `days` CALENDAR days including today, oldest record first. Counted
   * by date rather than by file so a robot that was switched off for a week
   * returns nothing instead of silently reaching a month back.
   */
  readLastDays(days: number): JournalRecord[] {
    const cutoff = dayKey(shiftDays(this.now(), -(Math.max(1, days) - 1)));
    return this.listDays()
      .filter((day) => day >= cutoff)
      .flatMap((day) => this.readDay(day));
  }

  /**
   * Delete day files older than the retention boundary.
   *
   * An active legal hold stops this before anything is deleted, and says so in
   * the result — a prune that silently did nothing is indistinguishable from a
   * prune that ran, and only one of those is a compliance answer.
   */
  prune(retention: JournalRetention): PruneResult {
    const days = this.listDays();
    if (retention.legalHold) {
      console.warn(
        `[Journal] prune SUPPRESSED: a legal hold is active — ${days.length} day file(s) kept.`,
      );
      return { deleted: [], kept: days, suppressedByLegalHold: true };
    }

    const boundary = dayKey(shiftDays(this.now(), -Math.max(0, retention.retentionDays)));
    const deleted: string[] = [];
    const kept: string[] = [];
    for (const day of days) {
      if (day >= boundary) {
        kept.push(day);
        continue;
      }
      try {
        fs.rmSync(path.join(this.workspace.journalDir, `${day}.jsonl`), { force: true });
        deleted.push(day);
      } catch (err) {
        console.warn(`[Journal] could not prune ${day}:`, err);
        kept.push(day);
      }
    }
    if (deleted.length > 0) {
      console.log(
        `[Journal] pruned ${deleted.length} day file(s) older than ${boundary} ` +
          `(${retention.retentionDays} d, ${retention.source}).`,
      );
    }
    return { deleted, kept, suppressedByLegalHold: false };
  }
}

/**
 * The boot this process belongs to (TASK-196), stamped onto every journal line.
 *
 * A module-level holder rather than a constructor argument because the writer
 * (`ServerMirror.logBlock`) is constructed at import time, long before
 * `IncarnationLog.open()` has run. `null` until then, and null is honest: a line
 * we cannot attribute to a boot must not claim one.
 */
let currentBootId: string | null = null;

export function setJournalBootId(bootId: string | null): void {
  currentBootId = bootId;
}

export function getJournalBootId(): string | null {
  return currentBootId;
}

/** `date` shifted by whole days, without touching the original. */
function shiftDays(date: Date, delta: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + delta);
  return next;
}

export interface RetentionFetchDeps {
  serverUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /**
   * Platform API token. Defaults to `process.env[SERVICE_TOKEN_ENV]`; `''`
   * means "send no Authorization header", which is what an unauthenticated
   * local dev server (`AUTH_DISABLED=true`) wants.
   */
  authToken?: string;
}

const RETENTION_TIMEOUT_MS = 3000;

/**
 * Ask the platform what governs this journal: the `command_execution` retention
 * policy, and whether any legal hold is active.
 *
 * AUTHENTICATED. Both routes sit behind `authMiddleware`
 * (`server/src/app.ts`), so an unauthenticated GET is a 401 in every deployment
 * that has not set `AUTH_DISABLED=true` — which used to mean the retention
 * window silently reverted to the 30-day fallback and `legalHold` was
 * permanently false. The token is a service-account token (`ndsa_…`), the
 * mechanism the server already has for machine callers; NO route was given an
 * exemption, because a public legal-hold list is worse than an unauthenticated
 * robot.
 *
 * Still best-effort — a robot must boot with the platform down — but a lookup
 * that failed now SAYS so in `error`, and "no hold" is distinguished from
 * "nobody answered" by `legalHoldKnown`.
 */
export async function fetchJournalRetention(
  deps: RetentionFetchDeps = {},
): Promise<JournalRetention> {
  const serverUrl = deps.serverUrl ?? config.serverUrl;
  const fetchImpl = deps.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const timeoutMs = deps.timeoutMs ?? RETENTION_TIMEOUT_MS;
  const authToken = deps.authToken ?? process.env[SERVICE_TOKEN_ENV] ?? '';

  const get = async (url: string): Promise<unknown> => {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(timeoutMs),
      ...(authToken ? { headers: { Authorization: `Bearer ${authToken}` } } : {}),
    });
    if (!res.ok) {
      throw new Error(
        res.status === 401 || res.status === 403
          ? `HTTP ${res.status} — the robot is not authenticated to the platform. ` +
            `Set ${SERVICE_TOKEN_ENV} to a service-account API token.`
          : `HTTP ${res.status}`,
      );
    }
    return (await res.json()) as unknown;
  };

  let retentionDays = JOURNAL_FALLBACK_RETENTION_DAYS;
  let source: JournalRetention['source'] = 'fallback';
  let error: string | null = null;
  try {
    const body = await get(`${serverUrl}/api/compliance/retention/${JOURNAL_EVENT_TYPE}`);
    const days = (body as { retentionDays?: unknown } | null)?.retentionDays;
    if (typeof days === 'number' && Number.isFinite(days) && days >= 0) {
      retentionDays = Math.floor(days);
      source = 'policy';
    } else {
      error = 'the platform answered without a usable retentionDays';
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  if (error) {
    // console.error, not warn: this is the state in which a second, invented
    // retention regime governs personal data on an unencrypted disk.
    console.error(
      `[Journal] RETENTION POLICY NOT APPLIED (${error}) — falling back to ` +
        `${JOURNAL_FALLBACK_RETENTION_DAYS} days, which is this robot's own number, ` +
        "not the platform's.",
    );
  }

  // A hold we cannot confirm is treated as ABSENT rather than present: the
  // alternative is a robot whose disk fills forever whenever the server is
  // down, which is a different failure, not a safer one. The compliance copy —
  // the one a hold is actually taken over — is unaffected either way. What
  // changed is that the guess is now labelled: `legalHoldKnown`.
  //
  // `activeOnly`, not `active`: `legal-hold.routes.ts` reads `req.query.activeOnly`,
  // so the old spelling asked for ALL holds and a hold released months ago
  // suppressed pruning forever.
  let legalHold = false;
  let legalHoldKnown = false;
  try {
    const body = await get(`${serverUrl}/api/compliance/legal-holds?activeOnly=true`);
    const holds = (body as { holds?: unknown } | null)?.holds;
    if (Array.isArray(holds)) {
      legalHold = holds.length > 0;
      legalHoldKnown = true;
    } else {
      error = error ?? 'the legal-hold list came back in an unreadable shape';
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    error = error ?? `legal holds: ${message}`;
    console.error(
      `[Journal] LEGAL HOLDS UNKNOWN (${message}) — pruning proceeds as if no hold were ` +
        'active. If one is, the platform copy still holds it; this robot\'s copy does not.',
    );
  }

  return { retentionDays, source, legalHold, legalHoldKnown, error };
}

/** Wiring for {@link startJournalRetentionLoop}. */
export interface JournalRetentionLoopDeps {
  /** Where a fresh answer goes — in production, `applyJournalRetention`, which prunes. */
  apply: (retention: JournalRetention) => void;
  /** Override the lookup (tests, or a robot with its own transport). */
  fetchRetention?: () => Promise<JournalRetention>;
  /** How often to re-ask and re-prune. Defaults to {@link RETENTION_CACHE_TTL_MS}. */
  intervalMs?: number;
}

/** A running retention loop. `handle` is a test seam — see {@link startJournalRetentionLoop}. */
export interface JournalRetentionLoop {
  stop(): void;
  /** The interval timer, exposed so a test can assert it is unref'd. */
  readonly handle: NodeJS.Timeout;
}

/**
 * Re-ask the platform and re-prune, forever.
 *
 * Pruning ONCE at boot is not a retention boundary: this stack's normal case is
 * a robot that stays up at a customer site for months, and every day past the
 * boundary is another plaintext day-file on a device with no encryption, no
 * hash chain and no `retentionExpiresAt` — the exact asymmetry the boundary
 * exists to compensate for.
 *
 * The timer is `unref()`d: shutdown ordering in `index.ts` depends on nothing
 * unexpected holding the event loop open, and a robot that will not exit is a
 * robot somebody power-cycles, which is the crash the incarnation log then
 * reports.
 */
export function startJournalRetentionLoop(deps: JournalRetentionLoopDeps): JournalRetentionLoop {
  const intervalMs = Math.max(1000, deps.intervalMs ?? RETENTION_CACHE_TTL_MS);
  const fetchRetention = deps.fetchRetention ?? ((): Promise<JournalRetention> => fetchJournalRetention());

  const tick = (): void => {
    void fetchRetention()
      .then((retention) => deps.apply(retention))
      .catch((err) => console.warn('[Journal] retention lookup failed:', err));
  };

  tick();
  const handle = setInterval(tick, intervalMs);
  // Guarded: a fake-timer implementation need not provide `unref`, and a test
  // clock is not a reason for production code to throw.
  handle.unref?.();
  return { stop: () => clearInterval(handle), handle };
}

/**
 * Blocks whose result text is a VISION-MODEL CAPTION, not a measurement.
 *
 * `look` answers with `Looked: <whatever the VLM wrote> (entities: …)`, so the
 * journal line for it is a sentence a 7B model produced from pixels. Tagging
 * that `self` would launder a caption into the one tier that may be promoted
 * into durable memory — which is the exact poisoning path the trust tier
 * exists to close. The observation is still recorded; it is just recorded as
 * what it is.
 */
export const VLM_CAPTION_BLOCK_KINDS: ReadonlySet<string> = new Set(['look', 'scan_room']);

/**
 * Every kind whose result text is worth less than the robot's own measurement.
 *
 * `blockTrust` FAILS OPEN — an unlisted kind is `'self'`, the one tier that may
 * be promoted into durable memory — so a new kind has to be named here to be
 * kept out, and naming it is the whole safeguard.
 *
 * `vla_skill` (TASK-226) is here because its result is a VERDICT, not a
 * measurement: today "outcome unknown", and once a success classifier is wired
 * up, a model's opinion about a camera frame. Neither is the robot's own
 * experience of having done the thing, and a rollout that ran to its step
 * budget while grasping nothing must not be able to write "I moved the apple to
 * the plate" into memory as a fact about the world.
 */
export const UNTRUSTED_BLOCK_KINDS: ReadonlySet<string> = new Set([
  ...VLM_CAPTION_BLOCK_KINDS,
  'vla_skill',
]);

/** How much a finished block's own result text is worth. */
export function blockTrust(blockKind: string): TrustLevel {
  return UNTRUSTED_BLOCK_KINDS.has(blockKind) ? 'untrusted' : 'self';
}

/**
 * The journal record for a finished Agent Mode block.
 *
 * Trust follows the block KIND (see {@link blockTrust}): a walk's "moved
 * 0.98 m" is the robot's own measured experience, a look's sentence is a vision
 * model's guess. What the OPERATOR said arrives as the plan `command`, which is
 * why that is carried as context and not as the `msg`.
 */
export function blockJournalRecord(input: {
  at: string;
  bootId: string | null;
  planId: string | null;
  blockKind: string;
  ok: boolean;
  message: string;
  measured?: { distanceM?: number; angleDeg?: number };
  place: string | null;
  pose?: { x: number; y: number; yawDeg: number; source: string } | null;
}): JournalRecord {
  return {
    t: input.at,
    bootId: input.bootId,
    kind: 'block',
    planId: input.planId,
    block: input.blockKind,
    ok: input.ok,
    ...(input.measured ? { measured: input.measured } : {}),
    place: input.place,
    ...(input.pose ? { pose: input.pose } : {}),
    trust: blockTrust(input.blockKind),
    msg: input.message,
  };
}
