/**
 * @file dataset-views.routes.ts
 * @description REST endpoints for dataset views — forking a dataset by
 *   selecting episodes instead of copying its bytes (TASK-240).
 * @feature datasets
 *
 * WHY THESE LIVE IN THEIR OWN FILE. A view IS a `Dataset` row — `kind =
 * 'view'`, a `parentDatasetId`, a resolved episode selection, empty
 * `storagePath` — so every existing dataset endpoint already serves one, and
 * every existing foreign key already points at one. What is new is the small
 * set of operations that only make sense for a fork: creating one from a
 * selection, from operator flags or from reward scores, listing what was forked
 * from a dataset, forcing the bytes onto disk, and taking one away. Putting
 * them beside 1600 lines of upload, import, episode and video plumbing would
 * bury them.
 *
 * Mounted under `/api/datasets`, because a view is a dataset.
 *
 * NOTHING HERE WALKS `parentDatasetId`. Resolution lives in exactly one place
 * (`DatasetViewService.resolve`), reached through `DatasetService`; a second
 * walker in a route handler is how the route's idea of what a view contains
 * starts to differ from the trainer's.
 */

import { Router, Request, Response } from 'express';
import { datasetService } from '../services/DatasetService.js';
import { DatasetViewError } from '../services/DatasetViewService.js';
import { AppError } from '../utils/errors.js';
import type { DatasetSelection } from '../types/dataset-view.types.js';

export const datasetViewRoutes = Router();

/** What a create-a-view request carries, whichever door it came through. */
interface ViewRequestBody {
  name?: unknown;
  description?: unknown;
}

/**
 * Answer an error in the shape the dataset endpoints already use.
 *
 * Mapped on `error.code`, never on the message: the codes are the contract
 * (`VIEW_EPISODE_OUT_OF_RANGE` tells a UI to re-read the episode table;
 * `VIEW_EMPTY_SELECTION` tells it to keep the dialog open), and message text is
 * written for people and will be reworded.
 */
function sendViewError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof DatasetViewError || error instanceof AppError) {
    res.status(error.statusCode).json({
      error: error.message,
      message: error.message,
      code: error.code,
      ...(error.context ? { context: error.context } : {}),
    });
    return;
  }
  const message = error instanceof Error ? error.message : fallback;
  console.error(`[DatasetViewRoutes] ${fallback}:`, error);
  res.status(400).json({ error: message, message, code: 'VIEW_ERROR' });
}

/** The name and description off a request body, or a 400's worth of reason. */
function readNaming(body: ViewRequestBody): { name: string; description?: string } {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    throw new DatasetViewError('name is required', 'VIEW_MALFORMED');
  }
  const description = typeof body.description === 'string' ? body.description : undefined;
  return { name, description };
}

// ============================================================================
// GET /api/datasets/views/:id — one view, addressed without its parent
// ============================================================================
//
// The ordinary `GET /api/datasets/:id` also serves a view — it is a Dataset
// row — but answers it as a dataset. This answers it as a fork: what it was
// forked from, what it selects, and whether a run has pinned it.

datasetViewRoutes.get('/views/:id', async (req: Request, res: Response) => {
  try {
    res.json({ view: await datasetService.getView(req.params.id) });
  } catch (error) {
    sendViewError(res, error, 'Failed to read view');
  }
});

// ============================================================================
// POST /api/datasets/views/:id/materialize — force the bytes onto disk
// ============================================================================
//
// Declared before the `/:id/views` routes so that a dataset whose id is
// literally "views" cannot shadow them. The escape hatch, not the normal path:
// every pass of `curate.py` rebuilds the whole directory, which is the cost
// this feature exists to avoid. Idempotent — a view that has already been
// written answers with the path it was written to and runs nothing.

datasetViewRoutes.post('/views/:id/materialize', async (req: Request, res: Response) => {
  try {
    const backend = (req.body as { backend?: unknown } | undefined)?.backend;
    if (backend !== undefined && backend !== 'native' && backend !== 'lerobot') {
      return res.status(400).json({
        error: "backend must be 'native' or 'lerobot'",
        code: 'VIEW_MALFORMED',
      });
    }
    const path = await datasetService.materializeView(req.params.id, backend);
    res.json({ datasetId: req.params.id, materializedPath: path });
  } catch (error) {
    sendViewError(res, error, 'Failed to materialize view');
  }
});

