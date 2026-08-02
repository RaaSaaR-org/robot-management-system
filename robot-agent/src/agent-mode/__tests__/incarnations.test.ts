/**
 * @file incarnations.test.ts
 * @description The boot lineage: a line without `endedAt` is a crash, a clean
 *              shutdown writes one, and the file is rotated — `tsx watch` opens
 *              a new incarnation on every file save, and this file is read at
 *              every boot. A line belongs to a process that OWNED ITS PORT:
 *              `open()` only reads the past, `confirm()` writes.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  IncarnationLog,
  INCARNATION_MAX_LINES,
  nextLifetimeSeq,
  type IncarnationRecord,
} from '../incarnations.js';

let tmpDir: string;
let file: string;
let seq: number;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neodem-incarnations-'));
  file = path.join(tmpDir, 'incarnations.jsonl');
  seq = 0;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** One log with deterministic boot ids, as a fresh process would see the file. */
function makeLog(maxLines?: number): IncarnationLog {
  return new IncarnationLog({
    robotId: 'robot-1',
    filePath: file,
    makeBootId: () => `b-${++seq}`,
    ...(maxLines === undefined ? {} : { maxLines }),
  });
}

/**
 * A process that came up AND got its port — which is what puts a line on disk.
 * `open()` on its own writes nothing: a process that loses the port to another
 * one never lived, and a line it left open would be read as a crash by the boot
 * that follows.
 */
function bind(
  log: IncarnationLog,
  opts: { startedAt?: string; integrityHash?: string } = {},
): ReturnType<IncarnationLog['open']> {
  const result = log.open(opts);
  log.confirm();
  return result;
}

describe('IncarnationLog — crash detection', () => {
  it('reports no crash on the very first boot', () => {
    const result = makeLog().open();

    expect(result.fromCrash).toBe(false);
    expect(result.previous).toBeNull();
    expect(result.bootId).toBe('b-1');
  });

  it('reports NO crash when the previous incarnation was closed cleanly', () => {
    const first = makeLog();
    bind(first);
    first.close('SIGTERM', { estopLatched: false, damped: false });

    const second = bind(makeLog());

    expect(second.fromCrash).toBe(false);
    expect(second.previous?.endedAt).not.toBeNull();
    expect(second.previous?.exit).toBe('SIGTERM');
  });

  it('reports a crash when the previous incarnation never wrote `endedAt`', () => {
    bind(makeLog()); // it owned the port, and died here — no close()

    const second = bind(makeLog());

    expect(second.fromCrash).toBe(true);
    expect(second.previous?.endedAt).toBeNull();
    expect(second.previous?.bootId).toBe('b-1');
  });

  it('carries the safety state of the last clean shutdown into the lineage', () => {
    const log = makeLog();
    bind(log);
    log.close('SIGINT', { estopLatched: true, damped: true, lastPlace: 'AISLE-3' });

    const [record] = makeLog().readAll();
    expect(record.estopLatched).toBe(true);
    expect(record.damped).toBe(true);
    expect(record.lastPlace).toBe('AISLE-3');
    expect(record.exit).toBe('SIGINT');
  });

  it('keeps the attestation details it was opened with', () => {
    const log = makeLog();
    bind(log, { startedAt: '2026-08-02T08:00:00.000Z', integrityHash: 'deadbeef' });

    const [record] = log.readAll();
    expect(record.startedAt).toBe('2026-08-02T08:00:00.000Z');
    expect(record.integrityHash).toBe('deadbeef');
  });

  it('survives a corrupt line instead of losing the whole lineage', () => {
    fs.writeFileSync(file, 'not json at all\n', 'utf-8');

    const result = bind(makeLog());

    // The lineage carries on from a fresh line…
    expect(makeLog().readAll().map((r) => r.bootId)).toEqual(['b-1']);
    // …and the damage itself is read as what it is: nothing writes half a line
    // to this file except a process that was killed while writing it.
    expect(result.fromCrash).toBe(true);
  });

  /**
   * THE failure this detector exists for, and the one it used to miss: the
   * process is killed mid-write, so the last line is cut off. `readAll` skipped
   * unparseable lines, which promoted the previous — cleanly closed — line to
   * `previous`, and the boot after a hard kill reported `fromCrash: false`. The
   * robot lost its refusal to act on its own at exactly the moment the refusal
   * was warranted.
   */
  it('reports a crash when the last line was cut off mid-write', () => {
    const clean = makeLog();
    bind(clean);
    clean.close('SIGTERM');
    const closed = fs.readFileSync(file, 'utf-8');
    // The next boot's line, truncated the way an interrupted write leaves it.
    fs.writeFileSync(file, `${closed}{"bootId":"b-9","startedAt":"2026-08-0`, 'utf-8');

    const result = bind(makeLog());

    expect(result.fromCrash).toBe(true);
    // The complete records are still there — the tail is dropped, not the file.
    expect(makeLog().readAll().map((r) => r.bootId)).toEqual(['b-1', 'b-2']);
  });

  it('does not call a boot a crash over damage in the MIDDLE of the file', () => {
    const first = makeLog();
    bind(first);
    first.close('SIGTERM');
    const second = makeLog();
    bind(second);
    second.close('SIGTERM');
    const [a, b] = fs.readFileSync(file, 'utf-8').trim().split('\n');
    // Old damage, with a complete and cleanly-closed line after it: that line
    // is what says how the previous process ended.
    fs.writeFileSync(file, `${a}\nhalf a line from last month\n${b}\n`, 'utf-8');

    expect(bind(makeLog()).fromCrash).toBe(false);
  });
});

