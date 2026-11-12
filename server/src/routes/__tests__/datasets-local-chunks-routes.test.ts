/**
 * @file datasets-local-chunks-routes.test.ts
 * @description Frames and video of a dataset on the server's disk, past its first chunk (TASK-479)
 * @feature datasets
 *
 * LeRobot v2.1 keeps episode N in chunk floor(N / chunks_size). The local
 * readers joined `chunk-000` for every episode, so episode 1000 of a local
 * dataset — which the repo's own v3.0 converter writes to chunk-001 — was a
 * 404. The fixture declares `chunks_size: 2`, so three episodes are enough to
 * leave the first chunk.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { FRAME_FIELDS, frameRows, parquetBuffer } from '../../services/lerobot/__tests__/parquetFixtures.js';

const datasets = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('../../services/DatasetService.js', () => ({
  datasetService: { get: datasets.get, on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  datasetStorageRoot: () => '/tmp',
}));

// A local dataset never reaches object storage; if a reader falls through to
// it, the request fails instead of quietly answering from somewhere else.
vi.mock('../../storage/rustfs-client.js', () => ({
  isRustFSInitialized: () => false,
  getRustFSClient: () => {
    throw new Error('a local dataset must not be read from object storage');
  },
}));

import { datasetRoutes } from '../datasets.routes.js';

const CAMERA = 'observation.images.ego_view';
const DATA_PATH = 'data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet';
const CHUNK_FIRST = 'videos/chunk-{episode_chunk:03d}/{video_key}/episode_{episode_index:06d}.mp4';
const KEY_FIRST = 'videos/{video_key}/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.mp4';
const LENGTHS = [4, 6, 3, 5, 2];

let root: string;
let outside: string;

function app() {
  const a = express();
  a.use('/api/datasets', datasetRoutes);
  return a;
}

const binary = (r: request.Test) =>
  r.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });

async function put(dir: string, rel: string, body: Buffer | string): Promise<void> {
  const file = join(dir, rel);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, body);
}

const pad = (n: number, width: number) => String(n).padStart(width, '0');
const videoBody = (episode: number) => Buffer.from(`video of episode ${episode}`);

/**
 * A v2.1 dataset of five episodes on disk. `chunkOf` says which chunk
 * directory each episode is written to; `info` is merged into meta/info.json.
 */
async function writeDataset(
  options: {
    info?: Record<string, unknown>;
    chunkOf?: (episode: number) => number;
    videoRel?: (chunk: number, episode: number) => string;
  } = {},
): Promise<void> {
  const chunkOf = options.chunkOf ?? ((episode: number) => Math.floor(episode / 2));
  const videoRel = options.videoRel
    ?? ((chunk, episode) => `videos/chunk-${pad(chunk, 3)}/${CAMERA}/episode_${pad(episode, 6)}.mp4`);
  await put(root, 'meta/info.json', JSON.stringify({
    codebase_version: 'v2.1',
    fps: 30,
    chunks_size: 2,
    total_episodes: LENGTHS.length,
    total_chunks: 3,
    data_path: DATA_PATH,
    video_path: CHUNK_FIRST,
    ...options.info,
  }));
  await put(root, 'meta/episodes.jsonl', LENGTHS.map((length, i) => JSON.stringify({ episode_index: i, length })).join('\n'));
  for (const [episode, length] of LENGTHS.entries()) {
    const chunk = chunkOf(episode);
    await put(
      root,
      `data/chunk-${pad(chunk, 3)}/episode_${pad(episode, 6)}.parquet`,
      await parquetBuffer(FRAME_FIELDS, frameRows(episode, length, 3)),
    );
    await put(root, videoRel(chunk, episode), videoBody(episode));
  }
}

beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), 'rms-local-chunks-'));
  root = join(base, 'dataset');
  outside = join(base, 'outside');
  await mkdir(root, { recursive: true });
  datasets.get.mockReset();
  // The record's own infoJson is deliberately wrong about the chunk size: the
  // readers must go by the info.json of the directory they serve.
  datasets.get.mockResolvedValue({
    id: 'ds-local',
    storagePath: root,
    lerobotVersion: 'v2.1',
    fps: 30,
    infoJson: JSON.stringify({ codebase_version: 'v2.1', fps: 30, chunks_size: 1000 }),
  });
});

afterEach(async () => {
  await rm(dirname(root), { recursive: true, force: true });
});

