/**
 * @file ExperimentRepository.ts
 * @description Data access for experiments and their arms (TASK-242), plus the
 *   evaluation-episode writes and reads that score an arm.
 * @feature training
 *
 * `Experiment` is tenant-scoped through the extended `prisma`; `ExperimentArm`
 * carries no tenantId and is only ever reached through its experiment — the
 * lifecycle hooks look an arm up by job id and then read its experiment, which
 * is where the tenant check happens.
 */

import type { Experiment, ExperimentArm } from '@prisma/client';
import { prisma } from '../database/index.js';

export type ExperimentRow = Experiment;
export type ExperimentArmRow = ExperimentArm;
export type ExperimentWithArms = Experiment & { arms: ExperimentArm[] };

export interface ArmCreateData {
  name: string;
  label: string | null;
  isBaseline: boolean;
  datasetRefsJson: string;
  initFromModelVersionId: string | null;
  hyperparametersJson: string;
}

export interface ExperimentCreateData {
  title: string;
  hypothesis: string;
  actorType: string;
  actorId: string;
  displayName: string;
  baseModel: string;
  fineTuneMethod: string;
  budgetJson: string;
  evaluationJson: string;
}

export interface SimEpisodeData {
  modelVersionId: string;
  taskPrompt: string;
  startedAt: Date;
  endedAt: Date;
  durationMs: number;
  success: boolean;
  metadata: Record<string, unknown>;
}

/** Baseline first, then arms in the order they were proposed. */
const ARM_ORDER = [{ isBaseline: 'desc' as const }, { createdAt: 'asc' as const }, { name: 'asc' as const }];

export class ExperimentRepository {
  /**
   * Create the experiment and its arms, then point `baselineArmId` at the
   * baseline — two writes in one transaction, since the id is not known
   * before the arm exists.
   */
  async create(data: ExperimentCreateData, arms: ArmCreateData[]): Promise<ExperimentWithArms> {
    return prisma.$transaction(async (tx) => {
      const exp = await tx.experiment.create({ data });
      const created: ExperimentArm[] = [];
      for (const arm of arms) {
        created.push(await tx.experimentArm.create({ data: { ...arm, experimentId: exp.id } }));
      }
      const baseline = created.find((a) => a.isBaseline) ?? created[0];
      const updated = await tx.experiment.update({ where: { id: exp.id }, data: { baselineArmId: baseline.id } });
      return { ...updated, arms: created };
    });
  }

  findById(id: string): Promise<ExperimentWithArms | null> {
    return prisma.experiment.findFirst({ where: { id }, include: { arms: { orderBy: ARM_ORDER } } });
  }

  list(filter: { status?: string; limit?: number }): Promise<ExperimentWithArms[]> {
    return prisma.experiment.findMany({
      where: filter.status ? { status: filter.status } : {},
      include: { arms: { orderBy: ARM_ORDER } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(filter.limit ?? 100, 1), 500),
    });
  }

  /** Experiments with an arm that trained from, or produced, this model. */
  listForModelVersion(modelVersionId: string): Promise<ExperimentWithArms[]> {
    return prisma.experiment.findMany({
      where: {
        arms: { some: { OR: [{ modelVersionId }, { initFromModelVersionId: modelVersionId }] } },
      },
      include: { arms: { orderBy: ARM_ORDER } },
      orderBy: { createdAt: 'desc' },
    });
  }

  updateExperiment(id: string, data: Partial<Omit<Experiment, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Experiment> {
    return prisma.experiment.update({ where: { id }, data });
  }

  /**
   * running → completed with the verdict, only if still running. Two arms
   * settling at once both try to conclude; exactly one wins this write, and
   * only the winner posts the verdict comment.
   */
  async markCompleted(id: string, verdictJson: string): Promise<boolean> {
    const { count } = await prisma.experiment.updateMany({
      where: { id, status: 'running' },
      data: { status: 'completed', verdictJson },
    });
    return count === 1;
  }

  updateArm(id: string, data: Partial<Omit<ExperimentArm, 'id' | 'experimentId' | 'createdAt' | 'updatedAt'>>): Promise<ExperimentArm> {
    return prisma.experimentArm.update({ where: { id }, data });
  }

  findArm(id: string): Promise<ExperimentArm | null> {
    return prisma.experimentArm.findUnique({ where: { id } });
  }

  findArmByTrainingJobId(trainingJobId: string): Promise<ExperimentArm | null> {
    return prisma.experimentArm.findFirst({ where: { trainingJobId } });
  }

  findArmBySimJobId(simJobId: string): Promise<ExperimentArm | null> {
    return prisma.experimentArm.findFirst({ where: { simJobId } });
  }

  /** The tenant an experiment belongs to, read without tenant scoping (hooks run outside requests). */
  async findTenantOfExperiment(id: string): Promise<{ tenantId: string | null } | null> {
    return prisma.experiment.findUnique({ where: { id }, select: { tenantId: true } }) as Promise<{
      tenantId: string | null;
    } | null>;
  }

  /** Write one simulated rollout per row; returns the ids in order. */
  async createSimEpisodes(rows: SimEpisodeData[]): Promise<string[]> {
    const ids: string[] = [];
    await prisma.$transaction(async (tx) => {
      for (const r of rows) {
        const ep = await tx.evaluationEpisode.create({
          data: {
            robotId: null,
            source: 'sim',
            modelVersion: r.modelVersionId,
            modelVersionId: r.modelVersionId,
            taskPrompt: r.taskPrompt,
            startedAt: r.startedAt,
            endedAt: r.endedAt,
            durationMs: r.durationMs,
            success: r.success,
            metadata: JSON.stringify(r.metadata),
          },
          select: { id: true },
        });
        ids.push(ep.id);
      }
    });
    return ids;
  }

  /** The evaluation rows an arm is scored from. */
  listEpisodes(ids: string[]): Promise<Array<{ id: string; success: boolean; durationMs: number }>> {
    return prisma.evaluationEpisode.findMany({
      where: { id: { in: ids } },
      select: { id: true, success: true, durationMs: true },
    });
  }

  /** The newest sim-to-real validation of a model, if any. */
  latestSimToRealValidation(modelVersionId: string): Promise<{ id: string; domainGapScore: number | null } | null> {
    return prisma.simToRealValidation.findFirst({
      where: { modelVersionId },
      orderBy: { validationDate: 'desc' },
      select: { id: true, domainGapScore: true },
    });
  }
}

export const experimentRepository = new ExperimentRepository();
