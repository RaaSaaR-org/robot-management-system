/**
 * @file SkillLibraryService.ts
 * @description Service for managing the skill library - CRUD operations, validation, and compatibility checking
 * @feature vla
 */

import { EventEmitter } from 'events';
import Ajv, { type ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import {
  skillDefinitionRepository,
  skillChainRepository,
  robotTypeRepository,
} from '../repositories/index.js';
import { robotManager } from './RobotManager.js';
import type {
  SkillDefinition,
  CreateSkillDefinitionInput,
  UpdateSkillDefinitionInput,
  SkillDefinitionQueryParams,
  SkillStatus,
  Condition,
  PaginatedResult,
} from '../types/vla.types.js';
import type {
  SkillChain,
  CreateSkillChainInput,
  UpdateSkillChainInput,
  SkillChainQueryParams,
  SkillChainStatus,
  ParameterValidationResult,
  ValidationError,
  RobotCompatibility,
  CompatibilityCheckResult,
  SkillEvent,
  SkillEventType,
  SkillEventCallback,
} from '../types/skill.types.js';

// ============================================================================
// SKILL LIBRARY SERVICE
// ============================================================================

/**
 * Service for managing skills and skill chains
 */
export class SkillLibraryService extends EventEmitter {
  private static instance: SkillLibraryService;
  private ajv: Ajv;
  private initialized = false;

  private constructor() {
    super();
    // Initialize AJV for JSON Schema validation
    this.ajv = new Ajv({
      allErrors: true,
      coerceTypes: true,
      useDefaults: true,
    });
    addFormats(this.ajv);
  }

  /**
   * Get singleton instance
   */
  static getInstance(): SkillLibraryService {
    if (!SkillLibraryService.instance) {
      SkillLibraryService.instance = new SkillLibraryService();
    }
    return SkillLibraryService.instance;
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    console.log('[SkillLibraryService] Initialized');
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  // ============================================================================
  // SKILL DEFINITION CRUD
  // ============================================================================

  /**
   * Create a new skill definition
   */
  async createSkill(input: CreateSkillDefinitionInput): Promise<SkillDefinition> {
    // Validate parameter schema if provided
    if (input.parametersSchema && Object.keys(input.parametersSchema).length > 0) {
      try {
        this.ajv.compile(input.parametersSchema);
      } catch (error) {
        throw new Error(`Invalid parameter schema: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Validate compatible robot types exist
    if (input.compatibleRobotTypeIds) {
      for (const robotTypeId of input.compatibleRobotTypeIds) {
        const robotType = await robotTypeRepository.findById(robotTypeId);
        if (!robotType) {
          throw new Error(`Robot type not found: ${robotTypeId}`);
        }
      }
    }

    const skill = await skillDefinitionRepository.create(input);

    this.emitEvent('skill:execution:completed', { skillId: skill.id });
    console.log(`[SkillLibraryService] Created skill: ${skill.name} v${skill.version}`);

    return skill;
  }

  /**
   * Get skill by ID
   */
  async getSkill(id: string): Promise<SkillDefinition | null> {
    return skillDefinitionRepository.findById(id);
  }

  /**
   * Get skill by ID with relations (compatible robot types)
   */
  async getSkillWithRelations(id: string): Promise<SkillDefinition | null> {
    return skillDefinitionRepository.findByIdWithRelations(id);
  }

  /**
   * Get skill by name and version
   */
  async getSkillByNameAndVersion(name: string, version: string): Promise<SkillDefinition | null> {
    return skillDefinitionRepository.findByNameAndVersion(name, version);
  }

  /**
   * List skills with filters
   */
  async listSkills(params?: SkillDefinitionQueryParams): Promise<PaginatedResult<SkillDefinition>> {
    return skillDefinitionRepository.findAll(params);
  }

  /**
   * List published skills
   */
  async listPublishedSkills(): Promise<SkillDefinition[]> {
    return skillDefinitionRepository.findPublished();
  }

  /**
   * List skills compatible with a robot type
   */
  async listSkillsByRobotType(robotTypeId: string): Promise<SkillDefinition[]> {
    return skillDefinitionRepository.findByRobotType(robotTypeId);
  }

  /**
   * List skills requiring a specific capability
   */
  async listSkillsByCapability(capability: string): Promise<SkillDefinition[]> {
    return skillDefinitionRepository.findByCapability(capability);
  }

  /**
   * Update a skill definition
   */
  async updateSkill(id: string, input: UpdateSkillDefinitionInput): Promise<SkillDefinition | null> {
    const existing = await skillDefinitionRepository.findById(id);
    if (!existing) {
      throw new Error(`Skill not found: ${id}`);
    }

    // Prevent updates to published skills unless deprecating/archiving
    if (existing.status === 'published' && !['deprecated', 'archived'].includes(input.status ?? '')) {
      // Only allow status changes for published skills
      if (Object.keys(input).some(k => k !== 'status')) {
        throw new Error('Cannot modify published skill. Create a new version instead.');
      }
    }

    // Validate parameter schema if being updated
    if (input.parametersSchema && Object.keys(input.parametersSchema).length > 0) {
      try {
        this.ajv.compile(input.parametersSchema);
      } catch (error) {
        throw new Error(`Invalid parameter schema: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    const skill = await skillDefinitionRepository.update(id, input);
    if (skill) {
      console.log(`[SkillLibraryService] Updated skill: ${skill.name} v${skill.version}`);
    }

    return skill;
  }

  /**
   * Delete a skill definition
   */
  async deleteSkill(id: string): Promise<boolean> {
    const existing = await skillDefinitionRepository.findById(id);
    if (!existing) {
      return false;
    }

    // Prevent deletion of published skills
    if (existing.status === 'published') {
      throw new Error('Cannot delete published skill. Deprecate or archive it instead.');
    }

    const deleted = await skillDefinitionRepository.delete(id);
    if (deleted) {
      console.log(`[SkillLibraryService] Deleted skill: ${existing.name} v${existing.version}`);
    }

    return deleted;
  }

  // ============================================================================
  // SKILL STATUS MANAGEMENT
  // ============================================================================

  /**
   * Publish a skill (draft -> published)
   */
  async publishSkill(id: string): Promise<SkillDefinition> {
    const existing = await skillDefinitionRepository.findById(id);
    if (!existing) {
      throw new Error(`Skill not found: ${id}`);
    }

    if (existing.status !== 'draft') {
      throw new Error(`Cannot publish skill in status: ${existing.status}`);
    }

    // Validate skill before publishing
    const validationErrors = this.validateSkillForPublishing(existing);
    if (validationErrors.length > 0) {
      throw new Error(`Skill validation failed: ${validationErrors.join(', ')}`);
    }

    const skill = await skillDefinitionRepository.update(id, { status: 'published' });
    if (!skill) {
      throw new Error(`Failed to publish skill: ${id}`);
    }

    console.log(`[SkillLibraryService] Published skill: ${skill.name} v${skill.version}`);
    return skill;
  }

  /**
   * Deprecate a skill (published -> deprecated)
   */
  async deprecateSkill(id: string): Promise<SkillDefinition> {
    const existing = await skillDefinitionRepository.findById(id);
    if (!existing) {
      throw new Error(`Skill not found: ${id}`);
    }

    if (existing.status !== 'published') {
      throw new Error(`Cannot deprecate skill in status: ${existing.status}`);
    }

    const skill = await skillDefinitionRepository.update(id, { status: 'deprecated' });
    if (!skill) {
      throw new Error(`Failed to deprecate skill: ${id}`);
    }

    console.log(`[SkillLibraryService] Deprecated skill: ${skill.name} v${skill.version}`);
    return skill;
  }

  /**
   * Archive a skill (deprecated -> archived)
   */
  async archiveSkill(id: string): Promise<SkillDefinition> {
    const existing = await skillDefinitionRepository.findById(id);
    if (!existing) {
      throw new Error(`Skill not found: ${id}`);
    }

    if (!['deprecated', 'draft'].includes(existing.status)) {
      throw new Error(`Cannot archive skill in status: ${existing.status}`);
    }

    const skill = await skillDefinitionRepository.update(id, { status: 'archived' });
    if (!skill) {
      throw new Error(`Failed to archive skill: ${id}`);
    }

    console.log(`[SkillLibraryService] Archived skill: ${skill.name} v${skill.version}`);
    return skill;
  }

  // ============================================================================
  // PARAMETER VALIDATION
  // ============================================================================

  /**
   * Validate parameters against a skill's schema
   */
  validateParameters(skill: SkillDefinition, parameters: Record<string, unknown>): ParameterValidationResult {
    // Merge with defaults
    const mergedParams = { ...skill.defaultParameters, ...parameters };

    // If no schema, consider valid
    if (!skill.parametersSchema || Object.keys(skill.parametersSchema).length === 0) {
      return {
        valid: true,
        errors: [],
        coercedParameters: mergedParams,
      };
    }

    // Compile and validate
    const validate = this.ajv.compile(skill.parametersSchema);
    const valid = validate(mergedParams);

    if (valid) {
      return {
        valid: true,
        errors: [],
        coercedParameters: mergedParams,
      };
    }

    // Convert AJV errors to our format
    const errors: ValidationError[] = (validate.errors ?? []).map((err: ErrorObject) => ({
      path: err.instancePath ? err.instancePath.split('/').filter(Boolean) : [],
      message: err.message ?? 'Validation error',
      code: err.keyword ?? 'unknown',
    }));

    return {
      valid: false,
      errors,
      coercedParameters: mergedParams,
    };
  }

  /**
   * Validate parameters for a skill by ID
   */
  async validateSkillParameters(
    skillId: string,
    parameters: Record<string, unknown>
  ): Promise<ParameterValidationResult> {
    const skill = await skillDefinitionRepository.findById(skillId);
    if (!skill) {
      return {
        valid: false,
        errors: [{ path: [], message: 'Skill not found', code: 'not_found' }],
      };
    }

    return this.validateParameters(skill, parameters);
  }

  // ============================================================================
  // COMPATIBILITY CHECKING
  // ============================================================================

  /**
   * Check if a robot is compatible with a skill
   */
  async checkRobotCompatibility(skillId: string, robotId: string): Promise<RobotCompatibility> {
    const skill = await skillDefinitionRepository.findByIdWithRelations(skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }

    const robot = await robotManager.getRobot(robotId);
    if (!robot) {
      throw new Error(`Robot not found: ${robotId}`);
    }

    // Get robot type
    const robotType = (robot.metadata?.robotType as string) ?? robot.model;
    const robotCapabilities = (robot.metadata?.capabilities as string[]) ?? [];

    // Check robot type compatibility
    const compatibleTypes = skill.compatibleRobotTypes ?? [];
    const typeCompatible = compatibleTypes.length === 0 ||
      compatibleTypes.some(t => t.name === robotType || t.id === robotType);

    // Check capability requirements
    const requiredCapabilities = skill.requiredCapabilities ?? [];
    const missingCapabilities = requiredCapabilities.filter(cap => !robotCapabilities.includes(cap));
    const matchingCapabilities = requiredCapabilities.filter(cap => robotCapabilities.includes(cap));

    return {
      robotId,
      robotName: robot.name,
      robotType,
      compatible: typeCompatible && missingCapabilities.length === 0,
      missingCapabilities,
      matchingCapabilities,
    };
  }

  /**
   * Get all robots compatible with a skill
   */
  async getCompatibleRobots(skillId: string): Promise<CompatibilityCheckResult> {
    const skill = await skillDefinitionRepository.findByIdWithRelations(skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }

    const allRobots = await robotManager.listRobots();
    const robots: RobotCompatibility[] = [];

    for (const robot of allRobots) {
      const robotType = (robot.metadata?.robotType as string) ?? robot.model;
      const robotCapabilities = (robot.metadata?.capabilities as string[]) ?? [];

      const compatibleTypes = skill.compatibleRobotTypes ?? [];
      const typeCompatible = compatibleTypes.length === 0 ||
        compatibleTypes.some(t => t.name === robotType || t.id === robotType);

      const requiredCapabilities = skill.requiredCapabilities ?? [];
      const missingCapabilities = requiredCapabilities.filter(cap => !robotCapabilities.includes(cap));
      const matchingCapabilities = requiredCapabilities.filter(cap => robotCapabilities.includes(cap));

      robots.push({
        robotId: robot.id,
        robotName: robot.name,
        robotType,
        compatible: typeCompatible && missingCapabilities.length === 0,
        missingCapabilities,
        matchingCapabilities,
      });
    }

    return {
      skillId,
      totalRobots: robots.length,
      compatibleRobots: robots.filter(r => r.compatible).length,
      robots,
    };
  }

  /**
   * Get all skills compatible with a specific robot
   */
  async getSkillsForRobot(robotId: string): Promise<SkillDefinition[]> {
    const robot = await robotManager.getRobot(robotId);
    if (!robot) {
      throw new Error(`Robot not found: ${robotId}`);
    }

    const robotType = (robot.metadata?.robotType as string) ?? robot.model;
    const robotCapabilities = (robot.metadata?.capabilities as string[]) ?? [];

    // Get robot type ID if we have one
    const robotTypeEntity = await robotTypeRepository.findByName(robotType);
    if (!robotTypeEntity) {
      // No registered robot type, return skills with no type restriction
      const allPublished = await skillDefinitionRepository.findPublished();
      return allPublished.filter(skill => {
        const hasRelations = (skill as { compatibleRobotTypes?: unknown[] }).compatibleRobotTypes;
        return !hasRelations || (Array.isArray(hasRelations) && hasRelations.length === 0);
      });
    }

    return skillDefinitionRepository.findCompatibleSkills(robotTypeEntity.id, robotCapabilities);
  }

  // ============================================================================
  // SKILL CHAIN MANAGEMENT
  // ============================================================================

  /**
   * Create a skill chain
   */
  async createChain(input: CreateSkillChainInput): Promise<SkillChain> {
    // Validate all skills exist
    for (const step of input.steps) {
      const skill = await skillDefinitionRepository.findById(step.skillId);
      if (!skill) {
        throw new Error(`Skill not found: ${step.skillId}`);
      }
      if (skill.status !== 'published') {
        throw new Error(`Skill is not published: ${skill.name} v${skill.version}`);
      }
    }

    const chain = await skillChainRepository.create(input);
    console.log(`[SkillLibraryService] Created skill chain: ${chain.name}`);

    return chain;
  }

  /**
   * Get skill chain by ID
   */
  async getChain(id: string): Promise<SkillChain | null> {
    return skillChainRepository.findById(id);
  }

  /**
   * List skill chains with filters
   */
  async listChains(params?: SkillChainQueryParams): Promise<PaginatedResult<SkillChain>> {
    return skillChainRepository.findAll(params);
  }

  /**
   * List active skill chains
   */
  async listActiveChains(): Promise<SkillChain[]> {
    return skillChainRepository.findActive();
  }

  /**
   * Update a skill chain
   */
  async updateChain(id: string, input: UpdateSkillChainInput): Promise<SkillChain | null> {
    const existing = await skillChainRepository.findById(id);
    if (!existing) {
      throw new Error(`Skill chain not found: ${id}`);
    }

    // Validate new steps if provided
    if (input.steps) {
      for (const step of input.steps) {
        const skill = await skillDefinitionRepository.findById(step.skillId);
        if (!skill) {
          throw new Error(`Skill not found: ${step.skillId}`);
        }
        if (skill.status !== 'published') {
          throw new Error(`Skill is not published: ${skill.name} v${skill.version}`);
        }
      }
    }

    const chain = await skillChainRepository.update(id, input);
    if (chain) {
      console.log(`[SkillLibraryService] Updated skill chain: ${chain.name}`);
    }

    return chain;
  }

  /**
   * Delete a skill chain
   */
  async deleteChain(id: string): Promise<boolean> {
    const existing = await skillChainRepository.findById(id);
    if (!existing) {
      return false;
    }

    // Prevent deletion of active chains
    if (existing.status === 'active') {
      throw new Error('Cannot delete active skill chain. Archive it first.');
    }

    const deleted = await skillChainRepository.delete(id);
    if (deleted) {
      console.log(`[SkillLibraryService] Deleted skill chain: ${existing.name}`);
    }

    return deleted;
  }

  /**
   * Activate a skill chain
   */
  async activateChain(id: string): Promise<SkillChain> {
    const existing = await skillChainRepository.findById(id);
    if (!existing) {
      throw new Error(`Skill chain not found: ${id}`);
    }

    if (existing.status !== 'draft') {
      throw new Error(`Cannot activate chain in status: ${existing.status}`);
    }

    const chain = await skillChainRepository.updateStatus(id, 'active');
    if (!chain) {
      throw new Error(`Failed to activate chain: ${id}`);
    }

    console.log(`[SkillLibraryService] Activated skill chain: ${chain.name}`);
    return chain;
  }

  /**
   * Archive a skill chain
   */
  async archiveChain(id: string): Promise<SkillChain> {
    const existing = await skillChainRepository.findById(id);
    if (!existing) {
      throw new Error(`Skill chain not found: ${id}`);
    }

    const chain = await skillChainRepository.updateStatus(id, 'archived');
    if (!chain) {
      throw new Error(`Failed to archive chain: ${id}`);
    }

    console.log(`[SkillLibraryService] Archived skill chain: ${chain.name}`);
    return chain;
  }

  // ============================================================================
  // VALIDATION HELPERS
  // ============================================================================

  /**
   * Validate a skill is ready for publishing
   */
  private validateSkillForPublishing(skill: SkillDefinition): string[] {
    const errors: string[] = [];

    if (!skill.name || skill.name.trim().length === 0) {
      errors.push('Name is required');
    }

    if (!skill.version || skill.version.trim().length === 0) {
      errors.push('Version is required');
    }

    // Validate parameter schema is valid JSON Schema
    if (skill.parametersSchema && Object.keys(skill.parametersSchema).length > 0) {
      try {
        this.ajv.compile(skill.parametersSchema);
      } catch {
        errors.push('Invalid parameter schema');
      }
    }

    // Validate preconditions have proper structure
    for (const condition of skill.preconditions) {
      if (!this.isValidCondition(condition)) {
        errors.push(`Invalid precondition: ${condition.name}`);
      }
    }

    // Validate postconditions have proper structure
    for (const condition of skill.postconditions) {
      if (!this.isValidCondition(condition)) {
        errors.push(`Invalid postcondition: ${condition.name}`);
      }
    }

    return errors;
  }

  /**
   * Check if a condition has valid structure
   */
  private isValidCondition(condition: Condition): boolean {
    if (!condition.type || !['sensor', 'state', 'custom'].includes(condition.type)) {
      return false;
    }
    if (!condition.name || condition.name.trim().length === 0) {
      return false;
    }
    if (!condition.check || condition.check.trim().length === 0) {
      return false;
    }
    return true;
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
export const skillLibraryService = SkillLibraryService.getInstance();
