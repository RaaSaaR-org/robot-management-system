/**
 * @file HuggingFacePublishService.test.ts
 * @description Publishing a local LeRobot dataset to the Hub — with the Hub
 *              client faked, so no request ever leaves the test (TASK-394).
 * @feature datasets
 */

import { mkdtemp, mkdir, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDatasetService } = vi.hoisted(() => ({
  mockDatasetService: {
    get: vi.fn(),
    update: vi.fn(),
    auditDatasetAction: vi.fn(),
  },
}));

vi.mock('../DatasetService.js', () => ({ datasetService: mockDatasetService }));

// Belt and braces: if the injected fake were ever bypassed, the real client
// must not be reachable from this file.
vi.mock('@huggingface/hub', () => {
  const refuse = () => {
    throw new Error('the real Hub client must not be called from a test');
  };
  return { whoAmI: refuse, repoExists: refuse, createRepo: refuse, downloadFile: refuse, uploadFilesWithProgress: refuse };
});

// The default client tags over plain REST; nothing in this file may reach it.
const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = (() => {
    throw new Error('fetch must not be called from a test');
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

import {
  HuggingFacePublishService,
  normalizeRepoId,
  PublishError,
  replaceTagOverRest,
  scrubToken,
  type HubClient,
} from '../HuggingFacePublishService.js';
import { buildDatasetCard, NEODEM_CARD_MARKER } from '../huggingface/datasetCard.js';

const TOKEN = 'hf_testTOKEN1234567890abcdef';

const INFO = {
  codebase_version: 'v3.0',
  robot_type: 'Unitree_G1_Dex3',
  fps: 30,
  total_episodes: 3,
  total_frames: 900,
  features: {
    'observation.images.cam_right_high': { dtype: 'video', shape: [480, 640, 3] },
    'observation.state': { dtype: 'float32', shape: [28] },
    action: { dtype: 'float32', shape: [28] },
  },
  _neodem: { simulated: false, source: 'neodem-teleop' },
};

let root: string;
let home: string;

async function writeDataset(dir: string): Promise<void> {
  await mkdir(join(dir, 'meta', 'episodes', 'chunk-000'), { recursive: true });
  await mkdir(join(dir, 'data', 'chunk-000'), { recursive: true });
  await mkdir(join(dir, 'videos', 'observation.images.cam_right_high', 'chunk-000'), { recursive: true });
  await writeFile(join(dir, 'meta', 'info.json'), JSON.stringify(INFO));
  await writeFile(join(dir, 'meta', 'tasks.jsonl'), '{"task_index":0,"task":"Pick up the apple and place it on the plate"}\n');
  await writeFile(join(dir, 'meta', 'episodes', 'chunk-000', 'file-000.parquet'), 'E'.repeat(10));
  await writeFile(join(dir, 'data', 'chunk-000', 'file-000.parquet'), 'D'.repeat(100));
  await writeFile(join(dir, 'videos', 'observation.images.cam_right_high', 'chunk-000', 'file-000.mp4'), 'V'.repeat(1000));
  // NeoDEM's own bookkeeping at the root is not part of the LeRobot dataset.
  await writeFile(join(dir, 'neodem-episodes.json'), '[]');
}

function dataset(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ds-1',
    name: 'g1-apple-pick',
    kind: 'materialized',
    status: 'ready',
    storagePath: root,
    fps: 30,
    totalFrames: 900,
    demonstrationCount: 3,
    huggingFaceRepoId: undefined,
    sourceRevision: null,
    importMode: null,
    robotType: { name: 'Unitree G1 EDU (Dex3-1)' },
    ...overrides,
  };
}

interface FakeHub extends HubClient {
  uploads: Array<{ repo: unknown; files: Array<{ path: string; content: Blob | URL }>; commitTitle: string }>;
  created: Array<{ repo: unknown; visibility: string; license?: string }>;
  tags: Array<{ repo: unknown; tag: string; revision: string }>;
}

function fakeHub(
  opts: { exists?: boolean; remoteReadme?: string | null; fail?: Error; orgs?: string[]; tagFail?: Error } = {},
): FakeHub {
  const hub: FakeHub = {
    uploads: [],
    created: [],
    tags: [],
    replaceTag: vi.fn(async (p) => {
      if (opts.tagFail) throw opts.tagFail;
      hub.tags.push({ repo: p.repo, tag: p.tag, revision: p.revision });
    }),
    whoAmI: vi.fn(async () => ({ name: 'huhn511', type: 'user', orgs: (opts.orgs ?? ['zemarobotik']).map((name) => ({ name })) })),
    repoExists: vi.fn(async () => opts.exists ?? false),
    createRepo: vi.fn(async (p) => {
      hub.created.push({ repo: p.repo, visibility: p.visibility, license: p.license });
      return { repoUrl: 'https://huggingface.co/datasets/x' };
    }),
    downloadFile: vi.fn(async () => (opts.remoteReadme == null ? null : new Blob([opts.remoteReadme]))),
    uploadFilesWithProgress: vi.fn(async function* (p) {
      hub.uploads.push({ repo: p.repo, files: p.files, commitTitle: p.commitTitle });
      if (opts.fail) throw opts.fail;
      yield { event: 'phase' as const, phase: 'preuploading' as const };
      yield { event: 'fileProgress' as const, path: 'videos/observation.images.cam_right_high/chunk-000/file-000.mp4', progress: 0.5, state: 'uploading' as const };
      yield { event: 'phase' as const, phase: 'committing' as const };
      return { commit: { oid: 'abc123', url: 'https://huggingface.co/datasets/zemarobotik/g1/commit/abc123' }, hookOutput: '' };
    }) as HubClient['uploadFilesWithProgress'],
  };
  return hub;
}

function service(hub: HubClient, env: Record<string, string> = { HF_TOKEN: TOKEN }) {
  return new HuggingFacePublishService({ hub, env, home, now: () => new Date('2026-10-17T12:00:00.000Z') });
}

beforeEach(async () => {
  vi.clearAllMocks();
  root = await mkdtemp(join(tmpdir(), 'hf-publish-ds-'));
  home = await mkdtemp(join(tmpdir(), 'hf-publish-home-'));
  await writeDataset(root);
  mockDatasetService.get.mockResolvedValue(dataset());
  mockDatasetService.update.mockResolvedValue(dataset());
  mockDatasetService.auditDatasetAction.mockResolvedValue(undefined);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

describe('HuggingFacePublishService.publish', () => {
  it('creates a private repo and uploads meta/, data/, videos/ and a generated card', async () => {
    const hub = fakeHub();
    const svc = service(hub);
    const job = await svc.publish('ds-1', { repoId: 'zemarobotik/g1-apple-pick' }, 'user-1');
    expect(job).toMatchObject({ status: 'running', repoId: 'zemarobotik/g1-apple-pick', private: true, license: 'apache-2.0' });

    await svc.settled('ds-1');
    const done = (await svc.getJob('ds-1')) as Record<string, unknown>;
    expect(done).toMatchObject({
      status: 'done',
      phase: 'done',
      repoCreated: true,
      card: 'generated',
      commitOid: 'abc123',
      url: 'https://huggingface.co/datasets/zemarobotik/g1-apple-pick',
      filesTotal: 6,
      versionTag: 'v3.0',
    });
    expect(done.bytesDone).toBe(done.bytesTotal);
    // LeRobotDataset(repo_id) refuses a repo without the codebase-version tag.
    expect(hub.tags).toEqual([{ repo: { type: 'dataset', name: 'zemarobotik/g1-apple-pick' }, tag: 'v3.0', revision: 'abc123' }]);

    expect(hub.created).toEqual([
      { repo: { type: 'dataset', name: 'zemarobotik/g1-apple-pick' }, visibility: 'private', license: 'apache-2.0' },
    ]);
    const paths = hub.uploads[0].files.map((f) => f.path).sort();
    expect(paths).toEqual([
      'README.md',
      'data/chunk-000/file-000.parquet',
      'meta/episodes/chunk-000/file-000.parquet',
      'meta/info.json',
      'meta/tasks.jsonl',
      'videos/observation.images.cam_right_high/chunk-000/file-000.mp4',
    ]);
    const readme = hub.uploads[0].files.find((f) => f.path === 'README.md')!.content as Blob;
    const card = await readme.text();
    expect(card).toContain(NEODEM_CARD_MARKER);
    expect(card).toContain('Pick up the apple and place it on the plate');
    expect(card).toContain('Real robot');

    expect(mockDatasetService.update).toHaveBeenCalledWith('ds-1', { huggingFaceRepoId: 'zemarobotik/g1-apple-pick' });
    const actions = mockDatasetService.auditDatasetAction.mock.calls.map((c) => c[1]);
    expect(actions).toEqual(['publish.huggingface.start', 'publish.huggingface']);
    expect(mockDatasetService.auditDatasetAction.mock.calls[1][3]).toMatchObject({ status: 'done', commit: 'abc123' });
  });

  it('commits to an existing repo without recreating it, and keeps a hand-written card', async () => {
    const hub = fakeHub({ exists: true, remoteReadme: '# Our own card' });
    const svc = service(hub);
    await svc.publish('ds-1', { repoId: 'zemarobotik/g1-apple-pick' }, null);
    await svc.settled('ds-1');
    expect(hub.createRepo).not.toHaveBeenCalled();
    expect(hub.uploads[0].files.map((f) => f.path)).not.toContain('README.md');
    expect(await svc.getJob('ds-1')).toMatchObject({ status: 'done', repoCreated: false, card: 'kept' });
  });

  it('leaves the card alone when the Hub one cannot be read', async () => {
    const hub = fakeHub({ exists: true });
    (hub.downloadFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('500'));
    const svc = service(hub);
    await svc.publish('ds-1', { repoId: 'zemarobotik/g1-apple-pick' }, null);
    await svc.settled('ds-1');
    expect(hub.uploads[0].files.map((f) => f.path)).not.toContain('README.md');
    expect(await svc.getJob('ds-1')).toMatchObject({ status: 'done', card: 'kept' });
  });

  it('replaces a card NeoDEM generated earlier', async () => {
    const hub = fakeHub({ exists: true, remoteReadme: `---\n---\n${NEODEM_CARD_MARKER}\n# old` });
    const svc = service(hub);
    await svc.publish('ds-1', { repoId: 'zemarobotik/g1-apple-pick' }, null);
    await svc.settled('ds-1');
    expect(hub.uploads[0].files.map((f) => f.path)).toContain('README.md');
  });

  it('uploads the dataset\'s own README.md as is', async () => {
    await writeFile(join(root, 'README.md'), '# Local card');
    const hub = fakeHub();
    const svc = service(hub);
    await svc.publish('ds-1', { repoId: 'zemarobotik/g1' }, null);
    await svc.settled('ds-1');
    const readme = hub.uploads[0].files.find((f) => f.path === 'README.md')!;
    expect(readme.content).toBeInstanceOf(URL);
    expect(await svc.getJob('ds-1')).toMatchObject({ card: 'local' });
  });

  it('leaves symlinks out and says so', async () => {
    await symlink('/etc/hostname', join(root, 'data', 'chunk-000', 'escape.parquet'));
    const hub = fakeHub();
    const svc = service(hub);
    await svc.publish('ds-1', { repoId: 'zemarobotik/g1' }, null);
    await svc.settled('ds-1');
    expect(hub.uploads[0].files.map((f) => f.path)).not.toContain('data/chunk-000/escape.parquet');
    const job = (await svc.getJob('ds-1')) as { warnings: string[] };
    expect(job.warnings.join(' ')).toMatch(/1 symlink/);
  });

  it('gives a bare name the default namespace', async () => {
    const hub = fakeHub();
    const svc = service(hub, { HF_TOKEN: TOKEN, HF_PUBLISH_NAMESPACE: 'zemarobotik' });
    const job = await svc.publish('ds-1', { repoId: 'g1-apple-pick' }, null);
    expect(job.repoId).toBe('zemarobotik/g1-apple-pick');
    await svc.settled('ds-1');
  });

  it('keeps a failure\'s reason with the token scrubbed out', async () => {
    const hub = fakeHub({ fail: new Error(`upload refused for Bearer ${TOKEN}`) });
    const svc = service(hub);
    await svc.publish('ds-1', { repoId: 'zemarobotik/g1' }, null);
    await svc.settled('ds-1');
    const job = (await svc.getJob('ds-1')) as { status: string; error: string };
    expect(job.status).toBe('failed');
    expect(job.error).toContain('upload refused');
    expect(job.error).not.toContain(TOKEN);
    expect(JSON.stringify(mockDatasetService.auditDatasetAction.mock.calls)).not.toContain(TOKEN);
    expect(mockDatasetService.update).not.toHaveBeenCalled();
  });

  it('does not overwrite the source repo of a Hub import', async () => {
    mockDatasetService.get.mockResolvedValue(dataset({ huggingFaceRepoId: 'nvidia/source', sourceRevision: 'sha' }));
    const svc = service(fakeHub());
    await svc.publish('ds-1', { repoId: 'zemarobotik/copy' }, null);
    await svc.settled('ds-1');
    expect(mockDatasetService.update).not.toHaveBeenCalled();
  });

  async function refusal(promise: Promise<unknown>): Promise<PublishError> {
    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(PublishError);
      return error as PublishError;
    }
    throw new Error('expected a refusal');
  }

  it('refuses a dataset that is not ready', async () => {
    mockDatasetService.get.mockResolvedValue(dataset({ status: 'validating' }));
    expect((await refusal(service(fakeHub()).publish('ds-1', { repoId: 'zemarobotik/g1' }, null))).code).toBe('DATASET_NOT_READY');
  });

  it('refuses a degraded dataset unless forced', async () => {
    mockDatasetService.get.mockResolvedValue(
      dataset({ validation: { valid: false, errors: [{ code: 'X', message: 'missing video' }], warnings: [] } }),
    );
    const hub = fakeHub();
    const svc = service(hub);
    const error = await refusal(svc.publish('ds-1', { repoId: 'zemarobotik/g1' }, null));
    expect(error).toMatchObject({ status: 409, code: 'DATASET_DEGRADED' });
    expect(error.message).toContain('missing video');

    const job = await svc.publish('ds-1', { repoId: 'zemarobotik/g1', force: true }, null);
    expect(job.forced).toBe(true);
    expect(job.warnings[0]).toMatch(/Published although/);
    await svc.settled('ds-1');
  });

  it('refuses a view, a dataset not on local disk, and an unknown one', async () => {
    mockDatasetService.get.mockResolvedValueOnce(dataset({ kind: 'view' }));
    expect((await refusal(service(fakeHub()).publish('ds-1', { repoId: 'a/b' }, null))).code).toBe('DATASET_IS_VIEW');
    mockDatasetService.get.mockResolvedValueOnce(dataset({ storagePath: 'ds-1/' }));
    expect((await refusal(service(fakeHub()).publish('ds-1', { repoId: 'a/b' }, null))).code).toBe('DATASET_NOT_LOCAL');
    mockDatasetService.get.mockResolvedValueOnce(null);
    expect((await refusal(service(fakeHub()).publish('nope', { repoId: 'a/b' }, null))).status).toBe(404);
  });

  it('refuses without a token', async () => {
    const error = await refusal(service(fakeHub(), {}).publish('ds-1', { repoId: 'zemarobotik/g1' }, null));
    expect(error).toMatchObject({ status: 503, code: 'HF_TOKEN_MISSING' });
  });

  it('refuses a namespace the account cannot write to', async () => {
    const error = await refusal(service(fakeHub()).publish('ds-1', { repoId: 'lerobot/g1' }, null));
    expect(error).toMatchObject({ status: 403, code: 'NAMESPACE_FORBIDDEN' });
  });

  it('still finishes when the version tag cannot be set, and says what that breaks', async () => {
    const hub = fakeHub({ tagFail: new Error(`HTTP 403 for ${TOKEN}`) });
    const svc = service(hub);
    await svc.publish('ds-1', { repoId: 'zemarobotik/g1' }, null);
    await svc.settled('ds-1');
    const job = (await svc.getJob('ds-1')) as { status: string; versionTag?: string; warnings: string[] };
    expect(job.status).toBe('done');
    expect(job.versionTag).toBeUndefined();
    expect(job.warnings.join(' ')).toMatch(/v3\.0 tag could not be set.*LeRobotDataset/);
    expect(job.warnings.join(' ')).not.toContain(TOKEN);
  });

  it('refuses a double click: two starts in the same tick make one publish', async () => {
    const hub = fakeHub();
    const svc = service(hub);
    const results = await Promise.allSettled([
      svc.publish('ds-1', { repoId: 'zemarobotik/g1' }, null),
      svc.publish('ds-1', { repoId: 'zemarobotik/g1' }, null),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'PUBLISH_IN_PROGRESS' });
    await svc.settled('ds-1');
    expect(hub.uploads).toHaveLength(1);
  });

  it('refuses a second publish while one is running', async () => {
    const svc = service(fakeHub());
    const first = svc.publish('ds-1', { repoId: 'zemarobotik/g1' }, null);
    await first;
    const error = await refusal(svc.publish('ds-1', { repoId: 'zemarobotik/g1' }, null));
    expect(error.code).toBe('PUBLISH_IN_PROGRESS');
    await svc.settled('ds-1');
    // Finished: publishing again is a new commit, not a refusal.
    await svc.publish('ds-1', { repoId: 'zemarobotik/g1' }, null);
    await svc.settled('ds-1');
  });
});

describe('HuggingFacePublishService.getStatus', () => {
  it('reads the token from the hf login file and never returns it', async () => {
    await mkdir(join(home, '.cache', 'huggingface'), { recursive: true });
    await writeFile(join(home, '.cache', 'huggingface', 'token'), `${TOKEN}\n`);
    const hub = fakeHub();
    const status = await service(hub, {}).getStatus();
    expect(status).toEqual({
      configured: true,
      source: 'file',
      user: 'huhn511',
      orgs: ['zemarobotik'],
      defaultNamespace: 'huhn511',
    });
    expect(hub.whoAmI).toHaveBeenCalledWith({ accessToken: TOKEN });
    expect(JSON.stringify(status)).not.toContain(TOKEN);
  });

  it('prefers HF_TOKEN_PATH over the default file', async () => {
    const path = join(home, 'custom-token');
    await writeFile(path, 'hf_fromPATHfile00000000');
    const hub = fakeHub();
    await service(hub, { HF_TOKEN_PATH: path }).getStatus();
    expect(hub.whoAmI).toHaveBeenCalledWith({ accessToken: 'hf_fromPATHfile00000000' });
  });

  it('says not configured when there is no token anywhere', async () => {
    expect(await service(fakeHub(), {}).getStatus()).toMatchObject({ configured: false, user: null });
  });

  it('reports a rejected token without echoing it', async () => {
    const hub = fakeHub();
    (hub.whoAmI as ReturnType<typeof vi.fn>).mockRejectedValue(new Error(`401 for ${TOKEN}`));
    const status = await service(hub).getStatus();
    expect(status.configured).toBe(true);
    expect(status.error).toContain('401');
    expect(status.error).not.toContain(TOKEN);
  });
});

describe('replaceTagOverRest', () => {
  it('moves the tag the way huggingface_hub does: DELETE the old one (404 is fine), then POST on the revision', async () => {
    const calls: Array<{ url: string; method?: string; body?: unknown; auth?: string }> = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        auth: (init?.headers as Record<string, string>)?.Authorization,
      });
      return new Response('', { status: init?.method === 'DELETE' ? 404 : 200 });
    }) as typeof fetch;
    await replaceTagOverRest({
      repo: { type: 'dataset', name: 'zemarobotik/g1' },
      tag: 'v3.0',
      revision: 'abc123',
      accessToken: TOKEN,
      hubUrl: 'http://127.0.0.1:9/',
    });
    expect(calls).toEqual([
      { url: 'http://127.0.0.1:9/api/datasets/zemarobotik/g1/tag/v3.0', method: 'DELETE', body: undefined, auth: `Bearer ${TOKEN}` },
      { url: 'http://127.0.0.1:9/api/datasets/zemarobotik/g1/tag/abc123', method: 'POST', body: { tag: 'v3.0' }, auth: `Bearer ${TOKEN}` },
    ]);
  });

  it('throws when the Hub refuses the tag', async () => {
    globalThis.fetch = (async (_url: string, init?: RequestInit) =>
      new Response('forbidden', { status: init?.method === 'DELETE' ? 404 : 403 })) as typeof fetch;
    await expect(
      replaceTagOverRest({ repo: { type: 'dataset', name: 'a/b' }, tag: 'v3.0', revision: 'main', accessToken: TOKEN }),
    ).rejects.toThrow(/HTTP 403/);
  });
});

