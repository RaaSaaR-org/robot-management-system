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
      const info = service.buildInfo(baseFrames, 1, { sessionFps: 30 });
      expect(info.robot_type).toBe('so101');
      expect(info.codebase_version).toBe('v3.0');
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
      const info = service.buildInfo(baseFrames, 1, options);
      expect(info.robot_type).toBe('h1');
      // sliced to dim (3)
      expect(info.features['observation.state'].names).toEqual(['a', 'b', 'c']);
    });

    it('reflects the episode count in totals and splits', () => {
      const info = service.buildInfo(baseFrames, 3, { sessionFps: 30 });
      expect(info.total_episodes).toBe(3);
      expect(info.splits).toEqual({ train: '0:3' });
    });

    it('computes fps from timestamps when 2+ frames span a positive duration', () => {
      // 11 frames over 1.0s -> (11-1)/1.0 = 10 fps, overriding sessionFps
      const frames: FrameRow[] = [];
      for (let i = 0; i <= 10; i++) {
        frames.push(frame(i, i * 0.1, [0], [0]));
      }
      const info = service.buildInfo(frames, 1, { sessionFps: 99 });
      expect(info.fps).toBe(10);
    });

    it('falls back to sessionFps for a single frame', () => {
      const info = service.buildInfo([frame(0, 5, [0], [0])], 1, { sessionFps: 24 });
      expect(info.fps).toBe(24);
    });

    it('falls back to sessionFps when duration is zero', () => {
      const frames = [frame(0, 7, [0], [0]), frame(1, 7, [0], [0])];
      const info = service.buildInfo(frames, 1, { sessionFps: 15 });
      expect(info.fps).toBe(15);
    });

    it('pads generic joint names when the robot has more joints than defaults', () => {
      const wide = [frame(0, 0, new Array(8).fill(0), new Array(8).fill(0))];
      const info = service.buildInfo(wide, 1, { sessionFps: 10 });
      expect(info.features.action.names).toHaveLength(8);
      expect(info.features.action.names[6]).toBe('joint_6');
    });
  });

  // --------------------------------------------------------------------------
  // groupByEpisode
  // --------------------------------------------------------------------------

  describe('groupByEpisode', () => {
    it('groups frames by episodeIndex and re-numbers episodes densely', () => {
      const frames: FrameRow[] = [
        { ...frame(0, 0, [0], [0]), episodeIndex: 0 },
        { ...frame(1, 0.1, [1], [1]), episodeIndex: 0 },
        // episode 1 was discarded — indices jump from 0 to 2
        { ...frame(2, 0.2, [2], [2]), episodeIndex: 2 },
        { ...frame(3, 0.3, [3], [3]), episodeIndex: 2 },
        { ...frame(4, 0.4, [4], [4]), episodeIndex: 2 },
      ];

      const episodes = service.groupByEpisode(frames);
      expect(episodes).toHaveLength(2);
      expect(episodes[0].episodeIndex).toBe(0);
      expect(episodes[0].frames).toHaveLength(2);
      expect(episodes[1].episodeIndex).toBe(1); // dense re-numbering of source ep 2
      expect(episodes[1].frames).toHaveLength(3);
      expect(episodes[1].frames.map((f) => f.frameIndex)).toEqual([2, 3, 4]);
    });

    it('treats frames without episodeIndex as episode 0 (legacy data)', () => {
      const episodes = service.groupByEpisode([frame(0, 0, [0], [0]), frame(1, 1, [1], [1])]);
      expect(episodes).toHaveLength(1);
      expect(episodes[0].episodeIndex).toBe(0);
      expect(episodes[0].frames).toHaveLength(2);
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

    it('uploads chunked parquet + metadata and returns a datasetId', async () => {
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

      // UUID-shaped datasetId; storagePath is the object-key prefix
      expect(result.datasetId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(result.storagePath).toBe(`${result.datasetId}/`);
      expect(result.episodeCount).toBe(1);

      // Parquet uploaded via upload() (data + episodes meta), JSON via putObject()
      expect(upload).toHaveBeenCalledTimes(2);
      expect(putObject).toHaveBeenCalledTimes(3);

      const uploadKeys = upload.mock.calls.map((c) => c[1] as string).sort();
      expect(uploadKeys).toEqual([
        `${result.datasetId}/data/chunk-000/file-000.parquet`,
        `${result.datasetId}/meta/episodes/chunk-000/file-000.parquet`,
      ]);
      for (const call of upload.mock.calls) {
        expect(Buffer.isBuffer(call[2])).toBe(true);
        expect((call[2] as Buffer).length).toBeGreaterThan(0);
      }

      // putObject keys: episodes.jsonl, info.json, stats.json
      const keys = putObject.mock.calls.map((c) => c[1] as string).sort();
      expect(keys).toEqual([
        `${result.datasetId}/meta/episodes.jsonl`,
        `${result.datasetId}/meta/info.json`,
        `${result.datasetId}/meta/stats.json`,
      ]);

      // info.json payload should be valid JSON with expected totals
      const infoCall = putObject.mock.calls.find((c) =>
        (c[1] as string).endsWith('info.json'),
      );
      const infoPayload = JSON.parse(infoCall![2] as string);
      expect(infoPayload.total_frames).toBe(2);
      expect(infoPayload.total_episodes).toBe(1);
      expect(infoPayload.codebase_version).toBe('v3.0');
    });

    it('groups frames by episodeIndex into separate episodes (jsonl + parquet round-trip)', async () => {
      const { storage, upload, putObject } = makeFakeStorage();
      const svc = new LeRobotExportService(storage);

      const frames: FrameRow[] = [
        { ...frame(0, 0.0, [0, 0], [0, 0]), episodeIndex: 0 },
        { ...frame(1, 0.1, [1, 1], [1, 1]), episodeIndex: 0 },
        { ...frame(2, 0.2, [2, 2], [2, 2]), episodeIndex: 1 },
        { ...frame(3, 0.3, [3, 3], [3, 3]), episodeIndex: 1 },
        { ...frame(4, 0.4, [4, 4], [4, 4]), episodeIndex: 1 },
      ];

      const result = await svc.exportSession(frames, {
        sessionFps: 10,
        task: 'pick up the cube',
      });
      expect(result.episodeCount).toBe(2);

      // episodes.jsonl: one line per episode with the task and length
      const jsonlCall = putObject.mock.calls.find((c) =>
        (c[1] as string).endsWith('episodes.jsonl'),
      );
      const lines = (jsonlCall![2] as string).split('\n').map((l) => JSON.parse(l));
      expect(lines).toEqual([
        { episode_index: 0, tasks: ['pick up the cube'], length: 2 },
        { episode_index: 1, tasks: ['pick up the cube'], length: 3 },
      ]);

      // Round-trip the data parquet: episode_index column and per-episode
      // re-based frame_index/timestamp must match what the dataset viewer reads.
      const dataCall = upload.mock.calls.find((c) =>
        (c[1] as string).includes('/data/chunk-000/'),
      );
      const { ParquetReader } = await import('@dsnp/parquetjs');
      const reader = await ParquetReader.openBuffer(dataCall![2] as Buffer);
      const cursor = reader.getCursor();
      const rows: Record<string, unknown>[] = [];
      let row: Record<string, unknown> | null;
      while ((row = (await cursor.next()) as Record<string, unknown> | null)) {
        rows.push(row);
      }
      await reader.close();

      expect(rows).toHaveLength(5);
      expect(rows.map((r) => Number(r['episode_index']))).toEqual([0, 0, 1, 1, 1]);
      expect(rows.map((r) => Number(r['frame_index']))).toEqual([0, 1, 0, 1, 2]);
      expect(rows.map((r) => Number(r['index']))).toEqual([0, 1, 2, 3, 4]);
      // Episode 1 timestamps re-based to start at 0
      expect(Number(rows[2]['timestamp'])).toBeCloseTo(0, 5);
      // next_done marks each episode end
      expect(rows.map((r) => Boolean(r['next_done']))).toEqual([false, true, false, false, true]);
      // The dotted observation.state column survives the round-trip
      const obs = rows[4]['observation.state'];
      expect(Array.isArray(obs) ? obs.map(Number) : obs).toEqual([4, 4]);

      // Round-trip the episodes metadata parquet (viewer reads length per episode)
      const epCall = upload.mock.calls.find((c) =>
        (c[1] as string).includes('/meta/episodes/chunk-000/'),
      );
      const epReader = await ParquetReader.openBuffer(epCall![2] as Buffer);
      const epCursor = epReader.getCursor();
      const epRows: Record<string, unknown>[] = [];
      while ((row = (await epCursor.next()) as Record<string, unknown> | null)) {
        epRows.push(row);
      }
      await epReader.close();
      expect(epRows.map((r) => Number(r['episode_index']))).toEqual([0, 1]);
      expect(epRows.map((r) => Number(r['length']))).toEqual([2, 3]);
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
