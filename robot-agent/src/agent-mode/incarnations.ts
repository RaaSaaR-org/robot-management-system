/**
 * @file incarnations.ts
 * @description The robot's boot lineage: one JSONL line per process life,
 *              closed on a clean shutdown. A line without `endedAt` is a crash —
 *              that is the whole detection mechanism, and it is why the close
 *              happens before the network phase of `shutdown()`.
 *              A "process life" starts when the process OWNS ITS PORT, not when
 *              `main()` starts: `open()` only reads the past and mints an id,
 *              `confirm()` is what writes the line.
 * @feature agentmode
 * @status live
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { atomicWriteFileSync } from '../utils/atomic-file.js';

/**
 * How many lines the file keeps. `npm run dev` is `tsx watch`, so EVERY file
 * save starts a new incarnation: without a cap a dev box accumulates thousands
 * of lines within a week, and this file is read at every boot.
 */
export const INCARNATION_MAX_LINES = 200;

/** One process life. */
export interface IncarnationRecord {
  /** Short, unique-per-boot id. */
  bootId: string;
  /** ISO-8601 timestamp the process came up. */
  startedAt: string;
  /** ISO-8601 timestamp of the CLEAN shutdown; null means it never happened. */
  endedAt: string | null;
  /** How it ended — 'SIGINT', 'SIGTERM', … ; null while running / on a crash. */
  exit: string | null;
  /** Last known named place (TASK-195), when there was one. */
  lastPlace: string | null;
  /** Whether an E-Stop latch was held at shutdown. */
  estopLatched: boolean;
  /** Whether the base was damped at shutdown. */
  damped: boolean;
  /** Software integrity hash from `SecureBootVerifier`, when available. */
  integrityHash?: string;
  /**
   * Which boot this is over the robot's WHOLE life, 1-based.
   *
   * Written INTO the line, which is the entire point: the file is a ring buffer
   * capped at {@link INCARNATION_MAX_LINES}, so a count derived from a line's
   * index inside it drops by one every time rotation discards a line — observed
   * live going 199 → 197 across a restart. A number that decreases is not a
   * count of starts. The retained lines carry their own ordinal, so the next
   * boot continues from the highest one it can still see.
   *
   * Absent on lines written before this field existed (and on hand-written
   * ones), which is what {@link seqExact} is for.
   */
  seq?: number;
  /**
   * `true` only when {@link seq} is an exact lifetime ordinal — i.e. it was
   * counted forward from a line that was itself exact, all the way back to the
   * first boot of this lineage file.
   *
   * `false` means it is a FLOOR: the counter was seeded from a file that had
   * already rotated without one (or from an unreadable/erased lineage), so
   * boots happened that nothing on this disk can account for. The floor still
   * never decreases — it just must not be presented as an exact ordinal, which
   * is why it travels all the way to the header as `incarnationExact`.
   */
  seqExact?: boolean;
}

/** What the boot sequence learns from opening the log. */
export interface IncarnationOpenResult {
  bootId: string;
  startedAt: string;
  /** This boot's lifetime ordinal, 1-based. See {@link IncarnationRecord.seq}. */
  seq: number;
  /** Whether {@link seq} is exact. `false` means "at least this many boots". */
  seqExact: boolean;
  /**
   * The previous incarnation never wrote its `endedAt` — the process was killed,
   * crashed or lost power. NOT "something bad happened to the robot": it is a
   * statement about the software's exit, which is exactly what a robot that
   * refuses self-initiated motion afterwards is being careful about.
   */
  fromCrash: boolean;
  /** The previous line, when there was one. */
  previous: IncarnationRecord | null;
}

export interface IncarnationLogDeps {
  robotId: string;
  /** Override the file location (tests, TASK-197's per-robot workspace). */
  filePath?: string;
  /** Override the rotation cap (tests). */
  maxLines?: number;
  /** Injected clock, for deterministic tests. */
  now?: () => Date;
  /** Injected boot-id source, for deterministic tests. */
  makeBootId?: () => string;
}

