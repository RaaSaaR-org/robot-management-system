/**
 * @file lerobotFolder.test.ts
 * @description What the upload dialog concludes about a picked folder before
 *              anything is sent: where the dataset root is, which files go up,
 *              what `meta/info.json` says, and every reason to refuse a folder.
 * @feature training
 */

import { describe, expect, it } from 'vitest';
import {
  entriesFromDrop, filesFromEntries, filesFromInput, inspectFolder, isDatasetFile, summarizeInfo,
  type FsEntry, type PickedFile,
} from '../lerobotFolder';

const INFO_V3 = {
  codebase_version: 'v3.0',
  robot_type: 'unitree_g1_dex3',
  fps: 30,
  total_episodes: 80,
  total_frames: 55695,
  features: {
    action: { dtype: 'float32', shape: [31] },
    'observation.state': { dtype: 'float32', shape: [31] },
    'observation.images.head': { dtype: 'video', shape: [480, 640, 3] },
    'observation.images.wrist': { dtype: 'video', shape: [480, 640, 3] },
  },
};

/** A file whose `text()` works in jsdom, with a size of our choosing. */
function fake(path: string, content = 'x', size?: number): PickedFile {
  const file = new File([content], path.split('/').pop() ?? path);
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(content) });
  return { path, file };
}

function v3Folder(root = 'bottles/', info: unknown = INFO_V3): PickedFile[] {
  return [
    fake(`${root}README.md`),
    fake(`${root}meta/info.json`, typeof info === 'string' ? info : JSON.stringify(info)),
    fake(`${root}meta/stats.json`),
    fake(`${root}meta/episodes/chunk-000/file-000.parquet`),
    fake(`${root}data/chunk-000/file-000.parquet`, 'd', 1000),
    fake(`${root}videos/observation.images.head/chunk-000/file-000.mp4`, 'v', 5000),
    fake(`${root}videos/observation.images.wrist/chunk-000/file-000.mp4`, 'v', 6000),
  ];
}

describe('isDatasetFile', () => {
  it('keeps exactly what the upload API stores', () => {
    expect(isDatasetFile('meta/info.json')).toBe(true);
    expect(isDatasetFile('meta/episodes/chunk-000/file-000.parquet')).toBe(true);
    expect(isDatasetFile('data/chunk-000/file-000.parquet')).toBe(true);
    expect(isDatasetFile('videos/observation.images.head/chunk-000/file-000.mp4')).toBe(true);
    expect(isDatasetFile('images/observation.images.head/episode_000000/frame_000000.png')).toBe(true);

    expect(isDatasetFile('README.md')).toBe(false);
    expect(isDatasetFile('.gitattributes')).toBe(false);
    expect(isDatasetFile('data/chunk-000/notes.txt')).toBe(false);
    expect(isDatasetFile('videos/observation.images.head/chunk-000/file-000.mkv')).toBe(false);
    expect(isDatasetFile('meta/')).toBe(false);
  });
});

describe('summarizeInfo', () => {
  it('reads version, counts, cameras and widths', () => {
    expect(summarizeInfo(INFO_V3)).toEqual({
      version: 'v3.0', robotType: 'unitree_g1_dex3', episodes: 80, frames: 55695, fps: 30,
      cameras: ['head', 'wrist'], actionWidth: 31, stateWidth: 31,
    });
  });

  it('reports what is missing as null rather than guessing', () => {
    expect(summarizeInfo({})).toEqual({
      version: null, robotType: null, episodes: null, frames: null, fps: null,
      cameras: [], actionWidth: null, stateWidth: null,
    });
  });
});

