/** @file research.types.ts @description Internal publication response types. @feature research */
export type ResearchKind = 'idea' | 'experiment' | 'report' | 'external-job' | 'dataset-assessment';
export interface ResearchRecord {
  id: string;
  kind: ResearchKind;
  version: 1;
  campaignId: string;
  ideaId?: string;
  parentId?: string;
  sourceRunId?: string;
  datasetId?: string;
  datasetVersion?: string;
  supersedesId?: string;
  title: string;
  body: Record<string, unknown>;
  evidence: { uri: string; sha256: string }[];
  author: { id: string; name: string; kind: 'human' | 'service' };
  createdAt: string;
  contentHash: string;
}
export interface ResearchList {
  records: ResearchRecord[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}
