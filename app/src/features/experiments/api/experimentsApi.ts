/**
 * @file experimentsApi.ts
 * @description REST client for `/api/experiments` (TASK-242).
 * @feature experiments
 */

import { apiClient } from '@/api/client';
import type { Experiment, ExperimentStatus } from '../types/experiment.types';

const id = (s: string) => encodeURIComponent(s);

export const experimentsApi = {
  async list(filter: { status?: ExperimentStatus; modelVersionId?: string } = {}): Promise<Experiment[]> {
    return (await apiClient.get<{ experiments: Experiment[] }>('/experiments', { params: filter })).data.experiments;
  },

  async get(experimentId: string): Promise<Experiment> {
    return (await apiClient.get<{ experiment: Experiment }>(`/experiments/${id(experimentId)}`)).data.experiment;
  },

  async approve(experimentId: string): Promise<Experiment> {
    return (await apiClient.post<{ experiment: Experiment }>(`/experiments/${id(experimentId)}/approve`)).data.experiment;
  },

  async reject(experimentId: string, reason?: string): Promise<Experiment> {
    return (await apiClient.post<{ experiment: Experiment }>(`/experiments/${id(experimentId)}/reject`, { reason })).data.experiment;
  },

  async cancel(experimentId: string): Promise<Experiment> {
    return (await apiClient.post<{ experiment: Experiment }>(`/experiments/${id(experimentId)}/cancel`)).data.experiment;
  },
};
