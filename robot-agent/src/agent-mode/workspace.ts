/**
 * @file workspace.ts
 * @description The robot's durable memory on disk: `data/workspace-<robotId>/`,
 *              its capped atomic writes, and the ONE place trust is checked
 *              before anything reaches durable memory.
 * @feature agentmode
 * @status live
 *
 * Files, not a database, deliberately: the robot has no Prisma, a server that is
 * down must never stall a block (`ServerMirror` already swallows every transport
 * error by design), and a fleet operator asking "what does this robot think it
 * knows about aisle 3?" gets a diffable, hand-correctable answer.
 *
 * Per-robot, following `data/state-<robotId>.json` — NOT the per-OS-user
 * convention of `security/device-identity.ts`, where three agents on this box
 * already share one device cert. Two agents sharing one memory is the same
 * landmine with worse consequences: a note written while driving a simulation
 * would be read back as fact by the physical humanoid.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config/config.js';
import {
  atomicWriteFileSync,
  RENAME_ATTEMPTS,
  RESCUE_SUFFIX_PREFIX,
} from '../utils/atomic-file.js';

/**
 * Where a piece of durable text came from, and therefore whether it may become
 * durable at all.
 *
 * `self` is the robot's own measured experience (a finished block, an odometry
 * reading). `operator` is a human instruction that arrived over the command
 * channel. `untrusted` is everything the robot merely OVERHEARD or was SHOWN —
 * VLM captions, bystander speech, third-party text. The distinction only works
 * if it is carried from the moment the text enters the process, which is why
 * every journal record has it and there is no default.
 */
export const TrustLevels = ['self', 'operator', 'untrusted'] as const;
export type TrustLevel = (typeof TrustLevels)[number];

/**
 * The trust levels {@link Workspace.promote} lets through. A set, not a
 * `!== 'untrusted'` test, so a future fourth level is refused by default rather
 * than admitted by omission.
 */
export const DURABLE_TRUST_LEVELS: ReadonlySet<TrustLevel> = new Set<TrustLevel>([
  'self',
  'operator',
]);

/** Hard cap on `MEMORY.md`. A write past it errors — see {@link Workspace.promote}. */
export const MEMORY_MAX_BYTES = 8 * 1024;

/** Hard cap on one `places/<id>.md`. */
export const PLACE_NOTE_MAX_BYTES = 4 * 1024;

/** Longest excerpt injected into the planner prompt on entering a place. */
export const PLACE_EXCERPT_MAX_CHARS = 400;

/** Longest text one `remember` may carry — mirrors `coerceParams`. */
export const REMEMBER_MAX_CHARS = 240;

/**
 * A place id that is safe to use as a file name. The place graph's ids are
 * hand-authored (`AISLE-3`, `DOCK-1`), so this is a guard against a malformed
 * graph or a crafted id reaching `path.join`, not a normalizer — an id that
 * does not match is REFUSED rather than rewritten into some other place's file.
 */
const SAFE_PLACE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * The ID card's file name, duplicated from `identity.ts`'s `IDENTITY_FILE`.
 *
 * Deliberate duplication rather than an import: `identity.ts` depends on this
 * module for its paths, so importing it back would be a cycle. Erasure has to
 * know the name because `Operator` and `Site` on that card are a NAMED HUMAN and
 * a NAMED PLACE — personal data that must not survive an Art. 17 request. If the
 * file name changes in `identity.ts`, change it here too (each side names the
 * other), the same way `ROBOT_SAFE_PLACE_ID` mirrors {@link SAFE_PLACE_ID} on
 * the server.
 */
const IDENTITY_FILE_NAME = 'IDENTITY.md';

/**
 * Labels on `IDENTITY.md` that are personal data and are therefore BLANKED —
 * not deleted — by {@link Workspace.erase}.
 *
 * Blanked rather than deleted because the card also carries `Name`, `Emoji` and
 * the config-owned `Robot-Id` / `Serial` / `Unit`: a robot whose memory was
 * erased must still know what it is (the same reason `AGENTS.md` survives).
 * `Name` is the robot's own name, not the data subject's, so it stays.
 */
export const IDENTITY_PERSONAL_LABELS: readonly string[] = ['Operator', 'Site'];

