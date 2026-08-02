/**
 * @file workspace.test.ts
 * @description The promotion chokepoint, the caps, and erasure (TASK-197).
 *              Everything here runs against a real temp directory — the point
 *              of this feature is what ends up ON DISK, and a mocked `fs` would
 *              assert the mock instead.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  Workspace,
  MEMORY_MAX_BYTES,
  PLACE_NOTE_MAX_BYTES,
  PLACE_EXCERPT_MAX_CHARS,
  DURABLE_TRUST_LEVELS,
  IDENTITY_PERSONAL_LABELS,
  STALE_TMP_MS,
  LIVE_TMP_GRACE_MS,
  listEntries,
  oneLine,
  type JournalRecord,
  type TrustLevel,
} from '../workspace.js';
import { RESCUE_SUFFIX_PREFIX } from '../../utils/atomic-file.js';

/** The card `identity.ts` renders, as it actually looks on disk. */
const IDENTITY_CARD = [
  '# Identity',
  '',
  '- **Name**: Nova',
  '- **Emoji**: 🤖',
  '- **Operator**: Sebastian Heusser',
  '- **Site**: Halle 3, Zürich',
  '- **Robot-Id**: sim-robot-g1-edu',
  '- **Serial**: sim-robot-g1-edu',
  '- **Unit**: Unitree G1 EDU',
  '',
].join('\n');

/** Files in the tree whose name marks them as an `atomicWrite` scratch file. */
function tmpFilesIn(dir: string): string[] {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.tmp-/.test(f)) : [];
}

/**
 * The pid baked into a scratch file name in these tests, and whether the sweep
 * is told that process still exists.
 *
 * Stubbed rather than left to the real process table: a bare pid literal means
 * something different on every machine (`5` is a live kernel thread on Linux and
 * nothing at all on Windows), and "is the other agent still writing this?" is
 * precisely the question these cases are about.
 */
const FOREIGN_PID = 41244;

function pretendForeignProcess(alive: boolean): void {
  const realKill = process.kill.bind(process);
  vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: string | number) => {
    if (pid === FOREIGN_PID) {
      if (alive) return true;
      throw Object.assign(new Error('ESRCH: no such process'), { code: 'ESRCH' });
    }
    return realKill(pid, signal);
  }) as typeof process.kill);
}

let root: string;
let workspace: Workspace;

function record(over: Partial<JournalRecord> = {}): JournalRecord {
  return {
    t: '2026-08-02T10:00:00.000Z',
    bootId: 'b-0001',
    kind: 'note',
    place: 'AISLE-3',
    trust: 'operator',
    msg: 'the pallet at the end of aisle 3 blocks the turn',
    ...over,
  };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'neodem-ws-'));
  workspace = new Workspace({ root });
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('Workspace — layout', () => {
  it('creates the tree and seeds AGENTS.md once', () => {
    workspace.ensure();
    expect(fs.existsSync(workspace.placesDir)).toBe(true);
    expect(fs.existsSync(workspace.journalDir)).toBe(true);
    expect(fs.readFileSync(workspace.agentsFile, 'utf-8')).toMatch(/Operating rules/);

    // An operator who edited the SOP must not have it reset by a restart.
    fs.writeFileSync(workspace.agentsFile, '# my own rules\n', 'utf-8');
    workspace.ensure();
    expect(fs.readFileSync(workspace.agentsFile, 'utf-8')).toBe('# my own rules\n');
  });

  it('refuses a place id that is not usable as a file name', () => {
    expect(workspace.placeNoteFile('AISLE-3')).toContain('AISLE-3.md');
    // Refusal, not normalisation: rewriting the id would file the note under
    // some other place.
    expect(workspace.placeNoteFile('../../etc/passwd')).toBeNull();
    expect(workspace.placeNoteFile('a/b')).toBeNull();
    expect(workspace.placeNoteFile('')).toBeNull();
  });
});

