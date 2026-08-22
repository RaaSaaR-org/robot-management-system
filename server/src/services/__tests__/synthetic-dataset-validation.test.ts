/**
 * @file synthetic-dataset-validation.test.ts
 * @description A Cosmos 3-generated synthetic LeRobot dataset (TASK-175)
 *              against the real validation logic.
 *              The fixture under fixtures/cosmos-synthetic-bridge/ is the meta/
 *              produced by scratch/cosmos3/cosmos3_synth.py from forward-dynamics
 *              rollouts on nvidia/Cosmos3-Action-Viewer (bridge / WidowX).
 * @feature datasets
 *
 * NOTE ON WHAT CHANGED (TASK-217). The fixture is meta/ ONLY — no parquets, no
 * mp4s, because it was committed as the metadata that generator produces. The
 * validator used to call it valid, since it read four fields out of info.json
 * and stopped. It does not any more: `info.json` names four parquets and four
 * videos and none of them are there, which is precisely the failure this task
 * exists to catch. Both halves are asserted below — the fixture as committed
 * is reported as incomplete, and the same metadata with its data files present
 * validates clean.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(__dirname, 'fixtures', 'cosmos-synthetic-bridge');

// Storage shim: validateStructure() calls client.exists/download with paths of
// the form `${storagePath}meta/info.json`. We make storagePath the absolute
// fixture dir so those resolve to real files on disk.
const { rustfsExists, rustfsDownload } = vi.hoisted(() => ({
  rustfsExists: vi.fn(),
  rustfsDownload: vi.fn(),
}));

vi.mock('../../repositories/index.js', () => ({
  datasetRepository: { create: vi.fn(), findById: vi.fn(), findAll: vi.fn(), update: vi.fn(), delete: vi.fn() },
  robotTypeRepository: { findById: vi.fn() },
  skillDefinitionRepository: { findById: vi.fn() },
}));
vi.mock('../../storage/model-storage.js', () => ({
  BUCKETS: { TRAINING_DATASETS: 'training-datasets', MODEL_CHECKPOINTS: 'model-checkpoints', PRODUCTION_MODELS: 'production-models', ROBOT_LOGS: 'robot-logs' },
  modelStorage: { getDatasetUploadUrl: vi.fn(), deleteDataset: vi.fn() },
}));
vi.mock('../../storage/rustfs-client.js', () => ({
  isRustFSInitialized: vi.fn(() => true),
  getRustFSClient: vi.fn(() => ({ exists: rustfsExists, download: rustfsDownload })),
}));
vi.mock('../../messaging/index.js', () => ({
  natsClient: { isConnected: vi.fn(), getKV: vi.fn(), getJetStream: vi.fn(() => ({ publish: vi.fn() })) },
}));
vi.mock('../../messaging/kv-stores.js', () => ({
  KV_STORE_NAMES: { JOB_PROGRESS: 'JOB_PROGRESS', MODEL_REGISTRY: 'MODEL_REGISTRY', FLEET_CONFIG: 'FLEET_CONFIG' },
  kvGet: vi.fn(), kvPut: vi.fn(),
}));

import { datasetService } from '../DatasetService.js';

/**
 * The fixture's metadata, with the data files it names actually written.
 *
 * Built in a temp directory rather than committed, so the repo keeps no
 * binaries and the fixture stays what it says it is: the metadata that
 * generator produces.
 */
