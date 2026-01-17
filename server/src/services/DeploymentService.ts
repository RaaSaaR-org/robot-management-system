/**
 * @file DeploymentService.ts
 * @description Service for managing VLA model deployments with canary rollout
 * @feature vla
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import {
  deploymentRepository,
  modelVersionRepository,
} from '../repositories/index.js';
import { robotManager } from './RobotManager.js';
import { mlflowService } from './MLflowService.js';
import { HttpClient, HTTP_TIMEOUTS } from './HttpClient.js';
import type {
  Deployment,
  DeploymentStatus,
  CanaryConfig,
  RollbackThresholds,
  CreateDeploymentInput,
  UpdateDeploymentInput,
  DeploymentQueryParams,
  PaginatedResult,
} from '../types/vla.types.js';
import type {
  DeploymentEvent,
  DeploymentEventType,
  DeploymentEventCallback,
  StartDeploymentRequest,
  DeploymentContext,
  CanaryStage,
  RobotDeployResult,
  ModelSwitchRequest,
  ModelSwitchResponse,
  ThresholdCheckResult,
  AggregatedDeploymentMetrics,
} from '../types/deployment.types.js';
import {
  DEFAULT_CANARY_STAGES,
  DEFAULT_ROLLBACK_THRESHOLDS,
  DEFAULT_CANARY_CONFIG,
  ROBOT_SWITCH_TIMEOUT_MS,
} from '../types/deployment.types.js';

// ============================================================================
// DEPLOYMENT SERVICE
// ============================================================================

/**
 * Service for managing VLA model deployments to robot fleets
 */
export class DeploymentService extends EventEmitter {
  private static instance: DeploymentService;

  // Active deployment tracking
  private activeDeployments: Map<string, DeploymentContext> = new Map();
  private stageTimers: Map<string, NodeJS.Timeout> = new Map();
  private initialized = false;

  private constructor() {
    super();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): DeploymentService {
    if (!DeploymentService.instance) {
      DeploymentService.instance = new DeploymentService();
    }
    return DeploymentService.instance;
  }

  /**
   * Initialize the service - restore active deployments from database
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Load active deployments from database
      const result = await deploymentRepository.findAll({
        status: ['deploying', 'canary'] as DeploymentStatus[],
      });
      const activeDeployments = result.data;

      for (const deployment of activeDeployments) {
        const context = this.createContext(deployment);
        this.activeDeployments.set(deployment.id, context);
        console.log(`[DeploymentService] Restored active deployment: ${deployment.id}`);
      }

      this.initialized = true;
      console.log(`[DeploymentService] Initialized with ${activeDeployments.length} active deployments`);
    } catch (error) {
      console.error('[DeploymentService] Initialization error:', error);
      throw error;
    }
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  // ============================================================================
  // DEPLOYMENT LIFECYCLE
  // ============================================================================

  /**
   * Create a new deployment (does not start it)
   */
  async createDeployment(request: StartDeploymentRequest): Promise<Deployment> {
    // Validate model version exists
    const modelVersion = await modelVersionRepository.findById(request.modelVersionId);
    if (!modelVersion) {
      throw new Error(`Model version not found: ${request.modelVersionId}`);
    }

    // Check for existing active deployment for same model version
    const existing = await deploymentRepository.findByModelVersion(request.modelVersionId);
    const activeExisting = existing.find(d =>
      ['pending', 'deploying', 'canary'].includes(d.status)
    );
    if (activeExisting) {
      throw new Error(`Active deployment already exists for model version: ${activeExisting.id}`);
    }

    // Merge config with defaults
    const canaryConfig: CanaryConfig = {
      stages: request.canaryConfig?.stages ?? DEFAULT_CANARY_STAGES,
      successThreshold: request.canaryConfig?.successThreshold ?? DEFAULT_CANARY_CONFIG.successThreshold,
      metricsWindow: request.canaryConfig?.metricsWindow ?? DEFAULT_CANARY_CONFIG.metricsWindow,
    };

    const rollbackThresholds: RollbackThresholds = {
      errorRate: request.rollbackThresholds?.errorRate ?? DEFAULT_ROLLBACK_THRESHOLDS.errorRate,
      latencyP99: request.rollbackThresholds?.latencyP99 ?? DEFAULT_ROLLBACK_THRESHOLDS.latencyP99,
      failureRate: request.rollbackThresholds?.failureRate ?? DEFAULT_ROLLBACK_THRESHOLDS.failureRate,
    };

    // Create deployment in database
    const input: CreateDeploymentInput = {
      modelVersionId: request.modelVersionId,
      strategy: request.strategy ?? 'canary',
      targetRobotTypes: request.targetRobotTypes ?? [],
      targetZones: request.targetZones ?? [],
      canaryConfig,
      rollbackThresholds,
    };

    const deployment = await deploymentRepository.create(input);

    // Emit event
    this.emitDeploymentEvent('deployment:created', deployment.id, { deployment });

    console.log(`[DeploymentService] Created deployment: ${deployment.id}`);
    return deployment;
  }

