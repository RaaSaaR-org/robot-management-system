/**
 * @file research.types.ts
 * @description Versioned, immutable internal research publication contracts.
 * @feature research
 * @status live
 */
import { z } from 'zod';

export const RESEARCH_KINDS = ['idea', 'experiment', 'report', 'external-job', 'dataset-assessment'] as const;
const identifier = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const sha256 = z.string().regex(/^[a-fA-F0-9]{64}$/).transform((value) => value.toLowerCase());
const artifactUri = z.string().max(4096).refine((value) => {
  try {
    const url = new URL(value);
    return ['https:', 'http:', 's3:', 'hf:', 'file:'].includes(url.protocol)
      && !url.username && !url.password && !url.search && !url.hash
      && (url.protocol === 'file:' ? url.pathname.startsWith('/') : !!url.hostname);
  } catch { return false; }
}, 'Expected an absolute http(s), s3, hf or file URI without credentials, query or fragment');

export const researchEvidenceSchema = z.object({ uri: artifactUri, sha256 }).strict();
export const publishResearchSchema = z.object({
  id: identifier,
  kind: z.enum(RESEARCH_KINDS),
  version: z.literal(1),
  idempotencyKey: z.string().min(1).max(200),
  campaignId: identifier,
  ideaId: identifier.optional(),
  parentId: identifier.optional(),
  sourceRunId: identifier.optional(),
  title: z.string().trim().min(1).max(300),
  body: z.record(z.string(), z.unknown()),
  evidence: z.array(researchEvidenceSchema).max(200),
  datasetId: identifier.optional(),
  datasetVersion: z.string().min(1).max(200).optional(),
  supersedesId: identifier.optional(),
}).strict();

export const datasetAssessmentSchema = z.object({
  datasetManifestSha256: sha256,
  datasetSourceRevision: z.string().min(1).max(200).optional(),
  task: z.string().trim().min(1).max(1000),
  model: z.string().trim().min(1).max(1000),
  rubricVersion: z.string().trim().min(1).max(100),
  comment: z.string().trim().min(1).max(20000),
  dimensions: z.record(z.string().min(1).max(100), z.object({
    score: z.number().min(0).max(100).nullable(),
    rationale: z.string().trim().min(1).max(4000),
  }).strict()).refine((value) => Object.keys(value).length > 0, 'At least one rubric dimension is required'),
  confidence: z.number().min(0).max(1),
  limitations: z.array(z.string().min(1).max(4000)).max(100),
}).passthrough();

/** The publisher's complete frozen experiment is retained alongside its digest. */
export const experimentRecordSchema = z.object({
  id: identifier,
  campaignId: identifier,
  ideaId: identifier,
  experimentHash: sha256,
}).passthrough();

export const publishResearchModelSchema = z.object({
  id: identifier,
  version: z.literal(1),
  idempotencyKey: z.string().min(1).max(200),
  campaignId: identifier,
  ideaId: identifier.optional(),
  sourceRunId: identifier,
  experimentHash: sha256,
  title: z.string().trim().min(1).max(300),
  artifact: researchEvidenceSchema,
  datasetId: identifier,
  datasetVersion: z.string().min(1).max(200),
  datasetManifestSha256: sha256,
  datasetSourceRevision: z.string().min(1).max(200).optional(),
  datasetRecipeHash: sha256,
  datasetSources: z.array(z.object({
    datasetId: identifier,
    version: z.string().min(1).max(200),
    manifestSha256: sha256,
    weight: z.number().positive(),
    episodeIds: z.array(z.string().min(1)),
  }).strict()).min(1),
  parentModelVersionId: identifier.optional(),
  executionMode: z.literal('real'),
  evidence: z.array(researchEvidenceSchema).min(1).max(200),
}).strict();
export type PublishResearchModelInput = z.infer<typeof publishResearchModelSchema>;

export const scientificReportSchema = z.object({
  reportType: z.literal('scientific'),
  executionMode: z.literal('real'),
  verdict: z.enum(['supported', 'refuted', 'inconclusive', 'invalid']),
  experimentHash: sha256,
  checkpoint: researchEvidenceSchema,
  evaluations: z.array(z.object({
    engine: z.enum(['isaac', 'mujoco']),
    executionMode: z.literal('real'),
    engineVersion: z.string().trim().min(1).max(300),
    checkpointSha256: sha256,
    protocolHash: sha256,
    evidence: z.array(researchEvidenceSchema).min(1).max(200),
  }).passthrough()).min(1),
  comparisons: z.array(z.record(z.string(), z.unknown())).min(1),
  prediction: z.record(z.string(), z.unknown()),
  limitations: z.array(z.string()),
}).passthrough();

export const listResearchSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  kind: z.enum(RESEARCH_KINDS).optional(),
  campaignId: identifier.optional(),
  ideaId: identifier.optional(),
  datasetId: identifier.optional(),
  sourceRunId: identifier.optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
}).strict();

export type PublishResearchInput = z.infer<typeof publishResearchSchema>;
export type ListResearchQuery = z.infer<typeof listResearchSchema>;
export interface ResearchActor { id: string; name: string; kind: 'human' | 'service'; tenantId: string }
export interface ResearchRecord extends PublishResearchInput {
  author: Omit<ResearchActor, 'tenantId'>;
  tenantId: string;
  createdAt: string;
  contentHash: string;
}