/**
 * Bytes of randomness in a boot id.
 *
 * It used to be 2 — 16 bits, against a file that keeps
 * {@link INCARNATION_MAX_LINES} lines and, on a `tsx watch` dev box, turns all
 * of them over within days. At ~0.3% per boot a collision was a matter of
 * weeks, and the consequence was not cosmetic: {@link IncarnationLog.close}
 * rewrote the OTHER line, leaving our own `endedAt: null` at the end of the
 * file, so the next boot reported a crash that never happened and demanded an
 * acknowledgement for a clean shutdown. A recovery banner that cries wolf is
 * worse than none — it teaches the operator to click it away.
 */
const BOOT_ID_BYTES = 6;

/** `b-7f3a19c2d40e` — still one glance in a log line, 48 bits of collision room. */
function defaultBootId(): string {
  return `b-${crypto.randomBytes(BOOT_ID_BYTES).toString('hex')}`;
}

/**
 * A usable lifetime ordinal: a whole, positive, safe integer.
 *
 * Anything else — a float, a negative, `1e400`, a string — is damage, and
 * damage is read as "no counter on this line" rather than trusted, because the
 * one thing this number may never do is over-count.
 */
function isLifetimeSeq(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

/**
 * What ordinal the NEXT boot gets, from the lines the file still holds.
 *
 * Exported for the tests that matter here: rotation past the cap, and every way
 * the counter can be missing. The rule is "never decrease, never over-count":
 *
 *  - The highest ordinal on disk wins (not the last line's — a corrupt or
 *    hand-appended tail must not cost the lineage ground it already covered).
 *  - The number of retained lines is a floor in its own right: a lineage with no
 *    counter at all has still demonstrably seen that many boots.
 *  - Exactness is inherited. A count that starts from a floor stays a floor
 *    forever, because the boots the rotation ate are gone for good.
 *
 * @param lineageExisted whether the file was there at all. A brand-new file is
 *   the one case where "this is boot 1" is exact; an unreadable or wiped one
 *   looks identical on disk and must not claim it.
 */
export function nextLifetimeSeq(
  records: readonly IncarnationRecord[],
  lineageExisted: boolean,
): { seq: number; exact: boolean } {
  let best: { seq: number; exact: boolean } | null = null;
  for (const record of records) {
    if (!isLifetimeSeq(record.seq)) continue;
    if (best === null || record.seq > best.seq) {
      best = { seq: record.seq, exact: record.seqExact === true };
    }
  }
  // +1 for the boot being opened right now.
  const floor = records.length + 1;
  if (best === null) {
    // Either a fresh lineage (exactly boot 1) or one that predates the counter
    // and has already rotated — indistinguishable from here, so: a floor.
    return { seq: floor, exact: !lineageExisted && records.length === 0 };
  }
  const seq = Math.max(best.seq + 1, floor);
  // Being dragged up by the line count means there are boots on disk the
  // counter never covered, so the result is a floor even if `best` was exact.
  return { seq, exact: best.exact && seq === best.seq + 1 };
}

/** Parse one JSONL line into a record, or null when it is not one. */
function parseLine(line: string): IncarnationRecord | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const obj: unknown = JSON.parse(trimmed);
    if (typeof obj !== 'object' || obj === null) return null;
    const rec = obj as Record<string, unknown>;
    if (typeof rec.bootId !== 'string' || typeof rec.startedAt !== 'string') return null;
    return {
      bootId: rec.bootId,
      startedAt: rec.startedAt,
      endedAt: typeof rec.endedAt === 'string' ? rec.endedAt : null,
      exit: typeof rec.exit === 'string' ? rec.exit : null,
      lastPlace: typeof rec.lastPlace === 'string' ? rec.lastPlace : null,
      estopLatched: rec.estopLatched === true,
      damped: rec.damped === true,
      ...(typeof rec.integrityHash === 'string' ? { integrityHash: rec.integrityHash } : {}),
      // `seqExact` is only believed when it says so explicitly: a line carrying
      // an ordinal but no flag was not written by this code, and an unlabelled
      // number is exactly the kind of thing that must not be promoted to fact.
      ...(isLifetimeSeq(rec.seq) ? { seq: rec.seq, seqExact: rec.seqExact === true } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Append-mostly JSONL log of every boot, with crash detection and rotation.
 *
 * All I/O is synchronous on purpose: the open runs in the boot sequence and the
 * close runs inside a signal handler, where an unawaited promise is a line that
 * never gets written.
 */
export class IncarnationLog {
  private readonly filePath: string;
  private readonly maxLines: number;
  private readonly now: () => Date;
  private readonly makeBootId: () => string;
  /** Our own line, once opened. */
  private current: IncarnationRecord | null = null;
  /** Whether {@link confirm} has put our line on disk. */
  private committed = false;
  /** Whether {@link abandon} decided this process never lived. */
  private abandoned = false;
  /**
   * The crash message {@link open} worked out, held until {@link confirm}.
   *
   * A process that loses the port must not announce the previous boot's crash
   * either: it is about to exit, and the boot that DOES take over says it.
   */
  private pendingCrashWarning: string | null = null;
  /** This boot's lifetime ordinal, decided in {@link open}. */
  private sequence: { seq: number; exact: boolean } = { seq: 1, exact: false };
  private closed = false;

  constructor(deps: IncarnationLogDeps) {
    this.filePath =
      deps.filePath ??
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        `../../data/incarnations-${deps.robotId}.jsonl`,
      );
    this.maxLines = deps.maxLines ?? INCARNATION_MAX_LINES;
    this.now = deps.now ?? (() => new Date());
    this.makeBootId = deps.makeBootId ?? defaultBootId;
  }

  /** Where the lineage is written (for logs and tests). */
  get file(): string {
    return this.filePath;
  }

  /** The line this process owns, once {@link open} has run. */
  getCurrent(): IncarnationRecord | null {
    return this.current ? { ...this.current } : null;
  }

  /** Every line currently on disk, oldest first. Unparseable lines are skipped. */
  readAll(): IncarnationRecord[] {
    return this.read().records;
  }

  /**
   * Read the file, and say whether its LAST line was cut off.
   *
   * A truncated tail is not noise to be skipped — it is the strongest possible
   * evidence that the previous process died mid-write, which is exactly
   * {@link IncarnationOpenResult.fromCrash}. Skipping it silently (as this used
   * to) promoted the previous, cleanly-closed line to `previous`, and the boot
   * that followed a hard kill reported `fromCrash: false`: the robot lost even
   * its refusal to act on its own.
   */
  private read(): { records: IncarnationRecord[]; truncated: boolean; existed: boolean } {
    try {
      if (!fs.existsSync(this.filePath)) return { records: [], truncated: false, existed: false };
      const lines = fs
        .readFileSync(this.filePath, 'utf-8')
        .split('\n')
        .filter((l) => l.trim().length > 0);
      const records = lines
        .map(parseLine)
        .filter((r): r is IncarnationRecord => r !== null);
      // Only the LAST line counts as truncation. Damage in the middle is a
      // different (and older) event: it cannot tell us how THIS boot's
      // predecessor ended, so it is skipped as before.
      const last = lines.length > 0 ? lines[lines.length - 1] : null;
      const truncated = last !== null && parseLine(last) === null;
      if (truncated) {
        console.warn(
          `[Incarnations] the last line of ${this.filePath} is incomplete — ` +
            'the previous process died while writing it',
        );
      }
      return { records, truncated, existed: true };
    } catch (err) {
      console.warn('[Incarnations] Could not read the lineage file:', err);
      // `existed: true` on purpose — a file we cannot read is not a fresh
      // lineage, and the boot counter must not restart at an exact 1 because of
      // an EACCES.
      return { records: [], truncated: false, existed: true };
    }
  }

  /**
   * Start this incarnation: read the previous line, decide whether the last
   * process died, and mint this boot's id — WITHOUT writing anything.
   *
   * The line goes to disk in {@link confirm}, once the process owns its port.
   * Writing it here is what manufactured phantom crashes: `npm run dev` spawns
   * racing processes, every loser appended a line ~300 lines of boot sequence
   * before `server.listen()` and then died on EADDRINUSE without ever reaching
   * a close, so its line stayed open — and an open line IS the crash signal.
   * Observed live on 2026-08-02: 200 of 200 lines in the file had
   * `endedAt: null`, and the console showed "recovered from an unclean
   * shutdown" permanently. A recovery banner that cries wolf is worse than
   * none.
   *
   * Idempotent — a second call returns the first result rather than forking the
   * lineage.
   */
  open(opts: { startedAt?: string; integrityHash?: string } = {}): IncarnationOpenResult {
    if (this.current) {
      return {
        bootId: this.current.bootId,
        startedAt: this.current.startedAt,
        seq: this.sequence.seq,
        seqExact: this.sequence.exact,
        fromCrash: false,
        previous: null,
      };
    }

    const { records: existing, truncated, existed } = this.read();
    const previous = existing.length > 0 ? existing[existing.length - 1] : null;
    // A line without `endedAt` was never closed: `shutdown()` did not run. A
    // line that does not even parse to the end says the same thing louder — the
    // process died with the write half-issued — so it counts as a crash whatever
    // the last COMPLETE line happens to claim.
    const fromCrash = truncated || (previous !== null && previous.endedAt === null);

    // Counted BEFORE rotation trims the file, and written into our own line, so
    // the boots this open discards are still accounted for by the next one.
    this.sequence = nextLifetimeSeq(existing, existed);

    const record: IncarnationRecord = {
      bootId: this.makeBootId(),
      startedAt: opts.startedAt ?? this.now().toISOString(),
      endedAt: null,
      exit: null,
      lastPlace: null,
      estopLatched: false,
      damped: false,
      ...(opts.integrityHash ? { integrityHash: opts.integrityHash } : {}),
      seq: this.sequence.seq,
      seqExact: this.sequence.exact,
    };
    this.current = record;

    // NOTHING is written here — see `confirm()`. The crash verdict is already
    // decided (the caller needs it to wire the controller), but the sentence
    // that announces it belongs to the boot that actually takes over.
    this.pendingCrashWarning = !fromCrash
      ? null
      : previous
        ? `[Incarnations] Previous incarnation ${previous.bootId} never shut down cleanly ` +
          `(started ${previous.startedAt}) — treating this boot as crash recovery`
        : '[Incarnations] The lineage file ends in an incomplete line and holds no complete ' +
          'record — treating this boot as crash recovery';

    return {
      bootId: record.bootId,
      startedAt: record.startedAt,
      seq: this.sequence.seq,
      seqExact: this.sequence.exact,
      fromCrash,
      previous,
    };
  }

  /**
   * This process owns its port: put our line on disk, and rotate.
   *
   * The moment a boot becomes part of the lineage. Called from the
   * `server.listen()` callback in `index.ts` — everything before that point is
   * a process that may still lose the port to another one, and a process that
   * never served is not an incarnation of this robot.
   *
   * Crash detection is NOT weakened by the deferral, only narrowed to processes
   * that actually ran: from here on, dying without a {@link close} leaves an
   * open line and the next boot reports the crash, exactly as before.
   *
   * Idempotent, and a no-op after {@link abandon}.
   */
  confirm(): void {
    const record = this.current;
    if (!record || this.committed || this.abandoned) return;
    this.committed = true;

    // Re-read instead of reusing the snapshot `open()` took: this file is
    // shared per robot, and the gap between open and bind is exactly where a
    // second process is alive. `seq` stays what open() decided — the ordinal is
    // about this robot's life, not about who wrote last.
    const { records } = this.read();
    this.writeAll([...records, record].slice(-this.maxLines));

    if (this.pendingCrashWarning) console.warn(this.pendingCrashWarning);
    console.log(
      `[Incarnations] boot ${record.bootId} opened — ` +
        `${this.sequence.exact ? '' : 'at least '}boot #${this.sequence.seq} of this robot's life ` +
        `(${this.filePath})`,
    );
  }

  /**
   * This process never owned its port: drop the record instead of confirming it.
   *
   * Nothing is written, because nothing was: the lineage neither gains a line
   * that reads as a crash nor counts a boot that never happened. After
   * {@link confirm} this is deliberately a no-op — a process that DID live
   * leaves its line exactly as its real exit wrote it, open (a crash) or
   * closed.
   */
  abandon(reason: string): void {
    const record = this.current;
    if (!record || this.abandoned) return;
    if (this.committed) {
      console.warn(
        `[Incarnations] boot ${record.bootId} is already in the lineage — ` +
          `"${reason}" leaves its line as it stands`,
      );
      return;
    }
    this.abandoned = true;
    console.warn(
      `[Incarnations] boot ${record.bootId} never owned its port (${reason}) — ` +
        'no lineage entry written',
    );
  }

  /**
   * Close this incarnation. Writing `endedAt` is what makes the NEXT boot read
   * as clean, so it must happen before anything that can hang — `server.close()`
   * waits forever on an open WebSocket.
   *
   * Idempotent: a SIGINT after a SIGTERM must not append a second line.
   *
   * A no-op before {@link confirm}: a process that never owned its port has no
   * line to close, and writing one here would put the phantom boot back into
   * the lineage through the shutdown path instead of the boot path.
   */
  close(
    exit: string,
    state: { lastPlace?: string | null; estopLatched?: boolean; damped?: boolean } = {},
  ): void {
    if (!this.current || !this.committed || this.closed) return;
    this.closed = true;

    this.current = {
      ...this.current,
      endedAt: this.now().toISOString(),
      exit,
      lastPlace: state.lastPlace ?? this.current.lastPlace,
      estopLatched: state.estopLatched ?? this.current.estopLatched,
      damped: state.damped ?? this.current.damped,
    };

    // Rewrite our own line in place. Appending a second line for the same
    // bootId would make the lineage read as two boots, one of them crashed.
    const lines = this.readAll();
    const index = this.indexOfSelf(lines);
    if (index === -1) lines.push(this.current);
    else lines[index] = this.current;

    this.writeAll(lines.slice(-this.maxLines));
    console.log(`[Incarnations] boot ${this.current.bootId} closed (${exit})`);
  }

  /**
   * Which line on disk is OURS.
   *
   * Identity is `bootId` AND `startedAt`, scanned from the END. Matching the
   * first `bootId` alone is what made a 16-bit collision destructive: with an
   * older line carrying the same id, a clean SIGINT closed the wrong boot and
   * left ours open. Scanning backwards means that even in the (now ~2^-48)
   * collision case we rewrite the line this process actually appended, because
   * ours is always the later one.
   */
  private indexOfSelf(lines: IncarnationRecord[]): number {
    const me = this.current;
    if (!me) return -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].bootId === me.bootId && lines[i].startedAt === me.startedAt) return i;
    }
    return -1;
  }

  /**
   * Overwrite the file with exactly these lines.
   *
   * Through a temp file + rename ({@link atomicWriteFileSync}): a truncating
   * write onto the live path leaves an empty or half-written lineage if the
   * process dies during it, and this file IS the crash detector — losing it
   * loses the very crash that killed the write.
   */
  private writeAll(records: IncarnationRecord[]): void {
    try {
      const body = records.map((r) => JSON.stringify(r)).join('\n');
      atomicWriteFileSync(this.filePath, records.length > 0 ? `${body}\n` : '');
    } catch (err) {
      // A lineage we cannot write is a lineage that reads as a crash next boot.
      // That is the safe direction, so it is logged and never thrown.
      console.error('[Incarnations] Could not write the lineage file:', err);
    }
  }
}
