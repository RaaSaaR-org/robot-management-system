/**
 * @file social.routes.ts
 * @description Comments, ratings, summaries and the activity feed over
 *   datasets, views, model versions, episodes and training jobs (TASK-241).
 *   Mounted at `/api/social`.
 * @feature social
 */

import { Router, type Response } from 'express';
import { AppError } from '../utils/errors.js';
import { sendFailure } from '../utils/routeErrors.js';
import { resolveSocialActor, type SocialRequest } from '../middleware/socialActor.js';
import { socialService, isActorType, isSubjectType } from '../services/SocialService.js';
import type { Actor, CreateCommentInput, PutRatingInput } from '../types/social.types.js';

export const socialRoutes = Router();

socialRoutes.use(resolveSocialActor);

/** Answer with `{ error, message, code, context? }` — the code is the contract. */
function sendSocialError(res: Response, error: unknown, fallback: string): void {
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

function actorOf(req: SocialRequest): Actor {
  // resolveSocialActor runs first on every route of this router.
  return req.actor!;
}

function subjectParams(req: SocialRequest, episodeIndex: unknown) {
  return socialService.resolveSubject(req.params.subjectType, req.params.subjectId, episodeIndex);
}

// ---------------------------------------------------------------------------
// Who am I, feed — declared before the /:subjectType routes
// ---------------------------------------------------------------------------

/** The actor this request speaks as, so a UI can offer edit/delete on its own rows. */
socialRoutes.get('/me', (req: SocialRequest, res: Response) => {
  res.json({ actor: actorOf(req) });
});

socialRoutes.get('/feed', async (req: SocialRequest, res: Response) => {
  try {
    const { actorType, subjectType, limit } = req.query;
    if (actorType !== undefined && !isActorType(actorType)) {
      res.status(400).json({ error: 'Unknown actorType', message: 'Unknown actorType', code: 'SOCIAL_FEED_INVALID' });
      return;
    }
    if (subjectType !== undefined && !isSubjectType(subjectType)) {
      res.status(400).json({ error: 'Unknown subjectType', message: 'Unknown subjectType', code: 'SOCIAL_FEED_INVALID' });
      return;
    }
    const n = limit === undefined ? undefined : Number(limit);
    if (n !== undefined && (!Number.isFinite(n) || n < 1)) {
      res.status(400).json({ error: 'limit must be a positive number', message: 'limit must be a positive number', code: 'SOCIAL_FEED_INVALID' });
      return;
    }
    const items = await socialService.feed({ actorType, subjectType, limit: n });
    res.json({ items });
  } catch (error) {
    sendSocialError(res, error, 'Failed to load the activity feed');
  }
});

// ---------------------------------------------------------------------------
// Comment edits by id
// ---------------------------------------------------------------------------

socialRoutes.patch('/comments/:id', async (req: SocialRequest, res: Response) => {
  try {
    const comment = await socialService.editComment(req.params.id, actorOf(req), req.body?.body);
    res.json({ comment });
  } catch (error) {
    sendSocialError(res, error, 'Failed to edit comment');
  }
});

socialRoutes.delete('/comments/:id', async (req: SocialRequest, res: Response) => {
  try {
    const comment = await socialService.deleteComment(req.params.id, actorOf(req));
    res.json({ comment });
  } catch (error) {
    sendSocialError(res, error, 'Failed to delete comment');
  }
});

// ---------------------------------------------------------------------------
// Per-subject
// ---------------------------------------------------------------------------

socialRoutes.get('/:subjectType/:subjectId/comments', async (req: SocialRequest, res: Response) => {
  try {
    const subject = await subjectParams(req, req.query.episodeIndex);
    res.json({ threads: await socialService.listThreads(subject) });
  } catch (error) {
    sendSocialError(res, error, 'Failed to load comments');
  }
});

socialRoutes.post('/:subjectType/:subjectId/comments', async (req: SocialRequest, res: Response) => {
  try {
    const body = (req.body ?? {}) as CreateCommentInput;
    const subject = await subjectParams(req, body.episodeIndex ?? req.query.episodeIndex);
    const comment = await socialService.createComment(subject, actorOf(req), body);
    res.status(201).json({ comment });
  } catch (error) {
    sendSocialError(res, error, 'Failed to create comment');
  }
});

socialRoutes.get('/:subjectType/:subjectId/rating', async (req: SocialRequest, res: Response) => {
  try {
    const subject = await subjectParams(req, req.query.episodeIndex);
    const [mine, ratings] = await Promise.all([
      socialService.getMyRating(subject, actorOf(req)),
      socialService.getRatings(subject),
    ]);
    res.json({ mine, ratings });
  } catch (error) {
    sendSocialError(res, error, 'Failed to load ratings');
  }
});

socialRoutes.put('/:subjectType/:subjectId/rating', async (req: SocialRequest, res: Response) => {
  try {
    const body = (req.body ?? {}) as PutRatingInput;
    const subject = await subjectParams(req, body.episodeIndex ?? req.query.episodeIndex);
    const { rating, created } = await socialService.putRating(subject, actorOf(req), body);
    res.status(created ? 201 : 200).json({ rating });
  } catch (error) {
    sendSocialError(res, error, 'Failed to save rating');
  }
});

socialRoutes.get('/:subjectType/:subjectId/summary', async (req: SocialRequest, res: Response) => {
  try {
    const subject = await subjectParams(req, req.query.episodeIndex);
    res.json({ summary: await socialService.summary(subject) });
  } catch (error) {
    sendSocialError(res, error, 'Failed to load summary');
  }
});
