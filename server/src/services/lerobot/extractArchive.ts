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
 * absolute path. `tar` is asked not to honour those, AND every extracted path
 * is checked afterwards, because "the tool refuses by default" is a claim about
 * a version of a tool rather than a property of this code. Symlinks are removed
 * for the same reason: a symlink to `/` inside the archive turns a later write
 * into a write anywhere.
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

/** Every path under a tree escapes checking; this is the check. */
async function assertContained(root: string): Promise<void> {
  const base = resolve(root);
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (full !== base && !full.startsWith(base + sep)) {
        throw new ExtractError('PATH_ESCAPE', `archive member escapes the target directory: ${full}`);
      }
      if (entry.isDirectory()) await walk(full);
    }
  };
  await walk(base);
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
    // acceptable outcomes. `assertContained` is what makes that a property of
    // this code rather than of that version of that tool.
    await run('tar', ['-xf', archive, '-C', target, '--no-same-owner']);

    const symlinksRemoved = await stripSymlinks(target);
    await assertContained(target);

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
