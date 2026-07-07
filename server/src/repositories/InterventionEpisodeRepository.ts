/**
 * @file InterventionEpisodeRepository.ts
 * @description Data access layer for InterventionEpisode rows — DAgger-style
 *   human interventions captured during a rollout (lerobot-rollout 'dagger'
 *   strategy, TASK-179 §7).
 * @feature datasets
 */

import { prisma } from '../database/index.js';
import type { InterventionEpisode as PrismaInterventionEpisode } from '@prisma/client';

// ============================================================================
// TYPES
// ============================================================================

/** One control step of an intervention episode. */
export interface InterventionStep {
  t: number;
  source: 'human' | 'policy';
  action: number[];
}

/** Domain shape of an intervention episode — `stepsJson` parsed to steps. */
export interface InterventionEpisode {
  id: string;
  robotId: string;
  skillId: string | null;
  taskPrompt: string;
  strategy: string;
  startedAt: Date;
  endedAt: Date;
  steps: InterventionStep[];
  createdAt: Date;
}

export interface CreateInterventionEpisodeInput {
  robotId: string;
  skillId?: string | null;
  taskPrompt: string;
  strategy?: string;
  startedAt: Date;
  endedAt: Date;
  steps?: InterventionStep[];
}

// ============================================================================
// HELPERS
// ============================================================================

const parseSteps = (val: string): InterventionStep[] => {
  try {
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) ? (parsed as InterventionStep[]) : [];
  } catch {
    return [];
  }
};

function dbInterventionToDomain(db: PrismaInterventionEpisode): InterventionEpisode {
  return {
    id: db.id,
    robotId: db.robotId,
    skillId: db.skillId,
    taskPrompt: db.taskPrompt,
    strategy: db.strategy,
    startedAt: db.startedAt,
    endedAt: db.endedAt,
    steps: parseSteps(db.stepsJson),
    createdAt: db.createdAt,
  };
}

// ============================================================================
// REPOSITORY
// ============================================================================

export class InterventionEpisodeRepository {
  async create(input: CreateInterventionEpisodeInput): Promise<InterventionEpisode> {
    const row = await prisma.interventionEpisode.create({
      data: {
        robotId: input.robotId,
        skillId: input.skillId ?? null,
        taskPrompt: input.taskPrompt,
        strategy: input.strategy ?? 'dagger',
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        stepsJson: JSON.stringify(input.steps ?? []),
      },
    });
    return dbInterventionToDomain(row);
  }

  /** List interventions, optionally filtered by robot; newest first. */
  async findAll(robotId?: string): Promise<InterventionEpisode[]> {
    const rows = await prisma.interventionEpisode.findMany({
      where: robotId ? { robotId } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(dbInterventionToDomain);
  }

  async findById(id: string): Promise<InterventionEpisode | null> {
    const row = await prisma.interventionEpisode.findUnique({ where: { id } });
    return row ? dbInterventionToDomain(row) : null;
  }
}

export const interventionEpisodeRepository = new InterventionEpisodeRepository();
