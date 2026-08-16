/**
 * @file patrol.routes.ts
 * @description REST routes for Patrol (TASK-212). Two routers:
 *              `patrolRoutes` mounted at `/api/patrol` (routes CRUD, cron
 *              validate, VDA5050 export, baseline, runs, findings + actions,
 *              start/abort proxies, places proxy) and `patrolRobotRoutes`
 *              mounted at `/api/robots` (the robot's photo upload + the UI's
 *              photo read, and the spec-named `POST /:id/agent-mode/patrol`
 *              start/abort aliases). Both sit behind `authMiddleware` like
 *              every other `/api/*` router.
 * @feature patrol
 */

import { Router, type Request, type Response } from 'express';
import { patrolService } from '../services/PatrolService.js';
import { patrolPhotoStore, PatrolPhotoKinds, isSafeIdSegment, isSafePhotoKey, type PatrolPhotoKind } from '../services/PatrolPhotoStore.js';
import { HttpClientError } from '../services/HttpClient.js';
import { AppError } from '../utils/errors.js';
import { PatrolFindingStatuses, PatrolRunStatuses, type PatrolFindingStatus, type PatrolRunStatus } from '../types/agent-mode.types.js';

export const patrolRoutes = Router();
export const patrolRobotRoutes = Router();

/** Body accepted by the robot photo upload; capped well above a 1080p JPEG. */
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

// ============================================================================
// HELPERS
// ============================================================================

function userId(req: Request): string | undefined {
  return (req as Request & { user?: { id?: string } }).user?.id;
}

function q(req: Request, name: string): string | undefined {
  const v = req.query[name];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function limitOf(req: Request, dflt: number): number {
  const n = Number(q(req, 'limit'));
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 1000) : dflt;
}

/**
 * Map an error onto a response: AppError → its status; robot transport
 * failure → 502; anything else → 500. Same shape as agent-mode.routes.
 */
function respondError(res: Response, error: unknown, action: string): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: error.message, code: error.code });
    return;
  }
  if (error instanceof HttpClientError) {
    if (error.isNetworkError()) {
      res.status(502).json({ error: 'Unable to communicate with robot agent', code: 'ROBOT_UNREACHABLE' });
      return;
    }
    // The robot's own answer (404 route unknown, 400 bad body, …) passes through.
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      res.status(error.statusCode).json(
        typeof error.responseBody === 'object' && error.responseBody !== null
          ? error.responseBody
          : { error: error.message },
      );
      return;
    }
    res.status(502).json({ error: error.message, code: 'ROBOT_ERROR' });
    return;
  }
  console.error(`[Patrol] ${action} error:`, error);
  res.status(500).json({ error: `Failed to ${action}` });
}

function parseStatusList<T extends string>(raw: string | undefined, allowed: readonly T[]): T | T[] | undefined {
  if (!raw) return undefined;
  const parts = raw.split(',').map((s) => s.trim()).filter((s): s is T => allowed.includes(s as T));
  if (parts.length === 0) return undefined;
  return parts.length === 1 ? parts[0] : parts;
}

// ============================================================================
// /api/patrol — ROUTES
// ============================================================================

/** GET /routes?robotId= — every route (newest first). */
patrolRoutes.get('/routes', async (req: Request, res: Response) => {
  try {
    res.json(await patrolService.listRoutes({ robotId: q(req, 'robotId') }));
  } catch (error) {
    respondError(res, error, 'list patrol routes');
  }
});

/** POST /routes — create. Body: name, robotId?, twinId?, checkpoints, cronExpression?, enabled?, timeWindows?, homePlaceId? */
patrolRoutes.post('/routes', async (req: Request, res: Response) => {
  try {
    res.status(201).json(await patrolService.createRoute(req.body ?? {}));
  } catch (error) {
    respondError(res, error, 'create patrol route');
  }
});

/** POST /cron/validate {cronExpression} → {valid, nextRuns[5], error?} */
patrolRoutes.post('/cron/validate', (req: Request, res: Response) => {
  const cron = (req.body as { cronExpression?: unknown } | undefined)?.cronExpression;
  if (typeof cron !== 'string' || !cron.trim()) {
    return res.status(400).json({ valid: false, nextRuns: [], error: 'cronExpression is required' });
  }
  const result = patrolService.validateCronExpression(cron.trim());
  res.status(result.valid ? 200 : 400).json(result);
});

