/**
 * @file atomic-file.ts
 * @description Whole-file synchronous writes that either land completely or not
 *              at all — temp file + rename, with the retry Windows needs.
 * @feature robot
 * @status live
 *
 * Extracted from `agent-mode/workspace.ts`, which is where the Windows failure
 * modes below were first paid for. It lives here rather than there because the
 * durable files that must survive a `kill -9` are NOT all agent-mode files:
 * `data/state-<robotId>.json` carries the E-Stop latch and
 * `workspace/incarnations-*.jsonl` carries the crash lineage, and a truncated
 * write of either erases exactly the evidence the crash-recovery feature exists
 * to preserve. One implementation, three callers — a second copy of a rename
 * retry loop is a second place for it to be subtly wrong.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Rename attempts before {@link atomicWriteFileSync} gives up. */
export const RENAME_ATTEMPTS = 5;

/** Pause between rename attempts, in ms. */
const RENAME_RETRY_MS = 20;

/**
 * Suffix of the RESCUE copy `replaceViaSideline` leaves behind: the previous
 * content of a file that could not be replaced, sitting under
 * `<file>.rescued-<pid>-<n>`.
 *
 * Deliberately NOT the `.tmp-<pid>-<n>` scratch suffix it used to share.
 * `Workspace.sweepTempFiles` recognises scratch files by that suffix and deletes
 * them on the next boot — which is right for a scratch file (a copy of a write
 * that never landed) and catastrophic for this one: when the sideline succeeded
 * and the replacement did not, THIS FILE IS THE ONLY COPY of the previous
 * content, and the thrown error tells a human to move it back by hand. The boot
 * sweep destroyed it before anyone read that error (reproduced:
 * `survivors: ["state-….json.tmp-52972-4"]`, holding the original content).
 *
 * `Workspace.erase()` still takes these — an Art. 17 wipe must not walk past a
 * full copy of a memory file just because it is a rescue copy.
 */
export const RESCUE_SUFFIX_PREFIX = '.rescued-';

/** Monotonic per-process counter, so two writes in the same ms cannot collide. */
let tmpSeq = 0;
function nextTmpSeq(): number {
  tmpSeq = (tmpSeq + 1) % 1_000_000;
  return tmpSeq;
}

/**
 * Block the thread for `ms`. Synchronous on purpose: every caller here is a
 * synchronous write path, and awaiting anything in it is how a durable write
 * turns into a promise nobody holds.
 */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** `err.message`, for a `catch (err: unknown)`. */
function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * `fs.renameSync` with retries and, as a last resort, a SIDELINE of the
 * destination. See {@link atomicWriteFileSync} for why Windows needs this.
 */
function renameWithRetry(tmp: string, file: string): void {
  for (let attempt = 1; attempt <= RENAME_ATTEMPTS; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      if (attempt === RENAME_ATTEMPTS) {
        replaceViaSideline(tmp, file, err, attempt);
        return;
      }
      sleepSync(RENAME_RETRY_MS);
    }
  }
}

/**
 * Last resort: move the destination ASIDE, move the replacement into the gap,
 * and put the destination back if that second move fails.
 *
 * NOT `rmSync(file)` + `renameSync(tmp, file)`, which is what this used to be.
 * On Windows a delete of a file another handle still holds open goes
 * "delete pending": the name survives until the last handle closes, and the
 * create that follows fails EACCES. The destination was then gone, the caller's
 * `finally` removed the scratch file, and BOTH the old and the new content were
 * lost — for `data/state-<robotId>.json` that is the E-Stop latch and the boot
 * lineage, exactly the evidence this module exists to preserve.
 *
 * A rename cannot half-happen, so every outcome here leaves one complete copy
 * of the file under one of two names:
 *
 *  - the replacement landed → the sideline copy is dropped;
 *  - the replacement did not land → the sideline copy is renamed back;
 *  - even that failed → we throw, naming the path the old content is sitting at.
 *
 * The sideline is named `<file>.rescued-<pid>-<n>` and NOT `.tmp-<pid>-<n>` —
 * see {@link RESCUE_SUFFIX_PREFIX}. The `.tmp-` name made the boot sweep delete
 * the one surviving copy of the previous content before anyone could act on the
 * error that names it.
 */