  /**
   * Start canary deployment (begin rolling out to first stage)
   */
  async startCanary(deploymentId: string): Promise<Deployment> {
    const deployment = await deploymentRepository.findById(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }

    if (deployment.status !== 'pending') {
      throw new Error(`Cannot start deployment in status: ${deployment.status}`);
    }

    // Create context
    const context = this.createContext(deployment);
    this.activeDeployments.set(deploymentId, context);

    // Update status to deploying
    const updated = await deploymentRepository.update(deploymentId, {
      status: 'deploying',
      startedAt: new Date(),
    });

    if (!updated) {
      throw new Error(`Failed to update deployment: ${deploymentId}`);
    }

    // Emit started event
    this.emitDeploymentEvent('deployment:started', deploymentId, { deployment: updated });

    // Start first stage
    await this.executeStage(deploymentId, 0);

    return updated;
  }

  /**
   * Progress to the next canary stage
   */
  async progressToNextStage(deploymentId: string): Promise<Deployment> {
    const context = this.activeDeployments.get(deploymentId);
    if (!context) {
      throw new Error(`No active deployment context: ${deploymentId}`);
    }

    const nextStageIndex = context.currentStageIndex + 1;
    const stages = context.deployment.canaryConfig.stages;

    if (nextStageIndex >= stages.length) {
      // Already at final stage, promote to production
      return this.promoteToProduction(deploymentId);
    }

    // Clear existing stage timer
    this.clearStageTimer(deploymentId);

    // Execute next stage
    await this.executeStage(deploymentId, nextStageIndex);

    const deployment = await deploymentRepository.findById(deploymentId);
    return deployment!;
  }

  /**
   * Promote deployment directly to production (skip remaining stages)
   */
  async promoteToProduction(deploymentId: string): Promise<Deployment> {
    const context = this.activeDeployments.get(deploymentId);
    if (!context) {
      // Try to load from database
      const deployment = await deploymentRepository.findById(deploymentId);
      if (!deployment || !['deploying', 'canary'].includes(deployment.status)) {
        throw new Error(`Cannot promote deployment: ${deploymentId}`);
      }
    }

    // Clear timers
    this.clearStageTimer(deploymentId);

    // Deploy to all remaining robots (100%)
    const deployment = await deploymentRepository.findById(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }

    // Get all eligible robots
    const allEligible = await this.getEligibleRobots(deployment);
    const remainingRobots = allEligible.filter(
      robotId => !deployment.deployedRobotIds.includes(robotId)
    );

    // Deploy to remaining robots
    const modelVersion = await modelVersionRepository.findById(deployment.modelVersionId);
    if (!modelVersion) {
      throw new Error(`Model version not found: ${deployment.modelVersionId}`);
    }

    const results = await this.deployToRobots(
      remainingRobots,
      modelVersion.id,
      modelVersion.artifactUri
    );

    // Update deployment
    const successfulRobots = results.filter(r => r.success).map(r => r.robotId);
    const failedRobots = results.filter(r => !r.success).map(r => r.robotId);

    const updated = await deploymentRepository.update(deploymentId, {
      status: 'production',
      trafficPercentage: 100,
      deployedRobotIds: [...deployment.deployedRobotIds, ...successfulRobots],
      failedRobotIds: [...deployment.failedRobotIds, ...failedRobots],
      completedAt: new Date(),
    });

    // Update model version deployment status
    await modelVersionRepository.update(modelVersion.id, {
      deploymentStatus: 'production',
    });

    // Update MLflow stage if configured
    if (modelVersion.mlflowModelName && modelVersion.mlflowModelVersion) {
      try {
        await mlflowService.transitionModelVersionStage(
          modelVersion.mlflowModelName,
          modelVersion.mlflowModelVersion,
          'Production',
          true // archive existing
        );
      } catch (error) {
        console.error('[DeploymentService] Failed to update MLflow stage:', error);
      }
    }

    // Clean up
    this.activeDeployments.delete(deploymentId);

    // Emit events
    this.emitDeploymentEvent('deployment:promoted', deploymentId, { deployment: updated! });
    this.emitDeploymentEvent('deployment:completed', deploymentId, { deployment: updated! });

    console.log(`[DeploymentService] Promoted deployment to production: ${deploymentId}`);
    return updated!;
  }