describe('inspectFolder', () => {
  it('accepts a v3.0 dataset and lists what goes up, relative to the dataset root', async () => {
    const found = await inspectFolder(v3Folder());
    expect(found.problems).toEqual([]);
    expect(found.rootName).toBe('bottles');
    expect(found.files.map((f) => f.path)).toEqual([
      'data/chunk-000/file-000.parquet',
      'meta/episodes/chunk-000/file-000.parquet',
      'meta/info.json',
      'meta/stats.json',
      'videos/observation.images.head/chunk-000/file-000.mp4',
      'videos/observation.images.wrist/chunk-000/file-000.mp4',
    ]);
    // README.md stays behind and is counted, not declared.
    expect(found.skipped).toBe(1);
    expect(found.totalBytes).toBe(found.files.reduce((n, f) => n + f.size, 0));
    expect(found.summary.episodes).toBe(80);
    expect(found.info).toEqual(INFO_V3);
  });

  it('finds the dataset one level down when its parent folder was picked', async () => {
    const found = await inspectFolder([fake('downloads/notes.txt'), ...v3Folder('downloads/bottles/')]);
    expect(found.problems).toEqual([]);
    expect(found.rootName).toBe('bottles');
    expect(found.files.every((f) => !f.path.startsWith('downloads'))).toBe(true);
    expect(found.skipped).toBe(2);
  });

  it('uploads only the shallowest dataset and says so when a folder holds several', async () => {
    const found = await inspectFolder([...v3Folder('all/a/'), ...v3Folder('all/b/')]);
    expect(found.rootName).toBe('a');
    expect(found.warnings.join(' ')).toMatch(/holds 2 datasets/);
    expect(found.files).toHaveLength(6);
  });

  it('leaves a file behind whose path the server would refuse the whole request for', async () => {
    const found = await inspectFolder([...v3Folder(), fake('bottles/meta/bad\\name.json')]);
    expect(found.problems).toEqual([]);
    expect(found.files.some((f) => f.path.includes('bad'))).toBe(false);
  });

  it('refuses a folder with no meta/info.json', async () => {
    const found = await inspectFolder([fake('videos/a.mp4'), fake('videos/b.mp4')]);
    expect(found.problems).toHaveLength(1);
    expect(found.problems[0]).toMatch(/No meta\/info\.json/);
    expect(found.files).toEqual([]);
  });

  it('says to unpack an archive instead of calling it an empty folder', async () => {
    const found = await inspectFolder([fake('bottles.tar.gz')]);
    expect(found.problems[0]).toMatch(/archive/i);
  });

  it('refuses an empty selection', async () => {
    expect((await inspectFolder([])).problems).toEqual(['The folder is empty.']);
  });

  it('refuses an info.json that is not JSON', async () => {
    const found = await inspectFolder(v3Folder('bottles/', '{ not json'));
    expect(found.problems).toContain('meta/info.json is not valid JSON.');
    expect(found.info).toBeNull();
  });

  it('refuses a version the instance does not take', async () => {
    const found = await inspectFolder(v3Folder('bottles/', { ...INFO_V3, codebase_version: 'v1.6' }));
    expect(found.problems.join(' ')).toMatch(/v1\.6 is not supported/);
  });

  it('names every field the start request would be refused for', async () => {
    const found = await inspectFolder(v3Folder('bottles/', { codebase_version: 'v3.0', fps: 0, features: {} }));
    expect(found.problems).toEqual(expect.arrayContaining([
      'meta/info.json has no robot_type.',
      'meta/info.json has no positive fps.',
      'meta/info.json lists no features.',
    ]));
  });

  it('refuses a dataset without episode tables', async () => {
    const found = await inspectFolder(v3Folder().filter((p) => !p.path.includes('/data/')));
    expect(found.problems.join(' ')).toMatch(/data\/ holds no \.parquet/);
  });

  it('wants the episode index the version uses', async () => {
    const v3 = await inspectFolder(v3Folder().filter((p) => !p.path.includes('meta/episodes/')));
    expect(v3.problems.join(' ')).toMatch(/v3\.0 dataset needs meta\/episodes/);

    const v2Files = [
      fake('d/meta/info.json', JSON.stringify({ ...INFO_V3, codebase_version: 'v2.1' })),
      fake('d/data/chunk-000/episode_000000.parquet'),
    ];
    const v2 = await inspectFolder(v2Files);
    expect(v2.problems.join(' ')).toMatch(/v2\.x dataset needs meta\/episodes\.jsonl/);

    const v2ok = await inspectFolder([...v2Files, fake('d/meta/episodes.jsonl')]);
    expect(v2ok.problems).toEqual([]);
  });

  it('warns, without refusing, when the cameras it declares have no video files', async () => {
    const found = await inspectFolder(v3Folder().filter((p) => !p.path.includes('/videos/')));
    expect(found.problems).toEqual([]);
    expect(found.warnings.join(' ')).toMatch(/tables only/);
  });
});

describe('collecting files', () => {
  it('reads the relative path a directory input gives each file', () => {
    const file = new File(['x'], 'info.json');
    Object.defineProperty(file, 'webkitRelativePath', { value: 'bottles/meta/info.json' });
    expect(filesFromInput([file])).toEqual([{ path: 'bottles/meta/info.json', file }]);
  });

  it('walks a dropped folder, asking each directory again until it answers empty', async () => {
    const fileEntry = (fullPath: string): FsEntry => ({
      isFile: true, isDirectory: false, name: fullPath.split('/').pop()!, fullPath,
      file: (ok) => ok(new File(['x'], fullPath.split('/').pop()!)),
    });
    const dirEntry = (fullPath: string, batches: FsEntry[][]): FsEntry => {
      const queue = [...batches, []];
      return {
        isFile: false, isDirectory: true, name: fullPath.split('/').pop()!, fullPath,
        createReader: () => ({ readEntries: (ok) => ok(queue.shift() ?? []) }),
      };
    };
    // `meta` answers in two batches, the way Chrome does past 100 entries.
    const root = dirEntry('/bottles', [[
      dirEntry('/bottles/meta', [[fileEntry('/bottles/meta/info.json')], [fileEntry('/bottles/meta/stats.json')]]),
      fileEntry('/bottles/README.md'),
    ]]);

    const picked = await filesFromEntries([root]);
    expect(picked.map((p) => p.path)).toEqual(['bottles/meta/info.json', 'bottles/meta/stats.json', 'bottles/README.md']);
  });

  it('takes the entries of a drop, and none when the browser offers no entry API', () => {
    const entry: FsEntry = { isFile: true, isDirectory: false, name: 'a', fullPath: '/a' };
    const withEntries = { items: [{ kind: 'file', webkitGetAsEntry: () => entry }, { kind: 'string' }] };
    expect(entriesFromDrop(withEntries as unknown as DataTransfer)).toEqual([entry]);
    expect(entriesFromDrop({ items: [{ kind: 'file' }] } as unknown as DataTransfer)).toEqual([]);
    expect(entriesFromDrop(null)).toEqual([]);
  });
});
