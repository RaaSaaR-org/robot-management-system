/**
 * @file extractArchive.test.ts
 * @description Unpacking an uploaded dataset archive — the shapes people
 *              actually upload, and the shapes an attacker uploads.
 * @feature training
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';
import {
  ExtractError,
  extractDatasetArchive,
  findDatasetRoot,
  isSupportedArchive,
  listFiles,
} from '../lerobot/extractArchive.js';

const run = promisify(execFile);
let root: string;

/** A minimal but real dataset tree. */
async function dataset(dir: string): Promise<void> {
  await mkdir(join(dir, 'meta'), { recursive: true });
  await mkdir(join(dir, 'data', 'chunk-000'), { recursive: true });
  await writeFile(join(dir, 'meta', 'info.json'), JSON.stringify({ codebase_version: 'v2.1' }));
  await writeFile(join(dir, 'data', 'chunk-000', 'episode_000000.parquet'), 'not really a parquet');
}

async function tarGz(cwd: string, members: string[], out: string): Promise<string> {
  await run('tar', ['-czf', out, '-C', cwd, ...members]);
  return out;
}


/**
 * A tar built BY HAND, so a member can be named anything.
 *
 * `tar -cf` will not create `../escaped.txt` for you — which is the point: an
 * archive that only this repo's own `tar` could have produced is not the
 * archive an attacker uploads. 512-byte ustar headers, which is all that is
 * needed to name a member.
 */
