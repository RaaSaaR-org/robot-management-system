/**
 * @file deploymentStore.ts
 * @description Zustand store for VLA deployment and skill library state management
 * @feature deployment
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { deploymentApi } from '../api';
import type {
  DeploymentState,
  DeploymentStore,
  Deployment,
  DeploymentResponse,
  CreateDeploymentInput,
  DeploymentQueryParams,
  DeploymentFilters,
  AggregatedDeploymentMetrics,
  DeploymentEvent,
  SkillDefinition,
  CreateSkillInput,
  UpdateSkillInput,
  SkillQueryParams,
  SkillFilters,
  ParameterValidationResult,
  CompatibilityCheckResult,
  ExecuteSkillRequest,
  SkillExecutionResult,
  SkillChain,
  CreateSkillChainInput,
  UpdateSkillChainInput,
  SkillChainQueryParams,
  ExecuteChainRequest,
  ChainExecutionResult,
  SkillEvent,
} from '../types';

const initialState: DeploymentState = {
  // Deployments
  deployments: [],
  deploymentsLoading: false,
  deploymentsError: null,
  deploymentsPagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
  selectedDeploymentId: null,

  // Skills
  skills: [],
  skillsLoading: false,
  skillsError: null,
  skillsPagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
  selectedSkillId: null,

  // Skill Chains
  skillChains: [],
  skillChainsLoading: false,
  skillChainsError: null,
  skillChainsPagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },

  // Real-time metrics
  deploymentMetrics: {},

  // Model Versions
  modelVersions: [],
  modelVersionsLoading: false,

  // Filters
  deploymentFilters: {},
  skillFilters: {},
};

export const useDeploymentStore = create<DeploymentStore>()(
  devtools(
    immer((set, get) => ({
      ...initialState,

      // ========================================================================
      // DEPLOYMENTS
      // ========================================================================

      fetchDeployments: async (params?: DeploymentQueryParams) => {
        set((state) => {
          state.deploymentsLoading = true;
          state.deploymentsError = null;
        });

        try {
          const filters = get().deploymentFilters;
          const mergedParams: DeploymentQueryParams = {
            ...params,
            status: filters.status,
            strategy: filters.strategy,
          };
          const response = await deploymentApi.listDeployments(mergedParams);

          set((state) => {
            state.deployments = response.deployments;
            state.deploymentsPagination = response.pagination;
            state.deploymentsLoading = false;
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to fetch deployments';
          set((state) => {
            state.deploymentsError = message;
            state.deploymentsLoading = false;
          });
        }
      },

      fetchActiveDeployments: async () => {
        set((state) => {
          state.deploymentsLoading = true;
          state.deploymentsError = null;
        });

        try {
          const deployments = await deploymentApi.getActiveDeployments();

          set((state) => {
            // Merge with existing, prioritizing active
            const existingIds = new Set(deployments.map((d) => d.id));
            const nonActive = state.deployments.filter((d) => !existingIds.has(d.id));
            state.deployments = [...deployments, ...nonActive];
            state.deploymentsLoading = false;
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to fetch active deployments';
          set((state) => {
            state.deploymentsError = message;
            state.deploymentsLoading = false;
          });
        }
      },

      fetchDeployment: async (id: string): Promise<DeploymentResponse> => {
        const response = await deploymentApi.getDeployment(id);

        set((state) => {
          // Update deployment in list
          const index = state.deployments.findIndex((d) => d.id === id);
          if (index !== -1) {
            state.deployments[index] = response.deployment;
          } else {
            state.deployments.unshift(response.deployment);
          }

          // Update metrics
          if (response.metrics) {
            state.deploymentMetrics[id] = response.metrics;
          }
        });

        return response;
      },

      createDeployment: async (input: CreateDeploymentInput): Promise<Deployment> => {
        const deployment = await deploymentApi.createDeployment(input);

        set((state) => {
          state.deployments.unshift(deployment);
        });

        return deployment;
      },

      startDeployment: async (id: string) => {
        const deployment = await deploymentApi.startDeployment(id);

        set((state) => {
          const index = state.deployments.findIndex((d) => d.id === id);
          if (index !== -1) {
            state.deployments[index] = deployment;
          }
        });
      },

      advanceStage: async (id: string) => {
        const deployment = await deploymentApi.advanceStage(id);

        set((state) => {
          const index = state.deployments.findIndex((d) => d.id === id);
          if (index !== -1) {
            state.deployments[index] = deployment;
          }
        });
      },

      promoteDeployment: async (id: string) => {
        const deployment = await deploymentApi.promoteDeployment(id);

        set((state) => {
          const index = state.deployments.findIndex((d) => d.id === id);
          if (index !== -1) {
            state.deployments[index] = deployment;
          }
        });
      },

      rollbackDeployment: async (id: string, reason: string) => {
        const deployment = await deploymentApi.rollbackDeployment(id, reason);

        set((state) => {
          const index = state.deployments.findIndex((d) => d.id === id);
          if (index !== -1) {
            state.deployments[index] = deployment;
          }
        });
      },

      cancelDeployment: async (id: string) => {
        const deployment = await deploymentApi.cancelDeployment(id);

        set((state) => {
          const index = state.deployments.findIndex((d) => d.id === id);
          if (index !== -1) {
            state.deployments[index] = deployment;
          }
        });
      },

      setDeploymentFilters: (filters: Partial<DeploymentFilters>) => {
        set((state) => {
          state.deploymentFilters = { ...state.deploymentFilters, ...filters };
        });
      },

      selectDeployment: (id: string | null) => {
        set((state) => {
          state.selectedDeploymentId = id;
        });
      },

      // ========================================================================
      // DEPLOYMENT METRICS
      // ========================================================================

      fetchDeploymentMetrics: async (id: string) => {
        try {
          const metrics = await deploymentApi.getDeploymentMetrics(id);

          if (metrics) {
            set((state) => {
              state.deploymentMetrics[id] = metrics;
            });
          }
        } catch (error) {
          console.error('Failed to fetch deployment metrics:', error);
        }
      },

      updateDeploymentMetrics: (id: string, metrics: AggregatedDeploymentMetrics) => {
        set((state) => {
          state.deploymentMetrics[id] = metrics;
        });
      },

      // ========================================================================
      // SKILLS
      // ========================================================================

      fetchSkills: async (params?: SkillQueryParams) => {
        set((state) => {
          state.skillsLoading = true;
          state.skillsError = null;
        });

        try {
          const filters = get().skillFilters;
          const mergedParams: SkillQueryParams = {
            ...params,
            status: filters.status,
            robotTypeId: filters.robotTypeId,
            capability: filters.capability,
            name: filters.search,
          };
          const response = await deploymentApi.listSkills(mergedParams);

          set((state) => {
            state.skills = response.skills;
            state.skillsPagination = response.pagination;
            state.skillsLoading = false;
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to fetch skills';
          set((state) => {
            state.skillsError = message;
            state.skillsLoading = false;
          });
        }
      },

      fetchPublishedSkills: async () => {
        set((state) => {
          state.skillsLoading = true;
          state.skillsError = null;
        });

        try {
          const skills = await deploymentApi.getPublishedSkills();

          set((state) => {
            state.skills = skills;
            state.skillsLoading = false;
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to fetch published skills';
          set((state) => {
            state.skillsError = message;
            state.skillsLoading = false;
          });
        }
      },

      fetchSkill: async (id: string): Promise<SkillDefinition> => {
        const skill = await deploymentApi.getSkill(id);

        set((state) => {
          const index = state.skills.findIndex((s) => s.id === id);
          if (index !== -1) {
            state.skills[index] = skill;
          } else {
            state.skills.unshift(skill);
          }
        });

        return skill;
      },

      createSkill: async (input: CreateSkillInput): Promise<SkillDefinition> => {
        const skill = await deploymentApi.createSkill(input);

        set((state) => {
          state.skills.unshift(skill);
        });

        return skill;
      },

      updateSkill: async (id: string, input: UpdateSkillInput): Promise<SkillDefinition> => {
        const skill = await deploymentApi.updateSkill(id, input);

        set((state) => {
          const index = state.skills.findIndex((s) => s.id === id);
          if (index !== -1) {
            state.skills[index] = skill;
          }
        });

        return skill;
      },

      deleteSkill: async (id: string) => {
        await deploymentApi.deleteSkill(id);

        set((state) => {
          state.skills = state.skills.filter((s) => s.id !== id);
        });
      },

      publishSkill: async (id: string) => {
        const skill = await deploymentApi.publishSkill(id);

        set((state) => {
          const index = state.skills.findIndex((s) => s.id === id);
          if (index !== -1) {
            state.skills[index] = skill;
          }
        });
      },

      deprecateSkill: async (id: string) => {
        const skill = await deploymentApi.deprecateSkill(id);

        set((state) => {
          const index = state.skills.findIndex((s) => s.id === id);
          if (index !== -1) {
            state.skills[index] = skill;
          }
        });
      },

      archiveSkill: async (id: string) => {
        const skill = await deploymentApi.archiveSkill(id);

        set((state) => {
          const index = state.skills.findIndex((s) => s.id === id);
          if (index !== -1) {
            state.skills[index] = skill;
          }
        });
      },

      validateSkillParams: async (
        id: string,
        params: Record<string, unknown>
      ): Promise<ParameterValidationResult> => {
        return await deploymentApi.validateSkillParams(id, params);
      },

      getCompatibleRobots: async (id: string): Promise<CompatibilityCheckResult> => {
        return await deploymentApi.getCompatibleRobots(id);
      },

      executeSkill: async (
        id: string,
        request: ExecuteSkillRequest
      ): Promise<SkillExecutionResult> => {
        return await deploymentApi.executeSkill(id, request);
      },

      setSkillFilters: (filters: Partial<SkillFilters>) => {
        set((state) => {
          state.skillFilters = { ...state.skillFilters, ...filters };
        });
      },

      selectSkill: (id: string | null) => {
        set((state) => {
          state.selectedSkillId = id;
        });
      },

      // ========================================================================
      // SKILL CHAINS
      // ========================================================================

      fetchSkillChains: async (params?: SkillChainQueryParams) => {
        set((state) => {
          state.skillChainsLoading = true;
          state.skillChainsError = null;
        });

        try {
          const response = await deploymentApi.listSkillChains(params);

          set((state) => {
            state.skillChains = response.chains;
            state.skillChainsPagination = response.pagination;
            state.skillChainsLoading = false;
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to fetch skill chains';
          set((state) => {
            state.skillChainsError = message;
            state.skillChainsLoading = false;
          });
        }
      },

      fetchActiveChains: async () => {
        set((state) => {
          state.skillChainsLoading = true;
        });

        try {
          const chains = await deploymentApi.getActiveChains();

          set((state) => {
            state.skillChains = chains;
            state.skillChainsLoading = false;
          });
        } catch (error) {
          console.error('Failed to fetch active chains:', error);
          set((state) => {
            state.skillChainsLoading = false;
          });
        }
      },

      fetchSkillChain: async (id: string): Promise<SkillChain> => {
        const chain = await deploymentApi.getSkillChain(id);

        set((state) => {
          const index = state.skillChains.findIndex((c) => c.id === id);
          if (index !== -1) {
            state.skillChains[index] = chain;
          } else {
            state.skillChains.unshift(chain);
          }
        });

        return chain;
      },

      createSkillChain: async (input: CreateSkillChainInput): Promise<SkillChain> => {
        const chain = await deploymentApi.createSkillChain(input);

        set((state) => {
          state.skillChains.unshift(chain);
        });

        return chain;
      },

      updateSkillChain: async (id: string, input: UpdateSkillChainInput): Promise<SkillChain> => {
        const chain = await deploymentApi.updateSkillChain(id, input);

        set((state) => {
          const index = state.skillChains.findIndex((c) => c.id === id);
          if (index !== -1) {
            state.skillChains[index] = chain;
          }
        });

        return chain;
      },

      deleteSkillChain: async (id: string) => {
        await deploymentApi.deleteSkillChain(id);

        set((state) => {
          state.skillChains = state.skillChains.filter((c) => c.id !== id);
        });
      },

      activateChain: async (id: string) => {
        const chain = await deploymentApi.activateChain(id);

        set((state) => {
          const index = state.skillChains.findIndex((c) => c.id === id);
          if (index !== -1) {
            state.skillChains[index] = chain;
          }
        });
      },

      archiveChain: async (id: string) => {
        const chain = await deploymentApi.archiveChain(id);

        set((state) => {
          const index = state.skillChains.findIndex((c) => c.id === id);
          if (index !== -1) {
            state.skillChains[index] = chain;
          }
        });
      },

      executeChain: async (
        id: string,
        request: ExecuteChainRequest
      ): Promise<ChainExecutionResult> => {
        return await deploymentApi.executeChain(id, request);
      },

      // ========================================================================
      // MODEL VERSIONS
      // ========================================================================

      fetchModelVersions: async (params?: { skillId?: string; deploymentStatus?: string }) => {
        set((state) => {
          state.modelVersionsLoading = true;
        });

        try {
          const versions = await deploymentApi.listModelVersions(params);

          set((state) => {
            state.modelVersions = versions;
            state.modelVersionsLoading = false;
          });
        } catch (error) {
          console.error('Failed to fetch model versions:', error);
          set((state) => {
            state.modelVersionsLoading = false;
          });
        }
      },

      // ========================================================================
      // WEBSOCKET EVENT HANDLERS
      // ========================================================================

      handleDeploymentEvent: (event: DeploymentEvent) => {
        const { type, deploymentId, deployment, metrics, robotId } = event;

        set((state) => {
          switch (type) {
            case 'deployment:created':
              if (deployment && !state.deployments.find((d) => d.id === deploymentId)) {
                state.deployments.unshift(deployment);
              }
              break;

            case 'deployment:started':
            case 'deployment:stage:started':
            case 'deployment:stage:completed':
            case 'deployment:promoted':
              if (deployment) {
                const index = state.deployments.findIndex((d) => d.id === deploymentId);
                if (index !== -1) {
                  state.deployments[index] = deployment;
                }
              }
              break;

            case 'deployment:robot:deployed':
              {
                const index = state.deployments.findIndex((d) => d.id === deploymentId);
                if (index !== -1 && robotId) {
                  if (!state.deployments[index].deployedRobotIds.includes(robotId)) {
                    state.deployments[index].deployedRobotIds.push(robotId);
                  }
                }
              }
              break;

            case 'deployment:robot:failed':
              {
                const index = state.deployments.findIndex((d) => d.id === deploymentId);
                if (index !== -1 && robotId) {
                  if (!state.deployments[index].failedRobotIds.includes(robotId)) {
                    state.deployments[index].failedRobotIds.push(robotId);
                  }
                }
              }
              break;

            case 'deployment:metrics:threshold_warning':
              if (metrics) {
                state.deploymentMetrics[deploymentId] = metrics;
              }
              break;

            case 'deployment:rollback:started':
            case 'deployment:rollback:completed':
            case 'deployment:completed':
            case 'deployment:failed':
            case 'deployment:cancelled':
              if (deployment) {
                const index = state.deployments.findIndex((d) => d.id === deploymentId);
                if (index !== -1) {
                  state.deployments[index] = deployment;
                }
              }
              break;
          }

          // Update metrics if provided
          if (metrics) {
            state.deploymentMetrics[deploymentId] = metrics;
          }
        });
      },

      handleSkillEvent: (event: SkillEvent) => {
        // Skill execution events are primarily handled by UI components
        // that are listening to the WebSocket directly for real-time feedback
        console.debug('Skill event received:', event);
      },

      // ========================================================================
      // RESET
      // ========================================================================

      reset: () => {
        set(() => ({ ...initialState }));
      },
    })),
    { name: 'deployment-store' }
  )
);

// ============================================================================
// SELECTORS
// ============================================================================

// Deployments
export const selectDeployments = (state: DeploymentStore) => state.deployments;
export const selectDeploymentsLoading = (state: DeploymentStore) => state.deploymentsLoading;
export const selectDeploymentsError = (state: DeploymentStore) => state.deploymentsError;
export const selectDeploymentsPagination = (state: DeploymentStore) => state.deploymentsPagination;
export const selectDeploymentFilters = (state: DeploymentStore) => state.deploymentFilters;
export const selectSelectedDeploymentId = (state: DeploymentStore) => state.selectedDeploymentId;

export const selectActiveDeployments = (state: DeploymentStore) =>
  state.deployments.filter(
    (d) => d.status === 'pending' || d.status === 'deploying' || d.status === 'canary'
  );

export const selectCompletedDeployments = (state: DeploymentStore) =>
  state.deployments.filter((d) => d.status === 'production' || d.status === 'failed');

export const selectDeploymentById = (id: string) => (state: DeploymentStore) =>
  state.deployments.find((d) => d.id === id);

export const selectSelectedDeployment = (state: DeploymentStore) =>
  state.selectedDeploymentId
    ? state.deployments.find((d) => d.id === state.selectedDeploymentId)
    : null;

// Deployment Metrics
export const selectDeploymentMetrics = (state: DeploymentStore) => state.deploymentMetrics;
export const selectMetricsForDeployment = (id: string) => (state: DeploymentStore) =>
  state.deploymentMetrics[id];

// Skills
export const selectSkills = (state: DeploymentStore) => state.skills;
export const selectSkillsLoading = (state: DeploymentStore) => state.skillsLoading;
export const selectSkillsError = (state: DeploymentStore) => state.skillsError;
export const selectSkillsPagination = (state: DeploymentStore) => state.skillsPagination;
export const selectSkillFilters = (state: DeploymentStore) => state.skillFilters;
export const selectSelectedSkillId = (state: DeploymentStore) => state.selectedSkillId;

export const selectPublishedSkills = (state: DeploymentStore) =>
  state.skills.filter((s) => s.status === 'published');

export const selectDraftSkills = (state: DeploymentStore) =>
  state.skills.filter((s) => s.status === 'draft');

export const selectSkillById = (id: string) => (state: DeploymentStore) =>
  state.skills.find((s) => s.id === id);

export const selectSelectedSkill = (state: DeploymentStore) =>
  state.selectedSkillId ? state.skills.find((s) => s.id === state.selectedSkillId) : null;

// Skill Chains
export const selectSkillChains = (state: DeploymentStore) => state.skillChains;
export const selectSkillChainsLoading = (state: DeploymentStore) => state.skillChainsLoading;
export const selectSkillChainsError = (state: DeploymentStore) => state.skillChainsError;
export const selectSkillChainsPagination = (state: DeploymentStore) => state.skillChainsPagination;

export const selectActiveChains = (state: DeploymentStore) =>
  state.skillChains.filter((c) => c.status === 'active');

export const selectSkillChainById = (id: string) => (state: DeploymentStore) =>
  state.skillChains.find((c) => c.id === id);

// Model Versions
export const selectModelVersions = (state: DeploymentStore) => state.modelVersions;
export const selectModelVersionsLoading = (state: DeploymentStore) => state.modelVersionsLoading;

export const selectStagingVersions = (state: DeploymentStore) =>
  state.modelVersions.filter((v) => v.deploymentStatus === 'staging');

export const selectProductionVersions = (state: DeploymentStore) =>
  state.modelVersions.filter((v) => v.deploymentStatus === 'production');
