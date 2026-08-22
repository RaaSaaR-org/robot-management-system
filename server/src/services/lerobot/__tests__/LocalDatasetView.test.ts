/**
 * @file LocalDatasetView.test.ts
 * @description The caching, concurrency and subprocess handling behind the
 *              v3.0 view — none of which had a test.
 * @feature training
 *
 * The converter is stubbed with a tiny python script, so these run without
 * pyarrow and without ffmpeg. What is under test is this file's behaviour
 * around the subprocess, not the conversion: how many children one burst of
 * requests spawns, whether a failure is remembered, whether a re-recording
 * invalidates the view, and whether the superseded copies are cleaned up.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, writeFile, utimes } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolveLocalView, clearViewCacheState, DatasetViewError } from '../LocalDatasetView.js';

let root: string;
let cache: string;
let counter: string;

/**
 * A stand-in converter: writes a v2.1-looking tree and appends a line to a
 * counter file, so a test can ask how many times it ran.
 */
async function installStubConverter(mode: 'ok' | 'fail'): Promise<void> {
  const script = join(root, 'stub_converter.py');
  const body = [
    'import json, sys, pathlib',
    `open(${JSON.stringify(counter)}, "a").write("x")`,
    ...(mode === 'fail'
      ? ['print(json.dumps({"ok": False, "error": "VIDEO_MISSING", "detail": "no mp4"}))',
         'sys.exit(1)']
      : [
        'source, out = sys.argv[1], sys.argv[2]',
        'meta = pathlib.Path(out) / "meta"',
        'meta.mkdir(parents=True, exist_ok=True)',
        '(meta / "info.json").write_text(json.dumps({',
        '  "codebase_version": "v2.1",',
        '  "_neodem_converted_from": {"version": "v3.0", "path": source},',
        '}))',
        'print(json.dumps({"ok": True}))',
      ]),
  ].join('\n');
  await writeFile(script, `${body}\n`);
  process.env.DATASET_VIEW_CONVERTER = script;
}

/** A v3.0 source tree. `tag` goes into `meta/info.json` so it can be changed. */
async function makeSource(name: string, tag = 'a'): Promise<string> {
  const dir = join(root, name);
  await mkdir(join(dir, 'meta'), { recursive: true });
  await writeFile(
    join(dir, 'meta', 'info.json'),
    JSON.stringify({ codebase_version: 'v3.0', tag }),
  );
  return dir;
}

async function converterRuns(): Promise<number> {
  try {
    return (await readFile(counter, 'utf8')).length;
  } catch {
    return 0;
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'view-cache-'));
  cache = join(root, 'views');
  counter = join(root, 'runs.txt');
  process.env.DATASET_VIEW_CACHE_DIR = cache;
  process.env.CURATION_PYTHON = process.env.CURATION_PYTHON || 'python3';
  process.env.DATASET_VIEW_FAILURE_COOLDOWN_MS = '30000';
  clearViewCacheState();
  await installStubConverter('ok');
});

afterAll(async () => {
  delete process.env.DATASET_VIEW_CACHE_DIR;
  delete process.env.DATASET_VIEW_CONVERTER;
  delete process.env.DATASET_VIEW_FAILURE_COOLDOWN_MS;
});

describe('a v2.1 dataset', () => {
  it('is served from where it is — no copy, no converter', async () => {
    const dir = join(root, 'already-v21');
    await mkdir(join(dir, 'meta'), { recursive: true });
    await writeFile(join(dir, 'meta', 'info.json'), JSON.stringify({ codebase_version: 'v2.1' }));

    const result = await resolveLocalView(dir);

    expect(result.converted).toBe(false);
    expect(result.root).toBe(dir);
    expect(await converterRuns()).toBe(0);
  });

  it('refuses a directory that is not a dataset at all', async () => {
    await expect(resolveLocalView(join(root, 'nothing-here'))).rejects.toMatchObject({
      code: 'NOT_A_DATASET',
    });
  });
});

