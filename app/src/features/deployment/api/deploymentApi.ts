/**
 * @file deploymentApi.ts
 * @description API calls for VLA deployment and skill library management
 * @feature deployment
 */

import { apiClient } from '@/api/client';
import type {
  Deployment,
  DeploymentResponse,
  CreateDeploymentInput,
  DeploymentQueryParams,
  DeploymentsListResponse,
  AggregatedDeploymentMetrics,
  SkillDefinition,
  CreateSkillInput,
  UpdateSkillInput,
  SkillQueryParams,
  SkillsListResponse,
  ParameterValidationResult,
  CompatibilityCheckResult,
  ExecuteSkillRequest,
  SkillExecutionResult,
  SkillChain,
  CreateSkillChainInput,
  UpdateSkillChainInput,
  SkillChainQueryParams,
  SkillChainsListResponse,
  ExecuteChainRequest,
  ChainExecutionResult,
  ModelVersion,
} from '../types';

const ENDPOINTS = {
  // Deployments
  deployments: '/deployments',
  deployment: (id: string) => `/deployments/${id}`,
  deploymentStart: (id: string) => `/deployments/${id}/start`,
  deploymentProgress: (id: string) => `/deployments/${id}/progress`,
  deploymentPromote: (id: string) => `/deployments/${id}/promote`,
  deploymentRollback: (id: string) => `/deployments/${id}/rollback`,
  deploymentCancel: (id: string) => `/deployments/${id}/cancel`,
  deploymentMetrics: (id: string) => `/deployments/${id}/metrics`,
  activeDeployments: '/deployments/active',

  // Skills
  skills: '/skills',
  skill: (id: string) => `/skills/${id}`,
  skillPublish: (id: string) => `/skills/${id}/publish`,
  skillDeprecate: (id: string) => `/skills/${id}/deprecate`,
  skillArchive: (id: string) => `/skills/${id}/archive`,
  skillValidate: (id: string) => `/skills/${id}/validate`,
  skillCompatibleRobots: (id: string) => `/skills/${id}/compatible-robots`,
  skillCheckRobot: (id: string, robotId: string) => `/skills/${id}/check-robot/${robotId}`,
  skillExecute: (id: string) => `/skills/${id}/execute`,
  publishedSkills: '/skills/published',
  skillsForRobot: (robotId: string) => `/skills/for-robot/${robotId}`,

  // Skill Chains
  skillChains: '/skills/chains',
  skillChain: (id: string) => `/skills/chains/${id}`,
  skillChainActivate: (id: string) => `/skills/chains/${id}/activate`,
  skillChainArchive: (id: string) => `/skills/chains/${id}/archive`,
  skillChainExecute: (id: string) => `/skills/chains/${id}/execute`,
  activeChains: '/skills/chains/active',

  // Model Versions (for deployment selection)
  modelVersions: '/models/versions',
} as const;