/**
 * Suffix `atomicWrite` gives its scratch file: `<file>.tmp-<pid>-<n>`. The pid
 * is captured because {@link Workspace.sweepTempFiles} needs to know whether the
 * process that is mid-write still exists.
 */
const TMP_SUFFIX = /\.tmp-(\d+)(?:-\d+)?$/;

/**
 * Suffix of a RESCUE copy: `<file>.rescued-<pid>-<n>`, written by
 * `replaceViaSideline` when a file could not be replaced AND its previous
 * content could not be moved back (see {@link RESCUE_SUFFIX_PREFIX}).
 *
 * Matched separately from {@link TMP_SUFFIX} because the two are opposites. A
 * `*.tmp-*` is a copy of a write that never landed — deleting it is the point.
 * A `*.rescued-*` is the LAST SURVIVING COPY of content the live file no longer
 * has, and the error that created it tells a human to move it back by hand; the
 * boot sweep deleting that before anyone read the error is what this split
 * fixes. It is still personal data, so {@link Workspace.erase} takes it.
 */
const RESCUE_SUFFIX = new RegExp(
  `${RESCUE_SUFFIX_PREFIX.replace(/[.]/g, '\\.')}(\\d+)-\\d+$`,
);

/**
 * How long a `*.tmp-*` file must have been sitting there before a boot sweep
 * considers it abandoned. Long enough that a second agent process mid-write is
 * never touched, short enough that the orphan is gone by the next restart.
 */
export const STALE_TMP_MS = 60_000;

/**
 * How long a scratch file belonging to a STILL-RUNNING other process is left
 * alone, even by an erasure that asked for `minAgeMs: 0`.
 *
 * `atomicWriteFileSync` is synchronous and its retry budget is
 * `RENAME_ATTEMPTS * 20 ms`, so a live write occupies its scratch name for
 * milliseconds, not seconds. Anything older than this from a live pid is a
 * leftover, not a write in progress.
 *
 * Three robot-agent processes run on one box here (41243/41244/41246) against
 * sibling workspaces, and deleting the scratch file out from under one of them
 * makes its `renameWithRetry` fail with ENOENT — a durable write silently lost,
 * which is the exact failure this whole module exists to prevent. Erasure does
 * not silently skip those files either: {@link Workspace.erase} reports every
 * one it could not take as an error.
 */
export const LIVE_TMP_GRACE_MS = 2_000;

/** How deep {@link Workspace.sweepTempFiles} walks. A guard, not a limit. */
const SWEEP_MAX_DEPTH = 8;

/**
 * Does a process with this pid exist? Signal `0` performs the permission and
 * existence checks without delivering anything, on Windows too. `EPERM` means
 * it exists and is not ours — still alive, still writing.
 */
function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** What one sweep did, including what it deliberately did not touch. */
export interface TempSweepResult {
  removed: string[];
  /**
   * Scratch files left in place because a LIVE other process may still be
   * writing them. Empty on a boot sweep; erasure turns these into errors.
   */
  skippedLive: string[];
  /**
   * Rescue copies (`*.rescued-*`) the sweep deliberately walked past because it
   * was not an erasure — each is the only surviving copy of a durable file's
   * previous content and is waiting for a human. Reported so a boot can SAY it
   * found one instead of silently leaving it there forever.
   */
  rescued: string[];
}

/**
 * Rename attempts before {@link Workspace.atomicWrite} gives up. Re-exported
 * from `utils/atomic-file.ts`, which owns the write since the durable files
 * outside this workspace (the state file, the incarnation lineage) need the
 * same guarantee.
 */
export { RENAME_ATTEMPTS };

/** `journal/YYYY-MM-DD.jsonl` and the daily-rollover key. */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * One line of the robot's own history. Written by the journal (a tee of
 * `ServerMirror.logBlock`), and the unit {@link Workspace.promote} accepts.
 *
 * It lives here rather than in `journal.ts` because promotion is the reason the
 * shape exists at all, and `journal.ts` depends on this module for its paths —
 * keeping the type here keeps that dependency one-directional.
 */