/**
 * The ghost incarnation, observed live on 2026-08-02.
 *
 * `index.ts` opened the lineage ~300 lines of boot sequence before
 * `server.listen()`. `npm run dev` (tsx watch) regularly has more than one
 * process alive — three boots landed within 50 ms on this box — and every one
 * that lost the port had already appended a line, read the winner's still-open
 * line as a crash and pushed its own identity to the server mirror, then died
 * on EADDRINUSE without ever closing its line. Result: 200 of 200 lines in the
 * live file had `endedAt: null`, and the Agent Mode page showed "Recovered from
 * an unclean shutdown" permanently — the banner that cries wolf.
 */
describe('IncarnationLog — a boot that never owned its port', () => {
  it('leaves no open (crash-looking) line behind', () => {
    const winner = makeLog();
    bind(winner);
    winner.close('SIGTERM');

    // The duplicate: gets as far as reading the lineage, then loses the port.
    const loser = makeLog();
    loser.open();
    loser.abandon('port 41246 is already in use');

    expect(makeLog().readAll().map((r) => r.bootId)).toEqual(['b-1']);
    // …so the boot that follows does not inherit a crash that never happened.
    expect(makeLog().open().fromCrash).toBe(false);
  });

  it('does not inflate the incarnation count', () => {
    const winner = makeLog();
    bind(winner);
    for (let i = 0; i < 4; i++) {
      const loser = makeLog();
      loser.open();
      loser.abandon('EADDRINUSE');
    }

    expect(makeLog().readAll()).toHaveLength(1);
  });

  it('writes nothing even when nobody calls abandon — the process just dies', () => {
    makeLog().open(); // EADDRINUSE, and the exit handler never got a chance

    expect(fs.existsSync(file)).toBe(false);
  });

  it('has no line to close, so the shutdown handler writes none', () => {
    const loser = makeLog();
    loser.open();
    loser.abandon('EADDRINUSE');
    // `index.ts`'s SIGTERM path still runs on a process that never bound.
    loser.close('SIGTERM');

    expect(fs.existsSync(file)).toBe(false);
  });

  it('cannot be resurrected: confirm() after abandon() writes nothing', () => {
    const loser = makeLog();
    loser.open();
    loser.abandon('EADDRINUSE');
    loser.confirm();

    expect(fs.existsSync(file)).toBe(false);
  });

  /**
   * The safety mechanism is narrowed to processes that ran, never removed: a
   * boot that DID bind and then died is still a crash, and the boot after it
   * still refuses self-initiated motion until a human clears it.
   */
  it('still reports a crash for a process that DID bind and never closed', () => {
    bind(makeLog()); // owned the port, then SIGKILL — no close()

    expect(makeLog().open().fromCrash).toBe(true);
  });

  it('leaves a confirmed line alone when abandon arrives after the bind', () => {
    const log = makeLog();
    bind(log);
    log.abandon('socket error after listen');

    // That process DID live, so its line stays — and stays open, because it
    // really did die without a clean shutdown.
    const [record] = makeLog().readAll();
    expect(record.bootId).toBe('b-1');
    expect(record.endedAt).toBeNull();
    expect(makeLog().open().fromCrash).toBe(true);
  });

  it('confirms exactly once, however often the listen callback fires', () => {
    const log = makeLog();
    log.open();
    log.confirm();
    log.confirm();

    expect(makeLog().readAll()).toHaveLength(1);
  });
});

