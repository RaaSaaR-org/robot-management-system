/**
 * @file CommandRepository.ts
 * @description Data access layer for CommandInterpretation entities
 */

import { prisma } from '../database/index.js';
import type { CommandInterpretation as DbCommandInterpretation } from '@prisma/client';

// ============================================================================
// TYPES
// ============================================================================

export type SafetyClassification = 'safe' | 'caution' | 'dangerous';

export type CommandHistoryStatus =
  | 'interpreted'
  | 'confirmed'
  | 'executed'
  | 'cancelled'
  | 'failed';

export type CommandType =
  | 'navigation'
  | 'manipulation'
  | 'status'
  | 'emergency'
  | 'custom';

export interface CommandParameters {
  target?: string;
  destination?: {
    x: number;
    y: number;
    z?: number;
  };
  quantity?: number;
  objects?: string[];
  speed?: 'slow' | 'normal' | 'fast';
  custom?: Record<string, unknown>;
}

export interface CommandInterpretation {
  id: string;
  robotId: string;
  originalText: string;
  commandType: CommandType;
  parameters: CommandParameters;
  confidence: number;
  safetyClassification: SafetyClassification;
  warnings: string[];
  suggestedAlternatives: string[];
  status: CommandHistoryStatus;
  executedCommandId?: string;
  createdAt: string;
  executedAt?: string;
}

export interface CreateCommandInterpretationInput {
  robotId: string;
  originalText: string;
  commandType: CommandType;
  parameters: CommandParameters;
  confidence: number;
  safetyClassification: SafetyClassification;
  warnings?: string[];
  suggestedAlternatives?: string[];
}

export interface CommandHistoryResponse {
  entries: CommandInterpretation[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

// ============================================================================
// CONVERSION HELPERS
// ============================================================================

function dbToDomain(db: DbCommandInterpretation): CommandInterpretation {
  return {
    id: db.id,
    robotId: db.robotId,
    originalText: db.originalText,
    commandType: db.commandType as CommandType,
    parameters: JSON.parse(db.parameters) as CommandParameters,
    confidence: db.confidence,
    safetyClassification: db.safetyClassification as SafetyClassification,
    warnings: JSON.parse(db.warnings) as string[],
    suggestedAlternatives: JSON.parse(db.suggestedAlternatives) as string[],
    status: db.status as CommandHistoryStatus,
    executedCommandId: db.executedCommandId ?? undefined,
    createdAt: db.createdAt.toISOString(),
    executedAt: db.executedAt?.toISOString(),
  };
}

// ============================================================================
// REPOSITORY
// ============================================================================

export class CommandRepository {
  /**
   * Find a command interpretation by ID
   */
  async findById(id: string): Promise<CommandInterpretation | null> {
    const interpretation = await prisma.commandInterpretation.findUnique({
      where: { id },
    });
    return interpretation ? dbToDomain(interpretation) : null;
  }

  /**
   * Find all command interpretations with pagination
   */
  async findAll(params?: PaginationParams): Promise<CommandHistoryResponse> {
    const page = params?.page ?? 1;
    const pageSize = params?.pageSize ?? 50;
    const skip = (page - 1) * pageSize;

    const [interpretations, total] = await Promise.all([
      prisma.commandInterpretation.findMany({
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.commandInterpretation.count(),
    ]);

    return {
      entries: interpretations.map(dbToDomain),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * Find command interpretations by robot ID with pagination
   */
  async findByRobotId(
    robotId: string,
    params?: PaginationParams
  ): Promise<CommandHistoryResponse> {
    const page = params?.page ?? 1;
    const pageSize = params?.pageSize ?? 50;
    const skip = (page - 1) * pageSize;

    const [interpretations, total] = await Promise.all([
      prisma.commandInterpretation.findMany({
        where: { robotId },
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.commandInterpretation.count({ where: { robotId } }),
    ]);

    return {
      entries: interpretations.map(dbToDomain),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * Create a new command interpretation
   */
  async create(input: CreateCommandInterpretationInput): Promise<CommandInterpretation> {
    const interpretation = await prisma.commandInterpretation.create({
      data: {
        robotId: input.robotId,
        originalText: input.originalText,
        commandType: input.commandType,
        parameters: JSON.stringify(input.parameters),
        confidence: input.confidence,
        safetyClassification: input.safetyClassification,
        warnings: JSON.stringify(input.warnings ?? []),
        suggestedAlternatives: JSON.stringify(input.suggestedAlternatives ?? []),
        status: 'interpreted',
      },
    });
    return dbToDomain(interpretation);
  }

  /**
   * Update command interpretation status
   */
  async updateStatus(
    id: string,
    status: CommandHistoryStatus,
    executedCommandId?: string
  ): Promise<CommandInterpretation | null> {
    try {
      const interpretation = await prisma.commandInterpretation.update({
        where: { id },
        data: {
          status,
          executedCommandId,
          executedAt: status === 'executed' ? new Date() : undefined,
        },
      });
      return dbToDomain(interpretation);
    } catch {
      return null;
    }
  }

  /**
   * Delete a command interpretation
   */
  async delete(id: string): Promise<boolean> {
    try {
      await prisma.commandInterpretation.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Count total interpretations
   */
  async count(): Promise<number> {
    return prisma.commandInterpretation.count();
  }
}

export const commandRepository = new CommandRepository();