export const deploymentApi = {
  // ============================================================================
  // DEPLOYMENTS
  // ============================================================================

  /**
   * Create a new deployment
   */
  async createDeployment(input: CreateDeploymentInput): Promise<Deployment> {
    const response = await apiClient.post<{ deployment: Deployment; message: string }>(
      ENDPOINTS.deployments,
      input
    );
    return response.data.deployment;
  },

  /**
   * List deployments with optional filtering and pagination
   */
  async listDeployments(params?: DeploymentQueryParams): Promise<DeploymentsListResponse> {
    const queryParams: Record<string, string | undefined> = {};

    if (params?.modelVersionId) queryParams.modelVersionId = params.modelVersionId;
    if (params?.page) queryParams.page = String(params.page);
    if (params?.pageSize) queryParams.pageSize = String(params.pageSize);

    if (params?.status) {
      queryParams.status = Array.isArray(params.status)
        ? params.status.join(',')
        : params.status;
    }

    if (params?.strategy) {
      queryParams.strategy = Array.isArray(params.strategy)
        ? params.strategy.join(',')
        : params.strategy;
    }

    const response = await apiClient.get<DeploymentsListResponse>(ENDPOINTS.deployments, {
      params: queryParams,
    });
    return response.data;
  },

  /**
   * Get all active deployments
   */
  async getActiveDeployments(): Promise<Deployment[]> {
    const response = await apiClient.get<{ deployments: Deployment[]; count: number }>(
      ENDPOINTS.activeDeployments
    );
    return response.data.deployments;
  },

  /**
   * Get a single deployment with full details
   */
  async getDeployment(id: string): Promise<DeploymentResponse> {
    const response = await apiClient.get<DeploymentResponse>(ENDPOINTS.deployment(id));
    return response.data;
  },

  /**
   * Get deployment metrics
   */
  async getDeploymentMetrics(id: string): Promise<AggregatedDeploymentMetrics | null> {
    const response = await apiClient.get<{
      deploymentId: string;
      metrics?: AggregatedDeploymentMetrics;
      isMonitoring: boolean;
    }>(ENDPOINTS.deploymentMetrics(id));
    return response.data.metrics || null;
  },

  /**
   * Start canary rollout for a deployment
   */
  async startDeployment(id: string): Promise<Deployment> {
    const response = await apiClient.post<{ deployment: Deployment; message: string }>(
      ENDPOINTS.deploymentStart(id)
    );
    return response.data.deployment;
  },

  /**
   * Advance deployment to next canary stage
   */
  async advanceStage(id: string): Promise<Deployment> {
    const response = await apiClient.post<{ deployment: Deployment; message: string }>(
      ENDPOINTS.deploymentProgress(id)
    );
    return response.data.deployment;
  },

  /**
   * Promote deployment to production (skip remaining stages)
   */
  async promoteDeployment(id: string): Promise<Deployment> {
    const response = await apiClient.post<{ deployment: Deployment; message: string }>(
      ENDPOINTS.deploymentPromote(id)
    );
    return response.data.deployment;
  },

  /**
   * Rollback a deployment
   */
  async rollbackDeployment(id: string, reason: string): Promise<Deployment> {
    const response = await apiClient.post<{ deployment: Deployment; message: string }>(
      ENDPOINTS.deploymentRollback(id),
      { reason }
    );
    return response.data.deployment;
  },

  /**
   * Cancel a deployment
   */
  async cancelDeployment(id: string): Promise<Deployment> {
    const response = await apiClient.post<{ deployment: Deployment; message: string }>(
      ENDPOINTS.deploymentCancel(id)
    );
    return response.data.deployment;
  },

  // ============================================================================
  // SKILLS
  // ============================================================================

  /**
   * Create a new skill definition
   */
  async createSkill(input: CreateSkillInput): Promise<SkillDefinition> {
    const response = await apiClient.post<{ skill: SkillDefinition; message: string }>(
      ENDPOINTS.skills,
      input
    );
    return response.data.skill;
  },

  /**
   * List skills with optional filtering and pagination
   */
  async listSkills(params?: SkillQueryParams): Promise<SkillsListResponse> {
    const queryParams: Record<string, string | undefined> = {};

    if (params?.name) queryParams.name = params.name;
    if (params?.robotTypeId) queryParams.robotTypeId = params.robotTypeId;
    if (params?.capability) queryParams.capability = params.capability;
    if (params?.linkedModelVersionId) queryParams.linkedModelVersionId = params.linkedModelVersionId;
    if (params?.page) queryParams.page = String(params.page);
    if (params?.pageSize) queryParams.pageSize = String(params.pageSize);

    if (params?.status) {
      queryParams.status = Array.isArray(params.status)
        ? params.status.join(',')
        : params.status;
    }

    const response = await apiClient.get<SkillsListResponse>(ENDPOINTS.skills, {
      params: queryParams,
    });
    return response.data;
  },

  /**
   * Get all published skills
   */
  async getPublishedSkills(): Promise<SkillDefinition[]> {
    const response = await apiClient.get<{ skills: SkillDefinition[]; count: number }>(
      ENDPOINTS.publishedSkills
    );
    return response.data.skills;
  },

  /**
   * Get skills compatible with a specific robot
   */
  async getSkillsForRobot(robotId: string): Promise<SkillDefinition[]> {
    const response = await apiClient.get<{
      robotId: string;
      skills: SkillDefinition[];
      count: number;
    }>(ENDPOINTS.skillsForRobot(robotId));
    return response.data.skills;
  },

  /**
   * Get a single skill by ID
   */
  async getSkill(id: string): Promise<SkillDefinition> {
    const response = await apiClient.get<{ skill: SkillDefinition }>(ENDPOINTS.skill(id));
    return response.data.skill;
  },

  /**
   * Update a skill definition
   */
  async updateSkill(id: string, input: UpdateSkillInput): Promise<SkillDefinition> {
    const response = await apiClient.put<{ skill: SkillDefinition; message: string }>(
      ENDPOINTS.skill(id),
      input
    );
    return response.data.skill;
  },

  /**
   * Delete a skill definition
   */
  async deleteSkill(id: string): Promise<void> {
    await apiClient.delete(ENDPOINTS.skill(id));
  },

  /**
   * Publish a skill (draft -> published)
   */
  async publishSkill(id: string): Promise<SkillDefinition> {
    const response = await apiClient.post<{ skill: SkillDefinition; message: string }>(
      ENDPOINTS.skillPublish(id)
    );
    return response.data.skill;
  },

  /**
   * Deprecate a skill (published -> deprecated)
   */
  async deprecateSkill(id: string): Promise<SkillDefinition> {
    const response = await apiClient.post<{ skill: SkillDefinition; message: string }>(
      ENDPOINTS.skillDeprecate(id)
    );
    return response.data.skill;
  },

  /**
   * Archive a skill (deprecated/draft -> archived)
   */
  async archiveSkill(id: string): Promise<SkillDefinition> {
    const response = await apiClient.post<{ skill: SkillDefinition; message: string }>(
      ENDPOINTS.skillArchive(id)
    );
    return response.data.skill;
  },

  /**
   * Validate skill parameters against schema
   */
  async validateSkillParams(
    id: string,
    parameters: Record<string, unknown>
  ): Promise<ParameterValidationResult> {
    const response = await apiClient.post<ParameterValidationResult>(
      ENDPOINTS.skillValidate(id),
      { parameters }
    );
    return response.data;
  },

  /**
   * Get compatible robots for a skill
   */
  async getCompatibleRobots(id: string): Promise<CompatibilityCheckResult> {
    const response = await apiClient.get<CompatibilityCheckResult>(
      ENDPOINTS.skillCompatibleRobots(id)
    );
    return response.data;
  },

  /**
   * Check if a specific robot is compatible with a skill
   */
  async checkRobotCompatibility(
    skillId: string,
    robotId: string
  ): Promise<CompatibilityCheckResult['robots'][0]> {
    const response = await apiClient.get<CompatibilityCheckResult['robots'][0]>(
      ENDPOINTS.skillCheckRobot(skillId, robotId)
    );
    return response.data;
  },

  /**
   * Execute a skill on a robot
   */
  async executeSkill(id: string, request: ExecuteSkillRequest): Promise<SkillExecutionResult> {
    const response = await apiClient.post<{ result: SkillExecutionResult; message: string }>(
      ENDPOINTS.skillExecute(id),
      request
    );
    return response.data.result;
  },

  // ============================================================================
  // SKILL CHAINS
  // ============================================================================

  /**
   * Create a new skill chain
   */
  async createSkillChain(input: CreateSkillChainInput): Promise<SkillChain> {
    const response = await apiClient.post<{ chain: SkillChain; message: string }>(
      ENDPOINTS.skillChains,
      input
    );
    return response.data.chain;
  },

  /**
   * List skill chains with optional filtering and pagination
   */
  async listSkillChains(params?: SkillChainQueryParams): Promise<SkillChainsListResponse> {
    const queryParams: Record<string, string | undefined> = {};

    if (params?.name) queryParams.name = params.name;
    if (params?.page) queryParams.page = String(params.page);
    if (params?.pageSize) queryParams.pageSize = String(params.pageSize);

    if (params?.status) {
      queryParams.status = Array.isArray(params.status)
        ? params.status.join(',')
        : params.status;
    }

    const response = await apiClient.get<SkillChainsListResponse>(ENDPOINTS.skillChains, {
      params: queryParams,
    });
    return response.data;
  },

  /**
   * Get all active skill chains
   */
  async getActiveChains(): Promise<SkillChain[]> {
    const response = await apiClient.get<{ chains: SkillChain[]; count: number }>(
      ENDPOINTS.activeChains
    );
    return response.data.chains;
  },

  /**
   * Get a single skill chain by ID
   */
  async getSkillChain(id: string): Promise<SkillChain> {
    const response = await apiClient.get<{ chain: SkillChain }>(ENDPOINTS.skillChain(id));
    return response.data.chain;
  },

  /**
   * Update a skill chain
   */
  async updateSkillChain(id: string, input: UpdateSkillChainInput): Promise<SkillChain> {
    const response = await apiClient.put<{ chain: SkillChain; message: string }>(
      ENDPOINTS.skillChain(id),
      input
    );
    return response.data.chain;
  },

  /**
   * Delete a skill chain
   */
  async deleteSkillChain(id: string): Promise<void> {
    await apiClient.delete(ENDPOINTS.skillChain(id));
  },

  /**
   * Activate a skill chain (draft -> active)
   */
  async activateChain(id: string): Promise<SkillChain> {
    const response = await apiClient.post<{ chain: SkillChain; message: string }>(
      ENDPOINTS.skillChainActivate(id)
    );
    return response.data.chain;
  },

  /**
   * Archive a skill chain (any -> archived)
   */
  async archiveChain(id: string): Promise<SkillChain> {
    const response = await apiClient.post<{ chain: SkillChain; message: string }>(
      ENDPOINTS.skillChainArchive(id)
    );
    return response.data.chain;
  },

  /**
   * Execute a skill chain on a robot
   */
  async executeChain(id: string, request: ExecuteChainRequest): Promise<ChainExecutionResult> {
    const response = await apiClient.post<{ result: ChainExecutionResult; message: string }>(
      ENDPOINTS.skillChainExecute(id),
      request
    );
    return response.data.result;
  },

  // ============================================================================
  // MODEL VERSIONS (for deployment selection)
  // ============================================================================

  /**
   * List model versions available for deployment
   */
  async listModelVersions(params?: {
    skillId?: string;
    deploymentStatus?: string;
  }): Promise<ModelVersion[]> {
    const queryParams: Record<string, string | undefined> = {};

    if (params?.skillId) queryParams.skillId = params.skillId;
    if (params?.deploymentStatus) queryParams.deploymentStatus = params.deploymentStatus;

    const response = await apiClient.get<{ modelVersions: ModelVersion[] }>(
      ENDPOINTS.modelVersions,
      { params: queryParams }
    );
    return response.data.modelVersions;
  },
};
