/**
 * @file DatasetService.reassociate.test.ts
 * @description The TASK-353 recovery pattern: a 43-wide dataset imported against
 *              the 28-wide G1 type fails, is pointed at an explicit 43-wide
 *              configuration, and revalidates from the files already stored —
 *              no download, no move, no delete, and the shared type untouched.
 * @feature datasets
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ParquetSchema, ParquetWriter, ParquetFieldBuilder } from '@dsnp/parquetjs';

// ---------------------------------------------------------------------------
// In-memory rows behind mocked repositories
// ---------------------------------------------------------------------------

const { rows, types, logAccess, deleteDataset, rtUpdate } = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  types: new Map<string, Record<string, unknown>>(),
  logAccess: vi.fn(async () => ({})),
  deleteDataset: vi.fn(),
  rtUpdate: vi.fn(),
}));

vi.mock('../../database/index.js', () => ({
  prisma: {
    dataset: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
    trainingJobDataset: { findMany: vi.fn(async () => []) },
  },
}));

vi.mock('../../repositories/index.js', () => ({
  datasetRepository: {
    findById: vi.fn(async (id: string) => (rows.has(id) ? { ...rows.get(id) } : null)),
    update: vi.fn(async (id: string, input: Record<string, unknown>) => {
      const row = rows.get(id);
      if (!row) return null;
      const next = { ...row };
      for (const [k, v] of Object.entries(input)) if (v !== undefined) next[k] = v;
      rows.set(id, next);
      return { ...next };
    }),
  },
  robotTypeRepository: {
    findById: vi.fn(async (id: string) => (types.has(id) ? { ...types.get(id) } : null)),
    findByName: vi.fn(async (name: string) => [...types.values()].find((t) => t.name === name) ?? null),
    create: vi.fn(async (input: Record<string, unknown>) => {
      const created = { id: `rt-${types.size + 1}`, ...input };
      types.set(created.id, created);
      return { ...created };
    }),
    update: rtUpdate,
  },
  skillDefinitionRepository: { findById: vi.fn(async () => null) },
}));

vi.mock('../ComplianceLogService.js', () => ({
  complianceLogService: {
    getOrCreateSession: vi.fn(() => ({ sessionId: 'audit-session' })),
    logAccess,
  },
}));

vi.mock('../../storage/model-storage.js', () => ({
  BUCKETS: { TRAINING_DATASETS: 'training-datasets' },
  modelStorage: { deleteDataset },
}));

vi.mock('../../storage/rustfs-client.js', () => ({
  isRustFSInitialized: vi.fn(() => false),
  getRustFSClient: vi.fn(() => null),
}));

vi.mock('../../messaging/index.js', () => ({
  natsClient: { isConnected: vi.fn(() => false), getKV: vi.fn(), getJetStream: vi.fn(() => null) },
}));

vi.mock('../../messaging/kv-stores.js', () => ({
  KV_STORE_NAMES: { JOB_PROGRESS: 'JOB_PROGRESS' },
  kvGet: vi.fn(),
  kvPut: vi.fn(),
}));

import { DatasetService, DatasetExpectationError } from '../DatasetService.js';

// ---------------------------------------------------------------------------
// A 43-wide G1 dataset on disk (v2.1 layout, no cameras)
// ---------------------------------------------------------------------------

const WIDTH = 43;
const EPISODES = [8, 9];
let root: string;
let datasetDir: string;

async function writeEpisode(path: string, length: number, offset: number): Promise<void> {
  const writer = await ParquetWriter.openFile(new ParquetSchema({
    'observation.state': ParquetFieldBuilder.createListField('FLOAT', false),
    action: ParquetFieldBuilder.createListField('FLOAT', false),
    timestamp: { type: 'FLOAT' },
    frame_index: { type: 'INT64' },
    episode_index: { type: 'INT64' },
    index: { type: 'INT64' },
    task_index: { type: 'INT64' },
  } as ConstructorParameters<typeof ParquetSchema>[0]), path);
  const vec = (f: number) => ({ list: Array.from({ length: WIDTH }, (_, j) => ({ element: Math.sin(f + j) })) });
  for (let f = 0; f < length; f++) {
    await writer.appendRow({
      'observation.state': vec(f),
      action: vec(f + 1),
      timestamp: f / 10,
      frame_index: f,
      episode_index: offset === 0 ? 0 : 1,
      index: offset + f,
      task_index: 0,
    });
  }
  await writer.close();
}

async function g1Fixture(): Promise<string> {
  const dir = join(root, 'apple-to-plate');
  await mkdir(join(dir, 'meta'), { recursive: true });
  await mkdir(join(dir, 'data', 'chunk-000'), { recursive: true });
  const scalar = (dtype: string) => ({ dtype, shape: [1], names: null });
  const info = {
    codebase_version: 'v2.1',
    robot_type: 'unitree_g1',
    fps: 10,
    total_episodes: EPISODES.length,
    total_frames: EPISODES.reduce((a, b) => a + b, 0),
    total_chunks: 1,
    chunks_size: 1000,
    data_path: 'data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet',
    video_path: null,
    features: {
      'observation.state': { dtype: 'float32', shape: [WIDTH], names: null },
      action: { dtype: 'float32', shape: [WIDTH], names: null },
      timestamp: scalar('float32'),
      frame_index: scalar('int64'),
      episode_index: scalar('int64'),
      index: scalar('int64'),
      task_index: scalar('int64'),
    },
  };
  await writeFile(join(dir, 'meta', 'info.json'), JSON.stringify(info));
  let offset = 0;
  for (let ep = 0; ep < EPISODES.length; ep++) {
    await writeEpisode(join(dir, 'data', 'chunk-000', `episode_${String(ep).padStart(6, '0')}.parquet`), EPISODES[ep]!, offset);
    offset += EPISODES[ep]!;
  }
  const lines = EPISODES.map((length, ep) => JSON.stringify({ episode_index: ep, tasks: ['pick'], length }));
  await writeFile(join(dir, 'meta', 'episodes.jsonl'), `${lines.join('\n')}\n`);
  return dir;
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'reassociate-'));
  datasetDir = await g1Fixture();
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------

const service = DatasetService.getInstance();
const DATASET = 'ds-apple-to-plate';
const SHARED_G1 = { id: 'rt-g1-28', name: 'Unitree_G1', manufacturer: 'Unitree', model: 'Unitree_G1', actionDim: 28, proprioceptionDim: 28 };
const SO101 = { id: 'rt-so101', name: 'SO-101 Follower', manufacturer: 'TheRobotStudio', model: 'so101', actionDim: 6, proprioceptionDim: 6 };

let fetchSpy: ReturnType<typeof vi.spyOn>;

/** Wait for the detached revalidation to write its verdict. */
async function settled(): Promise<Record<string, unknown>> {
  await vi.waitFor(() => {
    expect(service.isValidating(DATASET)).toBe(false);
    expect(rows.get(DATASET)!.status).not.toBe('validating');
  }, { timeout: 5000, interval: 20 });
  return rows.get(DATASET)!;
}

