/**
 * @file TrainingRunExportService.test.ts
 * @description The run manifest: scheme-tagged dataset URIs, the non-portable
 *              warning that is the point of the document, normalised weights,
 *              an image tag that is never invented, and — asserted on the
 *              serialised bytes — no secrets.
 * @feature training
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../database/index.js', () => ({
  prisma: {
    trainingJobDataset: { findMany: vi.fn() },
    dataset: { findUnique: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock('../../repositories/index.js', () => ({
  trainingJobRepository: { findById: vi.fn() },
  datasetRepository: { findById: vi.fn() },
  simSceneRepository: { findById: vi.fn() },
}));

import {
  trainingRunExportService,
  TRAINER_IMAGE_PLACEHOLDER,
  resolveDatasetUri,
} from '../TrainingRunExportService.js';
import { prisma as _prisma } from '../../database/index.js';
import { trainingJobRepository as _trainingJobRepository } from '../../repositories/index.js';

const prisma = _prisma as unknown as {
  trainingJobDataset: { findMany: ReturnType<typeof vi.fn> };
  dataset: { findUnique: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
};
const trainingJobRepository = vi.mocked(_trainingJobRepository, true);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function datasetRow(over: Record<string, unknown> = {}) {
  return {
    id: 'ds-groot',
    name: 'GR00T-N1.7-AppleToPlate',
    status: 'ready',
    fps: 30,
    lerobotVersion: 'v2.1',
    robotTypeId: 'rt-g1',
    storagePath: '7eb3aa57-5b35-4c90-9b1e-67b335236b7a/',
    huggingFaceRepoId: 'nvidia/GR00T-N1.7-AppleToPlate',
    sourceRevision: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    infoJson: JSON.stringify({
      robot_type: 'unitree_g1',
      license: 'cc-by-4.0',
      features: {
        'observation.state': { dtype: 'float32', shape: [43] },
        action: { dtype: 'float32', shape: [43] },
        'observation.images.ego_view': { dtype: 'video', shape: [3, 480, 640] },
      },
    }),
    validationJson: null,
    totalFrames: 171625,
    demonstrationCount: 402,
    ...over,
  };
}

function job(over: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    kind: 'supervised',
    datasetId: 'ds-groot',
    baseModel: 'groot_n1_7',
    fineTuneMethod: 'lora',
    sceneId: null,
    twinId: null,
    hyperparameters: { learning_rate: 1e-4, batch_size: 32, epochs: 100 },
    gpuRequirements: { count: 2, memory: 80, type: 'H100' },
    status: 'pending',
    progress: 0,
    metrics: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  prisma.trainingJobDataset.findMany.mockResolvedValue([]);
  trainingJobRepository.findById.mockResolvedValue(job() as never);
  prisma.dataset.findUnique.mockResolvedValue(datasetRow());
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

// ===========================================================================
// URIs
// ===========================================================================

describe('dataset URIs', () => {
  it('prefers hf://repo@sha — the one locator a cluster elsewhere can resolve', () => {
    expect(resolveDatasetUri(datasetRow() as never)).toEqual({
      uri: 'hf://nvidia/GR00T-N1.7-AppleToPlate@a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      portable: true,
      warning: null,
    });
  });

  it('never invents a revision for an unpinned repo, and says it is unpinned', () => {
    const resolved = resolveDatasetUri(datasetRow({ sourceRevision: null }) as never);
    expect(resolved.uri).toBe('hf://nvidia/GR00T-N1.7-AppleToPlate');
    expect(resolved.uri).not.toContain('main');
    expect(resolved.warning).toMatch(/no resolved commit/i);
  });

  it('tags a RustFS prefix as s3:// under the datasets bucket', () => {
    const resolved = resolveDatasetUri(
      datasetRow({ huggingFaceRepoId: null, sourceRevision: null }) as never,
    );
    expect(resolved.uri).toBe('s3://training-datasets/7eb3aa57-5b35-4c90-9b1e-67b335236b7a/');
    expect(resolved.portable).toBe(true);
  });

  it('tags an absolute path as file:// and marks it NOT portable', () => {
    const resolved = resolveDatasetUri(
      datasetRow({
        huggingFaceRepoId: null,
        sourceRevision: null,
        storagePath: '/Users/sebastian/develop/emai/robot-management-system/robot-agent/data/ds',
      }) as never,
    );
    expect(resolved.uri).toBe(
      'file:///Users/sebastian/develop/emai/robot-management-system/robot-agent/data/ds',
    );
    expect(resolved.portable).toBe(false);
    // The warning has to name the actual failure, not hedge about it.
    expect(resolved.warning).toMatch(/CANNOT read it/);
  });
});

// ===========================================================================
// The manifest
// ===========================================================================

describe('buildManifest', () => {
  it('returns null for a job that does not exist', async () => {
    trainingJobRepository.findById.mockResolvedValue(null as never);
    expect(await trainingRunExportService.buildManifest('nope')).toBeNull();
  });

  it('synthesises a single member for a job that predates mixtures', async () => {
    const manifest = await trainingRunExportService.buildManifest('job-1');
    expect(manifest?.datasets).toHaveLength(1);
    expect(manifest?.datasets[0]).toMatchObject({
      datasetId: 'ds-groot',
      weight: 1,
      normalizedWeight: 1,
      license: 'cc-by-4.0',
      robotType: 'unitree_g1',
      totalEpisodes: 402,
      totalFrames: 171625,
      cameraKeys: ['observation.images.ego_view'],
    });
  });

  it('normalises weights to sum to 1 while keeping what the operator typed', async () => {
    prisma.trainingJobDataset.findMany.mockResolvedValue([
      { weight: 3, position: 0, dataset: datasetRow() },
      { weight: 1, position: 1, dataset: datasetRow({ id: 'ds-dex3', name: 'Dex3' }) },
    ]);
    const manifest = await trainingRunExportService.buildManifest('job-1');
    expect(manifest?.datasets.map((d) => d.weight)).toEqual([3, 1]);
    expect(manifest?.datasets.map((d) => d.normalizedWeight)).toEqual([0.75, 0.25]);
    expect(
      manifest!.datasets.reduce((sum, d) => sum + d.normalizedWeight, 0),
    ).toBeCloseTo(1, 10);
  });

  it('falls back to equal shares — loudly — when the weights sum to zero', async () => {
    prisma.trainingJobDataset.findMany.mockResolvedValue([
      { weight: 0, position: 0, dataset: datasetRow() },
      { weight: 0, position: 1, dataset: datasetRow({ id: 'ds-dex3', name: 'Dex3' }) },
    ]);
    const manifest = await trainingRunExportService.buildManifest('job-1');
    expect(manifest?.datasets.map((d) => d.normalizedWeight)).toEqual([0.5, 0.5]);
    expect(manifest?.warnings.some((w) => /sum to zero/.test(w))).toBe(true);
  });

  it('warns about every non-portable member by name', async () => {
    prisma.dataset.findUnique.mockResolvedValue(
      datasetRow({
        huggingFaceRepoId: null,
        sourceRevision: null,
        storagePath: '/Users/sebastian/data/ds',
      }),
    );
    const manifest = await trainingRunExportService.buildManifest('job-1');
    expect(manifest?.datasets[0].portable).toBe(false);
    expect(
      manifest?.warnings.some((w) => w.includes('GR00T-N1.7-AppleToPlate') && w.includes('CANNOT')),
    ).toBe(true);
  });

  it('carries the compatibility report and the job facts', async () => {
    const manifest = await trainingRunExportService.buildManifest('job-1');
    expect(manifest?.schemaVersion).toBe('neodem.training.run/v1');
    expect(manifest?.runId).toBe('job-1');
    expect(manifest?.job).toEqual({
      kind: 'supervised',
      baseModel: 'groot_n1_7',
      fineTuneMethod: 'lora',
      status: 'pending',
    });
    expect(manifest?.gpu).toEqual({ count: 2, memory: 80, type: 'H100' });
    expect(manifest?.compatibility.verdict).toBe('identical');
  });

  it('uses TRAINER_IMAGE when it is set', async () => {
    process.env.TRAINER_IMAGE = 'registry.internal/neodem-trainer@sha256:abc';
    const manifest = await trainingRunExportService.buildManifest('job-1');
    expect(manifest?.runtime.image).toBe('registry.internal/neodem-trainer@sha256:abc');
    expect(manifest?.warnings.some((w) => w.includes('TRAINER_IMAGE'))).toBe(false);
  });

  it('emits an obvious hole rather than a plausible tag when TRAINER_IMAGE is unset', async () => {
    delete process.env.TRAINER_IMAGE;
    const manifest = await trainingRunExportService.buildManifest('job-1');
    expect(manifest?.runtime.image).toBe(TRAINER_IMAGE_PLACEHOLDER);
    // A wrong tag that looks right is worse than a hole: assert it does not
    // look like one.
    expect(manifest?.runtime.image).not.toMatch(/^[a-z0-9./-]+:[a-z0-9.-]+$/);
    expect(manifest?.warnings.some((w) => w.includes('TRAINER_IMAGE'))).toBe(true);
  });

  it('makes no residency claim, and says why', async () => {
    const manifest = await trainingRunExportService.buildManifest('job-1');
    expect(manifest?.compliance.residency).toBeNull();
    expect(manifest?.compliance.notes.some((n) => /residency is null/.test(n))).toBe(true);
  });

  it('carries each dataset license forward and flags the unknown ones', async () => {
    prisma.trainingJobDataset.findMany.mockResolvedValue([
      { weight: 1, position: 0, dataset: datasetRow() },
      { weight: 1, position: 1, dataset: datasetRow({ id: 'ds-x', name: 'X', infoJson: '{}' }) },
    ]);
    const manifest = await trainingRunExportService.buildManifest('job-1');
    expect(manifest?.compliance.datasetLicenses).toEqual(['cc-by-4.0', 'unknown']);
    expect(manifest?.compliance.notes.some((n) => /no license on record/.test(n))).toBe(true);
  });

  it('reports the job with no dataset left rather than throwing', async () => {
    prisma.dataset.findUnique.mockResolvedValue(null);
    const manifest = await trainingRunExportService.buildManifest('job-1');
    expect(manifest?.datasets).toEqual([]);
    expect(manifest?.compatibility.verdict).toBe('incompatible');
    expect(manifest?.warnings.some((w) => /names no dataset/.test(w))).toBe(true);
  });
});

// ===========================================================================
// The one thing a shareable document must never contain
// ===========================================================================

describe('secrets', () => {
  it('leaks no token, key or presigned URL into the serialised manifest', async () => {
    const secrets = {
      WORKER_API_TOKEN: 'worker-token-SHOULD-NEVER-APPEAR',
      HF_TOKEN: 'hf_SHOULDNEVERAPPEAR',
      HUGGINGFACE_TOKEN: 'hf_ALSO_SHOULD_NEVER_APPEAR',
      RUSTFS_ACCESS_KEY: 'rustfs-access-SHOULD-NEVER-APPEAR',
      RUSTFS_SECRET_KEY: 'rustfs-secret-SHOULD-NEVER-APPEAR',
      JWT_SECRET: 'jwt-SHOULD-NEVER-APPEAR',
      GOOGLE_API_KEY: 'google-SHOULD-NEVER-APPEAR',
      AGENT_MEMORY_TOKEN: 'agent-SHOULD-NEVER-APPEAR',
    };
    Object.assign(process.env, secrets);
    process.env.PUBLIC_BASE_URL = 'https://neodem.example.org';

    prisma.trainingJobDataset.findMany.mockResolvedValue([
      { weight: 2, position: 0, dataset: datasetRow() },
      {
        weight: 1,
        position: 1,
        dataset: datasetRow({
          id: 'ds-local',
          name: 'local one',
          huggingFaceRepoId: null,
          sourceRevision: null,
          storagePath: '/Users/sebastian/data/ds',
        }),
      },
    ]);

    const serialised = JSON.stringify(await trainingRunExportService.buildManifest('job-1'));

    for (const value of Object.values(secrets)) {
      expect(serialised).not.toContain(value);
    }
    // Nor the shape of a presigned URL, which IS a credential.
    expect(serialised).not.toMatch(/X-Amz-Signature|X-Amz-Credential|Signature=/i);
    // The public base URL is not a secret and is supposed to be there.
    expect(serialised).toContain('https://neodem.example.org');
  });
});