describe('IncarnationLog — close semantics', () => {
  it('rewrites its own line instead of appending a second one', () => {
    const log = makeLog();
    bind(log);
    log.close('SIGTERM');

    const all = log.readAll();
    expect(all).toHaveLength(1);
    expect(all[0].endedAt).not.toBeNull();
  });

  it('is idempotent — a SIGINT after a SIGTERM changes nothing', () => {
    const log = makeLog();
    bind(log);
    log.close('SIGTERM');
    const after = log.readAll();
    log.close('SIGINT');

    expect(log.readAll()).toEqual(after);
  });

  it('does nothing when the lineage was never opened', () => {
    makeLog().close('SIGTERM');
    expect(fs.existsSync(file)).toBe(false);
  });

  /**
   * The boot id used to be 16 bits against a 200-line file that a `tsx watch`
   * box turns over in days (~0.3% per boot). `close()` rewrote the FIRST line
   * with a matching id, so a collision closed somebody ELSE's boot and left
   * ours open — and the next boot read the file, saw an `endedAt: null` at the
   * end and demanded acknowledgement for a perfectly clean shutdown.
   */
  it('closes ITS OWN line when an older line carries the same boot id', () => {
    // An older, cleanly-closed incarnation that happens to share our id.
    const older = {
      bootId: 'b-dup',
      startedAt: '2026-07-01T07:00:00.000Z',
      endedAt: '2026-07-01T08:00:00.000Z',
      exit: 'SIGTERM',
      lastPlace: null,
      estopLatched: false,
      damped: false,
    };
    fs.writeFileSync(file, `${JSON.stringify(older)}\n`, 'utf-8');

    const log = new IncarnationLog({
      robotId: 'robot-1',
      filePath: file,
      makeBootId: () => 'b-dup',
    });
    bind(log, { startedAt: '2026-08-02T09:00:00.000Z' });
    log.close('SIGINT');

    const all = log.readAll();
    expect(all).toHaveLength(2);
    // The old line is untouched…
    expect(all[0]).toEqual(older);
    // …and OURS is the one that got the `endedAt`, so the next boot reads clean.
    expect(all[1].startedAt).toBe('2026-08-02T09:00:00.000Z');
    expect(all[1].endedAt).not.toBeNull();
    expect(new IncarnationLog({ robotId: 'robot-1', filePath: file }).open().fromCrash).toBe(false);
  });

  it('uses a boot id wide enough that a 200-line file cannot collide', () => {
    // 48 bits of randomness. The old `randomBytes(2)` produced 4 hex chars.
    const real = new IncarnationLog({ robotId: 'robot-1', filePath: file });
    const { bootId } = real.open();
    expect(bootId).toMatch(/^b-[0-9a-f]{12}$/);
  });
});

describe('IncarnationLog — the write is atomic', () => {
  /**
   * `fs.writeFileSync` onto the live path opens it `O_TRUNC`. A process killed
   * between the truncate and the write leaves an EMPTY lineage — and an empty
   * lineage reads as "no previous boot", so the crash that killed the write is
   * the one crash this file cannot report.
   */
  it('never opens the lineage file itself for writing', () => {
    const targets: string[] = [];
    const real = fs.writeFileSync;
    vi.spyOn(fs, 'writeFileSync').mockImplementation(((p: fs.PathOrFileDescriptor, data: string, opts: unknown) => {
      targets.push(String(p));
      return (real as (...args: unknown[]) => void)(p, data, opts);
    }) as typeof fs.writeFileSync);

    const log = makeLog();
    bind(log);
    log.close('SIGTERM');

    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(target).not.toBe(file);
      expect(target).toMatch(/\.tmp-\d+-\d+$/);
    }
    vi.restoreAllMocks();
    // …and the scratch files are gone, with the real content in place.
    expect(fs.readdirSync(tmpDir)).toEqual(['incarnations.jsonl']);
    expect(makeLog().readAll()).toHaveLength(1);
  });
});