  /**
   * Trigger rollback for a deployment
   */
  async rollback(deploymentId: string, reason: string): Promise<Deployment> {
    const deployment = await deploymentRepository.findById(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }

    if (!['deploying', 'canary', 'production'].includes(deployment.status)) {
      throw new Error(`Cannot rollback deployment in status: ${deployment.status}`);
    }

    // Clear timers
    this.clearStageTimer(deploymentId);

    // Update status
    let updated = await deploymentRepository.update(deploymentId, {
      status: 'rolling_back',
    });

    // Emit rollback started
    this.emitDeploymentEvent('deployment:rollback:started', deploymentId, {
      deployment: updated!,
      reason,
    });

    console.log(`[DeploymentService] Starting rollback: ${deploymentId}, reason: ${reason}`);

    // Get context for previous model versions
    const context = this.activeDeployments.get(deploymentId);
    const previousVersions = context?.previousModelVersionByRobot ?? new Map();

    // Rollback each deployed robot
    const rollbackResults: RobotDeployResult[] = [];
    for (const robotId of deployment.deployedRobotIds) {
      const previousVersion = previousVersions.get(robotId);
      if (previousVersion) {
        const result = await this.rollbackRobot(robotId, previousVersion);
        rollbackResults.push(result);
      }
    }

    // Update status to failed
    updated = await deploymentRepository.update(deploymentId, {
      status: 'failed',
      completedAt: new Date(),
    });

    // Clean up
    this.activeDeployments.delete(deploymentId);

    // Emit rollback completed
    this.emitDeploymentEvent('deployment:rollback:completed', deploymentId, {
      deployment: updated!,
      reason,
    });

    console.log(`[DeploymentService] Rollback completed: ${deploymentId}`);
    return updated!;
  }

  /**
   * Cancel a pending or in-progress deployment
   */
  async cancelDeployment(deploymentId: string): Promise<Deployment> {
    const deployment = await deploymentRepository.findById(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }

    if (!['pending', 'deploying', 'canary'].includes(deployment.status)) {
      throw new Error(`Cannot cancel deployment in status: ${deployment.status}`);
    }

    // Clear timers
    this.clearStageTimer(deploymentId);

    // Update status
    const updated = await deploymentRepository.update(deploymentId, {
      status: 'failed',
      completedAt: new Date(),
    });

    // Clean up
    this.activeDeployments.delete(deploymentId);

    // Emit event
    this.emitDeploymentEvent('deployment:cancelled', deploymentId, { deployment: updated! });

    console.log(`[DeploymentService] Cancelled deployment: ${deploymentId}`);
    return updated!;
  }

  // ============================================================================
  // STAGE EXECUTION
  // ============================================================================