function replaceViaSideline(tmp: string, file: string, cause: unknown, attempts: number): void {
  const aside = `${file}${RESCUE_SUFFIX_PREFIX}${process.pid}-${nextTmpSeq()}`;
  let movedAside = false;
  try {
    if (fs.existsSync(file)) {
      fs.renameSync(file, aside);
      movedAside = true;
    }
  } catch {
    // The destination could not even be moved out of the way — so it is still
    // exactly as it was, which is the outcome worth protecting. Report the
    // original failure, not this one.
    throw cause;
  }

  try {
    fs.renameSync(tmp, file);
  } catch (replaceErr) {
    if (!movedAside) throw cause;
    try {
      fs.renameSync(aside, file);
    } catch (restoreErr) {
      throw new Error(
        `[atomicWrite] ${path.basename(file)} could not be replaced (${errText(cause)}) and the ` +
          `previous content could not be moved back (${errText(restoreErr)}). It is INTACT at ` +
          `${aside} — move it back by hand (rename it to ${path.basename(file)}). ` +
          'That file is NOT swept on the next boot; only an Art. 17 memory erasure removes it.',
        { cause: replaceErr },
      );
    }
    throw cause;
  }

  if (movedAside) {
    try {
      // The replacement landed, so this copy is now genuinely redundant — and
      // nothing else will collect it, since the sweep spares rescue copies.
      fs.rmSync(aside, { force: true });
    } catch (err) {
      // The replacement is in place; failing the successful write over a
      // leftover copy of the OLD content would help nobody. Named loudly
      // because the boot sweep will not collect it — an erasure will.
      console.warn(`[atomicWrite] could not remove the sidelined previous ${aside}:`, err);
    }
  }
  console.warn(
    `[atomicWrite] rename to ${path.basename(file)} needed ${attempts} attempts and a sideline ` +
      'of the destination.',
  );
}

/**
 * Write a whole file through a temp file + rename, so a reader (or a crash)
 * never sees a half-written file.
 *
 * `fs.writeFileSync` onto the live path opens it `O_TRUNC`: a process that dies
 * between the truncate and the write leaves an EMPTY file, and every reader in
 * this codebase treats an unparseable durable file as "no record" — the latch,
 * the agent state and the boot lineage all disappear silently at exactly the
 * moment they matter.
 *
 * `renameSync` is NOT reliably atomic on Windows: when anything else holds the
 * destination open — an editor, a virus scanner, a second agent process — it
 * fails with EPERM/EACCES/EBUSY. That is not hypothetical; the agent workspace
 * had eight orphaned `BODY.md.tmp-*` files, each a full copy of content a
 * caller believed it had written. Two consequences, both handled here:
 *
 *  1. The rename is RETRIED, and on the last attempt the destination is moved
 *     ASIDE rather than deleted, and moved back when the replacement still
 *     cannot land — see {@link replaceViaSideline}. A failed write must leave
 *     the previous content intact; "the old data is gone too" is not an
 *     acceptable failure mode for a file that holds the E-Stop latch.
 *  2. The scratch file is removed in `finally`, whatever happened. A failed
 *     write must not leave a readable duplicate behind; in the workspace that
 *     duplicate is what survived erasure.
 *
 * Throws when the write could not land at all. Callers decide what a failed
 * durable write means for them — see `noteWorkspaceWrite` in Agent Mode.
 *
 * The scratch name is `<file>.tmp-<pid>-<n>` and must stay that way:
 * `Workspace.sweepTempFiles` recognises orphans by exactly that suffix. The
 * RESCUE copy is the deliberate opposite and carries
 * {@link RESCUE_SUFFIX_PREFIX} instead — the sweep must not collect that one.
 */
export function atomicWriteFileSync(file: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${nextTmpSeq()}`;
  try {
    // A Buffer (a JPEG, TASK-212) is written as-is; text stays UTF-8.
    if (typeof content === 'string') fs.writeFileSync(tmp, content, 'utf-8');
    else fs.writeFileSync(tmp, content);
    renameWithRetry(tmp, file);
  } finally {
    try {
      if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
    } catch (err) {
      // Reported, never thrown: the write itself either landed or already
      // threw, and losing that outcome to a cleanup failure helps nobody.
      console.warn(`[atomicWrite] could not remove scratch file ${tmp}:`, err);
    }
  }
}
