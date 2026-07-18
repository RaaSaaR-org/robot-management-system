/**
 * @file motionclip-routes.test.ts
 * @description Integration tests for motion-clip routes (list/get/import/delete)
 *              plus the app-level body-parser error mapping the import path relies on
 * @feature robots
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { BadRequestError } from '../utils/errors.js';

const { mockMotionClipService } = vi.hoisted(() => ({
  mockMotionClipService: {
    listClips: vi.fn(),
    getClip: vi.fn(),
    createClip: vi.fn(),
    deleteClip: vi.fn(),
  },
}));

vi.mock('../services/MotionClipService.js', () => ({
  motionClipService: mockMotionClipService,
}));

import { motionClipRoutes } from '../routes/motionclip.routes.js';
import { createApp } from '../app.js';

function createRouterApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/motion-clips', motionClipRoutes);
  return app;
}

const SAMPLE_SUMMARY = {
  id: 'clip-001',
  name: 'wave',
  source: 'gmr',
  robotType: 'unitree_g1_29dof',
  fps: 30,
  frameCount: 90,
  durationSec: 3,
  jointNames: ['left_hip_pitch_joint'],
  rootRotOrder: 'xyzw',
  upAxis: 'z',
  warnings: [],
  createdAt: '2026-07-17T00:00:00.000Z',
};

const SAMPLE_CLIP = {
  ...SAMPLE_SUMMARY,
  frames: [{ rootPos: [0, 0, 0.79], rootRot: [0, 0, 0, 1], dofPos: [0.1] }],
};

const VALID_BODY = {
  name: 'wave',
  fps: 30,
  jointNames: ['left_hip_pitch_joint'],
  frames: [{ rootPos: [0, 0, 0.79], rootRot: [0, 0, 0, 1], dofPos: [0.1] }],
};

describe('motion-clip routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── GET / (list) ───────────────────────────────────────────────────

  it('GET /api/motion-clips lists clips without a limit', async () => {
    mockMotionClipService.listClips.mockResolvedValue([SAMPLE_SUMMARY]);
    const res = await request(createRouterApp()).get('/api/motion-clips');

    expect(res.status).toBe(200);
    expect(res.body.clips).toHaveLength(1);
    expect(res.body.clips[0].id).toBe('clip-001');
    expect(mockMotionClipService.listClips).toHaveBeenCalledWith(undefined);
  });

  it('GET /api/motion-clips?limit=5 passes the limit through', async () => {
    mockMotionClipService.listClips.mockResolvedValue([]);
    const res = await request(createRouterApp()).get('/api/motion-clips?limit=5');

    expect(res.status).toBe(200);
    expect(mockMotionClipService.listClips).toHaveBeenCalledWith(5);
  });

  it('GET /api/motion-clips?limit=0 clamps to 1', async () => {
    mockMotionClipService.listClips.mockResolvedValue([]);
    const res = await request(createRouterApp()).get('/api/motion-clips?limit=0');

    expect(res.status).toBe(200);
    expect(mockMotionClipService.listClips).toHaveBeenCalledWith(1);
  });

  it('GET /api/motion-clips?limit=99999 clamps to 1000', async () => {
    mockMotionClipService.listClips.mockResolvedValue([]);
    const res = await request(createRouterApp()).get('/api/motion-clips?limit=99999');

    expect(res.status).toBe(200);
    expect(mockMotionClipService.listClips).toHaveBeenCalledWith(1000);
  });

  it('GET /api/motion-clips?limit=abc falls back to the service default', async () => {
    mockMotionClipService.listClips.mockResolvedValue([]);
    const res = await request(createRouterApp()).get('/api/motion-clips?limit=abc');

    expect(res.status).toBe(200);
    expect(mockMotionClipService.listClips).toHaveBeenCalledWith(undefined);
  });

  it('GET /api/motion-clips returns 500 when the service fails', async () => {
    mockMotionClipService.listClips.mockRejectedValue(new Error('db down'));
    const res = await request(createRouterApp()).get('/api/motion-clips');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to list motion clips');
  });

  // ─── GET /:id ───────────────────────────────────────────────────────

  it('GET /api/motion-clips/:id returns the full clip with frames', async () => {
    mockMotionClipService.getClip.mockResolvedValue(SAMPLE_CLIP);
    const res = await request(createRouterApp()).get('/api/motion-clips/clip-001');

    expect(res.status).toBe(200);
    expect(res.body.clip.id).toBe('clip-001');
    expect(res.body.clip.frames).toHaveLength(1);
    expect(mockMotionClipService.getClip).toHaveBeenCalledWith('clip-001');
  });

  it('GET /api/motion-clips/:id 404s when the clip is missing', async () => {
    mockMotionClipService.getClip.mockResolvedValue(null);
    const res = await request(createRouterApp()).get('/api/motion-clips/nope');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Motion clip not found');
  });

  // ─── POST / ─────────────────────────────────────────────────────────

  it('POST /api/motion-clips returns 201 with the created summary', async () => {
    mockMotionClipService.createClip.mockResolvedValue(SAMPLE_SUMMARY);
    const res = await request(createRouterApp()).post('/api/motion-clips').send(VALID_BODY);

    expect(res.status).toBe(201);
    expect(res.body.clip.id).toBe('clip-001');
    expect(mockMotionClipService.createClip).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'wave', fps: 30 }),
    );
  });

  it('POST /api/motion-clips surfaces BadRequestError messages verbatim as 400', async () => {
    mockMotionClipService.createClip.mockRejectedValue(
      new BadRequestError('fps must be a positive finite number'),
    );
    const res = await request(createRouterApp())
      .post('/api/motion-clips')
      .send({ ...VALID_BODY, fps: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('fps must be a positive finite number');
  });

  it('POST /api/motion-clips returns 500 on unexpected errors', async () => {
    mockMotionClipService.createClip.mockRejectedValue(new Error('disk full'));
    const res = await request(createRouterApp()).post('/api/motion-clips').send(VALID_BODY);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to create motion clip');
  });

  // ─── DELETE /:id ────────────────────────────────────────────────────

  it('DELETE /api/motion-clips/:id returns 204 on success', async () => {
    mockMotionClipService.deleteClip.mockResolvedValue(true);
    const res = await request(createRouterApp()).delete('/api/motion-clips/clip-001');

    expect(res.status).toBe(204);
    expect(mockMotionClipService.deleteClip).toHaveBeenCalledWith('clip-001');
  });

  it('DELETE /api/motion-clips/:id returns 404 when missing', async () => {
    mockMotionClipService.deleteClip.mockResolvedValue(false);
    const res = await request(createRouterApp()).delete('/api/motion-clips/nope');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Motion clip not found');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// App-level body-parser error mapping (app.ts) — clips near/over the 10 MB JSON
// limit must fail with an explanation, not "Internal server error".
// ════════════════════════════════════════════════════════════════════════════

describe('app-level body-parser error mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps oversized JSON bodies to 413 with a clear message', async () => {
    // > 10 MB payload — rejected by express.json({ limit: '10mb' }) before any route runs.
    const body = `{"pad":"${'x'.repeat(11 * 1024 * 1024)}"}`;
    const res = await request(createApp())
      .post('/api/motion-clips')
      .set('Content-Type', 'application/json')
      .send(body);

    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'Request body too large' });
    expect(mockMotionClipService.createClip).not.toHaveBeenCalled();
  });

  it('maps malformed JSON to 400 with a clear message', async () => {
    const res = await request(createApp())
      .post('/api/motion-clips')
      .set('Content-Type', 'application/json')
      .send('{"name": "wave", truncated');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Request body is not valid JSON' });
    expect(mockMotionClipService.createClip).not.toHaveBeenCalled();
  });
});