describe('the conversion', () => {
  it('runs once for a burst of parallel requests, not once per request', async () => {
    // The viewer opens an episode with three requests at the same moment —
    // episodes, frames, video. Each used to start its own converter over the
    // same recording.
    const source = await makeSource('burst');
    const results = await Promise.all([
      resolveLocalView(source), resolveLocalView(source), resolveLocalView(source),
    ]);
    expect(new Set(results.map((r) => r.root)).size).toBe(1);
    expect(await converterRuns()).toBe(1);
  });

  it('does not run again once the view is on disk', async () => {
    const source = await makeSource('hit');
    const first = await resolveLocalView(source);
    const second = await resolveLocalView(source);
    expect(second.root).toBe(first.root);
    expect(await converterRuns()).toBe(1);
  });

  it('remembers a failure instead of re-spawning the converter every request', async () => {
    // Three parallel requests plus a reload used to mean four ffmpeg runs on a
    // dataset that cannot convert, and then four more a second later.
    await installStubConverter('fail');
    const source = await makeSource('broken');

    await expect(resolveLocalView(source)).rejects.toMatchObject({ code: 'VIDEO_MISSING' });
    await expect(resolveLocalView(source)).rejects.toMatchObject({ code: 'VIDEO_MISSING' });
    await expect(resolveLocalView(source)).rejects.toMatchObject({ code: 'VIDEO_MISSING' });

    expect(await converterRuns()).toBe(1);
  });

  it('reports the converter\'s own error code rather than a stack trace', async () => {
    await installStubConverter('fail');
    const source = await makeSource('coded');
    const err = await resolveLocalView(source).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DatasetViewError);
    expect((err as DatasetViewError).message).toContain('no mp4');
  });
});

describe('invalidation', () => {
  it('builds a new view when the dataset is re-recorded into the same directory', async () => {
    const source = await makeSource('rerecord');
    const first = await resolveLocalView(source);

    // A new recording: same path, different metadata.
    await writeFile(
      join(source, 'meta', 'info.json'),
      JSON.stringify({ codebase_version: 'v3.0', tag: 'b', extra: 'a longer file' }),
    );
    clearViewCacheState();
    const second = await resolveLocalView(source);

    expect(second.root).not.toBe(first.root);
    expect(await converterRuns()).toBe(2);
  });

  it('deletes the superseded copy rather than keeping one per recording', async () => {
    // Keyed by source AND content, so every re-recording left a full extra copy
    // of the dataset behind and nothing ever removed any of them.
    const source = await makeSource('sweep');
    const first = await resolveLocalView(source);
    expect(existsSync(join(first.root, 'meta', 'info.json'))).toBe(true);

    await writeFile(
      join(source, 'meta', 'info.json'),
      JSON.stringify({ codebase_version: 'v3.0', tag: 'b', extra: 'longer' }),
    );
    clearViewCacheState();
    const second = await resolveLocalView(source);

    expect(second.root).not.toBe(first.root);
    expect(existsSync(first.root)).toBe(false);
    expect((await readdir(cache)).length).toBe(1);
  });

  it('leaves another dataset\'s view alone while sweeping', async () => {
    const other = await makeSource('other');
    const otherView = await resolveLocalView(other);

    const source = await makeSource('mine');
    await resolveLocalView(source);
    await writeFile(
      join(source, 'meta', 'info.json'),
      JSON.stringify({ codebase_version: 'v3.0', tag: 'b', extra: 'longer' }),
    );
    clearViewCacheState();
    await resolveLocalView(source);

    expect(existsSync(otherView.root)).toBe(true);
  });

  it('is not defeated by a large tree — the stamp reads meta/, not everything', async () => {
    // The stamp walked the whole tree with a 4000-file budget, so on a dataset
    // bigger than that the walk stopped before reaching the changed file and a
    // stale view was served with no way to invalidate it.
    const source = await makeSource('big');
    const data = join(source, 'data', 'chunk-000');
    await mkdir(data, { recursive: true });
    await Promise.all(
      Array.from({ length: 60 }, (_, i) => writeFile(join(data, `file-${i}.bin`), 'x')),
    );
    const first = await resolveLocalView(source);

    // Only meta changes, and it changes last — behind every one of those files.
    const meta = join(source, 'meta', 'info.json');
    await writeFile(meta, JSON.stringify({ codebase_version: 'v3.0', tag: 'c' }));
    await utimes(meta, new Date(), new Date());
    clearViewCacheState();

    expect((await resolveLocalView(source)).root).not.toBe(first.root);
  });
});