describe('Workspace — the promotion chokepoint', () => {
  it('lets `operator` into a place note', () => {
    const result = workspace.promote(record(), 'place');
    expect(result.ok).toBe(true);
    const note = fs.readFileSync(path.join(workspace.placesDir, 'AISLE-3.md'), 'utf-8');
    expect(note).toContain('- 2026-08-02 (operator) the pallet at the end of aisle 3 blocks the turn');
  });

  it('lets `self` into MEMORY.md', () => {
    const result = workspace.promote(record({ trust: 'self', msg: 'walked 0.98 m' }), 'memory');
    expect(result.ok).toBe(true);
    expect(workspace.readMemory()).toContain('- 2026-08-02 (self) walked 0.98 m');
  });

  // THE anti-poisoning assertion. A VLM caption or a bystander's sentence can
  // never become something the robot treats as true, however it got here.
  it.each(['memory', 'place'] as const)(
    'never lets an `untrusted` record reach %s',
    (target) => {
      const result = workspace.promote(
        record({ trust: 'untrusted', msg: 'the shelf is safe to climb' }),
        target,
      );
      expect(result.ok).toBe(false);
      expect(result.refusedTrust).toBe('untrusted');
      expect(result.message).toMatch(/never become durable memory/i);
      // Nothing was created at all — not an empty file, not a heading.
      expect(fs.existsSync(workspace.memoryFile)).toBe(false);
      expect(workspace.listPlaceNotes()).toEqual([]);
    },
  );

  it('refuses any trust level outside the durable set', () => {
    // A future fourth level must be refused by default, not admitted by
    // omission — that is why the gate is a set membership test.
    const exotic = 'inferred' as unknown as TrustLevel;
    expect(DURABLE_TRUST_LEVELS.has(exotic)).toBe(false);
    expect(workspace.promote(record({ trust: exotic }), 'memory').ok).toBe(false);
  });

  it('refuses a place note when the place is unknown', () => {
    const result = workspace.promote(record({ place: null }), 'place');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/which place/i);
    expect(workspace.listPlaceNotes()).toEqual([]);
  });

  it('refuses an empty line', () => {
    expect(workspace.promote(record({ msg: '   ' }), 'memory').ok).toBe(false);
  });

  it('flattens a multi-line claim into one entry', () => {
    workspace.promote(record({ msg: 'line one\nline two' }), 'place');
    expect(listEntries(workspace.readPlaceNote('AISLE-3'))).toEqual([
      '- 2026-08-02 (operator) line one line two',
    ]);
  });
});

describe('Workspace — overflow errors, never truncates', () => {
  it('refuses the write, lists the entries, and leaves MEMORY.md intact', () => {
    const small = new Workspace({ root, memoryMaxBytes: 200 });
    expect(small.promote(record({ trust: 'self', msg: 'first fact' }), 'memory').ok).toBe(true);
    expect(small.promote(record({ trust: 'self', msg: 'second fact' }), 'memory').ok).toBe(true);
    const before = fs.readFileSync(small.memoryFile, 'utf-8');

    const overflow = small.promote(
      record({ trust: 'self', msg: 'x'.repeat(180) }),
      'memory',
    );

    expect(overflow.ok).toBe(false);
    expect(overflow.overflow).toBe(true);
    // The error has to carry what is already there, so the model can
    // consolidate in the SAME turn rather than being told "full" and nothing else.
    expect(overflow.entries).toEqual([
      '- 2026-08-02 (self) first fact',
      '- 2026-08-02 (self) second fact',
    ]);
    expect(overflow.message).toContain('first fact');
    expect(overflow.message).toMatch(/unchanged/);

    // And — the whole point — the file on disk is byte-identical. An agent that
    // acts as if it forgot something still visibly on disk is the failure this
    // rule exists to prevent.
    expect(fs.readFileSync(small.memoryFile, 'utf-8')).toBe(before);
  });

  it('applies the per-file caps: 8 KB memory, 4 KB per place note', () => {
    expect(MEMORY_MAX_BYTES).toBe(8 * 1024);
    expect(PLACE_NOTE_MAX_BYTES).toBe(4 * 1024);

    // A place note fills at 4 KB while MEMORY.md, twice the size, does not.
    const line = 'y'.repeat(200);
    let placeWrites = 0;
    for (let i = 0; i < 40; i++) {
      if (!workspace.promote(record({ msg: `${i} ${line}` }), 'place').ok) break;
      placeWrites++;
    }
    expect(fs.statSync(path.join(workspace.placesDir, 'AISLE-3.md')).size).toBeLessThanOrEqual(
      PLACE_NOTE_MAX_BYTES,
    );
    expect(placeWrites).toBeGreaterThan(0);
    expect(placeWrites).toBeLessThan(40);

    let memoryWrites = 0;
    for (let i = 0; i < 40; i++) {
      if (!workspace.promote(record({ trust: 'self', msg: `${i} ${line}` }), 'memory').ok) break;
      memoryWrites++;
    }
    expect(memoryWrites).toBeGreaterThan(placeWrites);
    expect(Buffer.byteLength(workspace.readMemory(), 'utf-8')).toBeLessThanOrEqual(
      MEMORY_MAX_BYTES,
    );
  });
});

