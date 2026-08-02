/**
 * @file atomic-file.test.ts
 * @description What `atomicWriteFileSync` leaves on disk when the rename it is
 *              built around cannot land — the Windows failure this module
 *              exists for. Real temp directories, real files: the whole point
 *              of the module is the state of the filesystem afterwards, and a
 *              mocked `fs` would assert the mock.
 * @feature robot
 * @status test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { atomicWriteFileSync, RENAME_ATTEMPTS, RESCUE_SUFFIX_PREFIX } from '../atomic-file.js';

/** What a Windows rename onto a file another handle holds open answers with. */
function eperm(): NodeJS.ErrnoException {
  return Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });
}

const OLD = '{"estopLatched":true,"bootId":"b-7f3a19c2d40e"}\n';
const NEW = '{"estopLatched":false,"bootId":"b-0000deadbeef"}\n';

let dir: string;
let file: string;
/** `fs.renameSync`, captured before any spy replaces it. */
const realRename = fs.renameSync;

/** Scratch/sideline copies left in the directory: `<file>.tmp-<pid>-<n>`. */
function tmpFilesIn(target: string): string[] {
  return fs.readdirSync(target).filter((f) => /\.tmp-\d+/.test(f));
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neodem-atomic-'));
  file = path.join(dir, 'state-sim-robot-g1-edu.json');
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('atomicWriteFileSync — the happy path', () => {
  it('writes the file and leaves no scratch copy', () => {
    atomicWriteFileSync(file, NEW);
    expect(fs.readFileSync(file, 'utf-8')).toBe(NEW);
    expect(tmpFilesIn(dir)).toEqual([]);
  });

  it('replaces an existing file whose rename only succeeds after the sideline', () => {
    fs.writeFileSync(file, OLD, 'utf-8');
    let calls = 0;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      calls++;
      // Every direct attempt is refused; the moves the sideline makes succeed,
      // which is the real Windows shape: the DESTINATION name is contended, a
      // rename to a fresh name next to it is not.
      if (calls <= RENAME_ATTEMPTS) throw eperm();
      realRename(from, to);
    });

    atomicWriteFileSync(file, NEW);

    expect(fs.readFileSync(file, 'utf-8')).toBe(NEW);
    // The sidelined copy of the OLD content is dropped once the new one lands.
    expect(tmpFilesIn(dir)).toEqual([]);
    warn.mockRestore();
  });
});

describe('atomicWriteFileSync — a write that cannot land keeps the old content', () => {
  /**
   * THE regression. The previous implementation's last resort was
   * `rmSync(file)` + `renameSync(tmp, file)`: on Windows the delete of a file
   * another handle holds open goes "delete pending" and the create that follows
   * fails, so the destination was destroyed, the `finally` removed the scratch
   * file, and BOTH the old and the new content were gone. For
   * `state-<robotId>.json` that is the persisted E-Stop latch and the boot
   * lineage — the evidence this module's own header says it exists to preserve.
   */
  it('leaves the previous file byte-for-byte intact when the replacement rename fails', () => {
    fs.writeFileSync(file, OLD, 'utf-8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let aside = '';
    vi.spyOn(fs, 'renameSync').mockImplementation((fromRaw, toRaw) => {
      const from = String(fromRaw);
      const to = String(toRaw);
      // Moving the destination ASIDE is allowed — a fresh name is uncontended.
      if (from === file) {
        aside = to;
        realRename(fromRaw, toRaw);
        return;
      }
      // Moving anything INTO the destination name is what the other handle
      // blocks — including, in the old code, the create after the unlink.
      if (to === file && from !== aside) throw eperm();
      // …but putting the sidelined original back must work.
      realRename(fromRaw, toRaw);
    });

    expect(() => atomicWriteFileSync(file, NEW)).toThrow(/EPERM/);

    // The destination still exists, with EXACTLY the bytes it had before.
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, 'utf-8')).toBe(OLD);
    // …and no readable duplicate of either version survives.
    expect(tmpFilesIn(dir)).toEqual([]);
    warn.mockRestore();
  });

  it('says where the previous content is when it could not be moved back either', () => {
    fs.writeFileSync(file, OLD, 'utf-8');
    let aside = '';
    vi.spyOn(fs, 'renameSync').mockImplementation((fromRaw, toRaw) => {
      const from = String(fromRaw);
      const to = String(toRaw);
      if (from === file) {
        aside = to;
        realRename(fromRaw, toRaw);
        return;
      }
      // Nothing gets back into the destination name — not the replacement, and
      // not the original. Total contention on that one name.
      if (to === file) throw eperm();
      realRename(fromRaw, toRaw);
    });

    expect(() => atomicWriteFileSync(file, NEW)).toThrow(/INTACT at/);

    // The old content is STILL ON DISK under the sideline name — recoverable by
    // hand, and named in the error so an operator knows where to look. Losing
    // it silently is what the old `rmSync` did.
    expect(aside).not.toBe('');
    expect(fs.readFileSync(aside, 'utf-8')).toBe(OLD);
  });

  it('names the rescue copy so the next boot sweep cannot eat it', () => {
    // THE round-4 regression. The rescue copy used to be called
    // `<file>.tmp-<pid>-<n>` — precisely what `Workspace.sweepTempFiles`
    // recognises and deletes, so the next boot destroyed the one surviving copy
    // of the previous content before anyone could act on the error naming it
    // (reproduced: `survivors: ["state-….json.tmp-52972-4"]`, holding the
    // original content). The suffix has to be one the sweep spares.
    fs.writeFileSync(file, OLD, 'utf-8');
    let aside = '';
    vi.spyOn(fs, 'renameSync').mockImplementation((fromRaw, toRaw) => {
      const from = String(fromRaw);
      const to = String(toRaw);
      if (from === file) {
        aside = to;
        realRename(fromRaw, toRaw);
        return;
      }
      if (to === file) throw eperm();
      realRename(fromRaw, toRaw);
    });

    let message = '';
    try {
      atomicWriteFileSync(file, NEW);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    expect(path.basename(aside)).toContain(RESCUE_SUFFIX_PREFIX);
    // NOT the swept scratch suffix.
    expect(tmpFilesIn(dir)).toEqual([]);
    expect(fs.readFileSync(aside, 'utf-8')).toBe(OLD);
    // The thrown message names the file that actually exists — an operator
    // following it must not be sent to a path that was never written.
    expect(message).toContain(path.basename(aside));
    expect(fs.existsSync(path.join(dir, path.basename(aside)))).toBe(true);
  });

  it('still fails loudly and leaves nothing behind when there was no previous file', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw eperm();
    });

    expect(() => atomicWriteFileSync(file, NEW)).toThrow(/EPERM/);

    expect(fs.existsSync(file)).toBe(false);
    expect(tmpFilesIn(dir)).toEqual([]);
    warn.mockRestore();
  });
});
