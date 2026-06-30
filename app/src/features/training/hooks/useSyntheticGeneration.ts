/**
 * @file useSyntheticGeneration.ts
 * @description Drives the Cosmos 3 synthetic-episode generation flow: fetches
 *   generator config, starts a job, and polls its progress until terminal.
 * @feature training
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { syntheticApi } from '../api/syntheticApi';
import type {
  CosmosJobStatus,
  CosmosSyntheticConfig,
  CosmosSyntheticJob,
  GenerateSyntheticInput,
} from '../types';

const ACTIVE: CosmosJobStatus[] = ['queued', 'generating', 'converting', 'registering'];
const POLL_MS = 1500;
/** Tolerate transient poll failures (~6s) before giving up on a running job. */
const MAX_POLL_FAILURES = 4;

function isActive(status?: CosmosJobStatus): boolean {
  return !!status && ACTIVE.includes(status);
}

function errMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message?: unknown }).message ?? fallback);
  }
  return fallback;
}

export interface UseSyntheticGenerationReturn {
  config: CosmosSyntheticConfig | null;
  configLoading: boolean;
  job: CosmosSyntheticJob | null;
  isGenerating: boolean;
  isStarting: boolean;
  error: string | null;
  start: (input: GenerateSyntheticInput) => Promise<CosmosSyntheticJob | null>;
  cancel: () => Promise<void>;
  reset: () => void;
  refreshConfig: () => Promise<void>;
}

export function useSyntheticGeneration(): UseSyntheticGenerationReturn {
  const [config, setConfig] = useState<CosmosSyntheticConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [job, setJob] = useState<CosmosSyntheticJob | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const refreshConfig = useCallback(async () => {
    setConfigLoading(true);
    try {
      setConfig(await syntheticApi.getConfig());
    } catch (err) {
      setError(errMessage(err, 'Failed to load generator config'));
    } finally {
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshConfig();
    return () => stopPolling();
  }, [refreshConfig, stopPolling]);

  const poll = useCallback(
    (id: string) => {
      stopPolling();
      let failures = 0;
      pollRef.current = setInterval(async () => {
        try {
          const next = await syntheticApi.getJob(id);
          failures = 0;
          setJob(next);
          if (!isActive(next.status)) stopPolling();
        } catch (err) {
          // A blip (server restart, momentary network drop) shouldn't kill
          // tracking of a job that's still running — only give up after a streak.
          failures += 1;
          if (failures >= MAX_POLL_FAILURES) {
            setError(errMessage(err, 'Lost contact with generation job'));
            stopPolling();
          }
        }
      }, POLL_MS);
    },
    [stopPolling],
  );

  const start = useCallback(
    async (input: GenerateSyntheticInput) => {
      setError(null);
      setIsStarting(true);
      try {
        const started = await syntheticApi.generate(input);
        setJob(started);
        poll(started.id);
        return started;
      } catch (err) {
        setError(errMessage(err, 'Failed to start generation'));
        return null;
      } finally {
        setIsStarting(false);
      }
    },
    [poll],
  );

  const cancel = useCallback(async () => {
    if (!job) return;
    try {
      const cancelled = await syntheticApi.cancelJob(job.id);
      setJob(cancelled);
      stopPolling();
    } catch (err) {
      setError(errMessage(err, 'Failed to cancel job'));
    }
  }, [job, stopPolling]);

  const reset = useCallback(() => {
    stopPolling();
    setJob(null);
    setError(null);
  }, [stopPolling]);

  return {
    config,
    configLoading,
    job,
    isGenerating: isActive(job?.status),
    isStarting,
    error,
    start,
    cancel,
    reset,
    refreshConfig,
  };
}
