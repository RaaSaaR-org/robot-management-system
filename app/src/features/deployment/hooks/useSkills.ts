/**
 * @file useSkills.ts
 * @description React hook for skill library operations
 * @feature deployment
 */

import { useCallback, useMemo, useEffect } from 'react';
import {
  useDeploymentStore,
  selectSkills,
  selectSkillsLoading,
  selectSkillsError,
  selectSkillsPagination,
  selectSkillFilters,
  selectPublishedSkills,
  selectDraftSkills,
  selectSelectedSkill,
} from '../store';
import type {
  SkillDefinition,
  CreateSkillInput,
  UpdateSkillInput,
  SkillQueryParams,
  SkillFilters,
  PaginationInfo,
  ParameterValidationResult,
  CompatibilityCheckResult,
  ExecuteSkillRequest,
  SkillExecutionResult,
} from '../types';

export interface UseSkillsReturn {
  skills: SkillDefinition[];
  publishedSkills: SkillDefinition[];
  draftSkills: SkillDefinition[];
  selectedSkill: SkillDefinition | undefined;
  isLoading: boolean;
  error: string | null;
  pagination: PaginationInfo;
  filters: SkillFilters;
  fetchSkills: (params?: SkillQueryParams) => Promise<void>;
  fetchPublishedSkills: () => Promise<void>;
  createSkill: (input: CreateSkillInput) => Promise<SkillDefinition>;
  updateSkill: (id: string, input: UpdateSkillInput) => Promise<SkillDefinition>;
  deleteSkill: (id: string) => Promise<void>;
  publishSkill: (id: string) => Promise<void>;
  deprecateSkill: (id: string) => Promise<void>;
  archiveSkill: (id: string) => Promise<void>;
  validateParams: (id: string, params: Record<string, unknown>) => Promise<ParameterValidationResult>;
  getCompatibleRobots: (id: string) => Promise<CompatibilityCheckResult>;
  executeSkill: (id: string, request: ExecuteSkillRequest) => Promise<SkillExecutionResult>;
  selectSkill: (id: string | null) => void;
  setFilters: (filters: Partial<SkillFilters>) => void;
}

/**
 * Hook for accessing skills list
 */
export function useSkills(): UseSkillsReturn {
  const skills = useDeploymentStore(selectSkills);
  const isLoading = useDeploymentStore(selectSkillsLoading);
  const error = useDeploymentStore(selectSkillsError);
  const pagination = useDeploymentStore(selectSkillsPagination);
  const filters = useDeploymentStore(selectSkillFilters);
  const selectedSkill = useDeploymentStore(selectSelectedSkill);
  const publishedSkills = useDeploymentStore(selectPublishedSkills);
  const draftSkills = useDeploymentStore(selectDraftSkills);

  const storeFetchSkills = useDeploymentStore((state) => state.fetchSkills);
  const storeFetchPublishedSkills = useDeploymentStore((state) => state.fetchPublishedSkills);
  const storeCreateSkill = useDeploymentStore((state) => state.createSkill);
  const storeUpdateSkill = useDeploymentStore((state) => state.updateSkill);
  const storeDeleteSkill = useDeploymentStore((state) => state.deleteSkill);
  const storePublishSkill = useDeploymentStore((state) => state.publishSkill);
  const storeDeprecateSkill = useDeploymentStore((state) => state.deprecateSkill);
  const storeArchiveSkill = useDeploymentStore((state) => state.archiveSkill);
  const storeValidateParams = useDeploymentStore((state) => state.validateSkillParams);
  const storeGetCompatibleRobots = useDeploymentStore((state) => state.getCompatibleRobots);
  const storeExecuteSkill = useDeploymentStore((state) => state.executeSkill);
  const storeSelectSkill = useDeploymentStore((state) => state.selectSkill);
  const storeSetFilters = useDeploymentStore((state) => state.setSkillFilters);

  const fetchSkills = useCallback(
    async (params?: SkillQueryParams) => {
      await storeFetchSkills(params);
    },
    [storeFetchSkills]
  );

  const fetchPublishedSkills = useCallback(async () => {
    await storeFetchPublishedSkills();
  }, [storeFetchPublishedSkills]);

  const createSkill = useCallback(
    async (input: CreateSkillInput) => {
      return await storeCreateSkill(input);
    },
    [storeCreateSkill]
  );

  const updateSkill = useCallback(
    async (id: string, input: UpdateSkillInput) => {
      return await storeUpdateSkill(id, input);
    },
    [storeUpdateSkill]
  );

  const deleteSkill = useCallback(
    async (id: string) => {
      await storeDeleteSkill(id);
    },
    [storeDeleteSkill]
  );

  const publishSkill = useCallback(
    async (id: string) => {
      await storePublishSkill(id);
    },
    [storePublishSkill]
  );

  const deprecateSkill = useCallback(
    async (id: string) => {
      await storeDeprecateSkill(id);
    },
    [storeDeprecateSkill]
  );

  const archiveSkill = useCallback(
    async (id: string) => {
      await storeArchiveSkill(id);
    },
    [storeArchiveSkill]
  );

  const validateParams = useCallback(
    async (id: string, params: Record<string, unknown>) => {
      return await storeValidateParams(id, params);
    },
    [storeValidateParams]
  );

  const getCompatibleRobots = useCallback(
    async (id: string) => {
      return await storeGetCompatibleRobots(id);
    },
    [storeGetCompatibleRobots]
  );

  const executeSkill = useCallback(
    async (id: string, request: ExecuteSkillRequest) => {
      return await storeExecuteSkill(id, request);
    },
    [storeExecuteSkill]
  );

  const selectSkillFn = useCallback(
    (id: string | null) => {
      storeSelectSkill(id);
    },
    [storeSelectSkill]
  );

  const setFilters = useCallback(
    (newFilters: Partial<SkillFilters>) => {
      storeSetFilters(newFilters);
    },
    [storeSetFilters]
  );

  return useMemo(
    () => ({
      skills,
      publishedSkills,
      draftSkills,
      selectedSkill: selectedSkill || undefined,
      isLoading,
      error,
      pagination,
      filters,
      fetchSkills,
      fetchPublishedSkills,
      createSkill,
      updateSkill,
      deleteSkill,
      publishSkill,
      deprecateSkill,
      archiveSkill,
      validateParams,
      getCompatibleRobots,
      executeSkill,
      selectSkill: selectSkillFn,
      setFilters,
    }),
    [
      skills,
      publishedSkills,
      draftSkills,
      selectedSkill,
      isLoading,
      error,
      pagination,
      filters,
      fetchSkills,
      fetchPublishedSkills,
      createSkill,
      updateSkill,
      deleteSkill,
      publishSkill,
      deprecateSkill,
      archiveSkill,
      validateParams,
      getCompatibleRobots,
      executeSkill,
      selectSkillFn,
      setFilters,
    ]
  );
}

/**
 * Hook for auto-fetching skills on mount
 */
export function useSkillsAutoFetch(params?: SkillQueryParams): UseSkillsReturn {
  const result = useSkills();
  const { fetchSkills } = result;

  useEffect(() => {
    fetchSkills(params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return result;
}
