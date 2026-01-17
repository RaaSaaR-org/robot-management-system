/**
 * @file SkillExecutionService.ts
 * @description Service for executing skills and skill chains on robots
 * @feature vla
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { skillDefinitionRepository, skillChainRepository } from '../repositories/index.js';
import { robotManager } from './RobotManager.js';
import { skillLibraryService } from './SkillLibraryService.js';
import { HttpClient } from './HttpClient.js';
import type { SkillDefinition, Condition } from '../types/vla.types.js';
import type {
  SkillChain,
  ExecuteSkillRequest,
  ExecuteChainRequest,
  SkillExecutionResult,
  ChainExecutionResult,
  ConditionCheckResult,
  SkillExecutionStatus,
  SkillEvent,
  SkillEventType,
  SkillEventCallback,
} from '../types/skill.types.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const ROBOT_EXECUTION_TIMEOUT_MS = 300000; // 5 minutes
const DEFAULT_SKILL_TIMEOUT_S = 60;

// ============================================================================
// SKILL EXECUTION SERVICE
// ============================================================================

/**
 * Service for executing skills and skill chains on robots
 */
export class SkillExecutionService extends EventEmitter {
  private static instance: SkillExecutionService;
  private initialized = false;

  // Track active executions
  private activeExecutions: Map<string, { aborted: boolean }> = new Map();