export interface JournalRecord {
  /** ISO-8601 timestamp. */
  t: string;
  /** Boot this happened in (TASK-196), or null when it is not known. */
  bootId: string | null;
  /** What kind of line this is: a finished block, an observation, a note. */
  kind: 'block' | 'observation' | 'note';
  planId?: string | null;
  /** Block kind, when `kind` is `'block'`. */
  block?: string | null;
  ok?: boolean;
  measured?: { distanceM?: number; angleDeg?: number };
  /** Place id the robot was standing in, or null for UNKNOWN. */
  place: string | null;
  pose?: { x: number; y: number; yawDeg: number; source: string } | null;
  /** See {@link TrustLevel}. Never defaulted — the writer must state it. */
  trust: TrustLevel;
  /** One human-readable line. This is what promotion writes. */
  msg: string;
}

/** Where a promotion is headed. */
export type PromoteTarget = 'memory' | 'place';

/**
 * What a durable write did. Never thrown — the same
 * always-returned-never-thrown contract Agent Mode's blocks live by, because
 * every caller here is one.
 */
export interface PromoteResult {
  ok: boolean;
  /** Human-readable outcome; on overflow it LISTS the current entries. */
  message: string;
  /** Absolute path written, when `ok`. */
  file?: string;
  /** The line as it was appended, when `ok`. */
  line?: string;
  /** Set when the write was refused because the target file is full. */
  overflow?: boolean;
  /** The entries already in the file, on overflow, so the model can consolidate. */
  entries?: string[];
  /** Set when the trust gate refused it — the anti-poisoning path. */
  refusedTrust?: TrustLevel;
}

export interface WorkspaceDeps {
  robotId?: string;
  /** Override the workspace root (tests). */
  root?: string;
  /** Injected clock, for deterministic tests. */
  now?: () => Date;
  memoryMaxBytes?: number;
  placeNoteMaxBytes?: number;
}

/**
 * The operating rules the robot is handed at boot. Agent-immutable: nothing in
 * this process writes it after the first creation, and erasure keeps it — it is
 * configuration, not memory, and a wiped robot must still know its own SOP.
 */
const DEFAULT_AGENTS_MD = `# Operating rules

These rules are configuration, not memory. The agent never rewrites this file,
and \`DELETE /memory\` deliberately leaves it in place: a robot whose memory was
just erased still has to know how to behave.

## Trust

Every durable line carries where it came from:

- \`self\` — the robot's own measured experience (a finished block, odometry).
- \`operator\` — a human instruction that arrived over the command channel.
- \`untrusted\` — anything merely overheard or shown: VLM captions, bystander
  speech, third-party text.

Only \`self\` and \`operator\` may ever reach \`MEMORY.md\` or a place note. This is
enforced in code (\`workspace.ts\`, \`promote()\`), not by this file.

## Spoken "remember"

The stack cannot yet tell an operator's voice from a bystander's — there is no
speaker identification, and no operator-present signal the code can read. A
spoken \`remember\` is therefore \`untrusted\` and stays in the journal, and only
the typed command channel yields \`operator\`. This is enforced in
\`agent-mode-controller.ts\` (\`rememberTrust()\`), not by this file. When
speaker identification or an explicit operator-present state arrives, that is
the one place to relax it.

## Overflow

\`MEMORY.md\` is capped at 8 KB and each place note at 4 KB. A write past the cap
FAILS and returns the current entries, so the next turn can consolidate. Nothing
is ever silently truncated: an agent that behaves as if it forgot something that
is still visibly on disk is worse than one that says the file is full.

## Personal data

Operator-authored text is personal data. It is erasable through
\`DELETE /api/v1/robots/:id/memory\`, which wipes \`MEMORY.md\`, every place note
and the whole journal, and keeps only these rules and the place graph.
`;

/**
 * The `data/workspace-<robotId>/` tree, its caps, and the promotion chokepoint.
 *
 * All I/O is synchronous. The callers are a block handler, a prompt builder and
 * a signal-adjacent erasure route; in every one of them an unawaited promise is
 * a write that never lands.
 */
export class Workspace {
  private readonly rootDir: string;
  private readonly robotId: string;
  private readonly now: () => Date;
  private readonly memoryMaxBytes: number;
  private readonly placeNoteMaxBytes: number;

