/** @file researchApi.ts @description Read-only internal research API. @feature research */
import { apiClient } from '@/api/client';
import type { ResearchList, ResearchRecord } from '../types/research.types';

export const researchApi = {
  async list(query: string, signal?: AbortSignal): Promise<ResearchList> {
    return (await apiClient.get<ResearchList>(`/research/records?${query}`, { signal })).data;
  },
  async get(id: string, signal?: AbortSignal): Promise<ResearchRecord> {
    return (await apiClient.get<{ record: ResearchRecord }>(`/research/records/${encodeURIComponent(id)}`, { signal })).data.record;
  },
};