describe('Workspace — place-keyed retrieval', () => {
  it('returns the newest entries within the character budget', () => {
    for (let i = 1; i <= 12; i++) {
      workspace.promote(record({ msg: `fact number ${i} ${'.'.repeat(30)}` }), 'place');
    }
    const excerpt = workspace.placeExcerpt('AISLE-3');

    // The cap is a hard one and includes the "older notes" marker.
    expect(excerpt.length).toBeLessThanOrEqual(PLACE_EXCERPT_MAX_CHARS);
    // Newest kept, oldest dropped — and the drop is stated, not implied.
    expect(excerpt).toContain('fact number 12');
    expect(excerpt).not.toContain('fact number 1 ');
    expect(excerpt).toMatch(/older note\(s\) not shown/);
  });

  it('is place-scoped — one place never leaks into another', () => {
    workspace.promote(record({ place: 'AISLE-3', msg: 'pallet blocks the turn' }), 'place');
    workspace.promote(record({ place: 'DOCK-1', msg: 'ramp is wet' }), 'place');

    expect(workspace.placeExcerpt('AISLE-3')).toContain('pallet');
    expect(workspace.placeExcerpt('AISLE-3')).not.toContain('ramp');
    expect(workspace.placeExcerpt('DOCK-1')).toContain('ramp');
  });

  it('returns nothing for a place with no notes', () => {
    expect(workspace.placeExcerpt('STAGING')).toBe('');
  });

  it('never returns half a sentence', () => {
    workspace.promote(record({ msg: 'z'.repeat(240) }), 'place');
    const excerpt = workspace.placeExcerpt('AISLE-3', 50);
    // Truncating mid-entry would present a fragment as a complete fact.
    expect(excerpt).toMatch(/note\(s\) recorded, all longer than/);
  });
});