  /**
   * Execute a specific canary stage
   */
  private async executeStage(deploymentId: string, stageIndex: number): Promise<void> {
    const context = this.activeDeployments.get(deploymentId);
    if (!context) {
      throw new Error(`No deployment context: ${deploymentId}`);
    }

    const deployment = await deploymentRepository.findById(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }

    const stages = deployment.canaryConfig.stages;
    if (stageIndex >= stages.length) {
      throw new Error(`Invalid stage index: ${stageIndex}`);
    }

    const stage = stages[stageIndex];
    context.currentStageIndex = stageIndex;
    context.stageStartTime = new Date();

    console.log(`[DeploymentService] Executing stage ${stageIndex + 1}/${stages.length} (${stage.percentage}%)`);

    // Get model version
    const modelVersion = await modelVersionRepository.findById(deployment.modelVersionId);
    if (!modelVersion) {
      throw new Error(`Model version not found: ${deployment.modelVersionId}`);
    }

    // Get eligible robots and calculate target count
    const eligibleRobots = await this.getEligibleRobots(deployment);
    const alreadyDeployed = new Set(deployment.deployedRobotIds);
    const availableRobots = eligibleRobots.filter(id => !alreadyDeployed.has(id));

    // Calculate how many robots we need for this stage
    const totalTargetCount = Math.max(1, Math.ceil(eligibleRobots.length * stage.percentage / 100));
    const alreadyDeployedCount = deployment.deployedRobotIds.length;
    const newTargetCount = Math.max(0, totalTargetCount - alreadyDeployedCount);

    // Select robots for this stage
    const selectedRobots = await this.selectRobotsForStage(availableRobots, newTargetCount);
    context.robotsInCurrentStage = selectedRobots;

    // Emit stage started
    this.emitDeploymentEvent('deployment:stage:started', deploymentId, {
      deployment,
      stage: stageIndex + 1,
      totalStages: stages.length,
    });

    // Deploy to selected robots
    const results = await this.deployToRobots(
      selectedRobots,
      modelVersion.id,
      modelVersion.artifactUri
    );

    // Track results
    const successfulRobots = results.filter(r => r.success).map(r => r.robotId);
    const failedRobots = results.filter(r => !r.success).map(r => r.robotId);

    // Store previous versions for rollback
    for (const result of results) {
      if (result.success && result.previousModelVersion) {
        context.previousModelVersionByRobot.set(result.robotId, result.previousModelVersion);
      }
    }

    // Emit individual robot events
    for (const result of results) {
      this.emitDeploymentEvent(
        result.success ? 'deployment:robot:deployed' : 'deployment:robot:failed',
        deploymentId,
        { robotId: result.robotId, error: result.error }
      );
    }

    // Update deployment in database
    const newStatus: DeploymentStatus = stage.percentage === 100 ? 'production' : 'canary';
    const updated = await deploymentRepository.update(deploymentId, {
      status: newStatus,
      trafficPercentage: stage.percentage,
      deployedRobotIds: [...deployment.deployedRobotIds, ...successfulRobots],
      failedRobotIds: [...deployment.failedRobotIds, ...failedRobots],
      ...(newStatus === 'production' ? { completedAt: new Date() } : {}),
    });

    // Update context
    context.deployment = updated!;

    // Emit stage completed
    this.emitDeploymentEvent('deployment:stage:completed', deploymentId, {
      deployment: updated!,
      stage: stageIndex + 1,
      totalStages: stages.length,
    });

    // If this is the final stage, we're done
    if (stage.percentage === 100 || newStatus === 'production') {
      // Update model version status
      await modelVersionRepository.update(modelVersion.id, {
        deploymentStatus: 'production',
      });

      // Clean up
      this.activeDeployments.delete(deploymentId);
      this.emitDeploymentEvent('deployment:completed', deploymentId, { deployment: updated! });
      console.log(`[DeploymentService] Deployment completed: ${deploymentId}`);
      return;
    }

    // Start timer for next stage (if duration > 0)
    if (stage.durationMinutes > 0) {
      this.startStageTimer(deploymentId, stage.durationMinutes);
    }

    console.log(`[DeploymentService] Stage ${stageIndex + 1} completed. Deployed: ${successfulRobots.length}, Failed: ${failedRobots.length}`);
  }

  // ============================================================================
  // ROBOT SELECTION
  // ============================================================================

  /**
   * Get all eligible robots for a deployment
   */
  private async getEligibleRobots(deployment: Deployment): Promise<string[]> {
    const allRobots = await robotManager.listRobots();

    return allRobots.filter(robot => {
      // Must be online or busy
      if (!['online', 'busy'].includes(robot.status)) {
        return false;
      }

      // Must match target robot types (if specified)
      if (deployment.targetRobotTypes.length > 0) {
        const robotType = (robot.metadata?.robotType as string) ?? robot.model;
        if (!deployment.targetRobotTypes.includes(robotType)) {
          return false;
        }
      }

      // Must be in target zones (if specified)
      if (deployment.targetZones.length > 0) {
        const zone = robot.location.zone ?? '';
        if (!deployment.targetZones.includes(zone)) {
          return false;
        }
      }

      // Must not have already failed in this deployment
      if (deployment.failedRobotIds.includes(robot.id)) {
        return false;
      }

      return true;
    }).map(robot => robot.id);
  }