function codes(row: Record<string, unknown>): string[] {
  const report = (row.validation as { report?: { errors: { code: string }[] } } | undefined)?.report;
  return (report?.errors ?? []).map((e) => e.code);
}

beforeEach(async () => {
  rows.clear();
  types.clear();
  types.set(SHARED_G1.id, { ...SHARED_G1 });
  types.set(SO101.id, { ...SO101 });
  rows.set(DATASET, {
    id: DATASET,
    name: 'GR00T-N1.7-AppleToPlate',
    robotTypeId: SHARED_G1.id,
    storagePath: datasetDir,
    status: 'validating',
    huggingFaceRepoId: 'nvidia/GR00T-N1.7-AppleToPlate',
    sourceRevision: 'd89c126a713c6632432a607c12661546ff4d6ea9',
    importMode: 'metadata',
    infoJson: {},
    statsJson: {},
  });
  fetchSpy = vi.spyOn(globalThis, 'fetch');
  logAccess.mockClear();
  deleteDataset.mockClear();
  rtUpdate.mockClear();
  // The import's own validation pass, against the wrong (28-wide) type.
  await service.validateAndUpdateDataset(DATASET, datasetDir);
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe('reassociating a dataset with another robot type (TASK-353)', () => {
  it('fails on the 28-wide type, then passes on an explicit 43-wide configuration without downloading', async () => {
    const before = rows.get(DATASET)!;
    expect(before.status).toBe('failed');
    expect(codes(before)).toEqual(expect.arrayContaining(['ROBOT_STATE_DIM_MISMATCH', 'ROBOT_ACTION_DIM_MISMATCH']));

    const g1Edu = await service.createRobotConfiguration(
      { name: 'Unitree G1 EDU (Dex3-1)', manufacturer: 'Unitree', model: 'unitree_g1_edu_dex3', actionDim: 43, proprioceptionDim: 43 },
      'operator-1',
    );

    const result = await service.reassociateRobotType(DATASET, g1Edu.id, { actorId: 'operator-1', reason: 'Intended 43-DOF config' });
    expect(result.change).toMatchObject({ fromRobotTypeId: SHARED_G1.id, toRobotTypeId: g1Edu.id, previousStatus: 'failed', previousValid: false });
    expect(result.revalidation).toBe('started');

    const after = await settled();
    expect(after.status).toBe('ready');
    expect(after.robotTypeId).toBe(g1Edu.id);
    expect(codes(after)).toEqual([]);

    // The data and its provenance are untouched; nothing was fetched or deleted.
    expect(after.storagePath).toBe(datasetDir);
    expect(after.sourceRevision).toBe('d89c126a713c6632432a607c12661546ff4d6ea9');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(deleteDataset).not.toHaveBeenCalled();

    // The change survives the new verdict, and the response says observed vs expected.
    const response = (await service.get(DATASET))!;
    expect(response.expectations?.invalidated).toBeNull();
    expect(response.expectations?.history).toHaveLength(1);
    expect(response.validation).toMatchObject({ valid: true, observedStateWidth: 43, observedActionWidth: 43 });
    expect(response.robotType).toMatchObject({ actionDim: 43, proprioceptionDim: 43 });

    // Audited: the new type and the change.
    const actions = logAccess.mock.calls.map((c) => (c as unknown as [{ payload: { action: string } }])[0].payload.action);
    expect(actions).toEqual(expect.arrayContaining(['robot-type.create', 'dataset.robot-type.change']));
  });

  it('still fails when reassociated with an incompatible type, and never mutates a shared type', async () => {
    await service.reassociateRobotType(DATASET, SO101.id);
    const after = await settled();
    expect(after.status).toBe('failed');
    expect(codes(after)).toEqual(expect.arrayContaining(['ROBOT_STATE_DIM_MISMATCH', 'ROBOT_ACTION_DIM_MISMATCH']));
    expect(types.get(SHARED_G1.id)).toEqual(SHARED_G1);
    expect(types.get(SO101.id)).toEqual(SO101);
    expect(rtUpdate).not.toHaveBeenCalled();
  });

  it('voids the old verdict the moment the expectation changes', async () => {
    const g1Edu = await service.createRobotConfiguration({ name: 'G1 43', actionDim: 43, proprioceptionDim: 43 });
    // Hold the detached pass so the in-between state can be observed.
    const spy = vi.spyOn(service, 'requestValidation').mockResolvedValueOnce('started');
    await service.reassociateRobotType(DATASET, g1Edu.id);
    expect(rows.get(DATASET)!.status).toBe('validating');
    const response = (await service.get(DATASET))!;
    expect(response.validation).toBeUndefined();
    expect(response.expectations?.invalidated?.toRobotTypeId).toBe(g1Edu.id);
    spy.mockRestore();
    rows.set(DATASET, { ...rows.get(DATASET)!, status: 'failed' });
  });

  it('refuses with 409 while a validation is in flight or an import is running', async () => {
    const g1Edu = await service.createRobotConfiguration({ name: 'G1 43b', actionDim: 43, proprioceptionDim: 43 });
    await service.requestValidation(DATASET, datasetDir);
    await expect(service.reassociateRobotType(DATASET, g1Edu.id)).rejects.toMatchObject({ status: 409, code: 'VALIDATION_IN_FLIGHT' });
    await settled();

    rows.set(DATASET, { ...rows.get(DATASET)!, status: 'importing' });
    const refused = service.reassociateRobotType(DATASET, g1Edu.id);
    await expect(refused).rejects.toBeInstanceOf(DatasetExpectationError);
    await expect(refused).rejects.toMatchObject({ status: 409, code: 'DATASET_BUSY' });
    expect(rows.get(DATASET)!.robotTypeId).toBe(SHARED_G1.id);
  });

  it('creates robot types only: a taken name is a 409, not an update', async () => {
    await expect(service.createRobotConfiguration({ name: 'Unitree_G1', actionDim: 43, proprioceptionDim: 43 }))
      .rejects.toMatchObject({ status: 409, code: 'ROBOT_TYPE_EXISTS' });
    await expect(service.createRobotConfiguration({ name: 'Bad', actionDim: 0, proprioceptionDim: 43 }))
      .rejects.toMatchObject({ status: 400 });
    expect(types.get(SHARED_G1.id)).toEqual(SHARED_G1);
    expect(rtUpdate).not.toHaveBeenCalled();
  });
});