describe('Workspace — erasure (GDPR Art. 17)', () => {
  it('removes place notes, MEMORY.md and the journal but keeps AGENTS.md', () => {
    workspace.ensure();
    workspace.promote(record({ trust: 'self', msg: 'a global fact' }), 'memory');
    workspace.promote(record(), 'place');
    fs.writeFileSync(path.join(workspace.journalDir, '2026-08-02.jsonl'), '{"t":"x"}\n', 'utf-8');
    fs.writeFileSync(workspace.placeIndexFile, '{"version":1}', 'utf-8');

    const result = workspace.erase();

    expect(result.errors).toEqual([]);
    expect(result.removed.length).toBe(3);
    expect(fs.existsSync(workspace.memoryFile)).toBe(false);
    expect(workspace.listPlaceNotes()).toEqual([]);
    expect(fs.readdirSync(workspace.journalDir)).toEqual([]);

    // Configuration and site geometry survive: a robot whose memory was erased
    // still has to know how to behave and where it is.
    expect(fs.existsSync(workspace.agentsFile)).toBe(true);
    expect(fs.existsSync(workspace.placeIndexFile)).toBe(true);
  });

  it('is idempotent on a workspace that was never written to', () => {
    expect(workspace.erase()).toEqual({ removed: [], redacted: [], errors: [] });
  });

  it('takes the intents and the boot lineage too', () => {
    workspace.ensure();
    // Operator-authored free text with a trigger on it, and 200 boots of
    // "this robot was in THIS place at THIS time" — both personal data, and
    // both survived erasure while only `*.md` and `journal/*.jsonl` were swept.
    fs.writeFileSync(workspace.intentsFile, '{"id":"i-1","text":"tell Sam"}\n', 'utf-8');
    fs.writeFileSync(
      workspace.incarnationsFile,
      '{"bootId":"b-1","lastPlace":"AISLE-3","startedAt":"2026-08-02T10:00:00.000Z"}\n',
      'utf-8',
    );

    const result = workspace.erase();

    expect(fs.existsSync(workspace.intentsFile)).toBe(false);
    expect(fs.existsSync(workspace.incarnationsFile)).toBe(false);
    expect(result.removed).toEqual(
      expect.arrayContaining([workspace.intentsFile, workspace.incarnationsFile]),
    );
  });

  it('sweeps orphaned scratch files — a full copy of erased content is still that content', () => {
    workspace.ensure();
    workspace.promote(record({ trust: 'self', msg: 'a global fact' }), 'memory');
    // Exactly the eight `BODY.md.tmp-*` files this workspace had on disk: a
    // failed rename leaves a complete copy that matches neither the `*.md` nor
    // the `*.jsonl` filter, so erasure walked straight past it.
    const orphan = `${workspace.memoryFile}.tmp-4242`;
    fs.writeFileSync(orphan, fs.readFileSync(workspace.memoryFile, 'utf-8'), 'utf-8');
    const placeOrphan = path.join(workspace.placesDir, 'AISLE-3.md.tmp-4242-7');
    fs.writeFileSync(placeOrphan, '- 2026-08-02 (operator) the pallet blocks the turn\n', 'utf-8');

    workspace.erase();

    expect(fs.existsSync(orphan)).toBe(false);
    expect(fs.existsSync(placeOrphan)).toBe(false);
    expect(tmpFilesIn(workspace.root)).toEqual([]);
    expect(tmpFilesIn(workspace.placesDir)).toEqual([]);
  });

  it('takes a place note whose id does not round-trip the id grammar', () => {
    workspace.ensure();
    // A note that reached the disk by some route other than `promote()`: a
    // hand-written file, an older build, an operator's editor. `erase()` used to
    // enumerate the notes and then re-validate each id through
    // `placeNoteFile()`, which refuses anything SAFE_PLACE_ID does not match —
    // so this file survived the wipe with its operator-authored content AND the
    // wipe reported `errors: []`. A silent skip is the one answer an Art. 17
    // request must never get.
    const odd = path.join(workspace.placesDir, 'Halle 3.md');
    fs.writeFileSync(odd, '- 2026-08-02 (operator) Sam parks the pallet truck here\n', 'utf-8');
    fs.writeFileSync(workspace.placeIndexFile, '{"version":1}', 'utf-8');

    const result = workspace.erase();

    expect(fs.existsSync(odd)).toBe(false);
    expect(result.removed).toContain(odd);
    expect(result.errors).toEqual([]);
    // …and the surveyed place graph is still site geometry, so it stays.
    expect(fs.existsSync(workspace.placeIndexFile)).toBe(true);
  });

  it('sweeps scratch files in SUBDIRECTORIES too', () => {
    workspace.ensure();
    pretendForeignProcess(false);
    // The sweep walked exactly three directories — root, places/, journal/ — so
    // a scratch file one level deeper was a full, readable copy of a memory
    // file that outlived its own erasure.
    const nested = path.join(workspace.root, 'nested');
    fs.mkdirSync(nested, { recursive: true });
    const buried = path.join(nested, `MEMORY.md.tmp-${FOREIGN_PID}-1`);
    fs.writeFileSync(buried, '- 2026-08-02 (operator) Sam is on the late shift\n', 'utf-8');

    const result = workspace.erase();

    expect(fs.existsSync(buried)).toBe(false);
    expect(result.removed).toContain(buried);
  });

  it('never deletes the scratch file another RUNNING process is writing — and says so', () => {
    workspace.ensure();
    pretendForeignProcess(true);
    // Three robot-agent processes run on this box (41243/41244/41246).
    // `sweepTempFiles(0)` took every `*.tmp-*` regardless of age, including the
    // scratch file a second process was writing at that instant: its
    // `renameWithRetry` then fails on a source that vanished, and
    // `IntentStore.save()` only `console.warn`s — a durable write lost in
    // silence by the module whose whole job is that it is not.
    const live = path.join(workspace.root, `intents.jsonl.tmp-${FOREIGN_PID}-3`);
    fs.writeFileSync(live, '{"id":"i-1","text":"tell Sam when the dock is free"}\n', 'utf-8');

    const result = workspace.erase();

    expect(fs.existsSync(live)).toBe(true);
    // Left in place, but NOT in silence: a copy of personal data that the wipe
    // could not take has to be reported, or the erasure claims more than it did.
    expect(result.errors.join(' ')).toContain(live);
    expect(result.removed).not.toContain(live);
  });

  it('still takes a scratch file that a live process abandoned', () => {
    workspace.ensure();
    pretendForeignProcess(true);
    const abandoned = path.join(workspace.root, `MEMORY.md.tmp-${FOREIGN_PID}-9`);
    fs.writeFileSync(abandoned, '- 2026-08-02 (operator) a fact about Sam\n', 'utf-8');
    // An `atomicWrite` holds its scratch name for milliseconds. A file this old
    // is a leftover, not a write in progress, whoever is still running.
    const past = new Date(Date.now() - LIVE_TMP_GRACE_MS * 5);
    fs.utimesSync(abandoned, past, past);

    const result = workspace.erase();

    expect(fs.existsSync(abandoned)).toBe(false);
    expect(result.errors).toEqual([]);
  });

  it('takes the pre-workspace boot lineage one level up', () => {
    // `data/incarnations-<robotId>.jsonl` is where `IncarnationLog` wrote before
    // TASK-197 moved it into the workspace, and it is still the default when no
    // `filePath` is passed. The copy on this box held 7 KB of boot and location
    // history OUTSIDE the tree `erase()` walks — and `.gitignore` now hides it,
    // so nothing else was ever going to clean it up.
    const dataDir = path.join(root, 'data');
    const ws = new Workspace({
      root: path.join(dataDir, 'workspace-sim-robot-g1-edu'),
      robotId: 'sim-robot-g1-edu',
    });
    ws.ensure();
    expect(ws.legacyIncarnationsFile).toBe(
      path.join(dataDir, 'incarnations-sim-robot-g1-edu.jsonl'),
    );
    fs.writeFileSync(
      ws.legacyIncarnationsFile,
      '{"bootId":"b-1","startedAt":"2026-08-02T03:03:00.000Z","lastPlace":"AISLE-3"}\n',
      'utf-8',
    );

    const result = ws.erase();

    expect(fs.existsSync(ws.legacyIncarnationsFile)).toBe(false);
    expect(result.removed).toContain(ws.legacyIncarnationsFile);
  });

  it('blanks Operator and Site on IDENTITY.md but keeps the robot its own name', () => {
    workspace.ensure();
    fs.writeFileSync(workspace.identityFile, IDENTITY_CARD, 'utf-8');

    const result = workspace.erase();

    const card = fs.readFileSync(workspace.identityFile, 'utf-8');
    // A named human and a named site are personal data whatever file they sit in.
    expect(card).not.toContain('Sebastian Heusser');
    expect(card).not.toContain('Halle 3');
    for (const label of IDENTITY_PERSONAL_LABELS) {
      expect(card).toMatch(new RegExp(`\\*\\*${label}\\*\\*:\\s*$`, 'm'));
    }
    // …and the robot still knows what it is: the spec keeps the identity FILES
    // out of the memory wipe, so only the two personal labels go.
    expect(card).toContain('- **Name**: Nova');
    expect(card).toContain('- **Unit**: Unitree G1 EDU');
    expect(result.redacted).toEqual([workspace.identityFile]);
    expect(result.errors).toEqual([]);
  });

  it('leaves a card that never named anybody alone', () => {
    workspace.ensure();
    const blank = IDENTITY_CARD.replace('Sebastian Heusser', '').replace('Halle 3, Zürich', '');
    fs.writeFileSync(workspace.identityFile, blank, 'utf-8');

    expect(workspace.erase().redacted).toEqual([]);
    expect(fs.readFileSync(workspace.identityFile, 'utf-8')).toBe(blank);
  });
});

