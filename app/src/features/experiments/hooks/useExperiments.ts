/**
 * @file useExperiments.ts
 * @description Load the experiment list or one experiment, with the human
 *   actions (approve, reject, cancel) that change it (TASK-242). A running
 *   experiment is re-read every 10 s, since its arms advance on their own.
 * @feature experiments
 */

import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '@/shared/components/ui';
import { experimentsApi } from '../api/experimentsApi';
import type { Experiment, ExperimentStatus } from '../types/experiment.types';

const POLL_MS = 10_000;

export function useExperiments(filter: { status?: ExperimentStatus; modelVersionId?: string } = {}) {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { status, modelVersionId } = filter;

  const reload = useCallback(async () => {
    try {
      setExperiments(await experimentsApi.list({ status, modelVersionId }));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [status, modelVersionId]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  return { experiments, loading, error, reload };
}

export function useExperiment(experimentId: string | undefined) {
  const [experiment, setExperiment] = useState<Experiment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!experimentId) return;
    try {
      setExperiment(await experimentsApi.get(experimentId));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [experimentId]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  const running = experiment?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(t);
  }, [running, reload]);

  const act = useCallback(
    async (fn: () => Promise<Experiment>) => {
      const next = await fn();
      setExperiment(next);
      return next;
    },
    []
  );

  return {
    experiment,
    loading,
    error,
    reload,
    approve: () => act(() => experimentsApi.approve(experimentId!)),
    reject: (reason?: string) => act(() => experimentsApi.reject(experimentId!, reason)),
    cancel: () => act(() => experimentsApi.cancel(experimentId!)),
  };
}
