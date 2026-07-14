/**
 * @file CosmosSyntheticService.modes.test.ts
 * @description Unit tests for the TASK-182 generator-mode wiring in
 *              CosmosSyntheticService: mode config map, pure python-argv
 *              builders, per-mode validation in generate(), and getConfig()
 *              mode list. Plus an end-to-end smoke (skipped when the Windows
 *              venv is absent): run the real `python -m neural_traj` mock
 *              backend and prove the produced dataset passes the real
 *              DatasetService.validateStructure contract.
 * @feature training
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CURATION_DIR = join(__dirname, '..', '..', '..', 'curation');
const VENV_PYTHON = join(CURATION_DIR, '.venv-win', 'Scripts', 'python.exe');

// Storage shim (same pattern as synthetic-dataset-validation.test.ts): make
// validateStructure()'s exists/download resolve against the real filesystem.
const { rustfsExists, rustfsDownload } = vi.hoisted(() => ({
  rustfsExists: vi.fn(),
  rustfsDownload: vi.fn(),
}));

vi.mock('../../repositories/index.js', () => ({
  datasetRepository: { create: vi.fn(), findById: vi.fn(), findAll: vi.fn(), update: vi.fn(), delete: vi.fn() },
  robotTypeRepository: { findById: vi.fn(), findByName: vi.fn(), create: vi.fn() },
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

import {
  MODE_CONFIGS,
  buildConvertArgs,
  buildGenerateArgs,
  cosmosSyntheticService,
  neuralTrajBackend,
  ServiceError,
  type SyntheticGeneratorMode,
} from '../CosmosSyntheticService.js';
import { datasetService } from '../DatasetService.js';

describe('TASK-182: generator mode configs', () => {
  it('exposes both modes with the expected shape', () => {
    expect(Object.keys(MODE_CONFIGS).sort()).toEqual(['forward-dynamics', 'neural-trajectory']);

    const fd = MODE_CONFIGS['forward-dynamics'];
    expect(fd.datasetSubdir).toBe('lerobot_cosmos_bridge');
    expect(fd.maxEpisodes).toBe(8);
    expect(fd.embodiment).toBe('widowx_bridge');
    expect(fd.requiresToken).toBe(true);
    expect(fd.entry).toHaveLength(1);
    expect(fd.entry[0]).toMatch(/cosmos3_synth\.py$/);

    const nt = MODE_CONFIGS['neural-trajectory'];
    expect(nt.datasetSubdir).toBe('lerobot_neural_g1');
    expect(nt.maxEpisodes).toBe(50);
    expect(nt.embodiment).toBe('Unitree_G1_Dex3');
    expect(nt.requiresToken).toBe(false);
    expect(nt.entry).toEqual(['-m', 'neural_traj']);
    expect(nt.robotType.actionDim).toBe(28); // 14 arm + 14 hand joints
  });
});

describe('TASK-182: buildGenerateArgs / buildConvertArgs', () => {
  it('forward-dynamics: script path, --out, no --backend', () => {
    const args = buildGenerateArgs('forward-dynamics', { jobDir: '/tmp/j1', episodes: 3 });
    expect(args[0]).toMatch(/cosmos3_synth\.py$/);
    expect(args.slice(1)).toEqual(['--out', '/tmp/j1', 'generate', '--episodes', '3']);
    expect(args).not.toContain('--backend');
  });

  it('forward-dynamics: appends --prompt when given', () => {
    const args = buildGenerateArgs('forward-dynamics', {
      jobDir: '/tmp/j1',
      episodes: 2,
      prompt: 'pick up the cube',
    });
    expect(args.slice(-2)).toEqual(['--prompt', 'pick up the cube']);
  });

  it('neural-trajectory: -m neural_traj with --backend before the subcommand', () => {
    const args = buildGenerateArgs('neural-trajectory', {
      jobDir: '/tmp/j2',
      episodes: 5,
      backend: 'mock',
    });
    expect(args).toEqual([
      '-m', 'neural_traj',
      '--out', '/tmp/j2',
      '--backend', 'mock',
      'generate', '--episodes', '5',
    ]);
  });

  it('neural-trajectory: backend defaults from NEURAL_TRAJ_BACKEND env', () => {
    const prev = process.env.NEURAL_TRAJ_BACKEND;
    try {
      delete process.env.NEURAL_TRAJ_BACKEND;
      expect(neuralTrajBackend()).toBe('mock');
      process.env.NEURAL_TRAJ_BACKEND = 'wsl';
      expect(neuralTrajBackend()).toBe('wsl');
      const args = buildGenerateArgs('neural-trajectory', { jobDir: '/tmp/j3', episodes: 1 });
      expect(args).toContain('wsl');
    } finally {
      if (prev === undefined) delete process.env.NEURAL_TRAJ_BACKEND;
      else process.env.NEURAL_TRAJ_BACKEND = prev;
    }
  });

  it('convert args mirror the mode entry + --out', () => {
    expect(buildConvertArgs('neural-trajectory', { jobDir: '/tmp/j4', backend: 'mock' })).toEqual([
      '-m', 'neural_traj', '--out', '/tmp/j4', '--backend', 'mock', 'convert',
    ]);
    const fd = buildConvertArgs('forward-dynamics', { jobDir: '/tmp/j4' });
    expect(fd[0]).toMatch(/cosmos3_synth\.py$/);
    expect(fd.slice(1)).toEqual(['--out', '/tmp/j4', 'convert']);
  });
});

describe('TASK-182: generate() validation', () => {
  it('rejects an unknown mode with ServiceError code invalid', () => {
    expect(() =>
      cosmosSyntheticService.generate({
        episodes: 2,
        mode: 'time-travel' as SyntheticGeneratorMode,
      }),
    ).toThrowError(ServiceError);
    try {
      cosmosSyntheticService.generate({ episodes: 2, mode: 'time-travel' as SyntheticGeneratorMode });
    } catch (err) {
      expect((err as ServiceError).code).toBe('invalid');
      expect((err as ServiceError).message).toContain('time-travel');
    }
  });

  it('enforces the per-mode episode maximum (neural-trajectory: 50)', () => {
    try {
      cosmosSyntheticService.generate({ episodes: 51, mode: 'neural-trajectory' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ServiceError);
      expect((err as ServiceError).code).toBe('invalid');
      expect((err as ServiceError).message).toContain('50');
    }
  });

  it('enforces the per-mode episode maximum (forward-dynamics: 8)', () => {
    try {
      cosmosSyntheticService.generate({ episodes: 9, mode: 'forward-dynamics' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ServiceError);
      expect((err as ServiceError).code).toBe('invalid');
      expect((err as ServiceError).message).toContain('8');
    }
  });
});

describe('TASK-182: getConfig() mode list', () => {
  it('adds a modes array while keeping the legacy top-level fields', () => {
    const cfg = cosmosSyntheticService.getConfig();

    // Legacy fields untouched (backward compat).
    expect(cfg.embodiment).toBe('widowx_bridge');
    expect(cfg.maxEpisodes).toBe(8);
    expect(typeof cfg.available).toBe('boolean');
    expect(typeof cfg.hasToken).toBe('boolean');

    expect(cfg.modes).toHaveLength(2);
    const ids = cfg.modes.map((m) => m.id);
    expect(ids).toEqual(['forward-dynamics', 'neural-trajectory']);
    for (const m of cfg.modes) {
      expect(m.label).toBeTruthy();
      expect(typeof m.available).toBe('boolean');
      expect(typeof m.requiresToken).toBe('boolean');
      expect(typeof m.hasToken).toBe('boolean');
      expect(m.maxEpisodes).toBeGreaterThan(0);
    }
    const nt = cfg.modes.find((m) => m.id === 'neural-trajectory')!;
    expect(nt.embodiment).toBe('Unitree_G1_Dex3');
    expect(nt.requiresToken).toBe(false);
    // The package ships with the repo, so it must be reported available.
    expect(nt.available).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// End-to-end smoke: real mock-backend run -> validateStructure PASS.
// Skipped gracefully when the curation Windows venv is not installed.
// ---------------------------------------------------------------------------

const hasVenv = existsSync(VENV_PYTHON);

describe.skipIf(!hasVenv)('TASK-182: mock pipeline output passes validateStructure', () => {
  beforeEach(() => {
    rustfsExists.mockImplementation(async (_bucket: string, p: string) => existsSync(p));
    rustfsDownload.mockImplementation(async (_bucket: string, p: string) => readFileSync(p));
  });

  it(
    'generate(2) + convert produce a valid LeRobot v2.1 G1 dataset',
    { timeout: 120_000 },
    async () => {
      const outRoot = mkdtempSync(join(tmpdir(), 'nt-vitest-'));
      try {
        execFileSync(
          VENV_PYTHON,
          ['-m', 'neural_traj', '--out', outRoot, '--backend', 'mock', 'generate', '--episodes', '2'],
          { cwd: CURATION_DIR, timeout: 90_000 },
        );
        execFileSync(
          VENV_PYTHON,
          ['-m', 'neural_traj', '--out', outRoot, 'convert'],
          { cwd: CURATION_DIR, timeout: 90_000 },
        );

        const datasetDir = join(outRoot, 'lerobot_neural_g1').replace(/\\/g, '/');
        const result = await datasetService.validateStructure(`${datasetDir}/`);

        expect(result.errors).toEqual([]);
        expect(result.valid).toBe(true);
        expect(result.lerobotVersion).toBe('v2.1');
        expect(result.fps).toBe(30);
        expect(result.episodeCount).toBe(2);
        expect(result.totalFrames).toBe(90); // 2 x 45 mock frames
        expect(result.warnings).toEqual([]); // stats.json + episodes.json present

        const info = result.info as unknown as Record<string, unknown>;
        expect(info.robot_type).toBe('Unitree_G1_Dex3');
        expect(info._synthetic).toBe(true);
        expect(info._generator).toBe('GR00T-Dreams/Cosmos-Predict2-2B neural-trajectory (mock)');
        expect(info._provenance).toMatchObject({ backend: 'mock' });

        const score = datasetService.computeQualityScore(result);
        expect(score.formatCompliance).toBe(10);
      } finally {
        rmSync(outRoot, { recursive: true, force: true });
      }
    },
  );
});
