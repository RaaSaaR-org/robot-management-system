/**
 * @file dataset-video-ticket.test.ts
 * @description An episode video plays with sign-in on — through a real
 * `createApp()`, a real viewer JWT and a real file on disk (TASK-478).
 * @feature datasets
 */

import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.RATE_LIMIT_DISABLED = 'true';
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createApp } from '../app.js';
import { datasetService } from '../services/DatasetService.js';
import { signDatasetVideoTicket } from '../security/datasetVideoTicket.js';
import { signCameraTicket } from '../security/cameraTicket.js';

const app = createApp();

const CAMERA = 'observation.images.ego_view';
const VIDEO = `/api/datasets/ds-1/episodes/0/video/${CAMERA}`;
/** Not a decodable mp4 — the route streams bytes, it does not read them. */
const BYTES = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');

let root: string;
let viewerToken: string;

beforeAll(() => {
  // A minimal LeRobot v2.1 dataset on disk: the local branch of the video
  // route, which needs no object store.
  root = mkdtempSync(join(tmpdir(), 'task-478-'));
  mkdirSync(join(root, 'meta'), { recursive: true });
  writeFileSync(join(root, 'meta', 'info.json'), JSON.stringify({ codebase_version: 'v2.1', fps: 30 }));
  const videoDir = join(root, 'videos', 'chunk-000', CAMERA);
  mkdirSync(videoDir, { recursive: true });
  writeFileSync(join(videoDir, 'episode_000000.mp4'), BYTES);

  viewerToken = jwt.sign(
    { userId: 'viewer-user', email: 'viewer@example.com', name: 'Viewer User', role: 'viewer' },
    process.env.JWT_SECRET!,
    { expiresIn: '1h' }
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  // Only `ds-1` exists, the way only the caller's tenant's rows do.
  vi.spyOn(datasetService, 'get').mockImplementation(async (id: string) =>
    id === 'ds-1' ? ({ id, storagePath: root, lerobotVersion: 'v2.1' } as never) : null
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function mint(datasetId = 'ds-1'): Promise<string> {
  const res = await request(app)
    .post(`/api/datasets/${datasetId}/video-ticket`)
    .set('Authorization', `Bearer ${viewerToken}`)
    .send({});
  expect(res.status).toBe(200);
  return res.body.ticket as string;
}

describe('an episode video, with sign-in ON', () => {
  beforeEach(() => {
    vi.stubEnv('AUTH_DISABLED', 'false');
  });

  it('is refused without a credential — what a bare <video src> sends', async () => {
    const res = await request(app).get(VIDEO);
    expect(res.status).toBe(401);
  });

  it('plays with a ticket a viewer minted', async () => {
    const res = await request(app).get(VIDEO).query({ ticket: await mint() }).buffer(true);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('video/mp4');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(Buffer.from(res.body).equals(BYTES)).toBe(true);
  });

  it('answers a Range request with the window, as a seek needs', async () => {
    const res = await request(app)
      .get(VIDEO)
      .query({ ticket: await mint() })
      .set('Range', 'bytes=10-19')
      .buffer(true);

    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 10-19/${BYTES.length}`);
    expect(Buffer.from(res.body).toString()).toBe('abcdefghij');
  });

  it('keeps the chunk/file query of a v3.0 window next to the ticket', async () => {
    const res = await request(app).get(VIDEO).query({ chunk: 0, file: 0, ticket: await mint() });
    expect(res.status).toBe(200);
  });

  it('says how long the ticket lasts and is not cacheable', async () => {
    const res = await request(app)
      .post('/api/datasets/ds-1/video-ticket')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({});

    expect(res.body.expiresIn).toBe(900);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('mints nothing for a dataset the caller cannot see', async () => {
    const res = await request(app)
      .post('/api/datasets/ds-2/video-ticket')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.ticket).toBeUndefined();
  });

  it('mints nothing without a sign-in', async () => {
    const res = await request(app).post('/api/datasets/ds-1/video-ticket').send({});
    expect(res.status).toBe(401);
  });

  it('does not open another dataset', async () => {
    const ticket = signDatasetVideoTicket({ datasetId: 'ds-2', userId: 'u', tenantId: null, role: 'viewer' });
    const res = await request(app).get(VIDEO).query({ ticket });
    expect(res.status).toBe(401);
  });

  it('opens nothing but the video route', async () => {
    const ticket = await mint();
    for (const path of [
      '/api/datasets',
      '/api/datasets/ds-1',
      '/api/datasets/ds-1/episodes',
      '/api/datasets/ds-1/episodes/0/frames',
      '/api/datasets/views/ds-1',
      '/api/robots',
    ]) {
      const res = await request(app).get(path).query({ ticket });
      expect(res.status, path).toBe(401);
    }
  });

  it('is refused on a write, even on the video path', async () => {
    const ticket = await mint();
    const res = await request(app).delete(VIDEO).query({ ticket });
    expect(res.status).toBe(401);
  });

  it('is refused once it has expired', async () => {
    const ticket = signDatasetVideoTicket(
      { datasetId: 'ds-1', userId: 'u', tenantId: null, role: 'viewer' },
      -1_000
    );
    const res = await request(app).get(VIDEO).query({ ticket });
    expect(res.status).toBe(401);
  });

  it('never overrides a real Authorization header', async () => {
    const res = await request(app)
      .get(VIDEO)
      .set('Authorization', 'Bearer not-a-real-token')
      .query({ ticket: await mint() });
    expect(res.status).toBe(401);
  });

  it('does not accept a camera ticket, or an access token in the URL', async () => {
    const camera = signCameraTicket({
      robotId: 'ds-1',
      cameraName: CAMERA,
      userId: 'viewer-user',
      tenantId: null,
      role: 'viewer',
    });
    expect((await request(app).get(VIDEO).query({ ticket: camera })).status).toBe(401);
    expect((await request(app).get(VIDEO).query({ access_token: viewerToken })).status).toBe(401);
    expect((await request(app).get(VIDEO).query({ ticket: viewerToken })).status).toBe(401);
  });

  it('still plays with a bearer token, as an API client sends', async () => {
    const res = await request(app).get(VIDEO).set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(200);
  });
});

describe('an episode video, with sign-in OFF', () => {
  // vitest.config.ts runs the server suite with AUTH_DISABLED=true.
  it('plays without a ticket', async () => {
    const res = await request(app).get(VIDEO).set('Range', 'bytes=0-3');
    expect(res.status).toBe(206);
  });

  it('plays with the ticket the app now always sends', async () => {
    const minted = await request(app).post('/api/datasets/ds-1/video-ticket').send({});
    expect(minted.status).toBe(200);
    const res = await request(app).get(VIDEO).query({ ticket: minted.body.ticket });
    expect(res.status).toBe(200);
  });
});