describe('GET /datasets/:id/episodes/:index/frames of a local dataset', () => {
  it('returns the frames of every episode, whichever chunk holds it', async () => {
    await writeDataset();

    for (const [episode, length] of LENGTHS.entries()) {
      const res = await request(app()).get(`/api/datasets/ds-local/episodes/${episode}/frames`);
      expect(res.status, `episode ${episode}`).toBe(200);
      expect(res.body.total).toBe(length);
      // frameRows tags each value with its episode: 1000 * episode + frame.
      expect(res.body.frames[0].observationState[0]).toBe(episode * 1000);
    }
  });

  it('pages inside an episode of the second chunk', async () => {
    await writeDataset();

    const res = await request(app()).get('/api/datasets/ds-local/episodes/3/frames?offset=2&limit=2');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(5);
    expect(res.body.frames.map((f: { frameIndex: number }) => f.frameIndex)).toEqual([2, 3]);
  });

  it('goes by chunks_size 1000 when info.json names none', async () => {
    await writeDataset({ info: { chunks_size: undefined }, chunkOf: () => 0 });

    const res = await request(app()).get('/api/datasets/ds-local/episodes/4/frames');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
  });

  it('still opens a tree that kept every episode in chunk-000', async () => {
    // What the v3.0 converter wrote before it placed episodes by chunk.
    await writeDataset({ chunkOf: () => 0 });

    const res = await request(app()).get('/api/datasets/ds-local/episodes/4/frames');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
  });

  it('answers 404 for an episode the dataset does not have', async () => {
    await writeDataset();

    const res = await request(app()).get('/api/datasets/ds-local/episodes/9/frames');

    expect(res.status).toBe(404);
  });

  it('does not follow a data_path that leaves the dataset directory', async () => {
    await writeDataset({ info: { data_path: '../outside/episode_{episode_index:06d}.parquet' } });
    await put(outside, 'episode_000009.parquet', await parquetBuffer(FRAME_FIELDS, frameRows(9, 7, 3)));

    const res = await request(app()).get('/api/datasets/ds-local/episodes/9/frames');

    expect(res.status).toBe(404);
  });
});

describe('GET /datasets/:id/episodes/:index/video/:camera of a local dataset', () => {
  it('streams the video of every episode, whichever chunk holds it', async () => {
    await writeDataset();

    for (const episode of LENGTHS.keys()) {
      const res = await binary(request(app()).get(`/api/datasets/ds-local/episodes/${episode}/video/ego_view`));
      expect(res.status, `episode ${episode}`).toBe(200);
      expect((res.body as Buffer).toString()).toBe(`video of episode ${episode}`);
    }
  });

  it('answers a Range on a video of the third chunk', async () => {
    await writeDataset();

    const res = await binary(
      request(app()).get(`/api/datasets/ds-local/episodes/4/video/${CAMERA}`).set('Range', 'bytes=0-4'),
    );

    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 0-4/${videoBody(4).length}`);
    expect((res.body as Buffer).toString()).toBe('video');
  });

  it('finds the camera-first layout past the first chunk', async () => {
    await writeDataset({
      info: { video_path: KEY_FIRST },
      videoRel: (chunk, episode) => `videos/${CAMERA}/chunk-${pad(chunk, 3)}/episode_${pad(episode, 6)}.mp4`,
    });

    const res = await binary(request(app()).get('/api/datasets/ds-local/episodes/2/video/ego_view'));

    expect(res.status).toBe(200);
    expect((res.body as Buffer).toString()).toBe('video of episode 2');
  });

  it('finds the camera-first layout when info.json names the other one', async () => {
    await writeDataset({
      videoRel: (chunk, episode) => `videos/${CAMERA}/chunk-${pad(chunk, 3)}/episode_${pad(episode, 6)}.mp4`,
    });

    const res = await binary(request(app()).get('/api/datasets/ds-local/episodes/3/video/ego_view'));

    expect(res.status).toBe(200);
    expect((res.body as Buffer).toString()).toBe('video of episode 3');
  });

  it('still opens a tree that kept every video in chunk-000', async () => {
    await writeDataset({ chunkOf: () => 0 });

    const res = await binary(request(app()).get('/api/datasets/ds-local/episodes/4/video/ego_view'));

    expect(res.status).toBe(200);
    expect((res.body as Buffer).toString()).toBe('video of episode 4');
  });

  it('answers 404 for a video the dataset does not have', async () => {
    await writeDataset();

    const res = await request(app()).get('/api/datasets/ds-local/episodes/9/video/ego_view');

    expect(res.status).toBe(404);
  });

  it('does not follow a video_path that leaves the dataset directory', async () => {
    await writeDataset({ info: { video_path: '../outside/{video_key}/episode_{episode_index:06d}.mp4' } });
    await put(outside, `${CAMERA}/episode_000009.mp4`, 'not this dataset');

    const res = await request(app()).get('/api/datasets/ds-local/episodes/9/video/ego_view');

    expect(res.status).toBe(404);
  });
});