describe('IncarnationLog — rotation', () => {
  it('caps the file, keeping the most recent lines', () => {
    for (let i = 0; i < 8; i++) {
      const log = makeLog(5);
      bind(log);
      log.close('SIGTERM');
    }

    const all = makeLog(5).readAll();
    expect(all).toHaveLength(5);
    expect(all.map((r) => r.bootId)).toEqual(['b-4', 'b-5', 'b-6', 'b-7', 'b-8']);
  });

  it('rotates when the line is written, because a crash never reaches a close', () => {
    for (let i = 0; i < 6; i++) bind(makeLog(3)); // every one of them crashes

    expect(makeLog(3).readAll()).toHaveLength(3);
  });

  it('defaults to a cap a dev box cannot outgrow in a week of `tsx watch`', () => {
    expect(INCARNATION_MAX_LINES).toBe(200);
  });
});

/**
 * The lifetime boot counter.
 *
 * The count of starts used to be the line's INDEX inside this ring buffer, and
 * it was rendered to operators as "incarnation 197" and spoken as "this is my
 * 197th start". Observed live: it went 199 → 197 across a restart, because
 * rotation had discarded two lines. A count of starts that DECREASES is not a
 * count of starts — so the ordinal is written into the line, and the boots that
 * rotation eats stay counted.
 */
