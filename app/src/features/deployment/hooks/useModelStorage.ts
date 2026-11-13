/**
 * @file useModelStorage.ts
 * @description What the registry knows about a model beyond its row: the
 *              dataset it names as its training data, and — for a model
 *              uploaded to this instance — the files stored for it (TASK-498)
 * @feature deployment
 */

import { useEffect, useState } from 'react';
import axios from 'axios';
import { getErrorMessage } from '@/shared/utils';
import { deploymentApi } from '../api';
import type { ModelFileManifest, ModelVersion, ModelVersionOrigin } from '../types';

export interface UseModelStorageReturn {
  /** Null until loaded, and for a model that names no dataset and stores nothing here. */
  origin: ModelVersionOrigin | null;
  /** The stored files; null while loading, when there are none, or once they were removed. */
  files: ModelFileManifest | null;
  /** The files were removed when the model was deleted. */
  filesRemoved: boolean;
  isLoading: boolean;
  /** Why the file list could not be read (not set for "removed"). */
  filesError: string | null;
}

const EMPTY: UseModelStorageReturn = {
  origin: null, files: null, filesRemoved: false, isLoading: false, filesError: null,
};

/** Whether this instance stores files for the model — true only for a direct upload. */
export function storesFiles(version: Pick<ModelVersion, 'artifactSizeBytes'>): boolean {
  return typeof version.artifactSizeBytes === 'number';
}

/**
 * Loads the origin and the stored files of `version`. A model that states
 * neither a dataset nor a stored artifact asks the server nothing.
 */
export function useModelStorage(version: ModelVersion | null): UseModelStorageReturn {
  const [state, setState] = useState<UseModelStorageReturn>(EMPTY);
  const id = version?.id ?? null;
  const wantsOrigin = Boolean(version && (version.datasetId || storesFiles(version)));
  const wantsFiles = Boolean(version && storesFiles(version));

  useEffect(() => {
    if (!id || !wantsOrigin) {
      setState(EMPTY);
      return;
    }
    let cancelled = false;
    setState({ ...EMPTY, isLoading: true });

    const load = async (): Promise<UseModelStorageReturn> => {
      // The link to the dataset is a nicety: without it the id is still shown.
      const origin = await deploymentApi.getModelVersionOrigin(id).catch(() => null);
      if (!wantsFiles) return { ...EMPTY, origin };
      if (origin?.storage?.filesRemovedAt) return { ...EMPTY, origin, filesRemoved: true };
      try {
        return { ...EMPTY, origin, files: await deploymentApi.listModelFiles(id) };
      } catch (error) {
        // 410: removed between the two reads.
        if (axios.isAxiosError(error) && error.response?.status === 410) {
          return { ...EMPTY, origin, filesRemoved: true };
        }
        return { ...EMPTY, origin, filesError: getErrorMessage(error) };
      }
    };

    void load().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [id, wantsOrigin, wantsFiles]);

  return state;
}
