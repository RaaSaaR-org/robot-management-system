/** @file presentation.ts @description Read publication summaries without assuming a body schema. @feature research */
import type { ResearchRecord } from '../types/research.types';

export const kinds = [
  { value: 'idea', label: 'Ideas' }, { value: 'experiment', label: 'Experiments' },
  { value: 'report', label: 'Reports' }, { value: 'external-job', label: 'External jobs' },
  { value: 'dataset-assessment', label: 'Dataset assessments' },
];
export const kindLabel = (kind: string) => ({ idea: 'Idea', experiment: 'Experiment', report: 'Report', 'external-job': 'External job', 'dataset-assessment': 'Dataset assessment' })[kind] ?? kind;
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export const text = (value: unknown) => typeof value === 'string' ? value : undefined;
export const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
export const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
export const recordLink = (id: string, query = '') => `/research/${encodeURIComponent(id)}${query ? `?${query}` : ''}`;
export const campaignLink = (id: string) => `/research?${new URLSearchParams({ campaignId: id })}`;
export const readable = (value: string) => value.replace(/[_-]/g, ' ');
export function narrative(record: ResearchRecord) {
  const body = record.body;
  return text(body.comment) ?? text(body.summary) ?? text(body.hypothesis) ?? text(object(body.proposal).hypothesis);
}
export function recordStatus(record: ResearchRecord) {
  return text(record.body.state) ?? text(record.body.status) ?? text(record.body.verdict);
}