describe('IncarnationLog — the lifetime boot counter', () => {
  /**
   * Open, bind and cleanly close one boot, and report what it thinks its number
   * is. The `confirm()` is what puts the line on disk — see `bind()` above.
   */
  function boot(maxLines?: number): { seq: number; seqExact: boolean } {
    const log = makeLog(maxLines);
    const { seq, seqExact } = log.open();
    log.confirm();
    log.close('SIGTERM');
    return { seq, seqExact };
  }

  it('starts at an exact 1 on a lineage that does not exist yet', () => {
    expect(boot()).toEqual({ seq: 1, seqExact: true });
  });

  it('counts up one per boot and never repeats a number', () => {
    const seqs = [boot(), boot(), boot()].map((r) => r.seq);
    expect(seqs).toEqual([1, 2, 3]);
    expect(makeLog().readAll().map((r) => r.seq)).toEqual([1, 2, 3]);
  });

  it('does NOT decrease when the lineage rotates past its cap', () => {
    // Cap of 3 against 10 boots: seven lines are discarded, and every one of
    // them used to cost the count a step.
    const seen: number[] = [];
    for (let i = 0; i < 10; i++) seen.push(boot(3).seq);

    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // Monotone by construction, asserted anyway — this is the defect.
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1]);
    // …and the file itself is still capped: rotation was kept, not removed.
    expect(makeLog(3).readAll().map((r) => r.seq)).toEqual([8, 9, 10]);
  });

  it('continues from the right number after a rotation, and stays exact', () => {
    for (let i = 0; i < 6; i++) boot(2);

    const next = makeLog(2).open();
    expect(next.seq).toBe(7);
    expect(next.seqExact).toBe(true);
  });

  it('keeps its number across a crash, where no close ever runs', () => {
    bind(makeLog(2)); // killed here
    bind(makeLog(2)); // and again
    const third = bind(makeLog(2));

    expect(third.seq).toBe(3);
    expect(third.fromCrash).toBe(true);
  });

  it('keeps the ordinal on the line when the clean shutdown rewrites it', () => {
    const first = makeLog();
    bind(first);
    first.close('SIGINT');

    const [record] = makeLog().readAll();
    expect(record.seq).toBe(1);
    expect(record.seqExact).toBe(true);
    expect(record.endedAt).not.toBeNull();
  });

  /**
   * The upgrade path, and the one case where the number is honestly unknowable:
   * a file written before the counter existed has already rotated, so the boots
   * it dropped cannot be recovered. The count carries on from a FLOOR and says
   * so forever after — `seqExact: false` is what stops the header rendering a
   * lower bound as an exact ordinal.
   */
  it('degrades to a documented, non-decreasing floor on a lineage with no counter', () => {
    const legacy = (bootId: string): string =>
      `${JSON.stringify({
        bootId,
        startedAt: '2026-07-01T07:00:00.000Z',
        endedAt: '2026-07-01T08:00:00.000Z',
        exit: 'SIGTERM',
        lastPlace: null,
        estopLatched: false,
        damped: false,
      })}\n`;
    fs.writeFileSync(file, `${legacy('b-old-1')}${legacy('b-old-2')}${legacy('b-old-3')}`, 'utf-8');

    const first = boot();
    expect(first).toEqual({ seq: 4, seqExact: false });

    // It keeps rising, and it never turns back into an exact ordinal — the
    // boots the old file rotated away are gone for good.
    expect(boot()).toEqual({ seq: 5, seqExact: false });
    expect(boot()).toEqual({ seq: 6, seqExact: false });
  });

  it('treats a corrupt ordinal as no ordinal instead of trusting it', () => {
    const damaged = {
      bootId: 'b-old',
      startedAt: '2026-07-01T07:00:00.000Z',
      endedAt: '2026-07-01T08:00:00.000Z',
      exit: 'SIGTERM',
      lastPlace: null,
      estopLatched: false,
      damped: false,
      seq: 'many',
      seqExact: true,
    };
    fs.writeFileSync(file, `${JSON.stringify(damaged)}\n`, 'utf-8');

    // The floor from the lines on disk — never the string, and never exact.
    expect(boot()).toEqual({ seq: 2, seqExact: false });
  });

  it('does not lose ground to a hand-appended tail with no ordinal', () => {
    boot();
    boot();
    boot(); // counter is at 3
    fs.appendFileSync(
      file,
      `${JSON.stringify({
        bootId: 'b-hand',
        startedAt: '2026-07-01T07:00:00.000Z',
        endedAt: '2026-07-01T08:00:00.000Z',
        exit: 'SIGTERM',
        lastPlace: null,
        estopLatched: false,
        damped: false,
      })}\n`,
      'utf-8',
    );

    // The highest ordinal on disk wins, and the extra line still raises the
    // floor: four boots are visible, so this one is at least the fifth.
    expect(boot()).toEqual({ seq: 5, seqExact: false });
  });

  it('is idempotent — a second open reports the same number, not the next one', () => {
    const log = makeLog();
    const first = log.open();
    const again = log.open();
    expect(again.seq).toBe(first.seq);
    expect(again.seqExact).toBe(first.seqExact);
  });
});

describe('nextLifetimeSeq', () => {
  const rec = (over: Partial<IncarnationRecord>): IncarnationRecord => ({
    bootId: 'b',
    startedAt: '2026-07-01T07:00:00.000Z',
    endedAt: '2026-07-01T08:00:00.000Z',
    exit: 'SIGTERM',
    lastPlace: null,
    estopLatched: false,
    damped: false,
    ...over,
  });

  it('takes the HIGHEST ordinal on disk, not the last line’s', () => {
    // A stale line after a newer one (a rewrite that lost, an out-of-order
    // append) must not cost the lineage ground it has already covered.
    const out = nextLifetimeSeq([rec({ seq: 9, seqExact: true }), rec({ seq: 4, seqExact: true })], true);
    expect(out).toEqual({ seq: 10, exact: true });
  });

  it('never claims an exact 1 for a lineage that existed but could not be read', () => {
    // An empty-looking file after an EACCES or a wipe: "boot 1" would be a
    // decrease from whatever the robot had actually lived through.
    expect(nextLifetimeSeq([], true)).toEqual({ seq: 1, exact: false });
    expect(nextLifetimeSeq([], false)).toEqual({ seq: 1, exact: true });
  });

  it('is dragged up by uncounted lines, and stops being exact when it is', () => {
    const records = [rec({}), rec({}), rec({ seq: 2, seqExact: true })];
    expect(nextLifetimeSeq(records, true)).toEqual({ seq: 4, exact: false });
  });
});
