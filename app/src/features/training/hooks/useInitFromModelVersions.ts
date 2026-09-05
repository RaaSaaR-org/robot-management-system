/**
 * @file useInitFromModelVersions.ts
 * @description Registered models a training run can start from, each with the
 *              architecture its own run trained and the checkpoints it wrote.
 * @feature training
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useModelVersions } from '@/features/deployment/hooks/useModelVersions';
import { deploymentApi } from '@/features/deployment/api';
import type { ModelCheckpoint, ModelVersion } from '@/features/deployment/types';
import { BaseModels, type BaseModel } from '../types';

/**
 * One model the picker may offer, with what the registry alone cannot say.
 * (TASK-239)
 */
export interface InitFromCandidate {
  version: ModelVersion;
  /**
   * Architecture of the run that produced it. Null for an imported model:
   * there is no TrainingJob row here to read it from, and the server accepts
   * such a model as a starting point rather than guessing.
   */
  baseModel: BaseModel | null;
  /** Per-epoch checkpoints, ascending. Empty for a model that wrote none. */
  checkpoints: ModelCheckpoint[];
}

export interface UseInitFromModelVersionsReturn {
  /** Models compatible with `baseModel`, newest first. */
  candidates: InitFromCandidate[];
  /**
   * Registered models the picker left out: another architecture, or a detail
   * request that failed and so cannot be vouched for.
   */
  hiddenCount: number;
  isLoading: boolean;
}

/** What one `GET /api/models/versions/:id` contributes to a candidate. */
interface ResolvedDetail {
  baseModel: BaseModel | null;
  checkpoints: ModelCheckpoint[];
}

/**
 * The detail relation `GET /api/models/versions/:id` populates. The deployment
 * `ModelVersion` type does not declare it because the list endpoint never
 * sends it — and the list endpoint is also why this hook has to ask per model:
 * `GET /api/models/versions` carries no `baseModel` at all, so the architecture
 * (and the checkpoint rows) can only be read one model at a time. (TASK-239)
 */
interface ModelVersionDetailWithJob {
  trainingJob?: { baseModel?: string | null } | null;
  checkpoints?: ModelCheckpoint[];
}

function isBaseModel(value: unknown): value is BaseModel {
  return typeof value === 'string' && (BaseModels as readonly string[]).includes(value);
}

/**
 * Cached across mounts: the wizard is opened and closed repeatedly, and a
 * model's architecture and checkpoint list do not change once its run has
 * completed. A failed request resolves to null so one unreachable model does
 * not retry on every render.
 */
const detailCache = new Map<string, Promise<ResolvedDetail | null>>();

function fetchDetail(id: string): Promise<ResolvedDetail | null> {
  const cached = detailCache.get(id);
  if (cached) return cached;

  const pending = deploymentApi
    .getModelVersion(id)
    .then((detail): ResolvedDetail => {
      const withJob = detail as ModelVersionDetailWithJob;
      return {
        baseModel: isBaseModel(withJob.trainingJob?.baseModel)
          ? withJob.trainingJob.baseModel
          : null,
        checkpoints: withJob.checkpoints ?? [],
      };
    })
    .catch(() => null);

  detailCache.set(id, pending);
  return pending;
}

/**
 * The models a run on `baseModel` may start from.
 *
 * Fetching is tied to the mount: the picker is only rendered once someone
 * chooses to continue from an existing model, and most runs never do — so the
 * registry is left alone until then.
 */
export function useInitFromModelVersions(baseModel: BaseModel): UseInitFromModelVersionsReturn {
  const { modelVersions, isLoading: listLoading, fetchModelVersions } = useModelVersions();
  const [details, setDetails] = useState<Record<string, ResolvedDetail | null>>({});
  // Ids already asked for, so a re-render caused by an arriving detail does not
  // re-issue the requests still in flight.
  const requested = useRef(new Set<string>());

  useEffect(() => {
    void fetchModelVersions();
  }, [fetchModelVersions]);

  useEffect(() => {
    let cancelled = false;
    modelVersions.forEach((version) => {
      if (requested.current.has(version.id)) return;
      requested.current.add(version.id);

      void fetchDetail(version.id).then((detail) => {
        if (cancelled) return;
        setDetails((prev) => ({ ...prev, [version.id]: detail }));
      });
    });

    return () => {
      cancelled = true;
    };
  }, [modelVersions]);

  const resolved = useMemo(
    () =>
      modelVersions.map((version) => ({
        version,
        detail: details[version.id],
        isResolved: version.id in details,
      })),
    [modelVersions, details]
  );

  const candidates = useMemo(
    () =>
      resolved
        .filter(({ version, detail, isResolved }) => {
          if (!isResolved) return false;
          // An imported model records no architecture; the server accepts it
          // rather than refusing what it cannot check, so offer it too.
          if (version.trainingJobId === null) return true;
          return detail?.baseModel === baseModel;
        })
        .map(({ version, detail }) => ({
          version,
          baseModel: detail?.baseModel ?? null,
          checkpoints: detail?.checkpoints ?? [],
        })),
    [resolved, baseModel]
  );

  const isLoading = listLoading || resolved.some((entry) => !entry.isResolved);

  return {
    candidates,
    hiddenCount: isLoading ? 0 : modelVersions.length - candidates.length,
    isLoading,
  };
}