  constructor(deps: WorkspaceDeps = {}) {
    const robotId = deps.robotId ?? config.robotId;
    this.robotId = robotId;
    this.rootDir =
      deps.root ??
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        `../../data/workspace-${robotId}`,
      );
    this.now = deps.now ?? (() => new Date());
    this.memoryMaxBytes = deps.memoryMaxBytes ?? MEMORY_MAX_BYTES;
    this.placeNoteMaxBytes = deps.placeNoteMaxBytes ?? PLACE_NOTE_MAX_BYTES;
  }

  // ── paths ─────────────────────────────────────────────────────────────────

  get root(): string {
    return this.rootDir;
  }

  get memoryFile(): string {
    return path.join(this.rootDir, 'MEMORY.md');
  }

  get agentsFile(): string {
    return path.join(this.rootDir, 'AGENTS.md');
  }

  get placesDir(): string {
    return path.join(this.rootDir, 'places');
  }

  get journalDir(): string {
    return path.join(this.rootDir, 'journal');
  }

  /**
   * The boot lineage (TASK-196). It lives in the workspace because it is the
   * same category of thing as the journal — what this robot did, per process
   * life — and `IncarnationLog` already takes a `filePath` for exactly this.
   */
  get incarnationsFile(): string {
    return path.join(this.rootDir, 'incarnations.jsonl');
  }

  /**
   * Where the boot lineage lived BEFORE it moved into the workspace:
   * `data/incarnations-<robotId>.jsonl`, one level above this tree, and still
   * `IncarnationLog`'s default when no `filePath` is passed.
   *
   * It is named here because erasure has to reach it. The file on this box held
   * 7 KB of "this robot was in THIS place at THIS time" from an older build —
   * location history, outside the workspace, unreachable by an erasure that only
   * walks `rootDir`, and now hidden by `.gitignore` as well. A wipe that leaves
   * it behind is a false Article 17 answer, and nothing else would ever clean
   * it up.
   */
  get legacyIncarnationsFile(): string {
    return path.join(path.dirname(this.rootDir), `incarnations-${this.robotId}.jsonl`);
  }

  /**
   * Standing intents (TASK-199). Operator-authored free text, so erasure takes
   * it — the path lives here rather than in `intents.ts` so that erasure and the
   * store cannot disagree about which file that is.
   */
  get intentsFile(): string {
    return path.join(this.rootDir, 'intents.jsonl');
  }

  /** The ID card (TASK-198). See {@link IDENTITY_FILE_NAME} for the duplication. */
  get identityFile(): string {
    return path.join(this.rootDir, IDENTITY_FILE_NAME);
  }

  /**
   * The place graph (TASK-195), when it is kept inside the workspace. Survives
   * erasure: site geometry is not something observed about a person.
   */
  get placeIndexFile(): string {
    return path.join(this.placesDir, '_index.json');
  }

  /**
   * Path of one place's note, or null when the id is not usable as a file name.
   * Null is a refusal, never a fallback: writing a rejected id into some other
   * file would attribute a note to a place it was not made in.
   */
  placeNoteFile(placeId: string): string | null {
    if (!SAFE_PLACE_ID.test(placeId)) return null;
    return path.join(this.placesDir, `${placeId}.md`);
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Create the tree and seed `AGENTS.md` if it is not there. Idempotent, and
   * never overwrites an existing `AGENTS.md` — an operator who edited the SOP
   * must not have it reset by a restart.
   */
  ensure(): void {
    fs.mkdirSync(this.rootDir, { recursive: true });
    fs.mkdirSync(this.placesDir, { recursive: true });
    fs.mkdirSync(this.journalDir, { recursive: true });
    // Sweep before anything else writes: an orphaned `*.tmp-*` is a FULL COPY
    // of whatever was being written, and one that matches neither the `*.md`
    // nor the `*.jsonl` filter erasure walks. See {@link sweepTempFiles}.
    this.sweepTempFiles(STALE_TMP_MS);
    if (!fs.existsSync(this.agentsFile)) {
      this.atomicWrite(this.agentsFile, DEFAULT_AGENTS_MD);
    }
  }

  /**
   * Write a whole file through a temp file + rename, so a reader (or a crash)
   * never sees a half-written memory.
   *
   * The implementation lives in {@link atomicWriteFileSync} — see there for why
   * Windows needs a rename retry and why the scratch file is removed in a
   * `finally`. It is shared with `StatePersistence` and `IncarnationLog`, whose
   * files have the same "a truncated write erases the evidence of the crash"
   * property this workspace has.
   */
  atomicWrite(file: string, content: string): void {
    atomicWriteFileSync(file, content);
  }

  /**
   * Delete `*.tmp-*` files left behind by a crashed or blocked write.
   *
   * See {@link sweepTempFilesDetailed} for what is and is not taken; this is the
   * boot-sweep shape of it, which only ever needs the list of removals.
   */
  sweepTempFiles(minAgeMs: number): string[] {
    return this.sweepTempFilesDetailed(minAgeMs).removed;
  }

  /**
   * The whole tree's `*.tmp-*` files, swept — RECURSIVELY, because a scratch
   * file is a full copy of whatever was being written and one sitting in a
   * subdirectory is exactly as readable as one in the root.
   *
   * Two guards, and they are different things:
   *
   *  - `minAgeMs` is the boot sweep's patience: leave anything younger alone.
   *    Erasure passes `0` — a data-subject request does not wait a minute.
   *  - {@link LIVE_TMP_GRACE_MS} is the floor NOTHING lowers, and it applies
   *    only to a scratch file whose pid still names a RUNNING other process.
   *    Deleting that file makes the other process's `renameWithRetry` fail on a
   *    source that vanished, and `IntentStore.save()` only `console.warn`s: its
   *    durable write is gone and nobody is told. Those files come back in
   *    `skippedLive` so the caller can report them rather than assume them
   *    handled.
   *
   * RESCUE copies (`*.rescued-*`) are a third thing and are NOT swept unless
   * `includeRescued` is set: they are the last surviving copy of a durable
   * file's previous content, not a discarded write. Only {@link erase} passes
   * it — an Art. 17 wipe must leave no full copy of a memory file behind, and
   * that outranks the recovery story.
   */
  sweepTempFilesDetailed(minAgeMs: number, opts: { includeRescued?: boolean } = {}): TempSweepResult {
    const removed: string[] = [];
    const skippedLive: string[] = [];
    const rescued: string[] = [];
    const now = this.now().getTime();
    const cutoff = now - Math.max(0, minAgeMs);

    const walk = (dir: string, depth: number): void => {
      let entries: fs.Dirent[];
      try {
        if (!fs.existsSync(dir)) return;
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const file = path.join(dir, entry.name);
        // Never followed through a symlink: `isDirectory()` is false for one,
        // so a link out of the workspace cannot make this sweep leave it.
        if (entry.isDirectory()) {
          if (depth < SWEEP_MAX_DEPTH) walk(file, depth + 1);
          continue;
        }
        const rescueMatch = RESCUE_SUFFIX.exec(entry.name);
        if (rescueMatch && !opts.includeRescued) {
          rescued.push(file);
          continue;
        }
        const match = rescueMatch ?? TMP_SUFFIX.exec(entry.name);
        if (!match) continue;
        const pid = Number(match[1]);
        try {
          const mtimeMs = fs.statSync(file).mtimeMs;
          // Our own scratch files are never in flight here: every write in this
          // process is synchronous, so nothing of ours is half-done while this
          // loop runs.
          if (pid !== process.pid && isProcessAlive(pid) && now - mtimeMs < LIVE_TMP_GRACE_MS) {
            skippedLive.push(file);
            continue;
          }
          if (minAgeMs > 0 && mtimeMs > cutoff) continue;
          fs.rmSync(file, { force: true });
          removed.push(file);
        } catch (err) {
          console.warn(`[Workspace] could not remove stale temp file ${file}:`, err);
        }
      }
    };

    walk(this.rootDir, 0);

    if (removed.length > 0) {
      console.warn(
        `[Workspace] removed ${removed.length} orphaned temp file(s) in ${this.rootDir} — ` +
          'each was a full copy of a write that never landed.',
      );
    }
    if (rescued.length > 0) {
      // Said out loud on every boot, because nothing else will: the file that
      // needs a human is exactly the one this sweep must not delete.
      console.warn(
        `[Workspace] ${rescued.length} rescued copy(ies) of a failed replacement are waiting in ` +
          `${this.rootDir} — each holds the PREVIOUS content of a durable file whose write could ` +
          `not be undone: ${rescued.join(', ')}. Rename one back over its target to restore it.`,
      );
    }
    return { removed, skippedLive, rescued };
  }

  /** File contents, or `''` when it does not exist. */
  private readOrEmpty(file: string): string {
    try {
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
    } catch (err) {
      console.warn(`[Workspace] could not read ${file}:`, err);
      return '';
    }
  }

  /** `MEMORY.md`, or `''` when nothing has been remembered yet. */
  readMemory(): string {
    return this.readOrEmpty(this.memoryFile);
  }

  /** One place note, or `''` when there is none (or the id is unusable). */
  readPlaceNote(placeId: string): string {
    const file = this.placeNoteFile(placeId);
    return file ? this.readOrEmpty(file) : '';
  }

  /** Place ids that currently have a note, sorted. */
  listPlaceNotes(): string[] {
    try {
      if (!fs.existsSync(this.placesDir)) return [];
      return fs
        .readdirSync(this.placesDir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.slice(0, -3))
        .sort();
    } catch {
      return [];
    }
  }

  // ── the promotion chokepoint ──────────────────────────────────────────────

  /**
   * The ONE way anything becomes durable memory.
   *
   * Two gates, in this order:
   *
   *  1. **Trust.** Only `self` and `operator` pass. An `untrusted` record — a
   *     VLM caption, overheard speech — can never reach `MEMORY.md` or a place
   *     note, whatever any prompt says. That is the anti-poisoning spine of this
   *     feature and the reason it exists as one function rather than as a rule
   *     repeated at each call site: retrofitting a trust tier onto months of
   *     untagged content does not work.
   *  2. **Cap.** A write that would push the file past its cap FAILS and returns
   *     the current entries, leaving the file exactly as it was. Nothing is
   *     truncated. The caller (the `remember` block) surfaces the entries in its
   *     outcome message, so the model can consolidate in the same turn.
   */
  promote(record: JournalRecord, target: PromoteTarget): PromoteResult {
    if (!DURABLE_TRUST_LEVELS.has(record.trust)) {
      return {
        ok: false,
        refusedTrust: record.trust,
        message:
          `refused: a "${record.trust}" record can never become durable memory. ` +
          `Only ${[...DURABLE_TRUST_LEVELS].join(' / ')} content is promoted; ` +
          `this stays in the journal.`,
      };
    }

    const text = oneLine(record.msg);
    if (!text) return { ok: false, message: 'refused: nothing to remember (empty text).' };

    let file: string;
    let maxBytes: number;
    let heading: string;
    if (target === 'memory') {
      file = this.memoryFile;
      maxBytes = this.memoryMaxBytes;
      heading = '# Memory';
    } else {
      if (!record.place) {
        return {
          ok: false,
          message:
            'refused: this would be a place note, but the robot does not know ' +
            'which place it is standing in. Say it again once the place is known, ' +
            'or ask for it to be remembered globally.',
        };
      }
      const placeFile = this.placeNoteFile(record.place);
      if (!placeFile) {
        return { ok: false, message: `refused: "${record.place}" is not a usable place id.` };
      }
      file = placeFile;
      maxBytes = this.placeNoteMaxBytes;
      heading = `# ${record.place}`;
    }

    const date = dayKey(new Date(record.t ?? this.now().toISOString()));
    const line = `- ${date} (${record.trust}) ${text}`;
    const existing = this.readOrEmpty(file);
    const next = existing
      ? `${existing.replace(/\n*$/, '')}\n${line}\n`
      : `${heading}\n\n${line}\n`;

    if (Buffer.byteLength(next, 'utf-8') > maxBytes) {
      const entries = listEntries(existing);
      return {
        ok: false,
        overflow: true,
        file,
        entries,
        message:
          `${path.basename(file)} is full (${Buffer.byteLength(existing, 'utf-8')} of ` +
          `${maxBytes} bytes) — nothing was written and the file is unchanged. ` +
          `Consolidate these ${entries.length} entries first, then remember again:\n` +
          entries.map((e) => `  ${e}`).join('\n'),
      };
    }

    this.ensure();
    this.atomicWrite(file, next);
    return { ok: true, file, line, message: `Remembered in ${path.basename(file)}: ${text}` };
  }

  // ── retrieval ─────────────────────────────────────────────────────────────

  /**
   * What the robot knows about one place, capped for the planner prompt.
   *
   * Newest-first, because a place note grows by appending and the last thing
   * learned about an aisle is the thing most likely to still be true. Truncation
   * happens at ENTRY boundaries — half a sentence about a blocked turn is worse
   * than one fewer sentence — and the fact that entries were left out is stated
   * rather than implied.
   */
  placeExcerpt(placeId: string, maxChars: number = PLACE_EXCERPT_MAX_CHARS): string {
    const entries = listEntries(this.readPlaceNote(placeId));
    if (entries.length === 0) return '';

    // The "older notes not shown" marker counts against the budget too — a
    // caller told the excerpt is capped at N characters gets at most N.
    const render = (lines: string[], omitted: number): string =>
      omitted > 0
        ? `${lines.join('\n')}\n(+${omitted} older note(s) not shown)`
        : lines.join('\n');

    let chosen: string[] = [];
    for (let i = entries.length - 1; i >= 0; i--) {
      const candidate = [entries[i], ...chosen];
      if (render(candidate, i).length > maxChars) break;
      chosen = candidate;
    }
    if (chosen.length === 0) {
      // Even the newest single entry does not fit: say so instead of returning
      // a sentence cut in half, which would read as a complete fact.
      return `(${entries.length} note(s) recorded, all longer than the ${maxChars}-character budget)`;
    }
    return render(chosen, entries.length - chosen.length);
  }

  // ── erasure (GDPR Art. 17) ────────────────────────────────────────────────

  /**
   * Wipe everything about a person this robot holds on disk.
   *
   * WHAT GOES, and why each of these is personal data rather than machine state:
   *
   *  - `MEMORY.md` and every `places/<id>.md` — operator-authored notes.
   *  - `journal/*.jsonl` — what was done, when, where, on whose instruction.
   *  - `intents.jsonl` — operator-authored free text with a trigger on it.
   *  - `incarnations.jsonl` — up to 200 boots of "this robot was in THIS place
   *    at THIS time", which is location history whether or not anyone meant it
   *    that way — plus {@link legacyIncarnationsFile}, the same data at the
   *    pre-workspace path one level up.
   *  - every `*.tmp-*` AND every `*.rescued-*` in the tree, at ANY depth — a
   *    scratch file is a full copy of whatever was being written and a rescue
   *    copy is a full copy of what a file held before a failed replacement;
   *    neither matches the `*.md` or `*.jsonl` filter. Leaving those behind is
   *    how an erased `MEMORY.md` survives its own erasure.
   *  - the `Operator` and `Site` labels on `IDENTITY.md`, blanked in place.
   *
   * WHAT STAYS, and why. `AGENTS.md` is the operating SOP — configuration, not
   * memory. `places/_index.json` is the surveyed place graph, site geometry
   * rather than something observed about a person. `SOUL.md` and `BODY.md` are
   * persona and hardware. `IDENTITY.md` keeps `Name`, `Emoji` and the
   * config-owned labels: the spec excludes the identity FILES from the memory
   * wipe, and a robot that has forgotten what it is is not what an Art. 17
   * request asked for — but the two labels naming a HUMAN and a SITE are not the
   * robot's identity, they are somebody's personal data, so those are cleared.
   */
  erase(): { removed: string[]; redacted: string[]; errors: string[] } {
    const removed: string[] = [];
    const redacted: string[] = [];
    const errors: string[] = [];

    const remove = (file: string): void => {
      try {
        if (!fs.existsSync(file)) return;
        fs.rmSync(file, { force: true });
        removed.push(file);
      } catch (err) {
        errors.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    remove(this.memoryFile);
    // Every `places/*.md` ON DISK, by its real file name — NOT via
    // `placeNoteFile()`, which re-validates the id against SAFE_PLACE_ID and
    // returns null for anything that does not round-trip the grammar. A note
    // that reached the disk by another route (a hand-written `Halle 3.md`, an
    // older build, an operator's editor) was then skipped and survived its own
    // erasure with its operator-authored content, and the wipe reported no
    // error at all. A silent skip is the one outcome an Art. 17 wipe must never
    // produce; the write path keeps its guard, the erase path does not need it.
    try {
      if (fs.existsSync(this.placesDir)) {
        for (const entry of fs.readdirSync(this.placesDir, { withFileTypes: true })) {
          if (entry.isFile() && entry.name.endsWith('.md')) {
            remove(path.join(this.placesDir, entry.name));
          }
        }
      }
    } catch (err) {
      errors.push(`${this.placesDir}: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      if (fs.existsSync(this.journalDir)) {
        for (const name of fs.readdirSync(this.journalDir)) {
          if (name.endsWith('.jsonl')) remove(path.join(this.journalDir, name));
        }
      }
    } catch (err) {
      errors.push(`${this.journalDir}: ${err instanceof Error ? err.message : String(err)}`);
    }

    remove(this.intentsFile);
    remove(this.incarnationsFile);
    remove(this.legacyIncarnationsFile);
    // Age 0: a leftover scratch file goes now, not in a minute.
    // `includeRescued`: a `*.rescued-*` copy is spared by the BOOT sweep (it is
    // the only surviving copy of a durable file's previous content and a human
    // is supposed to move it back) — but an Art. 17 wipe outranks that. It is a
    // full copy of a memory file, and leaving it would be the same silent
    // survival this sweep exists to prevent.
    // The one thing this does NOT take is a scratch file a LIVE other process
    // is writing this instant — see LIVE_TMP_GRACE_MS. Those are REPORTED
    // rather than skipped in silence.
    const sweep = this.sweepTempFilesDetailed(0, { includeRescued: true });
    removed.push(...sweep.removed);
    for (const file of sweep.skippedLive) {
      errors.push(
        `${file}: left in place — another running process is writing it right now. ` +
          'Stop that agent (or retry the erasure) and wipe again.',
      );
    }

    try {
      if (this.redactIdentityPersonalData()) redacted.push(this.identityFile);
    } catch (err) {
      errors.push(`${this.identityFile}: ${err instanceof Error ? err.message : String(err)}`);
    }

    console.warn(
      `[Workspace] memory ERASED for ${this.rootDir}: ${removed.length} file(s) removed` +
        (redacted.length > 0 ? `, ${redacted.length} file(s) redacted` : '') +
        (errors.length > 0 ? `, ${errors.length} error(s)` : ''),
    );
    return { removed, redacted, errors };
  }

  /**
   * Blank the personal labels on `IDENTITY.md`, keeping the card's exact layout.
   *
   * Line-edited rather than re-rendered so `IdentityStore.load()` reads it back
   * unchanged instead of deciding the file disagrees with itself and rewriting
   * it. Returns true when something was actually cleared.
   */
  private redactIdentityPersonalData(): boolean {
    const file = this.identityFile;
    if (!fs.existsSync(file)) return false;
    const raw = fs.readFileSync(file, 'utf-8');
    let changed = false;
    const next = raw
      .split('\n')
      .map((line) => {
        for (const label of IDENTITY_PERSONAL_LABELS) {
          // Matches `- **Operator**: Sam`, `Operator: Sam`, `* Operator : Sam`.
          const match = new RegExp(`^(\\s*(?:[-*]\\s*)?\\*{0,2}${label}\\*{0,2}\\s*:)(.*)$`).exec(
            line,
          );
          if (!match) continue;
          if (match[2].trim() === '') return line;
          changed = true;
          return match[1];
        }
        return line;
      })
      .join('\n');
    if (!changed) return false;
    this.atomicWrite(file, next);
    return true;
  }
}

/**
 * Flatten to one line and clamp. Newlines would break both the markdown bullet
 * and the "one entry per line" reading that overflow listing and retrieval rely
 * on, so they are collapsed rather than rejected.
 */
export function oneLine(text: string, maxChars: number = REMEMBER_MAX_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > maxChars ? `${flat.slice(0, maxChars - 1).trimEnd()}…` : flat;
}

/** The `- …` bullets of a memory/place file, in file order. */
export function listEntries(markdown: string): string[] {
  return markdown
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '));
}

/**
 * Process-wide singleton — one robot, one memory. Constructed lazily so a test
 * that never touches memory never creates a directory.
 */
let singleton: Workspace | null = null;

export function getWorkspace(): Workspace {
  if (!singleton) singleton = new Workspace();
  return singleton;
}

/** Test seam: point the singleton at a temp dir (or reset it with `null`). */
export function setWorkspace(workspace: Workspace | null): void {
  singleton = workspace;
}