/** GET /places?robotId= — the robot's known places (proxy to the agent). */
patrolRoutes.get('/places', async (req: Request, res: Response) => {
  const robotId = q(req, 'robotId');
  if (!robotId) return res.status(400).json({ error: 'robotId is required' });
  try {
    res.json(await patrolService.listPlaces(robotId));
  } catch (error) {
    respondError(res, error, 'list places');
  }
});

/** GET /routes/:id/export/vda5050.json */
patrolRoutes.get('/routes/:id/export/vda5050.json', async (req: Request, res: Response) => {
  try {
    const order = await patrolService.exportVda5050(req.params.id);
    res.setHeader('Content-Disposition', `attachment; filename="patrol-${req.params.id}.vda5050.json"`);
    res.json(order);
  } catch (error) {
    respondError(res, error, 'export patrol route');
  }
});

/** GET /routes/:id/baseline?window= → {runId, window, photos:{checkpointId:key}} | 404 */
patrolRoutes.get('/routes/:id/baseline', async (req: Request, res: Response) => {
  try {
    const info = await patrolService.getBaseline(req.params.id, q(req, 'window') ?? null);
    if (!info) return res.status(404).json({ error: 'No baseline run for this route', code: 'NO_BASELINE' });
    res.json(info);
  } catch (error) {
    respondError(res, error, 'get patrol baseline');
  }
});

/**
 * POST /routes/:id/start {robotId?, mode:'baseline'|'patrol', origin?} →
 * PatrolStartResult (200 even when refused; 502 when the robot is unreachable
 * — the server has then recorded a `skipped` run and raised the alert).
 */
patrolRoutes.post('/routes/:id/start', async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { robotId?: string; mode?: string; origin?: string };
    if (body.mode !== undefined && body.mode !== 'baseline' && body.mode !== 'patrol') {
      return res.status(400).json({ error: "mode must be 'baseline' or 'patrol'" });
    }
    if (body.origin !== undefined && body.origin !== 'operator' && body.origin !== 'scheduled') {
      return res.status(400).json({ error: "origin must be 'operator' or 'scheduled'" });
    }
    const outcome = await patrolService.startRun(req.params.id, {
      robotId: body.robotId,
      mode: body.mode as 'baseline' | 'patrol' | undefined,
      origin: body.origin as 'operator' | 'scheduled' | undefined,
    });
    res.status(outcome.unreachable ? 502 : 200).json(outcome.result);
  } catch (error) {
    respondError(res, error, 'start patrol');
  }
});

/** POST /routes/:id/abort {robotId?, reason?} → {ok, runId?} */
patrolRoutes.post('/routes/:id/abort', async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { robotId?: string; reason?: string };
    res.json(await patrolService.abortRun(req.params.id, body.robotId, body.reason));
  } catch (error) {
    respondError(res, error, 'abort patrol');
  }
});

/** GET /routes/:id */
patrolRoutes.get('/routes/:id', async (req: Request, res: Response) => {
  try {
    res.json(await patrolService.getRoute(req.params.id));
  } catch (error) {
    respondError(res, error, 'get patrol route');
  }
});

/** PUT /routes/:id — partial update (same body as POST). */
patrolRoutes.put('/routes/:id', async (req: Request, res: Response) => {
  try {
    res.json(await patrolService.updateRoute(req.params.id, req.body ?? {}));
  } catch (error) {
    respondError(res, error, 'update patrol route');
  }
});

/** DELETE /routes/:id → 204 */
patrolRoutes.delete('/routes/:id', async (req: Request, res: Response) => {
  try {
    await patrolService.deleteRoute(req.params.id);
    res.status(204).send();
  } catch (error) {
    respondError(res, error, 'delete patrol route');
  }
});

// ============================================================================
// /api/patrol — RUNS
// ============================================================================

/** GET /runs?routeId=&robotId=&status=&limit=50 → PatrolRun[] newest first */
patrolRoutes.get('/runs', async (req: Request, res: Response) => {
  try {
    res.json(
      await patrolService.listRuns({
        routeId: q(req, 'routeId'),
        robotId: q(req, 'robotId'),
        status: parseStatusList<PatrolRunStatus>(q(req, 'status'), PatrolRunStatuses),
        limit: limitOf(req, 50),
      }),
    );
  } catch (error) {
    respondError(res, error, 'list patrol runs');
  }
});

