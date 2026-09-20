/**
 * @file ResearchService.ts
 * @description Append-only research records with tenant/actor scoped idempotency.
 * @feature research
 * @status live
 */
import { createHash } from 'node:crypto';
import type { Prisma, ResearchRecord as ResearchRow, ResearchModelPublication, ModelVersion } from '@prisma/client';
import { prisma } from '../database/index.js';
import { ensureDefaultTenant } from '../database/defaultTenant.js';
import { AppError } from '../utils/errors.js';
import {
  datasetAssessmentSchema, experimentRecordSchema, scientificReportSchema,
  type PublishResearchInput, type ResearchActor, type ResearchRecord, type ListResearchQuery,
  type PublishResearchModelInput,
} from '../types/research.types.js';

function bad(message: string): never { throw new AppError(message, 400, 'INVALID_RESEARCH_RECORD'); }
function conflict(): never {
  throw new AppError('Record ID or idempotency key already identifies a different publication', 409, 'RESEARCH_CONFLICT');
}

/** Stable across JSON object key order; array order remains meaningful. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Inspect provenance flags too, rather than trusting the top-level real label. */
function rejectFabricated(value: unknown): void {
  if (Array.isArray(value)) { value.forEach(rejectFabricated); return; }
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replace(/[_-]/g, '').toLowerCase();
    if (['mock', 'ismock', 'mockmode', 'dryrun', 'isdryrun'].includes(normalized) && child === true) {
      bad('Mock or dry-run evidence cannot be published as scientific research');
    }
    if (['mode', 'backend', 'executionmode', 'executionbackend'].includes(normalized)
      && typeof child === 'string' && /^(mock|dry[-_ ]?run|fixture|test)$/i.test(child)) {
      bad('Mock or dry-run evidence cannot be published as scientific research');
    }
    rejectFabricated(child);
  }
}