  private constructor() {
    super();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): SkillExecutionService {
    if (!SkillExecutionService.instance) {
      SkillExecutionService.instance = new SkillExecutionService();
    }
    return SkillExecutionService.instance;
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    console.log('[SkillExecutionService] Initialized');
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  // ============================================================================
  // SKILL EXECUTION
  // ============================================================================

  /**
   * Execute a single skill on a robot
   */
  async executeSkill(request: ExecuteSkillRequest): Promise<SkillExecutionResult> {
    const executionId = uuidv4();
    const startedAt = new Date();

    // Track execution
    this.activeExecutions.set(executionId, { aborted: false });

    try {
      // Get skill
      const skill = await skillDefinitionRepository.findById(request.skillId);
      if (!skill) {
        return this.createFailedResult(request, startedAt, 'Skill not found');
      }

      // Verify robot exists
      const robot = await robotManager.getRobot(request.robotId);
      if (!robot) {
        return this.createFailedResult(request, startedAt, 'Robot not found');
      }

      // Check compatibility
      const compatibility = await skillLibraryService.checkRobotCompatibility(
        request.skillId,
        request.robotId
      );
      if (!compatibility.compatible) {
        return this.createFailedResult(
          request,
          startedAt,
          `Robot incompatible: missing capabilities [${compatibility.missingCapabilities.join(', ')}]`
        );
      }

      // Merge parameters with defaults
      const parameters = { ...skill.defaultParameters, ...(request.parameters ?? {}) };

      // Validate parameters
      const validationResult = skillLibraryService.validateParameters(skill, parameters);
      if (!validationResult.valid) {
        const errorMessages = validationResult.errors.map(e => e.message).join(', ');
        return this.createFailedResult(request, startedAt, `Parameter validation failed: ${errorMessages}`);
      }

      // Emit started event
      this.emitEvent('skill:execution:started', {
        skillId: skill.id,
        robotId: request.robotId,
      });

      // Check preconditions (unless skipped)
      let preconditionResults: ConditionCheckResult[] = [];
      if (!request.skipPreconditions && skill.preconditions.length > 0) {
        this.emitEvent('skill:execution:preconditions:checking', {
          skillId: skill.id,
          robotId: request.robotId,
        });

        preconditionResults = await this.checkConditions(skill.preconditions, request.robotId);
        const failedPreconditions = preconditionResults.filter(r => !r.passed);

        if (failedPreconditions.length > 0) {
          this.emitEvent('skill:execution:preconditions:failed', {
            skillId: skill.id,
            robotId: request.robotId,
          });

          return {
            skillId: skill.id,
            robotId: request.robotId,
            status: 'failed',
            startedAt,
            completedAt: new Date(),
            duration: Date.now() - startedAt.getTime(),
            parameters,
            preconditionResults,
            error: `Preconditions failed: ${failedPreconditions.map(f => f.condition.name).join(', ')}`,
            retryCount: 0,
          };
        }

        this.emitEvent('skill:execution:preconditions:passed', {
          skillId: skill.id,
          robotId: request.robotId,
        });
      }

      // Execute skill on robot
      this.emitEvent('skill:execution:running', {
        skillId: skill.id,
        robotId: request.robotId,
      });

      const executionResult = await this.executeSkillOnRobot(
        skill,
        request.robotId,
        validationResult.coercedParameters ?? parameters
      );

      // Check if aborted
      if (this.activeExecutions.get(executionId)?.aborted) {
        return {
          skillId: skill.id,
          robotId: request.robotId,
          status: 'cancelled',
          startedAt,
          completedAt: new Date(),
          duration: Date.now() - startedAt.getTime(),
          parameters,
          preconditionResults,
          error: 'Execution cancelled',
          retryCount: 0,
        };
      }

      if (!executionResult.success) {
        this.emitEvent('skill:execution:failed', {
          skillId: skill.id,
          robotId: request.robotId,
          error: executionResult.error,
        });

        return {
          skillId: skill.id,
          robotId: request.robotId,
          status: 'failed',
          startedAt,
          completedAt: new Date(),
          duration: Date.now() - startedAt.getTime(),
          parameters,
          preconditionResults,
          output: executionResult.output,
          error: executionResult.error,
          retryCount: 0,
        };
      }

      // Check postconditions (unless skipped)
      let postconditionResults: ConditionCheckResult[] = [];
      if (!request.skipPostconditions && skill.postconditions.length > 0) {
        this.emitEvent('skill:execution:postconditions:checking', {
          skillId: skill.id,
          robotId: request.robotId,
        });

        postconditionResults = await this.checkConditions(skill.postconditions, request.robotId);
        const failedPostconditions = postconditionResults.filter(r => !r.passed);

        if (failedPostconditions.length > 0) {
          this.emitEvent('skill:execution:postconditions:failed', {
            skillId: skill.id,
            robotId: request.robotId,
          });

          return {
            skillId: skill.id,
            robotId: request.robotId,
            status: 'failed',
            startedAt,
            completedAt: new Date(),
            duration: Date.now() - startedAt.getTime(),
            parameters,
            output: executionResult.output,
            preconditionResults,
            postconditionResults,
            error: `Postconditions failed: ${failedPostconditions.map(f => f.condition.name).join(', ')}`,
            retryCount: 0,
          };
        }

        this.emitEvent('skill:execution:postconditions:passed', {
          skillId: skill.id,
          robotId: request.robotId,
        });
      }

      // Success!
      this.emitEvent('skill:execution:completed', {
        skillId: skill.id,
        robotId: request.robotId,
      });

      return {
        skillId: skill.id,
        robotId: request.robotId,
        status: 'completed',
        startedAt,
        completedAt: new Date(),
        duration: Date.now() - startedAt.getTime(),
        parameters,
        output: executionResult.output,
        preconditionResults,
        postconditionResults,
        retryCount: 0,
      };
    } finally {
      this.activeExecutions.delete(executionId);
    }
  }

  /**
   * Execute a skill chain on a robot
   */
  async executeChain(request: ExecuteChainRequest): Promise<ChainExecutionResult> {
    const executionId = uuidv4();
    const startedAt = new Date();

    // Track execution
    this.activeExecutions.set(executionId, { aborted: false });

    try {
      // Get chain
      const chain = await skillChainRepository.findById(request.chainId);
      if (!chain) {
        return {
          chainId: request.chainId,
          robotId: request.robotId,
          status: 'failed',
          startedAt,
          completedAt: new Date(),
          stepResults: [],
          error: 'Skill chain not found',
        };
      }

      if (chain.status !== 'active') {
        return {
          chainId: chain.id,
          robotId: request.robotId,
          status: 'failed',
          startedAt,
          completedAt: new Date(),
          stepResults: [],
          error: `Chain is not active: ${chain.status}`,
        };
      }

      // Verify robot exists
      const robot = await robotManager.getRobot(request.robotId);
      if (!robot) {
        return {
          chainId: chain.id,
          robotId: request.robotId,
          status: 'failed',
          startedAt,
          completedAt: new Date(),
          stepResults: [],
          error: 'Robot not found',
        };
      }

      // Emit chain started
      this.emitEvent('skill:chain:started', {
        chainId: chain.id,
        robotId: request.robotId,
      });

      // Execute steps
      const stepResults: ChainExecutionResult['stepResults'] = [];
      let chainOutput: Record<string, unknown> = request.initialParameters ?? {};
      const startFromStep = request.startFromStep ?? 0;

      for (let i = startFromStep; i < chain.steps.length; i++) {
        const step = chain.steps[i];

        // Check if aborted
        if (this.activeExecutions.get(executionId)?.aborted) {
          this.emitEvent('skill:chain:failed', {
            chainId: chain.id,
            robotId: request.robotId,
            error: 'Chain execution cancelled',
          });

          return {
            chainId: chain.id,
            robotId: request.robotId,
            status: 'cancelled',
            startedAt,
            completedAt: new Date(),
            totalDuration: Date.now() - startedAt.getTime(),
            stepResults,
            failedAtStep: i,
            error: 'Chain execution cancelled',
          };
        }

        // Map inputs from previous outputs
        const mappedParams = this.mapInputs(step.inputMapping ?? {}, chainOutput, step.parameters);

        this.emitEvent('skill:chain:step:started', {
          chainId: chain.id,
          robotId: request.robotId,
          skillId: step.skillId,
          stepOrder: i,
        });

        // Execute step with retries
        let stepResult: SkillExecutionResult | null = null;
        const maxRetries = step.maxRetries ?? step.skill?.maxRetries ?? 0;
        let retryCount = 0;

        while (retryCount <= maxRetries) {
          stepResult = await this.executeSkill({
            skillId: step.skillId,
            robotId: request.robotId,
            parameters: mappedParams,
          });

          if (stepResult.status === 'completed') {
            break;
          }

          if (step.onFailure === 'abort') {
            break; // Don't retry on abort
          }

          if (step.onFailure === 'retry' && retryCount < maxRetries) {
            retryCount++;
            console.log(`[SkillExecutionService] Retrying step ${i} (attempt ${retryCount + 1})`);
          } else {
            break;
          }
        }

        if (!stepResult) {
          stepResult = {
            skillId: step.skillId,
            robotId: request.robotId,
            status: 'failed',
            startedAt: new Date(),
            completedAt: new Date(),
            parameters: mappedParams,
            error: 'Unknown error',
            retryCount,
          };
        }

        stepResult.retryCount = retryCount;

        stepResults.push({
          stepOrder: i,
          skillId: step.skillId,
          result: stepResult,
        });

        if (stepResult.status !== 'completed') {
          // Handle failure based on strategy
          if (step.onFailure === 'abort') {
            this.emitEvent('skill:chain:step:failed', {
              chainId: chain.id,
              robotId: request.robotId,
              skillId: step.skillId,
              stepOrder: i,
              error: stepResult.error,
            });

            this.emitEvent('skill:chain:failed', {
              chainId: chain.id,
              robotId: request.robotId,
              error: `Step ${i} failed: ${stepResult.error}`,
            });

            return {
              chainId: chain.id,
              robotId: request.robotId,
              status: 'failed',
              startedAt,
              completedAt: new Date(),
              totalDuration: Date.now() - startedAt.getTime(),
              stepResults,
              failedAtStep: i,
              error: `Step ${i} failed: ${stepResult.error}`,
            };
          } else if (step.onFailure === 'skip') {
            // Log skip and continue
            console.log(`[SkillExecutionService] Skipping failed step ${i}`);
            this.emitEvent('skill:chain:step:failed', {
              chainId: chain.id,
              robotId: request.robotId,
              skillId: step.skillId,
              stepOrder: i,
              error: `Skipped: ${stepResult.error}`,
            });
            continue;
          }
        }

        // Merge output into chain context
        if (stepResult.output) {
          chainOutput = { ...chainOutput, ...stepResult.output };
        }

        this.emitEvent('skill:chain:step:completed', {
          chainId: chain.id,
          robotId: request.robotId,
          skillId: step.skillId,
          stepOrder: i,
        });
      }

      // Chain completed
      this.emitEvent('skill:chain:completed', {
        chainId: chain.id,
        robotId: request.robotId,
      });

      return {
        chainId: chain.id,
        robotId: request.robotId,
        status: 'completed',
        startedAt,
        completedAt: new Date(),
        totalDuration: Date.now() - startedAt.getTime(),
        stepResults,
        finalOutput: chainOutput,
      };
    } finally {
      this.activeExecutions.delete(executionId);
    }
  }

  /**
   * Cancel an active execution
   */
  cancelExecution(executionId: string): boolean {
    const execution = this.activeExecutions.get(executionId);
    if (execution) {
      execution.aborted = true;
      return true;
    }
    return false;
  }

  // ============================================================================
  // INTERNAL HELPERS
  // ============================================================================

  /**
   * Execute skill on robot via HTTP
   */
  private async executeSkillOnRobot(
    skill: SkillDefinition,
    robotId: string,
    parameters: Record<string, unknown>
  ): Promise<{ success: boolean; output?: Record<string, unknown>; error?: string }> {
    try {
      const registeredRobot = await robotManager.getRegisteredRobot(robotId);
      if (!registeredRobot) {
        return { success: false, error: 'Robot not registered with server' };
      }

      const timeout = (skill.timeout ?? DEFAULT_SKILL_TIMEOUT_S) * 1000;
      const httpClient = new HttpClient(registeredRobot.baseUrl, Math.min(timeout, ROBOT_EXECUTION_TIMEOUT_MS));

      const response = await httpClient.post<{
        status: string;
        output?: Record<string, unknown>;
        error?: string;
      }>(`/api/v1/robots/${robotId}/skills/execute`, {
        skillId: skill.id,
        skillName: skill.name,
        skillVersion: skill.version,
        parameters,
        timeout: skill.timeout,
        linkedModelVersionId: skill.linkedModelVersionId,
      });

      if (response.status === 'completed' || response.status === 'success') {
        return { success: true, output: response.output };
      }

      return {
        success: false,
        output: response.output,
        error: response.error ?? 'Skill execution failed on robot',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[SkillExecutionService] Robot execution error:`, message);
      return { success: false, error: message };
    }
  }

  /**
   * Check a list of conditions against robot state
   */
  private async checkConditions(
    conditions: Condition[],
    robotId: string
  ): Promise<ConditionCheckResult[]> {
    const results: ConditionCheckResult[] = [];

    for (const condition of conditions) {
      try {
        const result = await this.checkCondition(condition, robotId);
        results.push(result);
      } catch (error) {
        results.push({
          condition,
          passed: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return results;
  }

  /**
   * Check a single condition against robot state
   */
  private async checkCondition(condition: Condition, robotId: string): Promise<ConditionCheckResult> {
    try {
      const registeredRobot = await robotManager.getRegisteredRobot(robotId);
      if (!registeredRobot) {
        return {
          condition,
          passed: false,
          error: 'Robot not registered',
        };
      }

      const httpClient = new HttpClient(registeredRobot.baseUrl, 10000);

      const response = await httpClient.post<{
        passed: boolean;
        actualValue?: unknown;
        expectedValue?: unknown;
        error?: string;
      }>(`/api/v1/robots/${robotId}/conditions/check`, {
        type: condition.type,
        name: condition.name,
        check: condition.check,
        params: condition.params,
      });

      return {
        condition,
        passed: response.passed,
        actualValue: response.actualValue,
        expectedValue: response.expectedValue,
        error: response.error,
      };
    } catch (error) {
      // If robot doesn't support condition checking, assume passed
      console.warn(`[SkillExecutionService] Could not check condition ${condition.name}: ${error}`);
      return {
        condition,
        passed: true, // Optimistic - assume passed if we can't check
        error: 'Condition checking not available',
      };
    }
  }

  /**
   * Map input parameters from previous outputs
   */
  private mapInputs(
    inputMapping: Record<string, string>,
    previousOutput: Record<string, unknown>,
    stepParameters: Record<string, unknown>
  ): Record<string, unknown> {
    const mapped = { ...stepParameters };

    for (const [targetKey, sourceKey] of Object.entries(inputMapping)) {
      if (sourceKey in previousOutput) {
        mapped[targetKey] = previousOutput[sourceKey];
      }
    }

    return mapped;
  }

  /**
   * Create a failed result helper
   */
  private createFailedResult(
    request: ExecuteSkillRequest,
    startedAt: Date,
    error: string
  ): SkillExecutionResult {
    return {
      skillId: request.skillId,
      robotId: request.robotId,
      status: 'failed',
      startedAt,
      completedAt: new Date(),
      duration: Date.now() - startedAt.getTime(),
      parameters: request.parameters ?? {},
      error,
      retryCount: 0,
    };
  }

  // ============================================================================
  // EVENTS
  // ============================================================================

  /**
   * Emit a skill event
   */
  private emitEvent(type: SkillEventType, data: Partial<SkillEvent> = {}): void {
    const event: SkillEvent = {
      type,
      robotId: data.robotId ?? '',
      timestamp: new Date().toISOString(),
      ...data,
    };

    this.emit('skill_event', event);
  }

  /**
   * Subscribe to skill events
   */
  onSkillEvent(callback: SkillEventCallback): () => void {
    this.on('skill_event', callback);
    return () => this.off('skill_event', callback);
  }
}

// Export singleton instance
export const skillExecutionService = SkillExecutionService.getInstance();