/** GET /runs/:runId → PatrolRun & { findings } */
patrolRoutes.get('/runs/:runId', async (req: Request, res: Response) => {
  try {
    res.json(await patrolService.getRunWithFindings(req.params.runId));
  } catch (error) {
    respondError(res, error, 'get patrol run');
  }
});

/** POST /runs/:runId/promote → {ok} (proxy to the robot: this run becomes the baseline) */
patrolRoutes.post('/runs/:runId/promote', async (req: Request, res: Response) => {
  try {
    res.json(await patrolService.promoteRun(req.params.runId));
  } catch (error) {
    respondError(res, error, 'promote patrol run');
  }
});

// ============================================================================
// /api/patrol — FINDINGS
// ============================================================================

/** GET /findings?status=&routeId=&robotId=&runId=&limit= */
patrolRoutes.get('/findings', async (req: Request, res: Response) => {
  try {
    res.json(
      await patrolService.listFindings({
        status: parseStatusList<PatrolFindingStatus>(q(req, 'status'), PatrolFindingStatuses),
        routeId: q(req, 'routeId'),
        robotId: q(req, 'robotId'),
        runId: q(req, 'runId'),
        limit: limitOf(req, 100),
      }),
    );
  } catch (error) {
    respondError(res, error, 'list patrol findings');
  }
});

/** GET /findings/:id */
patrolRoutes.get('/findings/:id', async (req: Request, res: Response) => {
  try {
    res.json(await patrolService.getFinding(req.params.id));
  } catch (error) {
    respondError(res, error, 'get patrol finding');
  }
});

/** POST /findings/:id/acknowledge → finding (status acknowledged, alert acknowledged) */
patrolRoutes.post('/findings/:id/acknowledge', async (req: Request, res: Response) => {
  try {
    res.json(await patrolService.acknowledgeFinding(req.params.id, userId(req)));
  } catch (error) {
    respondError(res, error, 'acknowledge patrol finding');
  }
});

/** POST /findings/:id/normal → finding & { robotNotified } (status dismissed_normal) */
patrolRoutes.post('/findings/:id/normal', async (req: Request, res: Response) => {
  try {
    res.json(await patrolService.markFindingNormal(req.params.id, userId(req)));
  } catch (error) {
    respondError(res, error, 'dismiss patrol finding');
  }
});

/** POST /findings/:id/escalate → finding (status escalated, incidentId when created) */
patrolRoutes.post('/findings/:id/escalate', async (req: Request, res: Response) => {
  try {
    res.json(await patrolService.escalateFinding(req.params.id, userId(req)));
  } catch (error) {
    respondError(res, error, 'escalate patrol finding');
  }
});

// ============================================================================
// /api/robots — PHOTOS + spec-named proxies
// ============================================================================

/**
 * PUT /:id/patrol-runs/:runId/photos/:key — robot upload.
 * Body: { imageB64, contentType:'image/jpeg', kind:'control'|'baseline'|'finding', checkpointId?, routeId?, capturedAt? }
 * → { ok, key, url }
 */
