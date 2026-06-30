/**
 * @file synthetic-dataset-validation.test.ts
 * @description Proves a Cosmos 3-generated synthetic LeRobot dataset (TASK-175)
 *              passes the real dataset-validation worker logic
 *              (DatasetService.validateStructure + computeQualityScore).
 *              The fixture under fixtures/cosmos-synthetic-bridge/ is the meta/
 *              produced by scratch/cosmos3/cosmos3_synth.py from forward-dynamics
 *              rollouts on nvidia/Cosmos3-Action-Viewer (bridge / WidowX).
 * @feature datasets
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

describe('TASK-175: Cosmos 3 synthetic dataset passes validation', () => {
  beforeEach(() => {
    // path arg is the absolute on-disk path (storagePath = FIXTURE_ROOT + '/')
    rustfsExists.mockImplementation(async (_bucket: string, p: string) => existsSync(p));
    rustfsDownload.mockImplementation(async (_bucket: string, p: string) => readFileSync(p));
  });

  it('validateStructure() accepts the synthetic LeRobot dataset', async () => {
    const result = await datasetService.validateStructure(`${FIXTURE_ROOT}/`);

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.lerobotVersion).toBe('v2.1');
    expect(result.fps).toBeGreaterThan(0);
    expect(result.episodeCount).toBe(4);
    expect(result.totalFrames).toBe(68);
    // stats.json + episodes.json present -> no warnings about them
    expect(result.warnings).toEqual([]);
  });

  it('computeQualityScore() returns a positive score for the synthetic dataset', async () => {
    const result = await datasetService.validateStructure(`${FIXTURE_ROOT}/`);
    const score = datasetService.computeQualityScore(result);

    expect(score.total).toBeGreaterThan(0);
    expect(score.formatCompliance).toBe(10); // info(4) + stats(3) + valid(3)
  });
});
