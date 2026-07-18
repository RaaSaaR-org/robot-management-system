/**
 * @file motionclip.routes.ts
 * @description REST routes for retargeted motion clips (list / get / import / delete)
 * @feature robots
 */

import { Router, type Request, type Response } from 'express';
import { motionClipService, type CreateMotionClipRequest } from '../services/MotionClipService.js';
import { BadRequestError } from '../utils/errors.js';

export const motionClipRoutes = Router();

/**
 * GET /api/motion-clips — list clips (newest first), without frame data.
 * Optional ?limit=N (clamped to 1..1000) for callers that want fewer.
 */
motionClipRoutes.get('/', async (req: Request, res: Response) => {
  try {
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(1000, Math.max(1, Math.floor(rawLimit)))
      : undefined;
    const clips = await motionClipService.listClips(limit);
    res.json({ clips });
  } catch (error) {
    console.error('[MotionClip] list error:', error);
    res.status(500).json({ error: 'Failed to list motion clips' });
  }
});

/**
 * GET /api/motion-clips/:id — one clip including every frame (the viewer payload).
 */
motionClipRoutes.get('/:id', async (req: Request, res: Response) => {
  try {
    const clip = await motionClipService.getClip(req.params.id);
    if (!clip) {
      return res.status(404).json({ error: 'Motion clip not found' });
    }
    res.json({ clip });
  } catch (error) {
    console.error('[MotionClip] get error:', error);
    res.status(500).json({ error: 'Failed to load motion clip' });
  }
});

/**
 * POST /api/motion-clips — import an exporter JSON file. Validation failures come
 * back as 400 with the specific field, since the body is a file the user picked.
 */
motionClipRoutes.post('/', async (req: Request, res: Response) => {
  try {
    const clip = await motionClipService.createClip(req.body as CreateMotionClipRequest);
    res.status(201).json({ clip });
  } catch (error) {
    if (error instanceof BadRequestError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('[MotionClip] create error:', error);
    res.status(500).json({ error: 'Failed to create motion clip' });
  }
});

/**
 * DELETE /api/motion-clips/:id — remove a clip.
 */
motionClipRoutes.delete('/:id', async (req: Request, res: Response) => {
  try {
    const ok = await motionClipService.deleteClip(req.params.id);
    if (!ok) {
      return res.status(404).json({ error: 'Motion clip not found' });
    }
    res.status(204).send();
  } catch (error) {
    console.error('[MotionClip] delete error:', error);
    res.status(500).json({ error: 'Failed to delete motion clip' });
  }
});