  /**
   * Select robots for a canary stage
   */
  private async selectRobotsForStage(
    availableRobots: string[],
    targetCount: number
  ): Promise<string[]> {
    if (targetCount <= 0 || availableRobots.length === 0) {
      return [];
    }

    // Score robots (prefer idle, higher battery)
    const scoredRobots: Array<{ robotId: string; score: number }> = [];

    for (const robotId of availableRobots) {
      const robot = await robotManager.getRobot(robotId);
      if (!robot) continue;

      let score = 100;

      // Prefer idle robots (no current task)
      if (!robot.currentTaskId) {
        score += 50;
      }

      // Prefer higher battery
      score += robot.batteryLevel / 2;

      // Add randomization (0-20)
      score += Math.random() * 20;

      scoredRobots.push({ robotId, score });
    }

    // Sort by score (descending) and select top N
    scoredRobots.sort((a, b) => b.score - a.score);
    return scoredRobots.slice(0, targetCount).map(r => r.robotId);
  }

  // ============================================================================
  // ROBOT DEPLOYMENT
  // ============================================================================

  /**
   * Deploy model to multiple robots
   */
  private async deployToRobots(
    robotIds: string[],
    modelVersionId: string,
    artifactUri: string
  ): Promise<RobotDeployResult[]> {
    const results: RobotDeployResult[] = [];

    for (const robotId of robotIds) {
      const result = await this.deployToRobot(robotId, modelVersionId, artifactUri);
      results.push(result);
    }

    return results;
  }

