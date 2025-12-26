/**
 * @file ProcessManager.ts
 * @description Service for managing process lifecycle and step orchestration
 * @feature processes
 */

import { EventEmitter } from 'events';
import { processRepository } from '../repositories/ProcessRepository.js';
import { robotTaskRepository } from '../repositories/RobotTaskRepository.js';
import type {
  ProcessDefinition,
  ProcessInstance,
  ProcessInstanceStatus,
  StepInstance,
  StepInstanceStatus,
  CreateProcessDefinitionRequest,
  UpdateProcessDefinitionRequest,
  StartProcessRequest,
  ProcessListFilters,
  ProcessInstanceListFilters,
  PaginationParams,
  PaginatedResponse,
  ProcessEvent,
  StepResult,
} from '../types/process.types.js';
import type { RobotTask } from '../types/robotTask.types.js';

// Simple logger wrapper
const logger = {
  info: (msg: string) => console.log(`[ProcessManager] ${msg}`),
  warn: (msg: string) => console.warn(`[ProcessManager] ${msg}`),
  error: (msg: string, err?: unknown) => console.error(`[ProcessManager] ${msg}`, err ?? ''),
  debug: (msg: string) => console.log(`[ProcessManager:debug] ${msg}`),
};

export class ProcessManager extends EventEmitter {
  private static instance: ProcessManager;

  private constructor() {
    super();
  }

  static getInstance(): ProcessManager {
    if (!ProcessManager.instance) {
      ProcessManager.instance = new ProcessManager();
    }
    return ProcessManager.instance;
  }

  // ============================================================================
  // PROCESS DEFINITION MANAGEMENT
  // ============================================================================

  async getDefinition(id: string): Promise<ProcessDefinition | null> {
    return processRepository.findDefinitionById(id);
  }

  async listDefinitions(
    filters?: ProcessListFilters,
    pagination?: PaginationParams
  ): Promise<PaginatedResponse<ProcessDefinition>> {
    return processRepository.findAllDefinitions(filters, pagination);
  }

  async createDefinition(
    request: CreateProcessDefinitionRequest,
    createdBy: string
  ): Promise<ProcessDefinition> {
    const definition = await processRepository.createDefinition(request, createdBy);
    logger.info(`Created process definition: ${definition.name} (${definition.id})`);
    return definition;
  }

  async updateDefinition(
    id: string,
    request: UpdateProcessDefinitionRequest
  ): Promise<ProcessDefinition | null> {
    const definition = await processRepository.updateDefinition(id, request);
    if (definition) {
      logger.info(`Updated process definition: ${definition.name} (${definition.id})`);
    }
    return definition;
  }

  async publishDefinition(id: string): Promise<ProcessDefinition | null> {
    return processRepository.updateDefinition(id, { status: 'ready' });
  }

  async archiveDefinition(id: string): Promise<boolean> {
    return processRepository.deleteDefinition(id);
  }

  // ============================================================================
  // PROCESS INSTANCE MANAGEMENT
  // ============================================================================

  async getInstance(id: string): Promise<ProcessInstance | null> {
    return processRepository.findInstanceById(id);
  }

  async listInstances(
    filters?: ProcessInstanceListFilters,
    pagination?: PaginationParams
  ): Promise<PaginatedResponse<ProcessInstance>> {
    return processRepository.findAllInstances(filters, pagination);
  }

  /**
   * Start a new process instance from a definition
   */
  async startProcess(
    definitionId: string,
    request: StartProcessRequest,
    createdBy: string
  ): Promise<ProcessInstance | null> {
    const instance = await processRepository.createInstance(definitionId, request, createdBy);
    if (!instance) {
      logger.warn(`Failed to start process: definition ${definitionId} not found or not ready`);
      return null;
    }

    logger.info(`Started process instance: ${instance.processName} (${instance.id})`);

    // Emit creation event
    this.emitProcessEvent({
      type: 'process:created',
      processInstance: instance,
    });

    // If not scheduled for later, begin execution
    if (!request.scheduledAt || new Date(request.scheduledAt) <= new Date()) {
      await this.beginExecution(instance.id);
    }

    return instance;
  }