function validateContent(input: PublishResearchInput): void {
  if (!!input.datasetId !== !!input.datasetVersion) bad('datasetId and datasetVersion must be supplied together');
  if (input.parentId === input.id || input.supersedesId === input.id) bad('A record cannot link to itself');
  if (input.kind === 'experiment') {
    const result = experimentRecordSchema.safeParse(input.body);
    if (!result.success) bad('Experiments require frozen experiment ID, campaign, idea and SHA-256 digest');
    if (result.data.id !== input.id || result.data.campaignId !== input.campaignId || result.data.ideaId !== input.ideaId) {
      bad('Frozen experiment identifiers must match the publication envelope');
    }
  }
  if (input.kind === 'dataset-assessment') {
    rejectFabricated(input.body);
    if (!input.datasetId || !input.datasetVersion) bad('Dataset assessments require datasetId and datasetVersion');
    const result = datasetAssessmentSchema.safeParse(input.body);
    if (!result.success) bad(`Invalid dataset assessment: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
    if (input.evidence.length === 0) bad('Dataset assessments require evidence');
  }
  if (input.kind === 'report') {
    if (input.body.reportType === 'status') {
      // Operational incident records carry no scientific result. Use a separate
      // scientific record once a failed/blocked attempt yields valid evidence.
      if (!['blocked', 'failed', 'cancelled', 'needs_reconciliation'].includes(String(input.body.status))
        || typeof input.body.summary !== 'string' || !input.body.summary.trim()) {
        bad('Status reports require a failure/block/cancellation status and summary');
      }
      if (['comparisons', 'verdict', 'metrics', 'checkpoint', 'modelVersionId', 'evaluations'].some((key) => key in input.body)) {
        bad('Status reports cannot publish scientific metrics, model evidence or verdicts');
      }
      return;
    }
    rejectFabricated(input.body);
    const result = scientificReportSchema.safeParse(input.body);
    if (!result.success) bad(`Invalid scientific report: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
    if (input.evidence.length === 0) bad('Scientific reports require artifact evidence');
    const report = result.data;
    if (report.evaluations.some((evaluation) => evaluation.checkpointSha256 !== report.checkpoint.sha256)) {
      bad('Every evaluation must identify the published checkpoint');
    }
    // Receipts and checkpoint must be anchored in the publication's manifest.
    const evidence = new Set(input.evidence.map((item) => `${item.uri}\n${item.sha256}`));
    if (![report.checkpoint, ...report.evaluations.flatMap((item) => item.evidence)]
      .every((item) => evidence.has(`${item.uri}\n${item.sha256}`))) {
      bad('Checkpoint and evaluation receipts must appear in top-level evidence');
    }
  }
  if (input.body.modelVersionId !== undefined) {
    if (input.kind !== 'report' || input.body.reportType !== 'scientific') bad('Model evidence belongs in a scientific report with checkpoint receipts');
    if (typeof input.body.modelVersionId !== 'string' || !input.body.modelVersionId) bad('Invalid modelVersionId');
    rejectFabricated(input.body);
    if (input.body.executionMode !== 'real') bad('Model evidence requires executionMode real');
  }
}

function record(row: ResearchRow): ResearchRecord {
  return {
    id: row.id, kind: row.kind as PublishResearchInput['kind'], version: 1,
    idempotencyKey: row.idempotencyKey, campaignId: row.campaignId,
    ...(row.ideaId ? { ideaId: row.ideaId } : {}),
    ...(row.parentId ? { parentId: row.parentId } : {}),
    ...(row.sourceRunId ? { sourceRunId: row.sourceRunId } : {}),
    ...(row.datasetId ? { datasetId: row.datasetId, datasetVersion: row.datasetVersion! } : {}),
    ...(row.supersedesId ? { supersedesId: row.supersedesId } : {}),
    title: row.title, body: JSON.parse(row.bodyJson), evidence: JSON.parse(row.evidenceJson),
    author: { id: row.authorId, name: row.authorName, kind: row.authorKind as ResearchActor['kind'] },
    tenantId: row.tenantId, contentHash: row.contentHash, createdAt: row.createdAt.toISOString(),
  };
}

export class ResearchService {
  private async assertDataset(actor: ResearchActor, id: string, sourceRevision?: string) {
    const dataset = await prisma.dataset.findFirst({ where: { id, tenantId: actor.tenantId }, select: { id: true, sourceRevision: true } });
    if (!dataset) bad('Dataset is unavailable in this tenant');
    if (sourceRevision && dataset.sourceRevision && sourceRevision !== dataset.sourceRevision) bad('Dataset source revision differs from the catalog');
  }

  async list(actor: ResearchActor, query: ListResearchQuery) {
    const { page, pageSize, idempotencyKey, ...filters } = query;
    const where: Prisma.ResearchRecordWhereInput = {
      ...filters, tenantId: actor.tenantId,
      ...(idempotencyKey ? { idempotencyKey, authorId: actor.id } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.researchRecord.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
      prisma.researchRecord.count({ where }),
    ]);
    return { records: rows.map(record), pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async get(actor: ResearchActor, id: string) {
    const row = await prisma.researchRecord.findFirst({ where: { id, tenantId: actor.tenantId } });
    if (!row) throw new AppError('Research record not found', 404, 'RESEARCH_NOT_FOUND');
    return record(row);
  }

  async publish(actor: ResearchActor, input: PublishResearchInput) {
    validateContent(input);
    const contentHash = createHash('sha256').update(canonical(input)).digest('hex');
    const existing = await this.existing(actor, input);
    if (existing) return this.replay(existing, actor, input, contentHash);

    // Check references explicitly even when the global tenancy feature is off.
    if (input.kind === 'experiment') {
      const linkedIdea = await prisma.researchRecord.findFirst({
        where: { id: input.ideaId, tenantId: actor.tenantId, campaignId: input.campaignId, kind: 'idea' }, select: { id: true },
      });
      if (!linkedIdea) bad('Experiment idea is unavailable in this tenant and campaign');
    }
    if (input.datasetId) {
      await this.assertDataset(actor, input.datasetId, typeof input.body.datasetSourceRevision === 'string' ? input.body.datasetSourceRevision : undefined);
    }
    if (typeof input.body.modelVersionId === 'string') {
      const model = await prisma.modelVersion.findFirst({ where: { id: input.body.modelVersionId, tenantId: actor.tenantId }, select: { id: true, artifactUri: true, trainingMetrics: true } });
      if (!model) bad('Model version is unavailable in this tenant');
      const checkpoint = scientificReportSchema.parse(input.body).checkpoint;
      const modelMetrics = JSON.parse(model.trainingMetrics) as { checkpointSha256?: string };
      if (model.artifactUri !== checkpoint.uri || (modelMetrics.checkpointSha256 && modelMetrics.checkpointSha256 !== checkpoint.sha256)) {
        bad('Scientific checkpoint does not match the registered model artifact');
      }
    }
    for (const reference of [input.parentId, input.supersedesId].filter((id): id is string => !!id)) {
      const linked = await prisma.researchRecord.findFirst({ where: { id: reference, tenantId: actor.tenantId } });
      if (!linked || linked.campaignId !== input.campaignId) bad('Linked record is unavailable in this campaign');
      if (reference === input.supersedesId && (linked.kind !== input.kind || linked.datasetId !== (input.datasetId ?? null)
        || linked.datasetVersion !== (input.datasetVersion ?? null))) bad('A correction must preserve record kind and dataset version');
    }
    await ensureDefaultTenant(actor.tenantId);
    try {
      const row = await prisma.researchRecord.create({ data: {
        id: input.id, tenantId: actor.tenantId, kind: input.kind, version: input.version,
        idempotencyKey: input.idempotencyKey, campaignId: input.campaignId,
        ideaId: input.ideaId, parentId: input.parentId, sourceRunId: input.sourceRunId,
        title: input.title, bodyJson: JSON.stringify(input.body), evidenceJson: JSON.stringify(input.evidence),
        datasetId: input.datasetId, datasetVersion: input.datasetVersion, supersedesId: input.supersedesId,
        authorId: actor.id, authorName: actor.name, authorKind: actor.kind, contentHash,
      } });
      return { record: record(row), replayed: false };
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
        const raced = await this.existing(actor, input);
        if (raced) return this.replay(raced, actor, input, contentHash);
        conflict();
      }
      throw error;
    }
  }

  private existing(actor: ResearchActor, input: PublishResearchInput) {
    return prisma.researchRecord.findFirst({ where: { tenantId: actor.tenantId, OR: [
      { id: input.id }, { authorId: actor.id, idempotencyKey: input.idempotencyKey },
    ] } });
  }

  private replay(row: ResearchRow, actor: ResearchActor, input: PublishResearchInput, hash: string) {
    if (row.authorId !== actor.id || row.id !== input.id || row.idempotencyKey !== input.idempotencyKey || row.contentHash !== hash) conflict();
    return { record: record(row), replayed: true };
  }

  async listModels(actor: ResearchActor, query: ListResearchQuery) {
    const { page, pageSize, idempotencyKey, kind: _kind, ...filters } = query;
    const where: Prisma.ResearchModelPublicationWhereInput = {
      ...filters, tenantId: actor.tenantId,
      ...(idempotencyKey ? { idempotencyKey, authorId: actor.id } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.researchModelPublication.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
      prisma.researchModelPublication.count({ where }),
    ]);
    return { publications: rows.map(modelPublication), pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async publishModel(actor: ResearchActor, input: PublishResearchModelInput) {
    rejectFabricated(input);
    if (!input.evidence.some((item) => item.uri === input.artifact.uri && item.sha256 === input.artifact.sha256)) {
      bad('Model checkpoint must appear in the evidence manifest');
    }
    if (!input.datasetSources.some((source) => source.datasetId === input.datasetId && source.version === input.datasetVersion
      && source.manifestSha256 === input.datasetManifestSha256)) bad('Primary dataset must match a source in the pinned recipe');
    const contentHash = createHash('sha256').update(canonical(input)).digest('hex');
    const lookup = () => prisma.researchModelPublication.findFirst({ where: { tenantId: actor.tenantId, OR: [
      { id: input.id }, { authorId: actor.id, idempotencyKey: input.idempotencyKey },
    ] } });
    const replay = async (row: ResearchModelPublication) => {
      if (row.authorId !== actor.id || row.id !== input.id || row.idempotencyKey !== input.idempotencyKey || row.contentHash !== contentHash) conflict();
      const model = await prisma.modelVersion.findFirst({ where: { id: row.modelVersionId, tenantId: actor.tenantId } });
      if (!model) throw new AppError('Published model is unavailable; reconcile before another submission', 409, 'MODEL_RECONCILIATION_REQUIRED');
      return { modelVersion: modelResponse(model), publication: modelPublication(row), replayed: true };
    };
    const existing = await lookup();
    if (existing) return replay(existing);
    await this.assertDataset(actor, input.datasetId, input.datasetSourceRevision);
    for (const source of input.datasetSources) await this.assertDataset(actor, source.datasetId);
    if (input.parentModelVersionId && !await prisma.modelVersion.findFirst({ where: { id: input.parentModelVersionId, tenantId: actor.tenantId }, select: { id: true } })) {
      bad('Parent model is unavailable in this tenant');
    }
    await ensureDefaultTenant(actor.tenantId);
    try {
      return await prisma.$transaction(async (tx) => {
        const model = await tx.modelVersion.create({ data: {
          name: input.title, version: input.sourceRunId, artifactUri: input.artifact.uri,
          tenantId: actor.tenantId, parentModelVersionId: input.parentModelVersionId,
          sourceKind: input.parentModelVersionId ? 'derived' : 'imported', modelType: 'vla', deploymentStatus: 'staging',
          trainingMetrics: JSON.stringify({ sourceRunId: input.sourceRunId, experimentHash: input.experimentHash,
            checkpointSha256: input.artifact.sha256, datasetRecipeHash: input.datasetRecipeHash, datasetSources: input.datasetSources }),
        } });
        const publication = await tx.researchModelPublication.create({ data: {
          id: input.id, tenantId: actor.tenantId, authorId: actor.id, authorName: actor.name, authorKind: actor.kind,
          idempotencyKey: input.idempotencyKey, campaignId: input.campaignId, ideaId: input.ideaId, sourceRunId: input.sourceRunId,
          datasetId: input.datasetId, modelVersionId: model.id, inputJson: JSON.stringify(input), contentHash,
        } });
        return { modelVersion: modelResponse(model), publication: modelPublication(publication), replayed: false };
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
        const raced = await lookup();
        if (raced) return replay(raced);
        conflict();
      }
      throw error;
    }
  }
}

function modelPublication(row: ResearchModelPublication) {
  return { ...JSON.parse(row.inputJson) as PublishResearchModelInput, modelVersionId: row.modelVersionId,
    tenantId: row.tenantId, author: { id: row.authorId, name: row.authorName, kind: row.authorKind },
    contentHash: row.contentHash, createdAt: row.createdAt.toISOString() };
}
function modelResponse(row: ModelVersion) {
  return { ...row, trainingMetrics: JSON.parse(row.trainingMetrics), validationMetrics: JSON.parse(row.validationMetrics) };
}

export const researchService = new ResearchService();
