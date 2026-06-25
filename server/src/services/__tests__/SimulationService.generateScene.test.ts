/**
 * @file SimulationService.generateScene.test.ts
 * @description Unit tests for SimulationService.generateSceneFromTwin — the
 *   on-demand twin→MJCF scene generator (TASK-171 fidelity follow-up). Asserts
 *   the canonical scene_builder is spawned with the twin's REAL occupancy
 *   floor-plan threaded in (`--occupancy-pgm`), the resulting MJCF is uploaded +
 *   registered as a SimScene, and the AABB-only fallback omits occupancy. All
 *   I/O boundaries (child_process, fs, storage, repositories) are mocked.
 * @feature simulation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'stream';

// Force the mock backend so the singleton constructor doesn't try the real path.
process.env.SIMULATION_BACKEND = 'mock';

const { spawnMock, repoMocks, storageMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  repoMocks: {
    digitalTwinRepository: { findById: vi.fn(), update: vi.fn() },
    twinZoneRepository: { listByTwin: vi.fn() },
    simSceneRepository: { upsertForTwin: vi.fn(), upsertBuiltin: vi.fn(), listAll: vi.fn() },
  },
  storageMock: { getTwinArtifactStream: vi.fn(), uploadTwinArtifact: vi.fn() },
}));

vi.mock('child_process', () => ({ spawn: spawnMock }));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  mkdtempSync: vi.fn((p: string) => `${p}test`),
  readFileSync: vi.fn(() => Buffer.from('<mujoco/>')),
  writeFileSync: vi.fn(),
  createWriteStream: vi.fn(() => ({})),
  rmSync: vi.fn(),
}));

vi.mock('stream/promises', () => ({ pipeline: vi.fn().mockResolvedValue(undefined) }));

vi.mock('../../repositories/SimulationJobRepository.js', () => ({
  simulationJobRepository: {
    markFailedOnBoot: vi.fn().mockResolvedValue(0),
    findAll: vi.fn().mockResolvedValue([]),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    createFrames: vi.fn(),
  },
}));

vi.mock('../../repositories/index.js', () => ({
  digitalTwinRepository: repoMocks.digitalTwinRepository,
  twinZoneRepository: repoMocks.twinZoneRepository,
  simSceneRepository: repoMocks.simSceneRepository,
}));

vi.mock('../../storage/model-storage.js', () => ({ modelStorage: storageMock }));

vi.mock('../SimToRealValidationService.js', () => ({
  simToRealValidationService: { getComparison: vi.fn() },
}));

import { SimulationService } from '../SimulationService.js';

/** A fake ChildProcess whose `close` fires with the given exit code. */
function fakeProc(exitCode = 0) {
  return {
    stderr: null,
    on(event: string, cb: (arg: number) => void) {
      if (event === 'close') setImmediate(() => cb(exitCode));
      return this;
    },
  };
}

const TWIN_READY = {
  id: 'twin-1',
  name: 'Lab',
  resolution: 0.05,
  minX: 0, minY: 0, minZ: 0, maxX: 4, maxY: 3, maxZ: 2.5,
  occupancyPgmKey: 'twin-1/occupancy.pgm',
  occupancyYamlKey: 'twin-1/occupancy.yaml',
};

describe('SimulationService.generateSceneFromTwin', () => {
  let service: SimulationService;

  beforeEach(() => {
    vi.clearAllMocks();
    spawnMock.mockImplementation(() => fakeProc(0));
    storageMock.getTwinArtifactStream.mockResolvedValue(Readable.from(['x']));
    storageMock.uploadTwinArtifact.mockResolvedValue('twin-1/scene.mjcf.xml');
    repoMocks.twinZoneRepository.listByTwin.mockResolvedValue([
      { name: 'bench', type: 'workcell', points: [{ x: 3, y: 2 }, { x: 4, y: 3 }], minZ: 0, maxZ: 2 },
    ]);
    repoMocks.simSceneRepository.upsertForTwin.mockImplementation(async (i: { twinId: string }) => ({
      id: 'scene-1',
      ...i,
    }));
    repoMocks.digitalTwinRepository.update.mockResolvedValue(TWIN_READY);
    service = SimulationService.getInstance();
  });

  it('threads the occupancy floor-plan into the builder and registers the scene', async () => {
    repoMocks.digitalTwinRepository.findById.mockResolvedValue(TWIN_READY);

    const scene = await service.generateSceneFromTwin('twin-1');

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = spawnMock.mock.calls[0] as [string, string[]];
    expect(cmd).toBe('uv');
    expect(args).toContain('generate');
    expect(args).toContain('--occupancy-pgm'); // real scan floor-plan threaded in
    expect(args).toContain('--occupancy-yaml');
    expect(args).toContain('--zones-json');

    // The built MJCF is uploaded and the SimScene registered with that key.
    expect(storageMock.uploadTwinArtifact).toHaveBeenCalledWith(
      'twin-1',
      'scene.mjcf.xml',
      expect.any(Buffer)
    );
    expect(repoMocks.digitalTwinRepository.update).toHaveBeenCalledWith('twin-1', {
      simSceneKey: 'twin-1/scene.mjcf.xml',
      simSceneBackend: 'mujoco',
    });
    expect(repoMocks.simSceneRepository.upsertForTwin).toHaveBeenCalledWith(
      expect.objectContaining({
        twinId: 'twin-1',
        mjcfKey: 'twin-1/scene.mjcf.xml',
        backend: 'mujoco',
      })
    );
    expect((scene as { mjcfKey: string }).mjcfKey).toBe('twin-1/scene.mjcf.xml');
  });

  it('falls back to AABB (no --occupancy-pgm) when the twin has no occupancy grid', async () => {
    repoMocks.digitalTwinRepository.findById.mockResolvedValue({
      ...TWIN_READY,
      occupancyPgmKey: null,
      occupancyYamlKey: null,
    });

    await service.generateSceneFromTwin('twin-1');

    const [, args] = spawnMock.mock.calls[0] as [string, string[]];
    expect(args).not.toContain('--occupancy-pgm');
    expect(storageMock.getTwinArtifactStream).not.toHaveBeenCalled();
  });

  it('throws for an unknown twin', async () => {
    repoMocks.digitalTwinRepository.findById.mockResolvedValue(null);
    await expect(service.generateSceneFromTwin('nope')).rejects.toThrow('Unknown twin');
  });

  it('throws when the twin has no usable bounds', async () => {
    repoMocks.digitalTwinRepository.findById.mockResolvedValue({ ...TWIN_READY, minX: 0, maxX: 0 });
    await expect(service.generateSceneFromTwin('twin-1')).rejects.toThrow('no usable bounds');
  });

  it('surfaces a builder failure (non-zero exit) as an error', async () => {
    repoMocks.digitalTwinRepository.findById.mockResolvedValue(TWIN_READY);
    spawnMock.mockImplementation(() => fakeProc(1));
    await expect(service.generateSceneFromTwin('twin-1')).rejects.toThrow();
  });
});