  /**
   * Begin executing a process (start first step)
   */
  async beginExecution(instanceId: string): Promise<boolean> {
    const instance = await processRepository.findInstanceById(instanceId);
    if (!instance || instance.status !== 'pending') {
      return false;
    }

    // Update status to in_progress
    const updated = await processRepository.updateInstanceStatus(instanceId, 'in_progress');
    if (!updated) return false;

    logger.info(`Process ${instance.processName} (${instanceId}) is now in progress`);

    this.emitProcessEvent({
      type: 'process:updated',
      processInstance: updated,
    });

    // Execute next step
    await this.executeNextStep(instanceId);
    return true;
  }

  /**
   * Pause a running process
   */
  async pauseProcess(id: string): Promise<ProcessInstance | null> {
    const instance = await processRepository.findInstanceById(id);
    if (!instance || instance.status !== 'in_progress') {
      return null;
    }

    const updated = await processRepository.updateInstanceStatus(id, 'paused');
    if (updated) {
      logger.info(`Process ${instance.processName} (${id}) paused`);
      this.emitProcessEvent({
        type: 'process:updated',
        processInstance: updated,
      });
    }
    return updated;
  }

  /**
   * Resume a paused process
   */
  async resumeProcess(id: string): Promise<ProcessInstance | null> {
    const instance = await processRepository.findInstanceById(id);
    if (!instance || instance.status !== 'paused') {
      return null;
    }

    const updated = await processRepository.updateInstanceStatus(id, 'in_progress');
    if (updated) {
      logger.info(`Process ${instance.processName} (${id}) resumed`);
      this.emitProcessEvent({
        type: 'process:updated',
        processInstance: updated,
      });

      // Continue execution
      await this.executeNextStep(id);
    }
    return updated;
  }

  /**
   * Cancel a process
   */
  async cancelProcess(id: string): Promise<ProcessInstance | null> {
    const instance = await processRepository.findInstanceById(id);
    if (!instance || ['completed', 'failed', 'cancelled'].includes(instance.status)) {
      return null;
    }

    // Cancel any pending/in_progress steps
    for (const step of instance.steps) {
      if (['pending', 'queued', 'in_progress'].includes(step.status)) {
        await processRepository.updateStepStatus(step.id, 'cancelled');
      }
    }

    // Cancel any associated robot tasks
    const tasks = await robotTaskRepository.findByProcessInstanceId(id);
    for (const task of tasks) {
      if (['pending', 'assigned', 'executing'].includes(task.status)) {
        await robotTaskRepository.cancel(task.id, 'Process cancelled');
      }
    }

    const updated = await processRepository.updateInstanceStatus(id, 'cancelled');
    if (updated) {
      logger.info(`Process ${instance.processName} (${id}) cancelled`);
      this.emitProcessEvent({
        type: 'process:updated',
        processInstance: updated,
      });
    }
    return updated;
  }

  // ============================================================================
  // STEP EXECUTION
  // ============================================================================

  /**
   * Execute the next pending step in a process
   */
  async executeNextStep(instanceId: string): Promise<void> {
    const instance = await processRepository.findInstanceById(instanceId);
    if (!instance || instance.status !== 'in_progress') {
      return;
    }

    const nextStep = await processRepository.getNextPendingStep(instanceId);
    if (!nextStep) {
      // No more steps - check if all are completed
      await this.checkProcessCompletion(instanceId);
      return;
    }

    // Mark step as queued (waiting for robot assignment)
    await processRepository.updateStepStatus(nextStep.id, 'queued');

    this.emitProcessEvent({
      type: 'step:started',
      processInstanceId: instanceId,
      stepInstance: { ...nextStep, status: 'queued' },
    });

    // Create a robot task for this step
    // The TaskDistributor will assign it to a robot
    const task = await robotTaskRepository.create(
      {
        actionType: nextStep.actionType,
        actionConfig: nextStep.actionConfig,
        instruction: `${nextStep.name}: ${nextStep.description ?? ''}`,
        priority: instance.priority,
      },
      'process',
      instanceId,
      nextStep.id
    );

    logger.info(`Created task ${task.id} for step ${nextStep.name} in process ${instance.processName}`);

    // Emit event for TaskDistributor to pick up
    this.emit('task:created', task);
  }

