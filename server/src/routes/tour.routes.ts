/**
 * @file tour.routes.ts
 * @description REST routes for host mode (TASK-213), mounted at `/api/tour`:
 *              tour routes CRUD, the start/abort proxies to the robot, run
 *              history and the place list the route editor picks stops from.
 *              Behind `authMiddleware` like every other `/api/*` router.
 *
 *              No photo router and no `/api/robots` aliases: a tour stores no
 *              images at all (that is the point of host mode's privacy rule),
 *              so there is nothing for the robot to upload.
 * @feature tour
 */

import { Router, type Request, type Response } from 'express';
import { tourService } from '../services/TourService.js';
// The place list is a proxy to the robot's `GET /places` and PatrolService
// already owns it. Host mode picks stops from the same graph patrol picks
// checkpoints from, so this reuses that call rather than growing a second copy
// of the robot lookup + response normalisation.
import { patrolService } from '../services/PatrolService.js';
import { HttpClientError } from '../services/HttpClient.js';
import { AppError } from '../utils/errors.js';
import { TourRunStatuses, type TourRunStatus } from '../types/agent-mode.types.js';

export const tourRoutes = Router();

// ============================================================================
// HELPERS
// ============================================================================

function q(req: Request, name: string): string | undefined {
  const v = req.query[name];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function limitOf(req: Request, dflt: number): number {
  const n = Number(q(req, 'limit'));
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 1000) : dflt;
}

/**
 * Map an error onto a response: AppError → its status; robot transport failure
 * → 502; the robot's own 4xx passes through. Same shape as patrol.routes.
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
  console.error(`[Tour] ${action} error:`, error);
  res.status(500).json({ error: `Failed to ${action}` });
}

function parseStatusList<T extends string>(raw: string | undefined, allowed: readonly T[]): T | T[] | undefined {
  if (!raw) return undefined;
  const parts = raw.split(',').map((s) => s.trim()).filter((s): s is T => allowed.includes(s as T));
  if (parts.length === 0) return undefined;
  return parts.length === 1 ? parts[0] : parts;
}

// ============================================================================
// /api/tour — ROUTES
// ============================================================================

/** GET /routes?robotId= — every tour route (newest first). */
tourRoutes.get('/routes', async (req: Request, res: Response) => {
  try {
    res.json(await tourService.listRoutes({ robotId: q(req, 'robotId') }));
  } catch (error) {
    respondError(res, error, 'list tour routes');
  }
});

/** POST /routes — create. Body: name, greetingPlaceId, greeting, stops[…] + the optional rest. */
tourRoutes.post('/routes', async (req: Request, res: Response) => {
  try {
    res.status(201).json(await tourService.createRoute(req.body ?? {}));
  } catch (error) {
    respondError(res, error, 'create tour route');
  }
});

/** GET /places?robotId= — the robot's known places (proxy to the agent, shared with patrol). */
tourRoutes.get('/places', async (req: Request, res: Response) => {
  const robotId = q(req, 'robotId');
  if (!robotId) return res.status(400).json({ error: 'robotId is required' });
  try {
    res.json(await patrolService.listPlaces(robotId));
  } catch (error) {
    respondError(res, error, 'list places');
  }
});

/**
 * POST /routes/:id/start {robotId?, origin?} → TourStartResult (200 even when
 * the robot refuses — it then emits a `skipped` run, which ingest alerts on;
 * 502 when the robot could not be reached at all).
 */
tourRoutes.post('/routes/:id/start', async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { robotId?: string; origin?: string };
    if (body.origin !== undefined && body.origin !== 'visitor' && body.origin !== 'operator') {
      return res.status(400).json({ error: "origin must be 'visitor' or 'operator'" });
    }
    const outcome = await tourService.startRun(req.params.id, {
      robotId: body.robotId,
      origin: body.origin as 'visitor' | 'operator' | undefined,
    });
    res.status(outcome.unreachable ? 502 : 200).json(outcome.result);
  } catch (error) {
    respondError(res, error, 'start tour');
  }
});

/** POST /routes/:id/abort {robotId?, reason?} → {ok, runId?} */
tourRoutes.post('/routes/:id/abort', async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { robotId?: string; reason?: string };
    res.json(await tourService.abortRun(req.params.id, body.robotId, body.reason));
  } catch (error) {
    respondError(res, error, 'abort tour');
  }
});

/** GET /routes/:id */
tourRoutes.get('/routes/:id', async (req: Request, res: Response) => {
  try {
    res.json(await tourService.getRoute(req.params.id));
  } catch (error) {
    respondError(res, error, 'get tour route');
  }
});

/** PUT /routes/:id — partial update (same body as POST). */
tourRoutes.put('/routes/:id', async (req: Request, res: Response) => {
  try {
    res.json(await tourService.updateRoute(req.params.id, req.body ?? {}));
  } catch (error) {
    respondError(res, error, 'update tour route');
  }
});

/** DELETE /routes/:id → 204. The route's runs survive it. */
tourRoutes.delete('/routes/:id', async (req: Request, res: Response) => {
  try {
    await tourService.deleteRoute(req.params.id);
    res.status(204).send();
  } catch (error) {
    respondError(res, error, 'delete tour route');
  }
});

// ============================================================================
// /api/tour — RUNS
// ============================================================================

/** GET /runs?routeId=&robotId=&status=&limit=50 → TourRun[] newest first */
tourRoutes.get('/runs', async (req: Request, res: Response) => {
  try {
    res.json(
      await tourService.listRuns({
        routeId: q(req, 'routeId'),
        robotId: q(req, 'robotId'),
        status: parseStatusList<TourRunStatus>(q(req, 'status'), TourRunStatuses),
        limit: limitOf(req, 50),
      }),
    );
  } catch (error) {
    respondError(res, error, 'list tour runs');
  }
});

/** GET /runs/:runId → TourRun (legs + the Q&A transcript). */
tourRoutes.get('/runs/:runId', async (req: Request, res: Response) => {
  try {
    res.json(await tourService.getRun(req.params.runId));
  } catch (error) {
    respondError(res, error, 'get tour run');
  }
});
