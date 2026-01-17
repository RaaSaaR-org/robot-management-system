/**
 * @file useSkillChains.ts
 * @description React hook for skill chain operations
 * @feature deployment
 */

import { useCallback, useMemo, useEffect } from 'react';
import {
  useDeploymentStore,
  selectSkillChains,
  selectSkillChainsLoading,
  selectSkillChainsError,
  selectSkillChainsPagination,
  selectActiveChains,
} from '../store';
import type {
  SkillChain,
  CreateSkillChainInput,
  UpdateSkillChainInput,
  SkillChainQueryParams,
  PaginationInfo,
  ExecuteChainRequest,
  ChainExecutionResult,
} from '../types';

export interface UseSkillChainsReturn {
  skillChains: SkillChain[];
  chains: SkillChain[];
  activeChains: SkillChain[];
  isLoading: boolean;
  error: string | null;
  pagination: PaginationInfo;
  fetchSkillChains: (params?: SkillChainQueryParams) => Promise<void>;
  fetchChains: (params?: SkillChainQueryParams) => Promise<void>;
  fetchActiveChains: () => Promise<void>;
  createChain: (input: CreateSkillChainInput) => Promise<SkillChain>;
  updateChain: (id: string, input: UpdateSkillChainInput) => Promise<SkillChain>;
  deleteChain: (id: string) => Promise<void>;
  activateChain: (id: string) => Promise<void>;
  archiveChain: (id: string) => Promise<void>;
  executeChain: (id: string, request: ExecuteChainRequest) => Promise<ChainExecutionResult>;
}

/**
 * Hook for accessing skill chains list
 */
export function useSkillChains(): UseSkillChainsReturn {
  const chains = useDeploymentStore(selectSkillChains);
  const isLoading = useDeploymentStore(selectSkillChainsLoading);
  const error = useDeploymentStore(selectSkillChainsError);
  const pagination = useDeploymentStore(selectSkillChainsPagination);
  const activeChains = useDeploymentStore(selectActiveChains);

  const storeFetchChains = useDeploymentStore((state) => state.fetchSkillChains);
  const storeFetchActiveChains = useDeploymentStore((state) => state.fetchActiveChains);
  const storeCreateChain = useDeploymentStore((state) => state.createSkillChain);
  const storeUpdateChain = useDeploymentStore((state) => state.updateSkillChain);
  const storeDeleteChain = useDeploymentStore((state) => state.deleteSkillChain);
  const storeActivateChain = useDeploymentStore((state) => state.activateChain);
  const storeArchiveChain = useDeploymentStore((state) => state.archiveChain);
  const storeExecuteChain = useDeploymentStore((state) => state.executeChain);

  const fetchChains = useCallback(
    async (params?: SkillChainQueryParams) => {
      await storeFetchChains(params);
    },
    [storeFetchChains]
  );

  const fetchActiveChains = useCallback(async () => {
    await storeFetchActiveChains();
  }, [storeFetchActiveChains]);

  const createChain = useCallback(
    async (input: CreateSkillChainInput) => {
      return await storeCreateChain(input);
    },
    [storeCreateChain]
  );

  const updateChain = useCallback(
    async (id: string, input: UpdateSkillChainInput) => {
      return await storeUpdateChain(id, input);
    },
    [storeUpdateChain]
  );

  const deleteChain = useCallback(
    async (id: string) => {
      await storeDeleteChain(id);
    },
    [storeDeleteChain]
  );

  const activateChain = useCallback(
    async (id: string) => {
      await storeActivateChain(id);
    },
    [storeActivateChain]
  );

  const archiveChain = useCallback(
    async (id: string) => {
      await storeArchiveChain(id);
    },
    [storeArchiveChain]
  );

  const executeChain = useCallback(
    async (id: string, request: ExecuteChainRequest) => {
      return await storeExecuteChain(id, request);
    },
    [storeExecuteChain]
  );

  return useMemo(
    () => ({
      skillChains: chains,
      chains,
      activeChains,
      isLoading,
      error,
      pagination,
      fetchSkillChains: fetchChains,
      fetchChains,
      fetchActiveChains,
      createChain,
      updateChain,
      deleteChain,
      activateChain,
      archiveChain,
      executeChain,
    }),
    [
      chains,
      activeChains,
      isLoading,
      error,
      pagination,
      fetchChains,
      fetchActiveChains,
      createChain,
      updateChain,
      deleteChain,
      activateChain,
      archiveChain,
      executeChain,
    ]
  );
}

/**
 * Hook for auto-fetching skill chains on mount
 */
export function useSkillChainsAutoFetch(params?: SkillChainQueryParams): UseSkillChainsReturn {
  const result = useSkillChains();
  const { fetchChains } = result;

  useEffect(() => {
    fetchChains(params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return result;
}
