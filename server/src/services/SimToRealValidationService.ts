/**
 * @file SimToRealValidationService.ts
 * @description Wires the dormant SimToRealValidation model (TASK-171 Phase 3).
 *              Given a model version + a sim success rate measured in a twin
 *              scene, it measures the REAL success rate (from real-hardware
 *              EvaluationEpisodes in the same room) and persists the measured
 *              domain gap (sim − real). Replaces the faked `sim * random()`
 *              sim-to-real comparison. Also the source of truth for the
 *              deployment validation gate.
 * @feature simulation
 */

import { EventEmitter } from 'events';
import { prisma } from '../database/index.js';
import { evaluationService, type EvaluationPeriod } from './EvaluationService.js';

export interface CreateValidationInput {
  /** ModelVersion.id the policy belongs to (also the comparison lookup key). */
  modelVersionId: string;
  /** EvaluationEpisode.modelVersion string key (defaults to modelVersionId). */
  modelVersion?: string;
  /** Twin the sim scene was built from (real→sim provenance). */
  twinId?: string;
  /** SimScene registry id the policy ran in. */
  simSceneId?: string;
  /** Robot embodiment the gap was measured for (e.g. unitree_g1). */
  embodimentTag?: string;
  /** Sim success rate measured in the twin scene, 0–1. */
  simSuccessRate: number;
  /** Real success rate, 0–1. If omitted, derived from EvaluationEpisodes. */
  realSuccessRate?: number;
  /** Number of real episodes behind `realSuccessRate` (sample size). Ignored
   *  when the real rate is derived — the episode count is used instead. */
  realTestCount?: number;
  /** Robot used for the real evaluation (narrows the episode query). */
  realRobotId?: string;
  /** Window for deriving the real success rate from episodes. */
  period?: EvaluationPeriod;
  taskCategories?: string[];
  notes?: string;
}

export interface SimToRealValidationDTO {
  id: string;
  modelVersionId: string;
  twinId: string | null;
  simSceneId: string | null;
  embodimentTag: string | null;
  validationDate: string;
  simSuccessRate: number;
  realSuccessRate: number;
  domainGapScore: number;
  realTestCount: number;
  taskCategories: string[];
  notes: string | null;
}

/** Shape consumed by the Simulation "Sim vs Real" tab. */
export interface SimToRealComparisonRow {
  modelId: string;
  simSuccessRate: number;
  realSuccessRate: number;
  gap: number;
  twinId: string | null;
  simSceneId: string | null;
  validationDate: string;
  realTestCount: number;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

type ValidationRow = {
  id: string;
  modelVersionId: string;
  twinId: string | null;
  simSceneId: string | null;
  embodimentTag: string | null;
  validationDate: Date;
  simSuccessRate: number;
  realSuccessRate: number;
  domainGapScore: number;
  realTestCount: number;
  taskCategories: unknown;
  notes: string | null;
};

function toDTO(row: ValidationRow): SimToRealValidationDTO {
  return {
    id: row.id,
    modelVersionId: row.modelVersionId,
    twinId: row.twinId,
    simSceneId: row.simSceneId,
    embodimentTag: row.embodimentTag,
    validationDate: row.validationDate.toISOString(),
    simSuccessRate: row.simSuccessRate,
    realSuccessRate: row.realSuccessRate,
    domainGapScore: row.domainGapScore,
    realTestCount: row.realTestCount,
    taskCategories: Array.isArray(row.taskCategories) ? (row.taskCategories as string[]) : [],
    notes: row.notes,
  };
}

export class SimToRealValidationService extends EventEmitter {
  private static instance: SimToRealValidationService;

  private constructor() {
    super();
  }

  static getInstance(): SimToRealValidationService {
    if (!SimToRealValidationService.instance) {
      SimToRealValidationService.instance = new SimToRealValidationService();
    }
    return SimToRealValidationService.instance;
  }

  /**
   * Create a sim-to-real validation. When `realSuccessRate` is not supplied, it
   * is derived from recorded real-hardware EvaluationEpisodes for the model.
   * domainGapScore = simSuccessRate − realSuccessRate (both 0–1).
   */
  async createValidation(input: CreateValidationInput): Promise<SimToRealValidationDTO> {
    const modelVersionKey = input.modelVersion ?? input.modelVersionId;
    const period: EvaluationPeriod = input.period ?? '30d';

    let realSuccessRate = input.realSuccessRate;
    // Honor an explicitly-supplied sample size; the derive branch overrides it
    // with the actual episode count.
    let realTestCount = Math.max(0, Math.round(input.realTestCount ?? 0));
    if (realSuccessRate === undefined) {
      const real = await evaluationService.getSuccessRate(
        input.realRobotId,
        modelVersionKey,
        period,
      );
      realSuccessRate = real.successRate / 100; // service returns a percentage
      realTestCount = real.totalEpisodes;
    }

    const simSuccessRate = round3(Math.max(0, Math.min(1, input.simSuccessRate)));
    realSuccessRate = round3(Math.max(0, Math.min(1, realSuccessRate)));
    const domainGapScore = round3(simSuccessRate - realSuccessRate);

    const row = await prisma.simToRealValidation.create({
      data: {
        syntheticJobId: null,
        twinId: input.twinId ?? null,
        simSceneId: input.simSceneId ?? null,
        embodimentTag: input.embodimentTag ?? null,
        modelVersionId: input.modelVersionId,
        simSuccessRate,
        realSuccessRate,
        domainGapScore,
        realTestCount,
        taskCategories: input.taskCategories ?? [],
        notes: input.notes ?? null,
      },
    });

    const dto = toDTO(row as ValidationRow);
    this.emit('validation:created', dto);
    console.log(
      `[SimToRealValidation] model=${input.modelVersionId} sim=${simSuccessRate} ` +
        `real=${realSuccessRate} gap=${domainGapScore} (n=${realTestCount})`,
    );
    return dto;
  }

  /** Most recent validation for a model version (drives the deployment gate). */
  async getLatestForModelVersion(modelVersionId: string): Promise<SimToRealValidationDTO | null> {
    const row = await prisma.simToRealValidation.findFirst({
      where: { modelVersionId },
      orderBy: { validationDate: 'desc' },
    });
    return row ? toDTO(row as ValidationRow) : null;
  }

  async listForModelVersion(modelVersionId: string): Promise<SimToRealValidationDTO[]> {
    const rows = await prisma.simToRealValidation.findMany({
      where: { modelVersionId },
      orderBy: { validationDate: 'desc' },
    });
    return rows.map((r) => toDTO(r as ValidationRow));
  }

  /**
   * Validation rows for a model, shaped for the "Sim vs Real" tab. Returns the
   * measured (non-random) gap; an empty array means "not validated yet".
   */
  async getComparisonForModel(modelId: string): Promise<SimToRealComparisonRow[]> {
    const rows = await prisma.simToRealValidation.findMany({
      where: { modelVersionId: modelId },
      orderBy: { validationDate: 'desc' },
      take: 50,
    });
    return rows.map((r) => {
      const v = r as ValidationRow;
      return {
        modelId,
        simSuccessRate: v.simSuccessRate,
        realSuccessRate: v.realSuccessRate,
        gap: v.domainGapScore,
        twinId: v.twinId,
        simSceneId: v.simSceneId,
        validationDate: v.validationDate.toISOString(),
        realTestCount: v.realTestCount,
      };
    });
  }
}

export const simToRealValidationService = SimToRealValidationService.getInstance();
