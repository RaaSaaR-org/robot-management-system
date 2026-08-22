/**
 * @file extractArchive.ts
 * @description Unpack an uploaded dataset archive into a directory, safely.
 * @feature training
 *
 * WHY. The upload flow had three halves that disagreed about what was in the
 * bucket. `initiateUpload` presigned a URL that writes `<id>/latest/data.bin`,
 * told the caller the object was `<id>/data.tar.gz`, and `validateStructure`
 * then looked for `<id>/meta/info.json` — an unpacked tree. Nothing extracted
 * anything, so the browser's upload modal (which accepts `.tar.gz`, `.tgz` and
 * `.zip`) could only ever end in `status: failed`. This is the missing step.
 *
 * SAFETY IS THE POINT OF THE FILE. An uploaded archive is attacker-controlled
 * input, and the classic bug is a member named `../../etc/whatever` or an
 * absolute path. `tar` is asked not to honour those, AND the member list is
 * read and refused BEFORE anything is written, because "the tool refuses by
 * default" is a claim about a version of a tool rather than a property of this
 * code.
 *
 * The first version of this file checked the tree AFTER extracting, which was
 * worthless: the walk started at the target directory, so every path it could
 * build was inside the target by construction — a member that escaped had
 * already been written somewhere the walk never looked. The check has to come
 * first, and it has to be on the archive's own member names. Symlinks are
 * refused for the same reason: a symlink to `/` inside the archive turns a
 * later write into a write anywhere.
 *
 * SIZE. A tarball is compressed, so a small upload can expand to an arbitrarily
 * large tree — the classic amplification bomb. The declared sizes in the member
 * list are checked against a cap before extracting, and the extracted tree is
 * measured afterwards as a backstop for an archive that lied.
 */

import { spawn } from 'child_process';
import { lstat, mkdir, readdir, rm, unlink } from 'fs/promises';
import { join, relative, resolve, sep } from 'path';

export class ExtractError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ExtractError';
  }
}

/** What a caller may hand us. Anything else is refused before `tar` runs. */
const SUPPORTED = ['.tar.gz', '.tgz', '.tar', '.zip'] as const;

export function isSupportedArchive(name: string): boolean {
  const lower = name.toLowerCase();
  return SUPPORTED.some((ext) => lower.endsWith(ext));
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (err) => reject(new ExtractError('TAR_UNAVAILABLE',
      `Could not run ${command}: ${err.message}`)));
    child.on('close', (code) => {
      if (code === 0) return resolvePromise();
      reject(new ExtractError('EXTRACT_FAILED', stderr.trim().slice(0, 400) || `${command} exited ${code}`));
    });
  });
}

/**
 * Caps on what one upload may become.
 *
 * Both are generous for a real LeRobot dataset — a 50-episode multi-camera G1
 * recording is a few GB and a few hundred files — and both are what stands
 * between a 1 MB tarball and a full disk.
 */
const MAX_MEMBERS = Number(process.env.DATASET_UPLOAD_MAX_MEMBERS ?? 200_000);
const MAX_EXTRACTED_BYTES = Number(
  process.env.DATASET_UPLOAD_MAX_BYTES ?? 20 * 1024 * 1024 * 1024,
);

/** Same as `run`, but hands back stdout. */
function runCapture(command: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (err) => reject(new ExtractError('TAR_UNAVAILABLE',
      `Could not run ${command}: ${err.message}`)));
    child.on('close', (code) => {
      if (code === 0) return resolvePromise(stdout);
      reject(new ExtractError('EXTRACT_FAILED', stderr.trim().slice(0, 400) || `${command} exited ${code}`));
    });
  });
}

/**
 * Delete every symlink under a tree, and report how many there were.
 *
 * A dataset has no legitimate use for one, and leaving them turns a later
 * "write into the extracted directory" into a write wherever the link points.
 */
async function stripSymlinks(root: string): Promise<number> {
  let removed = 0;
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        await unlink(full);
        removed++;
      } else if (entry.isDirectory()) {
        await walk(full);
      }
    }
  };
  await walk(root);
  return removed;
}

/** Refuse a member name that would land anywhere but under the target. */
function assertSafeMemberName(name: string): void {
  const trimmed = name.replace(/\/+$/, '');
  if (trimmed === '') return;
  if (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    throw new ExtractError('PATH_ESCAPE', `archive member is an absolute path: ${name}`);
  }
  for (const segment of trimmed.split(/[\\/]/)) {
    if (segment === '..') {
      throw new ExtractError('PATH_ESCAPE', `archive member escapes the target directory: ${name}`);
    }
  }
}

/**
 * What the archive says it holds, read before a byte is written.
 *
 * `tar -tvf` prints one line per member with the type as the first character of
 * the mode string (`l` symlink, `h` hardlink, `d` directory, `-` file) and the
 * declared size in a later column. Both GNU tar and bsdtar produce that shape;
 * the parse is deliberately loose — a line it cannot read costs the size check
 * for that member, not the refusal, because the NAME check runs off `tar -tf`,
 * which prints nothing but names.
 */
