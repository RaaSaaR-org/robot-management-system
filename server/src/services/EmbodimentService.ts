/**
 * @file EmbodimentService.ts
 * @description Service for managing embodiment configurations - CRUD operations and YAML validation
 * @feature vla
 */

import { EventEmitter } from 'events';
import { parse as parseYaml } from 'yaml';
import { PrismaClient } from '@prisma/client';
import type {
  Embodiment,
  EmbodimentWithRelations,
  CreateEmbodimentInput,
  UpdateEmbodimentInput,
  EmbodimentQueryParams,
  PaginatedEmbodimentResult,
  YamlValidationResult,
  YamlValidationError,
  ParsedEmbodimentConfig,
  EmbodimentServiceEvent,
  EmbodimentServiceEventType,
  EmbodimentEventCallback,
} from '../types/embodiment.types.js';

const prisma = new PrismaClient();

// Default page size for pagination
const DEFAULT_PAGE_SIZE = 20;

// ============================================================================
// EMBODIMENT SERVICE
// ============================================================================

/**
 * Service for managing embodiment configurations
 */
export class EmbodimentService extends EventEmitter {
  private static instance: EmbodimentService;
  private initialized = false;

  private constructor() {
    super();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): EmbodimentService {
    if (!EmbodimentService.instance) {
      EmbodimentService.instance = new EmbodimentService();
    }
    return EmbodimentService.instance;
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    console.log('[EmbodimentService] Initialized');
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  /**
   * Create a new embodiment configuration
   */
  async createEmbodiment(input: CreateEmbodimentInput): Promise<EmbodimentWithRelations> {
    // Validate YAML configuration
    const validationResult = this.validateYamlConfig(input.configYaml);
    if (!validationResult.valid) {
      throw new Error(
        `Invalid YAML configuration: ${validationResult.errors.map(e => e.message).join(', ')}`
      );
    }

    // Validate robotType exists if provided
    if (input.robotTypeId) {
      const robotType = await prisma.robotType.findUnique({
        where: { id: input.robotTypeId },
      });
      if (!robotType) {
        throw new Error(`Robot type not found: ${input.robotTypeId}`);
      }
    }

    // Create embodiment
    const embodiment = await prisma.embodiment.create({
      data: {
        tag: input.tag,
        manufacturer: input.manufacturer,
        model: input.model,
        description: input.description,
        configYaml: input.configYaml,
        actionDim: input.actionDim,
        proprioceptionDim: input.proprioceptionDim,
        robotTypeId: input.robotTypeId,
      },
      include: {
        robotType: {
          select: {
            id: true,
            name: true,
            manufacturer: true,
            model: true,
          },
        },
      },
    });

    this.emitEvent('embodiment:created', embodiment.id, embodiment.tag);
    console.log(`[EmbodimentService] Created embodiment: ${embodiment.tag}`);

    return embodiment;
  }

  /**
   * Get embodiment by tag
   */
  async getEmbodiment(tag: string): Promise<EmbodimentWithRelations | null> {
    return prisma.embodiment.findUnique({
      where: { tag },
      include: {
        robotType: {
          select: {
            id: true,
            name: true,
            manufacturer: true,
            model: true,
          },
        },
      },
    });
  }

  /**
   * Get embodiment by ID
   */
  async getEmbodimentById(id: string): Promise<EmbodimentWithRelations | null> {
    return prisma.embodiment.findUnique({
      where: { id },
      include: {
        robotType: {
          select: {
            id: true,
            name: true,
            manufacturer: true,
            model: true,
          },
        },
      },
    });
  }

  /**
   * List embodiments with filtering and pagination
   */
  async listEmbodiments(params?: EmbodimentQueryParams): Promise<PaginatedEmbodimentResult> {
    const page = params?.page ?? 1;
    const pageSize = params?.pageSize ?? DEFAULT_PAGE_SIZE;
    const skip = (page - 1) * pageSize;

    // Build where clause
    const where: Record<string, unknown> = {};
    if (params?.manufacturer) {
      where.manufacturer = params.manufacturer;
    }
    if (params?.model) {
      where.model = params.model;
    }
    if (params?.robotTypeId) {
      where.robotTypeId = params.robotTypeId;
    }

    // Get total count
    const total = await prisma.embodiment.count({ where });

    // Get paginated results
    const data = await prisma.embodiment.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
      include: {
        robotType: {
          select: {
            id: true,
            name: true,
            manufacturer: true,
            model: true,
          },
        },
      },
    });