patrolRobotRoutes.put('/:id/patrol-runs/:runId/photos/:key', async (req: Request, res: Response) => {
  try {
    const { id: robotId, runId, key } = req.params;
    if (!isSafeIdSegment(robotId) || !isSafeIdSegment(runId) || !isSafePhotoKey(key)) {
      return res.status(400).json({ error: 'invalid robotId / runId / key' });
    }
    const body = (req.body ?? {}) as {
      imageB64?: unknown; contentType?: unknown; kind?: unknown; checkpointId?: unknown; routeId?: unknown; capturedAt?: unknown;
    };
    if (typeof body.imageB64 !== 'string' || body.imageB64.length === 0) {
      return res.status(400).json({ error: 'imageB64 is required' });
    }
    const kind: PatrolPhotoKind = PatrolPhotoKinds.includes(body.kind as PatrolPhotoKind) ? (body.kind as PatrolPhotoKind) : 'control';
    const contentType = typeof body.contentType === 'string' && body.contentType.startsWith('image/') ? body.contentType : 'image/jpeg';
    const data = Buffer.from(body.imageB64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (data.length === 0) return res.status(400).json({ error: 'imageB64 did not decode' });
    if (data.length > MAX_PHOTO_BYTES) return res.status(413).json({ error: 'photo too large' });

    const meta = await patrolPhotoStore.put({
      robotId, runId, key, data, kind, contentType,
      checkpointId: typeof body.checkpointId === 'string' ? body.checkpointId : null,
      routeId: typeof body.routeId === 'string' ? body.routeId : null,
      capturedAt: typeof body.capturedAt === 'string' ? body.capturedAt : null,
    });
    res.json({ ok: true, key: meta.key, url: `/api/robots/${robotId}/patrol-runs/${runId}/photos/${meta.key}`, kind: meta.kind, size: meta.size });
  } catch (error) {
    respondError(res, error, 'store patrol photo');
  }
});

/** GET /:id/patrol-runs/:runId/photos/:key → image/jpeg (UI). */
patrolRobotRoutes.get('/:id/patrol-runs/:runId/photos/:key', async (req: Request, res: Response) => {
  try {
    const { id: robotId, runId, key } = req.params;
    if (!isSafeIdSegment(robotId) || !isSafeIdSegment(runId) || !isSafePhotoKey(key)) {
      return res.status(400).json({ error: 'invalid robotId / runId / key' });
    }
    const stored = await patrolPhotoStore.get(robotId, runId, key);
    if (!stored) return res.status(404).json({ error: 'Photo not found', code: 'PHOTO_NOT_FOUND' });
    res.setHeader('Content-Type', stored.meta.contentType || 'image/jpeg');
    res.setHeader('Content-Length', String(stored.data.length));
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Patrol-Photo-Kind', stored.meta.kind);
    res.end(stored.data);
  } catch (error) {
    respondError(res, error, 'read patrol photo');
  }
});

/** GET /:id/patrol-runs/:runId/photos → [{key, kind, size, capturedAt, uploadedAt}] */
patrolRobotRoutes.get('/:id/patrol-runs/:runId/photos', async (req: Request, res: Response) => {
  try {
    const { id: robotId, runId } = req.params;
    if (!isSafeIdSegment(robotId) || !isSafeIdSegment(runId)) {
      return res.status(400).json({ error: 'invalid robotId / runId' });
    }
    const metas = await patrolPhotoStore.listRun(robotId, runId);
    res.json(metas.map((m) => ({ key: m.key, kind: m.kind, size: m.size, checkpointId: m.checkpointId ?? null, capturedAt: m.capturedAt ?? null, uploadedAt: m.uploadedAt })));
  } catch (error) {
    respondError(res, error, 'list patrol photos');
  }
});

/**
 * POST /:id/agent-mode/patrol {routeId, mode?, origin?} — spec-named alias of
 * `POST /api/patrol/routes/:routeId/start` with the robot in the path.
 */
patrolRobotRoutes.post('/:id/agent-mode/patrol', async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { routeId?: unknown; mode?: string; origin?: string };
    if (typeof body.routeId !== 'string' || !body.routeId) return res.status(400).json({ error: 'routeId is required' });
    if (body.mode !== undefined && body.mode !== 'baseline' && body.mode !== 'patrol') {
      return res.status(400).json({ error: "mode must be 'baseline' or 'patrol'" });
    }
    const outcome = await patrolService.startRun(body.routeId, {
      robotId: req.params.id,
      mode: body.mode as 'baseline' | 'patrol' | undefined,
      origin: body.origin === 'scheduled' ? 'scheduled' : 'operator',
    });
    res.status(outcome.unreachable ? 502 : 200).json(outcome.result);
  } catch (error) {
    respondError(res, error, 'start patrol');
  }
});

/** POST /:id/agent-mode/patrol/abort {reason?} → {ok, runId?} */
patrolRobotRoutes.post('/:id/agent-mode/patrol/abort', async (req: Request, res: Response) => {
  try {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    res.json(await patrolService.abortOnRobot(req.params.id, reason));
  } catch (error) {
    respondError(res, error, 'abort patrol');
  }
});
