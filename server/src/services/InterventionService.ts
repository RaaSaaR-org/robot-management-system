/**
 * @file InterventionService.ts
 * @description Service for DAgger-style intervention episodes captured during
 *   rollouts (lerobot-rollout 'dagger' strategy, TASK-179 §7). Robot agents
 *   POST completed episodes; the frontend lists them per robot for
 *   teleop-correction data collection.
 * @feature datasets
 */

import {
  interventionEpisodeRepository,
  type InterventionEpisode,
  type InterventionStep,
} from '../repositories/index.js';

// ============================================================================
// TYPES
// ============================================================================

export interface RecordInterventionDto {
  robotId: string;
  skillId?: string | null;
  taskPrompt: string;
  strategy?: string;
  startedAt: string | Date;
  endedAt: string | Date;
  steps?: InterventionStep[];
}

// ============================================================================
// SERVICE
// ============================================================================

export class InterventionService {
  /**
   * Record a completed intervention episode.
   */
  async recordIntervention(dto: RecordInterventionDto): Promise<InterventionEpisode> {
    const startedAt = new Date(dto.startedAt);
    const endedAt = new Date(dto.endedAt);
    if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) {
      throw new Error('startedAt and endedAt must be valid timestamps');
    }

    const episode = await interventionEpisodeRepository.create({
      robotId: dto.robotId,
      skillId: dto.skillId ?? null,
      taskPrompt: dto.taskPrompt,
      strategy: dto.strategy ?? 'dagger',
      startedAt,
      endedAt,
      steps: Array.isArray(dto.steps) ? dto.steps : [],
    });

    console.log(
      `[InterventionService] Recorded intervention ${episode.id} (robot=${episode.robotId}, steps=${episode.steps.length})`
    );
    return episode;
  }

  /**
   * List intervention episodes, optionally filtered by robot (stepsJson
   * parsed to steps). Newest first.
   */
  async listInterventions(robotId?: string): Promise<InterventionEpisode[]> {
    return interventionEpisodeRepository.findAll(robotId);
  }
}

export const interventionService = new InterventionService();
