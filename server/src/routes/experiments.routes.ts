/**
 * @file experiments.routes.ts
 * @description The experiment loop (TASK-242), mounted at `/api/experiments`:
 *   propose, list, read, approve, reject, cancel, and the arms of one.
 * @feature training
 *
 * Every route speaks as an Actor (resolveSocialActor): an agent proposes with
 * `X-Agent-Name`, a person approves. The service refuses an agent approval.
 */

import { Router, type Response } from 'express';
import { AppError } from '../utils/errors.js';
import { sendFailure } from '../utils/routeErrors.js';
import { resolveSocialActor, type SocialRequest } from '../middleware/socialActor.js';
import { experimentService } from '../services/ExperimentService.js';
import { experimentProposer, isProposerStrategy } from '../services/ExperimentProposer.js';
import { EXPERIMENT_STATUSES, type ExperimentStatus, type ProposeExperimentInput } from '../types/experiment.types.js';

export const experimentsRoutes = Router();

experimentsRoutes.use(resolveSocialActor);

/** Answer with `{ error, message, code, context? }` — the code is the contract. */
function sendExperimentError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      error: error.message,
      message: error.message,
      code: error.code,
      ...(error.context ? { context: error.context } : {}),
    });
    return;
  }
  sendFailure(res, error, fallback);
}

// POST /api/experiments — propose. Runs nothing.
experimentsRoutes.post('/', async (req: SocialRequest, res: Response) => {
  try {
    const experiment = await experimentService.propose(req.body as ProposeExperimentInput, req.actor!);
    res.status(201).json({ experiment });
  } catch (error) {
    sendExperimentError(res, error, 'Failed to propose experiment');
  }
});

// POST /api/experiments/propose/:strategy — the deterministic proposer
// (data-ablation | lr-sweep) composes the arms, then proposes as above.
experimentsRoutes.post('/propose/:strategy', async (req: SocialRequest, res: Response) => {
  try {
    const strategy = req.params.strategy;
    if (!isProposerStrategy(strategy)) {
      res.status(400).json({
        error: "strategy must be 'data-ablation' or 'lr-sweep'",
        message: "strategy must be 'data-ablation' or 'lr-sweep'",
        code: 'EXPERIMENT_STRATEGY_INVALID',
      });
      return;
    }
    const input = await experimentProposer.compose(strategy, req.body ?? {});
    const experiment = await experimentService.propose(input, req.actor!);
    res.status(201).json({ experiment });
  } catch (error) {
    sendExperimentError(res, error, 'Failed to compose experiment');
  }
});

// GET /api/experiments?status=&modelVersionId=
experimentsRoutes.get('/', async (req: SocialRequest, res: Response) => {
  try {
    const { status, modelVersionId, limit } = req.query;
    if (status !== undefined && !EXPERIMENT_STATUSES.includes(status as ExperimentStatus)) {
      res.status(400).json({ error: 'Unknown status', message: 'Unknown status', code: 'EXPERIMENT_INVALID' });
      return;
    }
    const experiments = await experimentService.list({
      status: status as string | undefined,
      modelVersionId: typeof modelVersionId === 'string' && modelVersionId ? modelVersionId : undefined,
      limit: limit === undefined ? undefined : Number(limit) || undefined,
    });
    res.json({ experiments });
  } catch (error) {
    sendExperimentError(res, error, 'Failed to list experiments');
  }
});

experimentsRoutes.get('/:id', async (req: SocialRequest, res: Response) => {
  try {
    res.json({ experiment: await experimentService.get(req.params.id) });
  } catch (error) {
    sendExperimentError(res, error, 'Failed to load experiment');
  }
});

experimentsRoutes.get('/:id/arms', async (req: SocialRequest, res: Response) => {
  try {
    const experiment = await experimentService.get(req.params.id);
    res.json({ arms: experiment.arms, baselineArmId: experiment.baselineArmId });
  } catch (error) {
    sendExperimentError(res, error, 'Failed to load arms');
  }
});

// POST /api/experiments/:id/approve — the human gate; submits one job per arm.
experimentsRoutes.post('/:id/approve', async (req: SocialRequest, res: Response) => {
  try {
    res.json({ experiment: await experimentService.approve(req.params.id, req.actor!) });
  } catch (error) {
    sendExperimentError(res, error, 'Failed to approve experiment');
  }
});

experimentsRoutes.post('/:id/reject', async (req: SocialRequest, res: Response) => {
  try {
    const reason = (req.body ?? {}).reason;
    res.json({ experiment: await experimentService.reject(req.params.id, req.actor!, reason) });
  } catch (error) {
    sendExperimentError(res, error, 'Failed to reject experiment');
  }
});

// POST /api/experiments/:id/cancel — cancels outstanding training jobs too.
experimentsRoutes.post('/:id/cancel', async (req: SocialRequest, res: Response) => {
  try {
    res.json({ experiment: await experimentService.cancel(req.params.id, req.actor!) });
  } catch (error) {
    sendExperimentError(res, error, 'Failed to cancel experiment');
  }
});
