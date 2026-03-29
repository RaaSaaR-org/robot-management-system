/**
 * @file HuggingFaceImportService.test.ts
 * @description Unit tests for HuggingFace dataset import service
 * @feature datasets
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before importing the service
vi.mock('../../repositories/index.js', () => ({
  datasetRepository: {
    create: vi.fn().mockResolvedValue({ id: 'test-dataset-id' }),
    update: vi.fn().mockResolvedValue({}),
    findById: vi.fn().mockResolvedValue(null),
  },
  robotTypeRepository: {
    findById: vi.fn().mockResolvedValue({ id: 'rt-1', name: 'SO-101', manufacturer: 'Lerobot', model: 'so100' }),
  },
}));

vi.mock('../../storage/rustfs-client.js', () => ({
  getRustFSClient: vi.fn().mockReturnValue({
    upload: vi.fn().mockResolvedValue(undefined),
  }),
  isRustFSInitialized: vi.fn().mockReturnValue(true),
}));

vi.mock('../../storage/model-storage.js', () => ({
  BUCKETS: { TRAINING_DATASETS: 'training-datasets' },
}));

vi.mock('../../messaging/index.js', () => ({
  natsClient: {
    isConnected: vi.fn().mockReturnValue(false),
    getJetStream: vi.fn().mockReturnValue(null),
  },
}));

vi.mock('../DatasetService.js', () => ({
  datasetService: {
    emit: vi.fn(),
    validateAndUpdateDataset: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('test-dataset-id'),
}));

import { HuggingFaceImportService } from '../HuggingFaceImportService.js';
import type { LeRobotInfoV3 } from '../../types/dataset.types.js';

// ============================================================================
// TEST DATA
// ============================================================================

const SAMPLE_INFO_JSON: LeRobotInfoV3 = {
  codebase_version: 'v2.1',
  robot_type: 'so100_follower',
  fps: 30,
  features: {
    'observation.images.top': { dtype: 'video', shape: [480, 640, 3], video: true },
    'observation.state': { dtype: 'float32', shape: [6] },
    action: { dtype: 'float32', shape: [6] },
  },
  total_episodes: 50,
  total_frames: 11900,
  total_chunks: 1,
  chunks_size: 1000,
  total_tasks: 1,
};

// ============================================================================
// TESTS
// ============================================================================

describe('HuggingFaceImportService', () => {
  let service: HuggingFaceImportService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = HuggingFaceImportService.getInstance();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // INFO.JSON PARSING
  // --------------------------------------------------------------------------

  describe('fetchInfoJson', () => {
    it('parses valid LeRobot v2.1 info.json', async () => {
      const mockResponse = new Response(JSON.stringify(SAMPLE_INFO_JSON), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

      const info = await service.fetchInfoJson('lerobot/svla_so101_pickplace', 'main');

      expect(info.codebase_version).toBe('v2.1');
      expect(info.robot_type).toBe('so100_follower');
      expect(info.fps).toBe(30);
      expect(info.total_episodes).toBe(50);
      expect(info.total_frames).toBe(11900);
    });

    it('throws on missing codebase_version', async () => {
      const badInfo = { ...SAMPLE_INFO_JSON, codebase_version: '' };
      const mockResponse = new Response(JSON.stringify(badInfo), { status: 200 });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

      await expect(
        service.fetchInfoJson('bad/repo', 'main')
      ).rejects.toThrow('codebase_version');
    });

    it('throws on missing robot_type', async () => {
      const badInfo = { ...SAMPLE_INFO_JSON, robot_type: '' };
      const mockResponse = new Response(JSON.stringify(badInfo), { status: 200 });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

      await expect(
        service.fetchInfoJson('bad/repo', 'main')
      ).rejects.toThrow('robot_type');
    });

    it('throws on invalid fps', async () => {
      const badInfo = { ...SAMPLE_INFO_JSON, fps: 0 };
      const mockResponse = new Response(JSON.stringify(badInfo), { status: 200 });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

      await expect(
        service.fetchInfoJson('bad/repo', 'main')
      ).rejects.toThrow('fps');
    });

    it('throws on 404 response', async () => {
      const mockResponse = new Response('Not Found', { status: 404, statusText: 'Not Found' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

      await expect(
        service.fetchInfoJson('nonexistent/repo', 'main')
      ).rejects.toThrow('404');
    });
  });

  // --------------------------------------------------------------------------
  // FILE LIST BUILDING
  // --------------------------------------------------------------------------

  describe('buildFileList', () => {
    it('builds correct file list without videos', () => {
      const files = service.buildFileList(SAMPLE_INFO_JSON, false);

      // Should include meta files
      expect(files).toContain('meta/info.json');
      expect(files).toContain('meta/stats.json');

      // Should include episode parquets (50 episodes in chunk-000)
      expect(files).toContain('data/chunk-000/episode_000000.parquet');
      expect(files).toContain('data/chunk-000/episode_000049.parquet');

      // Should NOT include video files
      const videoFiles = files.filter((f) => f.startsWith('videos/'));
      expect(videoFiles).toHaveLength(0);

      // Total: 2 meta + 50 episodes = 52
      expect(files).toHaveLength(52);
    });

    it('builds correct file list with videos', () => {
      const files = service.buildFileList(SAMPLE_INFO_JSON, true);

      // Should include video files for the video feature
      const videoFiles = files.filter((f) => f.startsWith('videos/'));
      expect(videoFiles).toHaveLength(50); // 50 episodes × 1 video feature

      expect(videoFiles).toContain(
        'videos/chunk-000/observation.images.top/episode_000000.mp4'
      );
      expect(videoFiles).toContain(
        'videos/chunk-000/observation.images.top/episode_000049.mp4'
      );

      // Total: 2 meta + 50 parquets + 50 videos = 102
      expect(files).toHaveLength(102);
    });

    it('handles multiple chunks correctly', () => {
      const multiChunkInfo: LeRobotInfoV3 = {
        ...SAMPLE_INFO_JSON,
        total_episodes: 1500,
        total_chunks: 2,
        chunks_size: 1000,
      };

      const files = service.buildFileList(multiChunkInfo, false);

      // chunk-000: 1000 episodes, chunk-001: 500 episodes
      expect(files).toContain('data/chunk-000/episode_000000.parquet');
      expect(files).toContain('data/chunk-000/episode_000999.parquet');
      expect(files).toContain('data/chunk-001/episode_001000.parquet');
      expect(files).toContain('data/chunk-001/episode_001499.parquet');

      // 2 meta + 1500 episodes = 1502
      expect(files).toHaveLength(1502);
    });

    it('handles zero episodes gracefully', () => {
      const emptyInfo: LeRobotInfoV3 = {
        ...SAMPLE_INFO_JSON,
        total_episodes: 0,
        total_chunks: 0,
      };

      const files = service.buildFileList(emptyInfo, false);

      // Only meta files
      expect(files).toHaveLength(2);
      expect(files).toContain('meta/info.json');
      expect(files).toContain('meta/stats.json');
    });
  });

  // --------------------------------------------------------------------------
  // RETRY LOGIC
  // --------------------------------------------------------------------------

  describe('fetchWithRetry', () => {
    it('returns immediately on success (non-429)', async () => {
      const mockResponse = new Response('OK', { status: 200 });
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

      const result = await service.fetchWithRetry('https://example.com/file');

      expect(result.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('retries on 429 with exponential backoff', async () => {
      const rateLimitResponse = () => new Response('Too Many Requests', { status: 429 });
      const okResponse = new Response('OK', { status: 200 });

      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(rateLimitResponse())
        .mockResolvedValueOnce(rateLimitResponse())
        .mockResolvedValueOnce(okResponse);

      // Mock sleep to avoid actual delays
      const sleepSpy = vi.spyOn(service as any, 'sleep').mockResolvedValue(undefined);

      const result = await service.fetchWithRetry('https://example.com/file');

      expect(result.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(sleepSpy).toHaveBeenCalledTimes(2);

      // Verify exponential backoff: 1000ms, 2000ms
      expect(sleepSpy).toHaveBeenNthCalledWith(1, 1000);
      expect(sleepSpy).toHaveBeenNthCalledWith(2, 2000);
    });

    it('returns 429 response after max retries exhausted', async () => {
      const rateLimitResponse = () => new Response('Too Many Requests', { status: 429 });

      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => rateLimitResponse());
      vi.spyOn(service as any, 'sleep').mockResolvedValue(undefined);

      const result = await service.fetchWithRetry('https://example.com/file', 2);

      expect(result.status).toBe(429);
    });

    it('respects Retry-After header', async () => {
      const rateLimitResponse = new Response('Too Many Requests', {
        status: 429,
        headers: { 'retry-after': '5' },
      });
      const okResponse = new Response('OK', { status: 200 });

      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(rateLimitResponse)
        .mockResolvedValueOnce(okResponse);

      const sleepSpy = vi.spyOn(service as any, 'sleep').mockResolvedValue(undefined);

      await service.fetchWithRetry('https://example.com/file');

      // Should use Retry-After value (5 seconds = 5000ms)
      expect(sleepSpy).toHaveBeenCalledWith(5000);
    });
  });

  // --------------------------------------------------------------------------
  // ERROR HANDLING
  // --------------------------------------------------------------------------

  describe('importDataset', () => {
    it('sets status to failed on download error', async () => {
      // Mock fetchInfoJson to succeed
      const mockInfoResponse = new Response(JSON.stringify(SAMPLE_INFO_JSON), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

      // First fetch = info.json (success), subsequent fetches = fail
      let callCount = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return mockInfoResponse;
        }
        throw new Error('Network error');
      });

      const { datasetRepository } = await import('../../repositories/index.js');

      const datasetId = await service.importDataset({
        repoId: 'lerobot/svla_so101_pickplace',
      });

      expect(datasetId).toBe('test-dataset-id');
      expect(datasetRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'svla_so101_pickplace',
          status: 'importing',
          lerobotVersion: 'v2.1',
          fps: 30,
          demonstrationCount: 50,
        })
      );

      // Wait for background import to settle
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should have updated status to failed
      expect(datasetRepository.update).toHaveBeenCalledWith(
        'test-dataset-id',
        expect.objectContaining({ status: 'failed' })
      );
    });

    it('rejects invalid robotTypeId', async () => {
      const { robotTypeRepository } = await import('../../repositories/index.js');
      (robotTypeRepository.findById as any).mockResolvedValueOnce(null);

      await expect(
        service.importDataset({
          repoId: 'lerobot/test',
          robotTypeId: 'nonexistent',
        })
      ).rejects.toThrow('Robot type not found');
    });
  });
});