async function completedFixture(): Promise<string> {
  const { mkdtemp, mkdir, cp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { ParquetSchema, ParquetWriter, ParquetFieldBuilder } = await import('@dsnp/parquetjs');

  const root = await mkdtemp(join(tmpdir(), 'cosmos-complete-'));
  await cp(join(FIXTURE_ROOT, 'meta'), join(root, 'meta'), { recursive: true });
  const info = JSON.parse(readFileSync(join(root, 'meta', 'info.json'), 'utf8')) as {
    features: Record<string, { dtype: string; shape: number[] }>;
  };
  const episodes = JSON.parse(readFileSync(join(root, 'meta', 'episodes.json'), 'utf8')) as
    { episode_index: number; length: number }[];
  const stateDim = info.features['observation.state']!.shape[0]!;
  const actionDim = info.features.action!.shape[0]!;
  const cameras = Object.entries(info.features)
    .filter(([, f]) => f.dtype === 'video')
    .map(([key]) => key);

  await mkdir(join(root, 'data', 'chunk-000'), { recursive: true });
  const asList = (v: number[]) => ({ list: v.map((element) => ({ element })) });
  for (const episode of episodes) {
    const writer = await ParquetWriter.openFile(
      new ParquetSchema({
        'observation.state': ParquetFieldBuilder.createListField('FLOAT', false),
        action: ParquetFieldBuilder.createListField('FLOAT', false),
        timestamp: { type: 'FLOAT' },
        frame_index: { type: 'INT64' },
        episode_index: { type: 'INT64' },
        index: { type: 'INT64' },
        task_index: { type: 'INT64' },
      }),
      join(root, 'data', 'chunk-000', `episode_${String(episode.episode_index).padStart(6, '0')}.parquet`),
    );
    for (let f = 0; f < episode.length; f++) {
      await writer.appendRow({
        'observation.state': asList(Array.from({ length: stateDim }, (_, j) => Math.sin(f + j))),
        action: asList(Array.from({ length: actionDim }, (_, j) => Math.cos(f + j))),
        timestamp: f / 5,
        frame_index: f,
        episode_index: episode.episode_index,
        index: f,
        task_index: 0,
      });
    }
    await writer.close();
    for (const camera of cameras) {
      // `video_path` in this fixture is key-first; `streamLocalVideo` and the
      // validator both accept either ordering, which is why the two converters
      // in this repo disagreeing about it has never bitten.
      const dir = join(root, 'videos', camera, 'chunk-000');
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, `episode_${String(episode.episode_index).padStart(6, '0')}.mp4`),
        'not really an mp4, but non-empty',
      );
    }
  }
  return root;
}

describe('TASK-175: the Cosmos 3 synthetic dataset against real validation', () => {
  beforeEach(() => {
    // path arg is the absolute on-disk path (storagePath = FIXTURE_ROOT + '/')
    rustfsExists.mockImplementation(async (_bucket: string, p: string) => existsSync(p));
    rustfsDownload.mockImplementation(async (_bucket: string, p: string) => readFileSync(p));
  });

  it('reads the metadata correctly', async () => {
    const result = await datasetService.validateStructure(`${FIXTURE_ROOT}/`);
    expect(result.lerobotVersion).toBe('v2.1');
    expect(result.fps).toBeGreaterThan(0);
    expect(result.episodeCount).toBe(4);
    expect(result.totalFrames).toBe(68);
    // stats.json and episodes.json are both present in the fixture.
    expect(result.report!.warnings.map((w) => w.code)).not.toContain('MISSING_STATS');
  });

  it('reports the fixture as incomplete, naming the files that are not there', async () => {
    // The fixture is meta/ only. This used to be `valid: true` with an empty
    // error list, because the check never looked for a file `info.json` named.
    const result = await datasetService.validateStructure(`${FIXTURE_ROOT}/`);
    expect(result.valid).toBe(false);
    const codes = result.report!.errors.map((e) => e.code);
    expect(codes).toContain('MISSING_DATA_FILE');
    expect(codes).toContain('MISSING_VIDEO_FILE');
    // Four episodes, so four of each — not one generic "something is missing".
    expect(codes.filter((c) => c === 'MISSING_DATA_FILE')).toHaveLength(4);
    expect(result.report!.errors.find((e) => e.code === 'MISSING_DATA_FILE')!.message)
      .toContain('data/chunk-000/episode_000000.parquet');
  });

  it('accepts the same metadata once its data files are there', async () => {
    const root = await completedFixture();
    const result = await datasetService.validateStructure(`${root}/`);

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.episodeCount).toBe(4);
    expect(result.totalFrames).toBe(68);
    // And it opened them: 1 info + 1 stats + 1 episodes + 4 parquets + 4 mp4s.
    expect(result.report!.files).toHaveLength(11);
  });

  it('computeQualityScore() returns a positive score for the completed dataset', async () => {
    const root = await completedFixture();
    const result = await datasetService.validateStructure(`${root}/`);
    const score = datasetService.computeQualityScore(result);

    expect(score.total).toBeGreaterThan(0);
    expect(score.formatCompliance).toBe(10); // info(4) + stats(3) + valid(3)
  });
});
