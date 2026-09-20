/**
 * @file research.routes.ts
 * @description Authenticated internal research publications; records are immutable.
 * @feature research
 * @status live
 */
import { Router, type Response } from 'express';
import { type AuthenticatedRequest, memberOrAbove } from '../middleware/auth.middleware.js';
import { getTenantId } from '../middleware/tenantContext.js';
import { researchService } from '../services/ResearchService.js';
import { listResearchSchema, publishResearchSchema, publishResearchModelSchema, type ResearchActor } from '../types/research.types.js';
import { AppError } from '../utils/errors.js';
import { sendFailure } from '../utils/routeErrors.js';

export const researchRoutes = Router();

function actor(req: AuthenticatedRequest): ResearchActor {
  if (!req.user) throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
  const tenantId = getTenantId() ?? req.user.tenantId;
  if (!tenantId) throw new AppError('Select a tenant before accessing research records', 403, 'TENANT_REQUIRED');
  return { id: req.user.id, name: req.user.name, kind: req.user.authType ?? 'human', tenantId };
}

researchRoutes.get('/records', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const query = listResearchSchema.safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: 'Invalid research filters or pagination', code: 'INVALID_QUERY' });
    res.json(await researchService.list(actor(req), query.data));
  } catch (error) { sendFailure(res, error, 'Failed to list research records'); }
});

researchRoutes.get('/records/:id', async (req: AuthenticatedRequest, res: Response) => {
  try { res.json({ record: await researchService.get(actor(req), req.params.id) }); }
  catch (error) { sendFailure(res, error, 'Failed to read research record'); }
});

researchRoutes.post('/records', memberOrAbove, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const identity = actor(req);
    const input = publishResearchSchema.safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: 'Invalid research publication envelope', code: 'INVALID_RECORD', fields: input.error.issues.map((issue) => issue.path.join('.')) });
    const result = await researchService.publish(identity, input.data);
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) { sendFailure(res, error, 'Failed to publish research record'); }
});

researchRoutes.get('/models', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const query = listResearchSchema.omit({ kind: true }).safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: 'Invalid model publication filters', code: 'INVALID_QUERY' });
    res.json(await researchService.listModels(actor(req), query.data));
  } catch (error) { sendFailure(res, error, 'Failed to list model publications'); }
});

researchRoutes.post('/models', memberOrAbove, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const identity = actor(req);
    const input = publishResearchModelSchema.safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: 'Invalid model publication envelope', code: 'INVALID_MODEL_PUBLICATION', fields: input.error.issues.map((issue) => issue.path.join('.')) });
    const result = await researchService.publishModel(identity, input.data);
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) { sendFailure(res, error, 'Failed to publish research model'); }
});
