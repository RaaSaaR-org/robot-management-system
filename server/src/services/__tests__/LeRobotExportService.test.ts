/**
 * @file LeRobotExportService.test.ts
 * @description Unit tests for LeRobotExportService — stats computation, info.json
 *   generation, and the full export pipeline (with a fake storage client).
 * @feature datacollection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  LeRobotExportService,
  type FrameRow,
  type LeRobotExportOptions,
} from '../LeRobotExportService.js';
import type { RustFSClient } from '../../storage/rustfs-client.js';

function frame(
  frameIndex: number,
  timestamp: number,
  jointPositions: number[],
  action: number[],
): FrameRow {
  return { frameIndex, timestamp, jointPositions, action, isIntervention: false };
}

/** Minimal fake of RustFSClient capturing upload/putObject calls. */
function makeFakeStorage() {
  const upload = vi.fn().mockResolvedValue(undefined);
  const putObject = vi.fn().mockResolvedValue(undefined);
  const storage = { upload, putObject } as unknown as RustFSClient;
  return { storage, upload, putObject };
}

describe('LeRobotExportService', () => {
  let service: LeRobotExportService;

  beforeEach(() => {
    vi.clearAllMocks();
    const { storage } = makeFakeStorage();
    service = new LeRobotExportService(storage);
  });

  // --------------------------------------------------------------------------
  // computeStats
  // --------------------------------------------------------------------------

  describe('computeStats', () => {
    it('computes mean, std, min, max per joint for state and action', () => {
      const frames = [
        frame(0, 0, [0, 10], [1, 1]),
        frame(1, 1, [2, 20], [3, 3]),
      ];
      const stats = service.computeStats(frames);

      // observation.state: joint0 = [0,2], joint1 = [10,20]
      expect(stats['observation.state'].mean).toEqual([1, 15]);
      expect(stats['observation.state'].min).toEqual([0, 10]);
      expect(stats['observation.state'].max).toEqual([2, 20]);
      // population std of [0,2] around mean 1 -> 1; of [10,20] around 15 -> 5
      expect(stats['observation.state'].std).toEqual([1, 5]);

      // action: joint0 = [1,3] mean 2, joint1 = [1,3] mean 2
      expect(stats.action.mean).toEqual([2, 2]);
      expect(stats.action.std).toEqual([1, 1]);
    });

    it('returns empty arrays for empty frame list', () => {
      const stats = service.computeStats([]);
      expect(stats['observation.state']).toEqual({
        mean: [],
        std: [],
        min: [],
        max: [],
      });
      expect(stats.action).toEqual({ mean: [], std: [], min: [], max: [] });
    });

    it('yields zero std for constant values', () => {
      const frames = [
        frame(0, 0, [5, 5], [7]),
        frame(1, 1, [5, 5], [7]),
        frame(2, 2, [5, 5], [7]),
      ];
      const stats = service.computeStats(frames);
      expect(stats['observation.state'].std).toEqual([0, 0]);
      expect(stats['observation.state'].mean).toEqual([5, 5]);
      expect(stats.action.std).toEqual([0]);
    });
  });

  // --------------------------------------------------------------------------
  // buildInfo
  // --------------------------------------------------------------------------

  describe('buildInfo', () => {
    const baseFrames = [
      frame(0, 0, [0, 0, 0], [0, 0, 0]),
      frame(1, 0.1, [0, 0, 0], [0, 0, 0]),
    ];

    it('uses defaults for robot type and joint names', () => {
      const info = service.buildInfo(baseFrames, { sessionFps: 30 });
      expect(info.robot_type).toBe('so101');
      expect(info.codebase_version).toBe('v2.0');
      expect(info.total_episodes).toBe(1);
      expect(info.total_frames).toBe(2);
      expect(info.splits).toEqual({ train: '0:1' });
      // dim = 3, default joint names sliced to 3
      expect(info.features['observation.state'].shape).toEqual([3]);
      expect(info.features['observation.state'].names).toEqual([
        'shoulder_pan',
        'shoulder_lift',
        'elbow_flex',
      ]);
      expect(info.features.action.shape).toEqual([3]);
    });

    it('honors custom robot type and joint names', () => {
      const options: LeRobotExportOptions = {
        sessionFps: 30,
        robotType: 'h1',
        jointNames: ['a', 'b', 'c', 'd', 'e'],
      };
      const info = service.buildInfo(baseFrames, options);
      expect(info.robot_type).toBe('h1');
      // sliced to dim (3)
      expect(info.features['observation.state'].names).toEqual(['a', 'b', 'c']);
    });

    it('computes fps from timestamps when 2+ frames span a positive duration', () => {
      // 11 frames over 1.0s -> (11-1)/1.0 = 10 fps, overriding sessionFps
      const frames: FrameRow[] = [];
      for (let i = 0; i <= 10; i++) {
        frames.push(frame(i, i * 0.1, [0], [0]));
      }
      const info = service.buildInfo(frames, { sessionFps: 99 });
      expect(info.fps).toBe(10);
    });

    it('falls back to sessionFps for a single frame', () => {
      const info = service.buildInfo([frame(0, 5, [0], [0])], { sessionFps: 24 });
      expect(info.fps).toBe(24);
    });

    it('falls back to sessionFps when duration is zero', () => {
      const frames = [frame(0, 7, [0], [0]), frame(1, 7, [0], [0])];
      const info = service.buildInfo(frames, { sessionFps: 15 });
      expect(info.fps).toBe(15);
    });
  });

  // --------------------------------------------------------------------------
  // exportSession
  // --------------------------------------------------------------------------

  describe('exportSession', () => {
    it('throws on an empty frame list', async () => {
      await expect(
        service.exportSession([], { sessionFps: 30 }),
      ).rejects.toThrow('Cannot export empty frame list');
    });

    it('uploads parquet, info.json and stats.json and returns a datasetId', async () => {
      const { storage, upload, putObject } = makeFakeStorage();
      const svc = new LeRobotExportService(storage);

      const frames = [
        frame(0, 0, [0, 1], [0.5, 0.5]),
        frame(1, 0.5, [1, 2], [0.6, 0.6]),
      ];

      const result = await svc.exportSession(frames, {
        sessionFps: 30,
        robotType: 'so101',
      });

      // UUID-shaped datasetId
      expect(result.datasetId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(result.storagePath).toBe(`datasets/${result.datasetId}/`);

      // Parquet uploaded via upload(), JSON via putObject()
      expect(upload).toHaveBeenCalledTimes(1);
      expect(putObject).toHaveBeenCalledTimes(2);

      const uploadCall = upload.mock.calls[0];
      expect(uploadCall[1]).toBe(`${result.datasetId}/data/data.parquet`);
      expect(Buffer.isBuffer(uploadCall[2])).toBe(true);
      expect((uploadCall[2] as Buffer).length).toBeGreaterThan(0);

      // The two putObject keys should be info.json and stats.json
      const keys = putObject.mock.calls.map((c) => c[1] as string).sort();
      expect(keys).toEqual([
        `${result.datasetId}/meta/info.json`,
        `${result.datasetId}/meta/stats.json`,
      ]);

      // info.json payload should be valid JSON with expected total_frames
      const infoCall = putObject.mock.calls.find((c) =>
        (c[1] as string).endsWith('info.json'),
      );
      const infoPayload = JSON.parse(infoCall![2] as string);
      expect(infoPayload.total_frames).toBe(2);
    });

    it('propagates storage upload failures', async () => {
      const { storage, upload } = makeFakeStorage();
      upload.mockRejectedValueOnce(new Error('rustfs down'));
      const svc = new LeRobotExportService(storage);

      await expect(
        svc.exportSession([frame(0, 0, [0], [0])], { sessionFps: 30 }),
      ).rejects.toThrow('rustfs down');
    });
  });
});