async function inspectArchive(archive: string): Promise<{ members: number; declaredBytes: number }> {
  const names = (await runCapture('tar', ['-tf', archive]))
    .split('\n').map((l) => l.trim()).filter(Boolean);
  if (names.length === 0) {
    throw new ExtractError('EMPTY_ARCHIVE', `${archive} holds no members`);
  }
  if (names.length > MAX_MEMBERS) {
    throw new ExtractError('TOO_MANY_MEMBERS',
      `archive holds ${names.length} members; the limit is ${MAX_MEMBERS}`);
  }
  for (const name of names) assertSafeMemberName(name);

  let declaredBytes = 0;
  let verbose = '';
  try {
    verbose = await runCapture('tar', ['-tvf', archive]);
  } catch {
    // A listing we cannot get costs the pre-flight size check, not the run:
    // `measureTree` below still refuses an oversized extraction.
    return { members: names.length, declaredBytes: 0 };
  }
  for (const line of verbose.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed[0] === 'l' || trimmed[0] === 'h') {
      throw new ExtractError('LINK_MEMBER',
        `archive contains a link member, which a dataset has no use for: ${trimmed.slice(0, 120)}`);
    }
    const size = /^\S+\s+\S+\s+(\d+)\s/.exec(trimmed);
    if (size) declaredBytes += Number(size[1]);
  }
  if (declaredBytes > MAX_EXTRACTED_BYTES) {
    throw new ExtractError('ARCHIVE_TOO_LARGE',
      `archive declares ${declaredBytes} bytes of content; the limit is ${MAX_EXTRACTED_BYTES}`);
  }
  return { members: names.length, declaredBytes };
}

/** Total bytes under a tree, so an archive that lied about its sizes is caught. */
async function measureTree(root: string): Promise<number> {
  let total = 0;
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) total += (await lstat(full)).size;
    }
  };
  await walk(root);
  return total;
}

/**
 * A LeRobot dataset root inside an extracted tree.
 *
 * Archives are commonly made with a single wrapping directory (`tar czf x.tgz
 * my-dataset/`), so `meta/info.json` is one level down. Looked for rather than
 * assumed, because both shapes are what people actually upload.
 */
export async function findDatasetRoot(root: string): Promise<string | null> {
  const hasInfo = async (dir: string): Promise<boolean> => {
    try {
      const info = await lstat(join(dir, 'meta', 'info.json'));
      return info.isFile();
    } catch {
      return false;
    }
  };
  if (await hasInfo(root)) return root;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = join(root, entry.name);
    if (await hasInfo(child)) return child;
  }
  return null;
}

export interface ExtractResult {
  /** The directory holding `meta/info.json`. */
  datasetRoot: string;
  /** Symlinks that were present and were removed. */
  symlinksRemoved: number;
}

/**
 * Unpack `archive` into `target` and return the dataset root inside it.
 *
 * `target` is created and must not already exist — an extraction that merges
 * into somebody else's directory is how one upload overwrites another.
 */
export async function extractDatasetArchive(
  archive: string,
  target: string,
): Promise<ExtractResult> {
  if (!isSupportedArchive(archive)) {
    throw new ExtractError('UNSUPPORTED_ARCHIVE',
      `${archive}: expected one of ${SUPPORTED.join(', ')}`);
  }

  // BEFORE anything is written. `tar` refusing a `../` member is a property of
  // whichever tar is installed; this is the property of this code.
  await inspectArchive(archive);

  await mkdir(target, { recursive: true });

  try {
    // `-P` is NOT passed, so absolute paths and `..` members are refused by both
    // GNU tar and bsdtar; `--no-same-owner` keeps a uid out of the archive from
    // meaning anything. bsdtar reads zip as well, which is why the modal's
    // `.zip` is not a separate code path.
    //
    // Measured on bsdtar 3.5.3: a member named `../x` is refused outright and
    // the whole extraction exits non-zero; a member named `/tmp/x` has its
    // leading slash stripped and lands INSIDE the target as `tmp/x`. Both are
    // acceptable outcomes — but neither is relied on: `inspectArchive` has
    // already refused both names above.
    await run('tar', ['-xf', archive, '-C', target, '--no-same-owner']);

    // The backstop for an archive whose member list understated what it holds.
    const extractedBytes = await measureTree(target);
    if (extractedBytes > MAX_EXTRACTED_BYTES) {
      throw new ExtractError('ARCHIVE_TOO_LARGE',
        `the archive extracted to ${extractedBytes} bytes; the limit is ${MAX_EXTRACTED_BYTES}`);
    }

    // Belt and braces: `inspectArchive` refuses a link member, so reaching one
    // here means the listing and the extraction disagreed.
    const symlinksRemoved = await stripSymlinks(target);

    const datasetRoot = await findDatasetRoot(target);
    if (!datasetRoot) {
      throw new ExtractError('NOT_A_DATASET',
        'the archive contains no meta/info.json, at its root or one level down');
    }
    return { datasetRoot, symlinksRemoved };
  } catch (error) {
    // A refused archive still leaves behind whatever tar wrote before it
    // stopped, and a half-tree is exactly what `isLocalDataset` would accept as
    // a dataset that happens to be missing most of its files.
    await rm(target, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

/** Relative paths of every file under a tree, POSIX-style. */
export async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) out.push(relative(root, full).split(sep).join('/'));
    }
  };
  await walk(root);
  out.sort();
  return out;
}