describe('Workspace — atomicWrite is atomic on Windows too', () => {
  it('retries a rename that fails, and leaves no scratch file behind', () => {
    workspace.ensure();
    const real = fs.renameSync;
    let attempts = 0;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      attempts++;
      // EPERM on the first two attempts is exactly what a virus scanner or a
      // second process holding the destination open produces on Windows.
      if (attempts <= 2) throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
      real(from, to);
    });

    workspace.atomicWrite(workspace.memoryFile, '# Memory\n\n- 2026-08-02 (self) a fact\n');

    expect(attempts).toBe(3);
    expect(workspace.readMemory()).toContain('a fact');
    // THE assertion: no `MEMORY.md.tmp-<pid>` full copy survives the retry.
    expect(tmpFilesIn(workspace.root)).toEqual([]);
  });

  it('never leaves a readable duplicate when the write cannot land at all', () => {
    workspace.ensure();
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => workspace.atomicWrite(workspace.memoryFile, 'the operator said something')).toThrow(
      /EPERM/,
    );

    // A write that failed must fail LOUDLY and leave nothing — a scratch file
    // holding the whole content is a copy that survives its own erasure.
    expect(tmpFilesIn(workspace.root)).toEqual([]);
    expect(fs.existsSync(workspace.memoryFile)).toBe(false);
    warn.mockRestore();
  });

  it('never sweeps the RESCUE copy of a failed replacement', () => {
    // THE round-4 regression, from the other side. `replaceViaSideline` throws
    // an error that names the file where the previous content survived and
    // tells a human to move it back — and the copy used to be called
    // `<file>.tmp-<pid>-<n>`, which is exactly what this sweep deletes. The
    // next boot destroyed the rescue copy before anyone read the error.
    workspace.ensure();
    const rescue = `${workspace.memoryFile}${RESCUE_SUFFIX_PREFIX}${FOREIGN_PID}-4`;
    fs.writeFileSync(rescue, '- 2026-08-02 (operator) Sam is on the late shift\n', 'utf-8');
    // Old enough that every age guard would have taken it, and from a pid the
    // sweep is told is alive — neither is what spares it.
    const past = new Date(Date.now() - STALE_TMP_MS * 10);
    fs.utimesSync(rescue, past, past);
    pretendForeignProcess(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    workspace.ensure();
    const sweep = workspace.sweepTempFilesDetailed(0);

    expect(fs.existsSync(rescue)).toBe(true);
    expect(fs.readFileSync(rescue, 'utf-8')).toContain('late shift');
    expect(sweep.removed).not.toContain(rescue);
    // Reported rather than silently left: a boot has to SAY it found one.
    expect(sweep.rescued).toContain(rescue);
    expect(warn.mock.calls.flat().join(' ')).toContain(rescue);
    warn.mockRestore();
  });

  it('but an Art. 17 erasure DOES take the rescue copy', () => {
    // The rescue copy outranks the boot sweep, not the data subject: it is a
    // full copy of a memory file, and an erasure that walked past it would be
    // the same silent survival the scratch-file sweep exists to prevent.
    workspace.ensure();
    const rescue = `${workspace.memoryFile}${RESCUE_SUFFIX_PREFIX}${FOREIGN_PID}-4`;
    fs.writeFileSync(rescue, '- 2026-08-02 (operator) Sam is on the late shift\n', 'utf-8');
    const past = new Date(Date.now() - LIVE_TMP_GRACE_MS * 5);
    fs.utimesSync(rescue, past, past);
    pretendForeignProcess(false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = workspace.erase();

    expect(fs.existsSync(rescue)).toBe(false);
    expect(result.removed).toContain(rescue);
    warn.mockRestore();
  });

  it('sweeps stale scratch files at boot but never a concurrent write', () => {
    workspace.ensure();
    const stale = path.join(workspace.root, 'BODY.md.tmp-22720');
    fs.writeFileSync(stale, '# Body\n', 'utf-8');
    const past = new Date(Date.now() - STALE_TMP_MS * 3);
    fs.utimesSync(stale, past, past);
    // Another agent process, mid-write, right now.
    const live = path.join(workspace.root, 'BODY.md.tmp-99999');
    fs.writeFileSync(live, '# Body\n', 'utf-8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    workspace.ensure();

    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(live)).toBe(true);
    warn.mockRestore();
  });
});

describe('oneLine', () => {
  it('collapses whitespace and clamps with an ellipsis', () => {
    expect(oneLine('  a \n b  ')).toBe('a b');
    expect(oneLine('x'.repeat(300))).toHaveLength(240);
    expect(oneLine('x'.repeat(300)).endsWith('…')).toBe(true);
  });
});