// ============================================================================
// DELETE /api/datasets/views/:id — refused while a job cites it
// ============================================================================

datasetViewRoutes.delete('/views/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await datasetService.deleteView(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'View not found', code: 'NOT_FOUND' });
    }
    res.json({ deleted: true, datasetId: req.params.id });
  } catch (error) {
    // A frozen view answers 409 here, naming the job — that is the whole of
    // copy-on-write at the metadata level: the caller duplicates instead.
    sendViewError(res, error, 'Failed to delete view');
  }
});

// ============================================================================
// GET /api/datasets/:id/views — what has been forked from this dataset
// ============================================================================

datasetViewRoutes.get('/:id/views', async (req: Request, res: Response) => {
  try {
    const views = await datasetService.listViews(req.params.id);
    res.json({ views });
  } catch (error) {
    sendViewError(res, error, 'Failed to list views');
  }
});

// ============================================================================
// POST /api/datasets/:id/views — fork by selecting episodes
// ============================================================================
//
// Body: `{ name, description?, selection: { episodes, origin } }`. Every
// `episodeIndex` is checked against the parent's episode count and every frame
// range against that episode's length, HERE, before the row is written: a
// selection that names an episode the parent does not have would otherwise
// surface as a missing file inside a training run hours later.

datasetViewRoutes.post('/:id/views', async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as ViewRequestBody & { selection?: DatasetSelection };
    const { name, description } = readNaming(body);
    const view = await datasetService.createView(req.params.id, {
      name,
      description,
      selection: body.selection as DatasetSelection,
    });
    res.status(201).json({ view });
  } catch (error) {
    sendViewError(res, error, 'Failed to create view');
  }
});

// ============================================================================
// POST /api/datasets/:id/views/from-flags — fork on operator judgement
// ============================================================================
//
// `decision: 'keep'` takes the episodes somebody explicitly kept.
// `decision: 'remove'` takes everything NOT explicitly removed — "drop the bad
// ones", which includes every episode nobody has looked at yet.
//
// The flags are read once, now, and stored as a list of episodes. A later
// review does not change this view; it makes a different one.

datasetViewRoutes.post('/:id/views/from-flags', async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as ViewRequestBody & { decision?: unknown };
    const { name, description } = readNaming(body);
    const decision = body.decision;
    if (decision !== 'keep' && decision !== 'remove') {
      return res.status(400).json({
        error: "decision must be 'keep' (only episodes marked keep) or 'remove' (everything not "
          + 'marked remove)',
        code: 'VIEW_MALFORMED',
      });
    }
    const selection = await datasetService.selectionFromFlags(req.params.id, decision);
    const view = await datasetService.createView(req.params.id, { name, description, selection });
    res.status(201).json({ view });
  } catch (error) {
    sendViewError(res, error, 'Failed to create view from flags');
  }
});

// ============================================================================
// POST /api/datasets/:id/views/from-rewards — fork on reward-model scores
// ============================================================================
//
// The scores are read ONCE and written out as an episode list. A reward job
// that re-scores this dataset tomorrow does not change what this view means —
// that is the difference between an experiment arm somebody can reproduce and
// a result nobody can explain a month later. `origin` keeps the threshold for
// a human to read; the episode list is the truth.

datasetViewRoutes.post('/:id/views/from-rewards', async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as ViewRequestBody & {
      rewardType?: unknown;
      minScore?: unknown;
    };
    const { name, description } = readNaming(body);
    const rewardType = body.rewardType ?? 'robometer';
    if (rewardType !== 'robometer' && rewardType !== 'topreward') {
      return res.status(400).json({
        error: "rewardType must be 'robometer' or 'topreward'",
        code: 'VIEW_MALFORMED',
      });
    }
    if (typeof body.minScore !== 'number' || !Number.isFinite(body.minScore)) {
      return res.status(400).json({
        error: 'minScore must be a finite number — the score an episode has to reach to be kept',
        code: 'VIEW_MALFORMED',
      });
    }
    const selection = await datasetService.selectionFromRewards(
      req.params.id,
      rewardType,
      body.minScore,
    );
    const view = await datasetService.createView(req.params.id, { name, description, selection });
    res.status(201).json({ view });
  } catch (error) {
    sendViewError(res, error, 'Failed to create view from rewards');
  }
});