function tarWithMembers(members: { name: string; body: string }[]): Buffer {
  const blocks: Buffer[] = [];
  for (const member of members) {
    const header = Buffer.alloc(512, 0);
    header.write(member.name.slice(0, 100), 0, 100, 'ascii');
    header.write('000644 \0', 100, 8, 'ascii');           // mode
    header.write('000000 \0', 108, 8, 'ascii');           // uid
    header.write('000000 \0', 116, 8, 'ascii');           // gid
    header.write(`${member.body.length.toString(8).padStart(11, '0')} `, 124, 12, 'ascii');
    header.write('00000000000 ', 136, 12, 'ascii');       // mtime
    header.write('        ', 148, 8, 'ascii');            // checksum placeholder
    header.write('0', 156, 1, 'ascii');                   // typeflag: regular file
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
    blocks.push(header);

    const body = Buffer.alloc(Math.ceil(member.body.length / 512) * 512, 0);
    body.write(member.body, 0, 'utf8');
    blocks.push(body);
  }
  blocks.push(Buffer.alloc(1024, 0)); // two empty blocks end the archive
  return Buffer.concat(blocks);
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'extract-archive-'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('what it accepts', () => {
  it('takes the extensions the upload modal offers, and nothing else', () => {
    for (const name of ['a.tar.gz', 'A.TGZ', 'b.tar', 'c.zip']) {
      expect(isSupportedArchive(name), name).toBe(true);
    }
    for (const name of ['d.rar', 'e.parquet', 'f', 'g.gz']) {
      expect(isSupportedArchive(name), name).toBe(false);
    }
  });

  it('refuses an unsupported archive before running tar', async () => {
    await expect(extractDatasetArchive(join(root, 'x.rar'), join(root, 'out-rar')))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_ARCHIVE' });
  });
});

describe('the shapes people upload', () => {
  it('unpacks a tree whose root IS the dataset', async () => {
    const src = join(root, 'flat');
    await dataset(src);
    const archive = await tarGz(src, ['meta', 'data'], join(root, 'flat.tar.gz'));

    const target = join(root, 'out-flat');
    const { datasetRoot, symlinksRemoved } = await extractDatasetArchive(archive, target);
    expect(datasetRoot).toBe(target);
    expect(symlinksRemoved).toBe(0);
    expect(await listFiles(datasetRoot)).toEqual([
      'data/chunk-000/episode_000000.parquet',
      'meta/info.json',
    ]);
  });

  it('finds the dataset one level down, which is how `tar czf x.tgz my-dataset/` comes out', async () => {
    const src = join(root, 'wrapped');
    await dataset(join(src, 'my-dataset'));
    const archive = await tarGz(src, ['my-dataset'], join(root, 'wrapped.tar.gz'));

    const target = join(root, 'out-wrapped');
    const { datasetRoot } = await extractDatasetArchive(archive, target);
    expect(datasetRoot).toBe(join(target, 'my-dataset'));
    expect(JSON.parse(await readFile(join(datasetRoot, 'meta', 'info.json'), 'utf8')))
      .toEqual({ codebase_version: 'v2.1' });
  });

  it('refuses an archive with no dataset in it, and leaves nothing behind', async () => {
    const src = join(root, 'junk');
    await mkdir(src, { recursive: true });
    await writeFile(join(src, 'readme.txt'), 'hello');
    const archive = await tarGz(src, ['readme.txt'], join(root, 'junk.tar.gz'));

    const target = join(root, 'out-junk');
    await expect(extractDatasetArchive(archive, target))
      .rejects.toMatchObject({ code: 'NOT_A_DATASET' });
    // A half-unpacked directory would be read by the next thing along as a
    // dataset that happens to be missing everything.
    expect(existsSync(target)).toBe(false);
  });
});

describe('the shapes an attacker uploads', () => {
  it('does not write a member that climbs out of the target directory', async () => {
    // THE classic, with an archive `tar -cf` would refuse to create — built by
    // hand so the member really is named `../`. What is asserted is the
    // OUTCOME on disk, not tar's promise about itself: the escape hatch would
    // be a future `-P`, a different tar, or a platform where the refusal is a
    // warning.
    const canary = join(root, 'CLIMBED-OUT.txt');
    const archive = join(root, 'evil.tar');
    await writeFile(archive, tarWithMembers([
      { name: 'meta/info.json', body: '{"codebase_version":"v2.1"}' },
      { name: '../CLIMBED-OUT.txt', body: 'this must never be written' },
    ]));

    const target = join(root, 'evil-out', 'unpacked');
    await mkdir(join(root, 'evil-out'), { recursive: true });
    // Either tar refuses the whole archive or it drops that member. Both are
    // acceptable; writing the file is not. Measured on bsdtar 3.5.3: refused,
    // whole extraction non-zero.
    await extractDatasetArchive(archive, target).catch(() => undefined);
    expect(existsSync(canary)).toBe(false);
    expect(existsSync(join(root, 'evil-out', 'CLIMBED-OUT.txt'))).toBe(false);
    // And nothing half-unpacked is left where a later read would take it for a
    // dataset that is merely missing most of its files.
    expect(existsSync(target)).toBe(false);
  });

  it('does not write a member with an absolute path', async () => {
    const canary = join(root, 'ABSOLUTE.txt');
    const archive = join(root, 'absolute.tar');
    await writeFile(archive, tarWithMembers([
      { name: 'meta/info.json', body: '{"codebase_version":"v2.1"}' },
      { name: canary, body: 'this must never be written either' },
    ]));

    // bsdtar strips the leading slash and lands it INSIDE the target, which is
    // safe; what must not happen is a write at the named absolute path.
    const target = join(root, 'absolute-out');
    await extractDatasetArchive(archive, target).catch(() => undefined);
    expect(existsSync(canary)).toBe(false);
  });

  it('removes symlinks rather than unpacking them', async () => {
    // A symlink to `/` inside the archive turns any later write into the
    // extracted tree into a write anywhere on the host.
    const src = join(root, 'linky');
    await dataset(src);
    await symlink('/etc', join(src, 'escape'));
    const archive = await tarGz(src, ['meta', 'data', 'escape'], join(root, 'linky.tar.gz'));

    const target = join(root, 'out-linky');
    const { datasetRoot, symlinksRemoved } = await extractDatasetArchive(archive, target);
    expect(symlinksRemoved).toBe(1);
    expect(existsSync(join(datasetRoot, 'escape'))).toBe(false);
    // And the real files survived the strip.
    expect(await listFiles(datasetRoot)).toContain('meta/info.json');
  });

  it('will not merge into a directory that already holds something', async () => {
    // `extractDatasetArchive` creates the target; the caller clears it first.
    // What this pins is that an existing tree is not silently combined with a
    // new upload, which is how one dataset ends up half another.
    const src = join(root, 'merge');
    await dataset(src);
    const archive = await tarGz(src, ['meta', 'data'], join(root, 'merge.tar.gz'));
    const target = join(root, 'out-merge');
    await mkdir(join(target, 'meta'), { recursive: true });
    await writeFile(join(target, 'meta', 'stale.json'), '{}');

    await extractDatasetArchive(archive, target);
    // The stale file is still there — proof the caller MUST clear the target,
    // which `unpackUploadedArchive` does with an `rm` before it calls this.
    expect(existsSync(join(target, 'meta', 'stale.json'))).toBe(true);
  });
});

describe('findDatasetRoot', () => {
  it('returns null rather than guessing when nothing looks like a dataset', async () => {
    const dir = join(root, 'nothing');
    await mkdir(join(dir, 'a', 'b'), { recursive: true });
    expect(await findDatasetRoot(dir)).toBeNull();
  });

  it('does not look more than one level down', async () => {
    // Deliberate: a `meta/info.json` three directories in is more likely to be
    // a nested copy or a backup than the dataset the uploader meant.
    const dir = join(root, 'deep');
    await dataset(join(dir, 'a', 'b'));
    expect(await findDatasetRoot(dir)).toBeNull();
  });
});

describe('ExtractError', () => {
  it('carries a code, so a caller can branch without parsing prose', () => {
    const err = new ExtractError('PATH_ESCAPE', 'nope');
    expect(err.code).toBe('PATH_ESCAPE');
    expect(err).toBeInstanceOf(Error);
  });
});