    return {
      data,
      pagination: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * Update an embodiment configuration
   */
  async updateEmbodiment(
    tag: string,
    input: UpdateEmbodimentInput
  ): Promise<EmbodimentWithRelations | null> {
    const existing = await prisma.embodiment.findUnique({
      where: { tag },
    });

    if (!existing) {
      return null;
    }

    // Validate YAML if provided
    if (input.configYaml) {
      const validationResult = this.validateYamlConfig(input.configYaml);
      if (!validationResult.valid) {
        throw new Error(
          `Invalid YAML configuration: ${validationResult.errors.map(e => e.message).join(', ')}`
        );
      }
    }

    // Validate robotType if provided
    if (input.robotTypeId !== undefined && input.robotTypeId !== null) {
      const robotType = await prisma.robotType.findUnique({
        where: { id: input.robotTypeId },
      });
      if (!robotType) {
        throw new Error(`Robot type not found: ${input.robotTypeId}`);
      }
    }

    // Update embodiment
    const embodiment = await prisma.embodiment.update({
      where: { tag },
      data: {
        manufacturer: input.manufacturer,
        model: input.model,
        description: input.description,
        configYaml: input.configYaml,
        actionDim: input.actionDim,
        proprioceptionDim: input.proprioceptionDim,
        robotTypeId: input.robotTypeId,
      },
      include: {
        robotType: {
          select: {
            id: true,
            name: true,
            manufacturer: true,
            model: true,
          },
        },
      },
    });

    this.emitEvent('embodiment:updated', embodiment.id, embodiment.tag);
    console.log(`[EmbodimentService] Updated embodiment: ${embodiment.tag}`);

    return embodiment;
  }

  /**
   * Delete an embodiment configuration
   */
  async deleteEmbodiment(tag: string): Promise<boolean> {
    const existing = await prisma.embodiment.findUnique({
      where: { tag },
    });

    if (!existing) {
      return false;
    }

    await prisma.embodiment.delete({
      where: { tag },
    });

    this.emitEvent('embodiment:deleted', existing.id, tag);
    console.log(`[EmbodimentService] Deleted embodiment: ${tag}`);

    return true;
  }

  /**
   * Upsert embodiment (create or update)
   */
  async upsertEmbodiment(input: CreateEmbodimentInput): Promise<EmbodimentWithRelations> {
    const existing = await this.getEmbodiment(input.tag);

    if (existing) {
      const updated = await this.updateEmbodiment(input.tag, {
        manufacturer: input.manufacturer,
        model: input.model,
        description: input.description,
        configYaml: input.configYaml,
        actionDim: input.actionDim,
        proprioceptionDim: input.proprioceptionDim,
        robotTypeId: input.robotTypeId,
      });
      return updated!;
    }

    return this.createEmbodiment(input);
  }

  // ============================================================================
  // LINKING
  // ============================================================================

  /**
   * Link embodiment to a robot type
   */
  async linkToRobotType(tag: string, robotTypeId: string): Promise<EmbodimentWithRelations> {
    // Verify robot type exists
    const robotType = await prisma.robotType.findUnique({
      where: { id: robotTypeId },
    });
    if (!robotType) {
      throw new Error(`Robot type not found: ${robotTypeId}`);
    }

    // Verify embodiment exists
    const existing = await prisma.embodiment.findUnique({
      where: { tag },
    });
    if (!existing) {
      throw new Error(`Embodiment not found: ${tag}`);
    }

    // Update link
    const embodiment = await prisma.embodiment.update({
      where: { tag },
      data: { robotTypeId },
      include: {
        robotType: {
          select: {
            id: true,
            name: true,
            manufacturer: true,
            model: true,
          },
        },
      },
    });

    this.emitEvent('embodiment:linked', embodiment.id, tag, { robotTypeId });
    console.log(`[EmbodimentService] Linked ${tag} to robot type ${robotTypeId}`);

    return embodiment;
  }

  /**
   * Unlink embodiment from robot type
   */
  async unlinkFromRobotType(tag: string): Promise<EmbodimentWithRelations> {
    const existing = await prisma.embodiment.findUnique({
      where: { tag },
    });
    if (!existing) {
      throw new Error(`Embodiment not found: ${tag}`);
    }

    const embodiment = await prisma.embodiment.update({
      where: { tag },
      data: { robotTypeId: null },
      include: {
        robotType: {
          select: {
            id: true,
            name: true,
            manufacturer: true,
            model: true,
          },
        },
      },
    });

    this.emitEvent('embodiment:linked', embodiment.id, tag, { robotTypeId: null });
    console.log(`[EmbodimentService] Unlinked ${tag} from robot type`);

    return embodiment;
  }

  // ============================================================================
  // VALIDATION
  // ============================================================================

  /**
   * Validate YAML configuration string
   */
  validateYamlConfig(yamlContent: string): YamlValidationResult {
    const errors: YamlValidationError[] = [];
    let parsedConfig: ParsedEmbodimentConfig | undefined;

    try {
      const parsed = parseYaml(yamlContent);

      // Required fields
      if (!parsed.embodiment_tag || typeof parsed.embodiment_tag !== 'string') {
        errors.push({
          path: 'embodiment_tag',
          message: 'embodiment_tag is required and must be a string',
          code: 'required',
        });
      }

      if (!parsed.manufacturer || typeof parsed.manufacturer !== 'string') {
        errors.push({
          path: 'manufacturer',
          message: 'manufacturer is required and must be a string',
          code: 'required',
        });
      }

      if (!parsed.model || typeof parsed.model !== 'string') {
        errors.push({
          path: 'model',
          message: 'model is required and must be a string',
          code: 'required',
        });
      }

      // Validate action config
      if (!parsed.action || typeof parsed.action !== 'object') {
        errors.push({
          path: 'action',
          message: 'action configuration is required',
          code: 'required',
        });
      } else {
        if (typeof parsed.action.dim !== 'number' || parsed.action.dim <= 0) {
          errors.push({
            path: 'action.dim',
            message: 'action.dim must be a positive integer',
            code: 'invalid',
          });
        }

        if (!parsed.action.normalization) {
          errors.push({
            path: 'action.normalization',
            message: 'action.normalization is required',
            code: 'required',
          });
        } else {
          if (!Array.isArray(parsed.action.normalization.mean)) {
            errors.push({
              path: 'action.normalization.mean',
              message: 'action.normalization.mean must be an array',
              code: 'invalid',
            });
          }
          if (!Array.isArray(parsed.action.normalization.std)) {
            errors.push({
              path: 'action.normalization.std',
              message: 'action.normalization.std must be an array',
              code: 'invalid',
            });
          }
        }
      }

      // Validate proprioception config
      if (!parsed.proprioception || typeof parsed.proprioception !== 'object') {
        errors.push({
          path: 'proprioception',
          message: 'proprioception configuration is required',
          code: 'required',
        });
      } else {
        if (typeof parsed.proprioception.dim !== 'number' || parsed.proprioception.dim <= 0) {
          errors.push({
            path: 'proprioception.dim',
            message: 'proprioception.dim must be a positive integer',
            code: 'invalid',
          });
        }
        if (!Array.isArray(parsed.proprioception.joint_names)) {
          errors.push({
            path: 'proprioception.joint_names',
            message: 'proprioception.joint_names must be an array',
            code: 'invalid',
          });
        }
      }

      // If valid, set parsedConfig
      if (errors.length === 0) {
        parsedConfig = parsed as ParsedEmbodimentConfig;
      }
    } catch (parseError) {
      errors.push({
        path: '',
        message: `YAML parse error: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`,
        code: 'parse_error',
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      parsedConfig,
    };
  }

  /**
   * Parse and validate YAML, returning extracted values
   */
  parseYamlConfig(yamlContent: string): ParsedEmbodimentConfig | null {
    const result = this.validateYamlConfig(yamlContent);
    return result.parsedConfig ?? null;
  }

  // ============================================================================
  // EVENTS
  // ============================================================================

  /**
   * Emit a service event
   */
  private emitEvent(
    type: EmbodimentServiceEventType,
    embodimentId: string,
    tag: string,
    data?: Record<string, unknown>
  ): void {
    const event: EmbodimentServiceEvent = {
      type,
      embodimentId,
      tag,
      timestamp: new Date().toISOString(),
      data,
    };

    this.emit('embodiment_event', event);
  }

  /**
   * Subscribe to embodiment events
   */
  onEmbodimentEvent(callback: EmbodimentEventCallback): () => void {
    this.on('embodiment_event', callback);
    return () => this.off('embodiment_event', callback);
  }
}

// Export singleton instance
export const embodimentService = EmbodimentService.getInstance();