  /**
   * Handle step completion (called by TaskDistributor when robot completes)
   */
  async onStepCompleted(
    stepId: string,
    result: StepResult
  ): Promise<void> {
    const step = await processRepository.findStepById(stepId);
    if (!step) return;

    const success = await processRepository.updateStepResult(stepId, result);
    if (!success) return;

    const updatedStep = await processRepository.findStepById(stepId);
    if (!updatedStep) return;

    logger.info(`Step ${step.name} completed: ${result.success ? 'success' : 'failed'}`);

    if (result.success) {
      this.emitProcessEvent({
        type: 'step:completed',
        processInstanceId: step.processInstanceId,
        stepInstance: updatedStep,
      });
    } else {
      this.emitProcessEvent({
        type: 'step:failed',
        processInstanceId: step.processInstanceId,
        stepInstance: updatedStep,
        error: result.message ?? 'Unknown error',
      });
    }

    if (result.success) {
      // Update progress and execute next step
      await this.updateProcessProgress(step.processInstanceId);
      await this.executeNextStep(step.processInstanceId);
    } else {
      // Handle failure
      await this.handleStepFailure(step, result.message ?? 'Unknown error');
    }
  }

  /**
   * Handle step failure with retry logic
   */
  private async handleStepFailure(step: StepInstance, error: string): Promise<void> {
    if (step.retryCount < step.maxRetries) {
      // Retry the step
      const newRetryCount = await processRepository.incrementStepRetry(step.id);
      logger.info(`Retrying step ${step.name} (attempt ${newRetryCount}/${step.maxRetries})`);

      // Re-execute by going back to executeNextStep
      await this.executeNextStep(step.processInstanceId);
    } else {
      // Max retries reached - fail the process
      const instance = await processRepository.findInstanceById(step.processInstanceId);
      if (instance) {
        const updated = await processRepository.updateInstanceStatus(
          step.processInstanceId,
          'failed',
          `Step "${step.name}" failed after ${step.maxRetries} retries: ${error}`
        );

        if (updated) {
          this.emitProcessEvent({
            type: 'process:failed',
            processInstance: updated,
            error: `Step "${step.name}" failed: ${error}`,
          });
        }
      }
    }
  }

  /**
   * Update process progress based on completed steps
   */
  private async updateProcessProgress(instanceId: string): Promise<void> {
    const stepCounts = await processRepository.countStepsByStatus(instanceId);
    const totalSteps = Object.values(stepCounts).reduce((sum, count) => sum + count, 0);
    const completedSteps = stepCounts.completed + stepCounts.skipped;
    const progress = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

    // Find current step index (first non-completed step)
    const instance = await processRepository.findInstanceById(instanceId);
    const currentStepIndex = instance?.steps.findIndex(
      (s) => !['completed', 'skipped'].includes(s.status)
    ) ?? 0;

    await processRepository.updateInstanceProgress(instanceId, progress, currentStepIndex);
  }

  /**
   * Check if process is complete
   */
  private async checkProcessCompletion(instanceId: string): Promise<void> {
    const stepCounts = await processRepository.countStepsByStatus(instanceId);

    const hasRunning = stepCounts.queued > 0 || stepCounts.in_progress > 0;
    const hasPending = stepCounts.pending > 0;
    const hasFailed = stepCounts.failed > 0;

    if (hasRunning || hasPending) {
      // Still work to do
      return;
    }

    if (hasFailed) {
      // Process failed
      const updated = await processRepository.updateInstanceStatus(instanceId, 'failed');
      if (updated) {
        this.emitProcessEvent({
          type: 'process:failed',
          processInstance: updated,
          error: 'One or more steps failed',
        });
      }
    } else {
      // All steps completed successfully
      await processRepository.updateInstanceProgress(instanceId, 100);
      const updated = await processRepository.updateInstanceStatus(instanceId, 'completed');
      if (updated) {
        logger.info(`Process ${updated.processName} (${instanceId}) completed successfully`);
        this.emitProcessEvent({
          type: 'process:completed',
          processInstance: updated,
        });
      }
    }
  }

  // ============================================================================
  // EVENT HELPERS
  // ============================================================================

  private emitProcessEvent(event: ProcessEvent): void {
    this.emit(event.type, event);
    this.emit('process:event', event);
  }

  /**
   * Subscribe to all process events
   */
  onProcessEvent(handler: (event: ProcessEvent) => void): void {
    this.on('process:event', handler);
  }
}

export const processManager = ProcessManager.getInstance();