  /**
   * Deploy model to a single robot
   */
  private async deployToRobot(
    robotId: string,
    modelVersionId: string,
    artifactUri: string
  ): Promise<RobotDeployResult> {
    const timestamp = new Date().toISOString();

    try {
      const registeredRobot = await robotManager.getRegisteredRobot(robotId);
      if (!registeredRobot) {
        return {
          robotId,
          success: false,
          error: 'Robot not registered',
          timestamp,
        };
      }

      const request: ModelSwitchRequest = {
        modelVersionId,
        artifactUri,
        rollback: false,
      };

      const httpClient = new HttpClient(registeredRobot.baseUrl, ROBOT_SWITCH_TIMEOUT_MS);
      const response = await httpClient.post<ModelSwitchResponse>(
        `/api/v1/robots/${robotId}/vla/model/switch`,
        request
      );

      if (response.status === 'switched') {
        console.log(`[DeploymentService] Model deployed to robot: ${robotId}`);
        return {
          robotId,
          success: true,
          previousModelVersion: response.previousModelVersion ?? undefined,
          timestamp,
        };
      } else {
        return {
          robotId,
          success: false,
          error: response.error ?? 'Unknown error',
          timestamp,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[DeploymentService] Failed to deploy to robot ${robotId}:`, message);
      return {
        robotId,
        success: false,
        error: message,
        timestamp,
      };
    }
  }

  /**
   * Rollback a single robot to a previous model version
   */
  private async rollbackRobot(
    robotId: string,
    previousModelVersionId: string
  ): Promise<RobotDeployResult> {
    const timestamp = new Date().toISOString();

    try {
      // Get previous model version for artifact URI
      const previousVersion = await modelVersionRepository.findById(previousModelVersionId);
      if (!previousVersion) {
        return {
          robotId,
          success: false,
          error: `Previous model version not found: ${previousModelVersionId}`,
          timestamp,
        };
      }

      const registeredRobot = await robotManager.getRegisteredRobot(robotId);
      if (!registeredRobot) {
        return {
          robotId,
          success: false,
          error: 'Robot not registered',
          timestamp,
        };
      }

      const request: ModelSwitchRequest = {
        modelVersionId: previousModelVersionId,
        artifactUri: previousVersion.artifactUri,
        rollback: true,
      };

      const httpClient = new HttpClient(registeredRobot.baseUrl, ROBOT_SWITCH_TIMEOUT_MS);
      const response = await httpClient.post<ModelSwitchResponse>(
        `/api/v1/robots/${robotId}/vla/model/switch`,
        request
      );

      if (response.status === 'switched') {
        console.log(`[DeploymentService] Rolled back robot: ${robotId}`);
        return {
          robotId,
          success: true,
          timestamp,
        };
      } else {
        return {
          robotId,
          success: false,
          error: response.error ?? 'Unknown error',
          timestamp,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[DeploymentService] Failed to rollback robot ${robotId}:`, message);
      return {
        robotId,
        success: false,
        error: message,
        timestamp,
      };
    }
  }

  // ============================================================================
  // STAGE TIMERS
  // ============================================================================

  /**
   * Start timer for automatic stage progression
   */
  private startStageTimer(deploymentId: string, durationMinutes: number): void {
    // Clear existing timer
    this.clearStageTimer(deploymentId);

    const durationMs = durationMinutes * 60 * 1000;
    console.log(`[DeploymentService] Starting stage timer for ${deploymentId}: ${durationMinutes} minutes`);

    const timer = setTimeout(async () => {
      try {
        await this.progressToNextStage(deploymentId);
      } catch (error) {
        console.error(`[DeploymentService] Auto-progression failed for ${deploymentId}:`, error);
      }
    }, durationMs);

    this.stageTimers.set(deploymentId, timer);
  }

  /**
   * Clear stage timer
   */
  private clearStageTimer(deploymentId: string): void {
    const timer = this.stageTimers.get(deploymentId);
    if (timer) {
      clearTimeout(timer);
      this.stageTimers.delete(deploymentId);
    }
  }

  // ============================================================================
  // CONTEXT MANAGEMENT
  // ============================================================================

  /**
   * Create deployment context from database record
   */
  private createContext(deployment: Deployment): DeploymentContext {
    // Calculate current stage based on traffic percentage
    let currentStageIndex = 0;
    const stages = deployment.canaryConfig.stages;
    for (let i = 0; i < stages.length; i++) {
      if (deployment.trafficPercentage >= stages[i].percentage) {
        currentStageIndex = i;
      }
    }

    return {
      deployment,
      currentStageIndex,
      stageStartTime: deployment.startedAt ?? new Date(),
      robotsInCurrentStage: [],
      previousModelVersionByRobot: new Map(),
    };
  }

  // ============================================================================
  // THRESHOLD CHECKING (for DeploymentMetricsService integration)
  // ============================================================================

  /**
   * Handle threshold violation from metrics service
   */
  async handleThresholdViolation(
    deploymentId: string,
    metrics: AggregatedDeploymentMetrics,
    violations: ThresholdCheckResult
  ): Promise<void> {
    const deployment = await deploymentRepository.findById(deploymentId);
    if (!deployment || !['deploying', 'canary'].includes(deployment.status)) {
      return;
    }

    // Emit warning event
    this.emitDeploymentEvent('deployment:metrics:threshold_warning', deploymentId, {
      deployment,
      metrics,
    });

    // Check if we should auto-rollback (critical violations)
    const criticalViolations = violations.violations.filter(v => v.severity === 'critical');
    if (criticalViolations.length > 0) {
      const reason = `Threshold violations: ${criticalViolations.map(v =>
        `${v.metric}=${v.currentValue.toFixed(3)} > ${v.threshold}`
      ).join(', ')}`;

      console.log(`[DeploymentService] Auto-rollback triggered: ${reason}`);
      await this.rollback(deploymentId, reason);
    }
  }

  // ============================================================================
  // QUERIES
  // ============================================================================

  /**
   * Get deployment by ID
   */
  async getDeployment(deploymentId: string): Promise<Deployment | null> {
    return deploymentRepository.findById(deploymentId);
  }

  /**
   * List deployments with filters
   */
  async listDeployments(params?: DeploymentQueryParams): Promise<PaginatedResult<Deployment>> {
    return deploymentRepository.findAll(params);
  }

  /**
   * Get active deployments
   */
  async getActiveDeployments(): Promise<Deployment[]> {
    return deploymentRepository.findActive();
  }

  /**
   * Get deployment context (for metrics service)
   */
  getDeploymentContext(deploymentId: string): DeploymentContext | undefined {
    return this.activeDeployments.get(deploymentId);
  }

  // ============================================================================
  // EVENTS
  // ============================================================================

  /**
   * Emit a deployment event
   */
  private emitDeploymentEvent(
    type: DeploymentEventType,
    deploymentId: string,
    data: Partial<DeploymentEvent> = {}
  ): void {
    const event: DeploymentEvent = {
      type,
      deploymentId,
      timestamp: new Date().toISOString(),
      ...data,
    };

    this.emit('deployment_event', event);
  }

  /**
   * Subscribe to deployment events
   */
  onDeploymentEvent(callback: DeploymentEventCallback): () => void {
    this.on('deployment_event', callback);
    return () => this.off('deployment_event', callback);
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  /**
   * Cleanup - cancel all timers
   */
  cleanup(): void {
    for (const [deploymentId] of this.stageTimers) {
      this.clearStageTimer(deploymentId);
    }
    this.activeDeployments.clear();
    console.log('[DeploymentService] Cleaned up');
  }
}

// Export singleton instance
export const deploymentService = DeploymentService.getInstance();