describe('helpers', () => {
  it('normalizes repo ids', () => {
    expect(normalizeRepoId('zemarobotik/g1', null)).toBe('zemarobotik/g1');
    expect(normalizeRepoId('g1', 'zemarobotik')).toBe('zemarobotik/g1');
    expect(normalizeRepoId('g1', null)).toBeNull();
    expect(normalizeRepoId('a/b/c', null)).toBeNull();
    expect(normalizeRepoId('a/b--c', null)).toBeNull();
    expect(normalizeRepoId('a/../b', null)).toBeNull();
    expect(normalizeRepoId('a/has space', null)).toBeNull();
  });

  it('scrubs tokens', () => {
    expect(scrubToken(`x ${TOKEN} y`, TOKEN)).toBe('x *** y');
    expect(scrubToken('leaked hf_abcdefghijklmnop here', null)).toBe('leaked hf_*** here');
  });

  it('builds a card with the facts from info.json', () => {
    const card = buildDatasetCard({
      repoId: 'zemarobotik/g1',
      datasetName: 'g1',
      license: 'apache-2.0',
      tags: ['apple', 'LeRobot'],
      info: INFO,
      tasks: ['Pick up the apple'],
      publishedAt: '2026-10-17T12:00:00.000Z',
    });
    expect(card.startsWith('---\nlicense: apache-2.0\ntask_categories:\n- robotics\n')).toBe(true);
    expect(card).toContain('- unitree_g1_dex3');
    expect(card.match(/^- LeRobot$/gm)).toHaveLength(1);
    expect(card).toContain('- apple');
    expect(card).toContain('data_files: data/*/*.parquet');
    expect(card).toContain('| Robot type | `Unitree_G1_Dex3` |');
    expect(card).toContain('| Frame rate | 30 fps |');
    expect(card).toContain('| Episodes | 3 |');
    expect(card).toContain('| Frames | 900 |');
    expect(card).toContain('`observation.images.cam_right_high` (480×640×3)');
    expect(card).toContain('| `action` | float32 | [28] |');
    expect(card).toContain('ZeMA');
    expect(card).toContain('LeRobotDataset("zemarobotik/g1")');
  });

  it('says unknown rather than guessing', () => {
    const card = buildDatasetCard({
      repoId: 'a/b', datasetName: 'b', license: 'mit', tags: [], info: {}, tasks: [], publishedAt: 'now',
    });
    expect(card).toContain('| Robot type | `unknown` |');
    expect(card).toContain('| Frame rate | unknown |');
    expect(card).toContain('Unknown — the recording does not say');
  });
});
