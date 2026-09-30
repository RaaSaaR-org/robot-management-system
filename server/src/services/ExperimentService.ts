/**
 * @file ExperimentService.ts
 * @description The experiment loop (TASK-242): propose → approve → train →
 *   evaluate in sim → score and rate each arm → conclude with a verdict.
 * @feature training
 *
 * The asymmetry is the design: an agent's proposal is a recommendation and runs
 * nothing; a human's approval is the decision, is compliance-logged with the
 * budget, and is the only place GPU time is spent. After that the platform
 * drives every arm on its own — a finished run is evaluated, a finished
 * evaluation is scored and rated by the runner agent with its episodes as
 * evidence, and the last arm to settle writes the verdict.
 *
 * Two rules keep the loop honest, both in experimentRules.ts: every arm varies
 * exactly one thing against the baseline, and no verdict outruns its sample.
 */

import { AppError } from '../utils/errors.js';
import { prisma } from '../database/index.js';
import { tenantStore } from '../middleware/tenantContext.js';
import {
  experimentRepository,
  type ArmCreateData,
  type ExperimentArmRow,
  type ExperimentRepository,
  type ExperimentWithArms,
} from '../repositories/ExperimentRepository.js';
import { trainingJobService, checkInitFrom } from './TrainingJobService.js';
import { trainingOrchestrator, type TrainingCompletedEvent, type TrainingFailedEvent } from './TrainingOrchestrator.js';
import {
  simulationService,
  isKnownEnvironment,
  getEvalProfileForEnvironment,
  type SimJob,
} from './SimulationService.js';
import { datasetViewService, isDatasetView } from './DatasetViewService.js';
import { socialService } from './SocialService.js';
import { complianceLogService } from './ComplianceLogService.js';
import { BaseModels, FineTuneMethods } from '../types/vla.types.js';
import type { MixtureMemberInput, CompatibilityReport } from '../types/mixture.types.js';
import type { Actor, CreateCommentInput, EvidenceRef, PutRatingInput, SubjectRef } from '../types/social.types.js';
import type {
  ArmInput,
  ArmResult,
  ArmStatus,
  ExperimentArmDTO,
  ExperimentBudget,
  ExperimentDTO,
  ExperimentEvaluation,
  ExperimentStatus,
  ExperimentVerdict,
  HyperparameterValue,
  ProposeExperimentInput,
} from '../types/experiment.types.js';
import {
  armDifferences,
  budgetViolation,
  buildVerdict,
  oneAxisViolation,
  readBudget,
  type ArmShape,
} from './experimentRules.js';

/** Error with a stable `code`, answered as-is by the routes. */
export class ExperimentError extends AppError {
  constructor(message: string, statusCode: number, code: string, context?: Record<string, unknown>) {
    super(message, statusCode, code, context);
  }
}

const bad = (message: string, code = 'EXPERIMENT_INVALID', context?: Record<string, unknown>) =>
  new ExperimentError(message, 400, code, context);

/** The agent that runs approved experiments and writes their ratings and verdicts. */
export const EXPERIMENT_RUNNER: Actor = {
  actorType: 'agent',
  actorId: 'experiment-runner',
  displayName: 'Experiment runner',
};

export const MAX_ROLLOUTS = 1000;

const TERMINAL_ARM: readonly ArmStatus[] = ['scored', 'failed', 'cancelled'];

// ----------------------------------------------------------------------------
// Dependencies — injectable so the loop is testable without a worker or a sim
// ----------------------------------------------------------------------------

export interface ExperimentDeps {
  repo: Pick<
    ExperimentRepository,
    | 'create'
    | 'findById'
    | 'list'
    | 'listForModelVersion'
    | 'updateExperiment'
    | 'updateArm'
    | 'findArm'
    | 'findArmByTrainingJobId'
    | 'findArmBySimJobId'
    | 'findTenantOfExperiment'
    | 'createSimEpisodes'
    | 'listEpisodes'
    | 'latestSimToRealValidation'
  > & {
    /** Move running → completed only if still running; true when this call did it. */
    markCompleted(id: string, verdictJson: string): Promise<boolean>;
  };
  training: {
    submitJob(request: {
      mixture: MixtureMemberInput[];
      baseModel: string;
      fineTuneMethod: string;
      hyperparameters?: Record<string, HyperparameterValue>;
      initFromModelVersionId?: string | null;
    }): Promise<{ id: string }>;
    cancelJob(id: string): Promise<unknown>;
    checkMixture(members: MixtureMemberInput[]): Promise<CompatibilityReport>;
    checkInitFrom(initFromModelVersionId: string, baseModel: string): Promise<void>;
  };
  /** Freeze every cited dataset that is a view; returns the ids it froze. */
  freezeViews(datasetIds: string[]): Promise<string[]>;
  sim: {
    isKnownEnvironment(environment: string): boolean;
    submitEvaluation(modelVersionId: string, environment: string, rolloutCount: number): { job: { jobId: string }; taskPrompt: string };
    cancelJob(jobId: string): unknown;
    /** The task string the environment's rollout profile gives the policy. */
    taskPromptFor(environment: string): string;
  };
  social: {
    putRating(subject: SubjectRef, actor: Actor, input: PutRatingInput): Promise<unknown>;
    createComment(subject: SubjectRef, actor: Actor, input: CreateCommentInput): Promise<unknown>;
  };
  compliance: {
    logSystemEvent(params: {
      sessionId: string;
      robotId: string;
      payload: { description: string; eventName: string; component?: string; configuration?: Record<string, unknown> };
    }): Promise<unknown>;
  };
  now(): Date;
}

async function freezeCitedViews(datasetIds: string[]): Promise<string[]> {
  const ids = [...new Set(datasetIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const rows = (await prisma.dataset.findMany({
    where: { id: { in: ids }, kind: 'view' },
    select: { id: true, kind: true },
  })) as Array<{ id: string; kind: string }>;
  const frozen: string[] = [];
  for (const row of rows) {
    if (!isDatasetView(row)) continue;
    await datasetViewService.freeze(row.id);
    frozen.push(row.id);
  }
  return frozen;
}

function defaultDeps(): ExperimentDeps {
  return {
    repo: experimentRepository,
    training: {
      submitJob: (request) =>
        trainingJobService.submitJob({
          mixture: request.mixture,
          baseModel: request.baseModel as (typeof BaseModels)[number],
          fineTuneMethod: request.fineTuneMethod as (typeof FineTuneMethods)[number],
          hyperparameters: request.hyperparameters as Record<string, number>,
          initFromModelVersionId: request.initFromModelVersionId ?? null,
        }),
      cancelJob: (id) => trainingJobService.cancelJob(id),
      checkMixture: (members) => trainingJobService.checkMixture(members),
      checkInitFrom: async (initFromModelVersionId, baseModel) => {
        await checkInitFrom({ initFromModelVersionId }, baseModel);
      },
    },
    freezeViews: freezeCitedViews,
    sim: {
      isKnownEnvironment,
      submitEvaluation: (mv, env, n) => simulationService.submitEvaluation(mv, env, n),
      cancelJob: (jobId) => simulationService.cancelJob(jobId),
      taskPromptFor: (env) => getEvalProfileForEnvironment(env).task,
    },
    social: socialService,
    compliance: complianceLogService,
    now: () => new Date(),
  };
}

// ----------------------------------------------------------------------------
// Mapping
// ----------------------------------------------------------------------------

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function armShape(row: ExperimentArmRow): ArmShape {
  return {
    name: row.name,
    datasetRefs: parseJson<MixtureMemberInput[]>(row.datasetRefsJson, []),
    initFromModelVersionId: row.initFromModelVersionId,
    hyperparameters: parseJson<Record<string, HyperparameterValue>>(row.hyperparametersJson, {}),
  };
}

export function toArmDTO(row: ExperimentArmRow, baseline: ExperimentArmRow | undefined): ExperimentArmDTO {
  const shape = armShape(row);
  return {
    id: row.id,
    experimentId: row.experimentId,
    name: row.name,
    label: row.label,
    isBaseline: row.isBaseline,
    datasetRefs: shape.datasetRefs,
    initFromModelVersionId: row.initFromModelVersionId,
    hyperparameters: shape.hyperparameters ?? {},
    trainingJobId: row.trainingJobId,
    modelVersionId: row.modelVersionId,
    simJobId: row.simJobId,
    status: row.status as ArmStatus,
    failureReason: row.failureReason,
    result: parseJson<ArmResult | null>(row.resultJson, null),
    varies: baseline && baseline.id !== row.id ? armDifferences(shape, armShape(baseline)) : [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toExperimentDTO(row: ExperimentWithArms): ExperimentDTO {
  const baseline = row.arms.find((a) => a.id === row.baselineArmId) ?? row.arms.find((a) => a.isBaseline);
  return {
    id: row.id,
    title: row.title,
    hypothesis: row.hypothesis,
    status: row.status as ExperimentStatus,
    actorType: row.actorType as Actor['actorType'],
    actorId: row.actorId,
    displayName: row.displayName,
    baseModel: row.baseModel,
    fineTuneMethod: row.fineTuneMethod,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
    rejectedReason: row.rejectedReason,
    budget: parseJson<ExperimentBudget>(row.budgetJson, readBudget(undefined)),
    evaluation: parseJson<ExperimentEvaluation>(row.evaluationJson, { environment: '', rolloutCount: 0 }),
    baselineArmId: baseline?.id ?? null,
    verdict: parseJson<ExperimentVerdict | null>(row.verdictJson, null),
    arms: row.arms.map((a) => toArmDTO(a, baseline)),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function nonEmpty(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Run `fn` inside the experiment's tenant, so ratings and comments written by a hook are stamped with it. */
function inTenant<T>(tenantId: string | null | undefined, fn: () => Promise<T>): Promise<T> {
  return tenantId ? tenantStore.run({ tenantId }, fn) : fn();
}

// ----------------------------------------------------------------------------
// Service
// ----------------------------------------------------------------------------

interface NormalizedArm extends ArmShape {
  label: string | null;
  isBaseline: boolean;
  datasetRefs: MixtureMemberInput[];
  initFromModelVersionId: string | null;
  hyperparameters: Record<string, HyperparameterValue>;
}

function normalizeArm(raw: ArmInput, i: number): NormalizedArm {
  if (!raw || typeof raw !== 'object') throw bad(`arms[${i}] must be an object`);
  if (!nonEmpty(raw.name)) throw bad(`arms[${i}].name is required`);
  if (!Array.isArray(raw.datasetRefs) || raw.datasetRefs.length === 0) {
    throw bad(`arms[${i}] ("${raw.name}") must name at least one dataset in datasetRefs`);
  }
  const datasetRefs = raw.datasetRefs.map((r, j) => {
    if (!r || !nonEmpty(r.datasetId)) throw bad(`arms[${i}].datasetRefs[${j}].datasetId is required`);
    if (r.weight !== undefined && (typeof r.weight !== 'number' || !Number.isFinite(r.weight) || r.weight <= 0)) {
      throw bad(`arms[${i}].datasetRefs[${j}].weight must be a positive number`);
    }
    return r.weight === undefined ? { datasetId: r.datasetId.trim() } : { datasetId: r.datasetId.trim(), weight: r.weight };
  });
  const hp = raw.hyperparameters ?? {};
  if (typeof hp !== 'object' || Array.isArray(hp)) throw bad(`arms[${i}].hyperparameters must be an object`);
  for (const [k, v] of Object.entries(hp)) {
    if (!['number', 'string', 'boolean'].includes(typeof v) || (typeof v === 'number' && !Number.isFinite(v))) {
      throw bad(`arms[${i}].hyperparameters.${k} must be a finite number, a string or a boolean`);
    }
  }
  const init = raw.initFromModelVersionId;
  if (init !== undefined && init !== null && typeof init !== 'string') {
    throw bad(`arms[${i}].initFromModelVersionId must be an id string or null`);
  }
  return {
    name: raw.name.trim(),
    label: nonEmpty(raw.label) ? raw.label.trim() : null,
    isBaseline: raw.isBaseline === true,
    datasetRefs,
    initFromModelVersionId: nonEmpty(init) ? init.trim() : null,
    hyperparameters: hp,
  };
}

export class ExperimentService {
  private attached = false;

  constructor(private readonly deps: ExperimentDeps = defaultDeps()) {}

  // --------------------------------------------------------------------------
  // Reads
  // --------------------------------------------------------------------------

  async get(id: string): Promise<ExperimentDTO> {
    return toExperimentDTO(await this.load(id));
  }

  async list(filter: { status?: string; modelVersionId?: string; limit?: number } = {}): Promise<ExperimentDTO[]> {
    const rows = filter.modelVersionId
      ? await this.deps.repo.listForModelVersion(filter.modelVersionId)
      : await this.deps.repo.list({ status: filter.status, limit: filter.limit });
    return rows.filter((r) => !filter.status || r.status === filter.status).map(toExperimentDTO);
  }

  private async load(id: string): Promise<ExperimentWithArms> {
    const row = await this.deps.repo.findById(id);
    if (!row) throw new ExperimentError(`Experiment '${id}' not found`, 404, 'EXPERIMENT_NOT_FOUND');
    return row;
  }

  // --------------------------------------------------------------------------
  // 1. Propose — validates everything, runs nothing
  // --------------------------------------------------------------------------

  /**
   * Validate the whole design and store it as `proposed`. Every check that can
   * refuse a run is made here, so an approver is only ever shown a design that
   * would start: one axis per arm, compatible data, matching starting models,
   * a budget within limits. Nothing is submitted.
   */
  async propose(input: ProposeExperimentInput, actor: Actor): Promise<ExperimentDTO> {
    if (!input || typeof input !== 'object') throw bad('body must be an object');
    if (!nonEmpty(input.title)) throw bad('title is required');
    if (!nonEmpty(input.hypothesis)) throw bad('hypothesis is required — what this expects to show, in one sentence');
    if (!(BaseModels as readonly string[]).includes(input.baseModel)) {
      throw bad(`baseModel must be one of ${BaseModels.join(', ')}`);
    }
    if (!(FineTuneMethods as readonly string[]).includes(input.fineTuneMethod)) {
      throw bad(`fineTuneMethod must be one of ${FineTuneMethods.join(', ')}`);
    }
    const evaluation = this.readEvaluation(input.evaluation);
    if (!Array.isArray(input.arms) || input.arms.length < 2) {
      throw bad('an experiment needs a baseline and at least one arm to compare against it');
    }
    const arms = input.arms.map(normalizeArm);
    const names = new Set<string>();
    for (const a of arms) {
      if (names.has(a.name)) throw bad(`two arms are named "${a.name}" — every arm needs its own name`);
      names.add(a.name);
    }
    const flagged = arms.filter((a) => a.isBaseline);
    if (flagged.length > 1) throw bad('exactly one arm is the baseline; several are flagged isBaseline');
    if (flagged.length === 0) arms[0].isBaseline = true;
    const baseline = arms.find((a) => a.isBaseline)!;

    let budget: ExperimentBudget;
    try {
      budget = readBudget(input.budget);
    } catch (e) {
      throw bad((e as Error).message, 'EXPERIMENT_BUDGET_INVALID');
    }
    const overBudget = budgetViolation(budget, arms.length);
    if (overBudget) throw bad(overBudget, 'EXPERIMENT_OVER_BUDGET', { budget, armCount: arms.length });

    this.assertOneAxis(arms, baseline);

    for (const arm of arms) {
      const report = await this.deps.training.checkMixture(arm.datasetRefs);
      if (report.verdict === 'incompatible') {
        throw bad(`Arm "${arm.name}": ${report.headline}`, 'EXPERIMENT_MIXTURE_INCOMPATIBLE', { arm: arm.name, report });
      }
      if (arm.initFromModelVersionId) {
        try {
          await this.deps.training.checkInitFrom(arm.initFromModelVersionId, input.baseModel);
        } catch (e) {
          throw bad(`Arm "${arm.name}": ${(e as Error).message}`, 'EXPERIMENT_INIT_FROM_INVALID', { arm: arm.name });
        }
      }
    }

    const rows: ArmCreateData[] = arms.map((a) => ({
      name: a.name,
      label: a.label ?? (a === baseline ? 'baseline' : armDifferences(a, baseline)[0] ?? null),
      isBaseline: a === baseline,
      datasetRefsJson: JSON.stringify(a.datasetRefs),
      initFromModelVersionId: a.initFromModelVersionId,
      hyperparametersJson: JSON.stringify(a.hyperparameters),
    }));
    const created = await this.deps.repo.create(
      {
        title: input.title.trim(),
        hypothesis: input.hypothesis.trim(),
        actorType: actor.actorType,
        actorId: actor.actorId,
        displayName: actor.displayName,
        baseModel: input.baseModel,
        fineTuneMethod: input.fineTuneMethod,
        budgetJson: JSON.stringify(budget),
        evaluationJson: JSON.stringify(evaluation),
      },
      rows
    );
    return toExperimentDTO(created);
  }

  private readEvaluation(raw: ExperimentEvaluation | undefined): ExperimentEvaluation {
    if (!raw || typeof raw !== 'object') throw bad('evaluation { environment, rolloutCount } is required');
    if (!nonEmpty(raw.environment) || !this.deps.sim.isKnownEnvironment(raw.environment)) {
      throw bad(`evaluation.environment '${String(raw.environment)}' is not a known simulation environment`);
    }
    const n = raw.rolloutCount;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_ROLLOUTS) {
      throw bad(`evaluation.rolloutCount must be a whole number from 1 to ${MAX_ROLLOUTS}`);
    }
    return { environment: raw.environment, rolloutCount: n };
  }

  private assertOneAxis(arms: ArmShape[], baseline: ArmShape): void {
    for (const arm of arms) {
      if (arm === baseline) continue;
      const violation = oneAxisViolation(arm, baseline);
      if (violation) {
        throw bad(violation, 'EXPERIMENT_ARM_NOT_ONE_AXIS', { arm: arm.name, differences: armDifferences(arm, baseline) });
      }
    }
  }

  // --------------------------------------------------------------------------
  // 2. Approve — the human gate, and the only place GPU time is spent
  // --------------------------------------------------------------------------

  /**
   * A person approves: the design is re-checked, every cited view is frozen,
   * the decision and its budget go to the compliance log, and one training job
   * per arm is submitted. An arm whose submission is refused fails on its own
   * rather than taking the experiment down with it.
   */
  async approve(id: string, approver: Actor): Promise<ExperimentDTO> {
    this.assertHuman(approver, 'approve');
    const exp = await this.load(id);
    if (exp.status !== 'proposed') {
      throw new ExperimentError(`Only a proposed experiment can be approved; this one is ${exp.status}`, 409, 'EXPERIMENT_NOT_PROPOSED');
    }
    const shapes = exp.arms.map(armShape);
    const baseline = shapes[exp.arms.findIndex((a) => a.id === exp.baselineArmId)] ?? shapes[0];
    this.assertOneAxis(shapes, baseline);
    const budget = parseJson<ExperimentBudget>(exp.budgetJson, readBudget(undefined));
    const overBudget = budgetViolation(budget, exp.arms.length);
    if (overBudget) throw bad(overBudget, 'EXPERIMENT_OVER_BUDGET');

    const cited = shapes.flatMap((s) => s.datasetRefs.map((r) => r.datasetId));
    const frozen = await this.deps.freezeViews(cited);

    const approvedAt = this.deps.now();
    await this.deps.repo.updateExperiment(id, { status: 'approved', approvedBy: approver.actorId, approvedAt });
    await this.deps.compliance.logSystemEvent({
      sessionId: `experiment-${id}`,
      robotId: 'platform',
      payload: {
        eventName: 'experiment_approved',
        component: 'experiments',
        description: `${approver.displayName} (${approver.actorType} ${approver.actorId}) approved experiment "${exp.title}" proposed by ${exp.displayName} (${exp.actorType}): ${exp.arms.length} arms, budget ${budget.maxGpuHours} GPU hours.`,
        configuration: {
          experimentId: id,
          approver,
          proposer: { actorType: exp.actorType, actorId: exp.actorId, displayName: exp.displayName },
          budget,
          armCount: exp.arms.length,
          frozenViewIds: frozen,
        },
      },
    });

    for (const [i, arm] of exp.arms.entries()) {
      const shape = shapes[i];
      try {
        const job = await this.deps.training.submitJob({
          mixture: shape.datasetRefs,
          baseModel: exp.baseModel,
          fineTuneMethod: exp.fineTuneMethod,
          hyperparameters: shape.hyperparameters,
          initFromModelVersionId: shape.initFromModelVersionId ?? null,
        });
        await this.deps.repo.updateArm(arm.id, { trainingJobId: job.id, status: 'training' });
      } catch (e) {
        await this.deps.repo.updateArm(arm.id, { status: 'failed', failureReason: `Training submission refused: ${(e as Error).message}` });
      }
    }
    await this.deps.repo.updateExperiment(id, { status: 'running' });
    await this.maybeConclude(id);
    return this.get(id);
  }

  async reject(id: string, actor: Actor, reason: unknown): Promise<ExperimentDTO> {
    this.assertHuman(actor, 'reject');
    const exp = await this.load(id);
    if (exp.status !== 'proposed') {
      throw new ExperimentError(`Only a proposed experiment can be rejected; this one is ${exp.status}`, 409, 'EXPERIMENT_NOT_PROPOSED');
    }
    await this.deps.repo.updateExperiment(id, {
      status: 'rejected',
      rejectedReason: nonEmpty(reason) ? reason.trim().slice(0, 2000) : null,
    });
    return this.get(id);
  }

  /**
   * Stop an experiment. Outstanding training jobs and sim evaluations are
   * cancelled; arms that already settled keep their results.
   */
  async cancel(id: string, actor: Actor): Promise<ExperimentDTO> {
    const exp = await this.load(id);
    if (!['proposed', 'approved', 'running'].includes(exp.status)) {
      throw new ExperimentError(`A ${exp.status} experiment cannot be cancelled`, 409, 'EXPERIMENT_NOT_CANCELLABLE');
    }
    await this.deps.repo.updateExperiment(id, { status: 'cancelled' });
    for (const arm of exp.arms) {
      if ((TERMINAL_ARM as readonly string[]).includes(arm.status)) continue;
      if (arm.status === 'training' && arm.trainingJobId) {
        try {
          await this.deps.training.cancelJob(arm.trainingJobId);
        } catch (e) {
          // Already finished or failed between the read and the cancel.
          console.warn(`[ExperimentService] could not cancel job ${arm.trainingJobId}: ${(e as Error).message}`);
        }
      }
      if (arm.status === 'evaluating' && arm.simJobId) {
        try {
          this.deps.sim.cancelJob(arm.simJobId);
        } catch (e) {
          console.warn(`[ExperimentService] could not cancel sim job ${arm.simJobId}: ${(e as Error).message}`);
        }
      }
      await this.deps.repo.updateArm(arm.id, { status: 'cancelled', failureReason: `Cancelled by ${actor.displayName}` });
    }
    return this.get(id);
  }

  private assertHuman(actor: Actor, verb: string): void {
    if (actor.actorType === 'agent') {
      throw new ExperimentError(
        `An agent cannot ${verb} an experiment — its proposal is a recommendation, the decision is a person's.`,
        403,
        'EXPERIMENT_APPROVER_NOT_HUMAN'
      );
    }
  }

  // --------------------------------------------------------------------------
  // 3. A finished run → evaluate its model
  // --------------------------------------------------------------------------

  /** Hooked off TrainingOrchestrator 'model:completed'. */
  async onJobCompleted(event: TrainingCompletedEvent): Promise<void> {
    const arm = await this.deps.repo.findArmByTrainingJobId(event.jobId);
    if (!arm || arm.status !== 'training') return;
    const tenant = await this.deps.repo.findTenantOfExperiment(arm.experimentId);
    await inTenant(tenant?.tenantId, async () => {
      const exp = await this.deps.repo.findById(arm.experimentId);
      if (!exp || exp.status !== 'running') return;
      if (!event.modelVersionId) {
        await this.failArm(arm.id, 'The run finished but produced no model version to evaluate.');
        return;
      }
      const evaluation = parseJson<ExperimentEvaluation>(exp.evaluationJson, { environment: '', rolloutCount: 0 });
      try {
        const { job } = this.deps.sim.submitEvaluation(event.modelVersionId, evaluation.environment, evaluation.rolloutCount);
        await this.deps.repo.updateArm(arm.id, { modelVersionId: event.modelVersionId, simJobId: job.jobId, status: 'evaluating' });
      } catch (e) {
        await this.deps.repo.updateArm(arm.id, { modelVersionId: event.modelVersionId });
        await this.failArm(arm.id, `Evaluation could not be submitted: ${(e as Error).message}`);
      }
    });
  }

  /** Hooked off TrainingOrchestrator 'model:failed' and job cancellation. */
  async onJobFailed(event: { jobId: string; error: string }): Promise<void> {
    const arm = await this.deps.repo.findArmByTrainingJobId(event.jobId);
    if (!arm || arm.status !== 'training') return;
    const tenant = await this.deps.repo.findTenantOfExperiment(arm.experimentId);
    await inTenant(tenant?.tenantId, () => this.failArm(arm.id, `Training failed: ${event.error}`));
  }

  // --------------------------------------------------------------------------
  // 4. A finished evaluation → score and rate the arm
  // --------------------------------------------------------------------------

  /** Hooked off SimulationService 'job:completed'. */
  async onSimCompleted(simJob: SimJob): Promise<void> {
    const arm = await this.deps.repo.findArmBySimJobId(simJob.jobId);
    if (!arm || arm.status !== 'evaluating') return;
    const tenant = await this.deps.repo.findTenantOfExperiment(arm.experimentId);
    await inTenant(tenant?.tenantId, async () => {
      try {
        await this.scoreArm(arm.id, simJob);
      } catch (e) {
        await this.failArm(arm.id, `Scoring failed: ${(e as Error).message}`);
      }
    });
  }

  /** Hooked off SimulationService 'job:failed'. */
  async onSimFailed(simJob: SimJob): Promise<void> {
    const arm = await this.deps.repo.findArmBySimJobId(simJob.jobId);
    if (!arm || arm.status !== 'evaluating') return;
    const tenant = await this.deps.repo.findTenantOfExperiment(arm.experimentId);
    await inTenant(tenant?.tenantId, () =>
      this.failArm(arm.id, `Evaluation failed${simJob.failureReason ? `: ${simJob.failureReason}` : ''}.`)
    );
  }

  /**
   * Score an arm from its evaluation: write one EvaluationEpisode per rollout
   * (source 'sim'), compute the ArmResult from those rows, and rate the arm's
   * model as the runner agent with the episode ids as evidence. The rating is
   * written before the arm is marked scored, so a scored arm always has one.
   *
   * The evaluator reports counts, not a per-rollout log, so rollout order is
   * not known: rows are written successes first and say so in their metadata.
   */
  async scoreArm(armId: string, simJob: Pick<SimJob, 'jobId' | 'rolloutCount' | 'metrics'>): Promise<ArmResult> {
    const arm = await this.deps.repo.findArm(armId);
    if (!arm) throw new ExperimentError(`Arm '${armId}' not found`, 404, 'EXPERIMENT_ARM_NOT_FOUND');
    if (!arm.modelVersionId) throw new Error('arm has no model version to score');
    const exp = await this.load(arm.experimentId);
    const evaluation = parseJson<ExperimentEvaluation>(exp.evaluationJson, { environment: '', rolloutCount: 0 });
    const m = (simJob.metrics ?? {}) as unknown as Record<string, unknown>;
    const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
    const total = int(m.totalEpisodes) ?? simJob.rolloutCount;
    const rate = typeof m.successRate === 'number' ? Math.max(0, Math.min(1, m.successRate)) : 0;
    const succeeded = Math.min(total, int(m.successfulEpisodes) ?? Math.round(rate * total));
    const durationMs = typeof m.avgEpisodeDuration === 'number' && m.avgEpisodeDuration > 0 ? Math.round(m.avgEpisodeDuration * 1000) : 0;
    const taskPrompt = this.deps.sim.taskPromptFor(evaluation.environment);

    const end = this.deps.now().getTime();
    const ids = await this.deps.repo.createSimEpisodes(
      Array.from({ length: total }, (_, i) => {
        const startedAt = new Date(end - (total - i) * durationMs);
        return {
          modelVersionId: arm.modelVersionId!,
          taskPrompt,
          startedAt,
          endedAt: new Date(startedAt.getTime() + durationMs),
          durationMs,
          success: i < succeeded,
          metadata: {
            source: 'sim',
            simJobId: simJob.jobId,
            environment: evaluation.environment,
            experimentId: exp.id,
            armId: arm.id,
            rolloutIndex: i,
            rolloutOrderKnown: false,
          },
        };
      })
    );

    const episodes = await this.deps.repo.listEpisodes(ids);
    const successCount = episodes.filter((e) => e.success).length;
    const episodeCount = episodes.length;
    const s2r = await this.deps.repo.latestSimToRealValidation(arm.modelVersionId);
    const result: ArmResult = {
      successRate: episodeCount > 0 ? successCount / episodeCount : 0,
      successCount,
      episodeCount,
      meanDurationMs: episodeCount > 0 ? Math.round(episodes.reduce((s, e) => s + e.durationMs, 0) / episodeCount) : 0,
      domainGapScore: s2r?.domainGapScore ?? null,
      evaluationEpisodeIds: ids,
      simJobId: simJob.jobId,
      taskPrompt,
    };

    const evidence: EvidenceRef[] = [{ kind: 'evaluation_episode', ids }];
    if (s2r) evidence.push({ kind: 'sim_to_real_validation', id: s2r.id });
    await this.deps.social.putRating(
      { subjectType: 'model_version', subjectId: arm.modelVersionId, episodeIndex: null },
      EXPERIMENT_RUNNER,
      {
        score: result.successRate,
        dimensions: { successRate: result.successRate },
        evidence,
        comment: `${successCount}/${episodeCount} sim rollouts succeeded in ${evaluation.environment} ("${taskPrompt}") — experiment "${exp.title}", arm "${arm.name}".`,
      }
    );
    await this.deps.repo.updateArm(arm.id, { resultJson: JSON.stringify(result), status: 'scored' });
    await this.maybeConclude(exp.id);
    return result;
  }

  /** Fail one arm (only while its experiment runs) and see whether the experiment can conclude. */
  private async failArm(armId: string, reason: string): Promise<void> {
    const arm = await this.deps.repo.findArm(armId);
    if (!arm || (TERMINAL_ARM as readonly string[]).includes(arm.status)) return;
    const exp = await this.deps.repo.findById(arm.experimentId);
    if (!exp || exp.status !== 'running') return;
    await this.deps.repo.updateArm(armId, { status: 'failed', failureReason: reason.slice(0, 2000) });
    await this.maybeConclude(arm.experimentId);
  }

  // --------------------------------------------------------------------------
  // 5. Every arm settled → the verdict
  // --------------------------------------------------------------------------

  /**
   * When every arm is scored or failed, compare each against the baseline,
   * store the verdict and post it as a comment on the experiment with the
   * arms' models and runs as evidence. A failed arm never blocks this.
   */
  async maybeConclude(id: string): Promise<ExperimentVerdict | null> {
    const exp = await this.deps.repo.findById(id);
    if (!exp || exp.status !== 'running') return null;
    if (!exp.arms.every((a) => (TERMINAL_ARM as readonly string[]).includes(a.status))) return null;

    const scored = (a: ExperimentArmRow) => ({
      id: a.id,
      name: a.name,
      result: a.status === 'scored' ? parseJson<ArmResult | null>(a.resultJson, null) : null,
    });
    const baseline = exp.arms.find((a) => a.id === exp.baselineArmId) ?? exp.arms[0];
    const verdict = buildVerdict(
      scored(baseline),
      exp.arms.filter((a) => a.id !== baseline.id).map(scored),
      this.deps.now()
    );
    if (!(await this.deps.repo.markCompleted(id, JSON.stringify(verdict)))) return null;

    const evidence: EvidenceRef[] = [];
    for (const a of exp.arms) {
      if (a.modelVersionId) evidence.push({ kind: 'model_version', id: a.modelVersionId });
      else if (a.trainingJobId) evidence.push({ kind: 'training_job', id: a.trainingJobId });
    }
    try {
      await this.deps.social.createComment({ subjectType: 'experiment', subjectId: id, episodeIndex: null }, EXPERIMENT_RUNNER, {
        body: `Verdict on "${exp.title}" — hypothesis: ${exp.hypothesis}\n\n${verdict.confidenceNote}`,
        evidence,
      });
    } catch (e) {
      // The verdict is stored either way; a lost comment must not undo it.
      console.error(`[ExperimentService] could not post the verdict comment on ${id}:`, e);
    }
    return verdict;
  }

  // --------------------------------------------------------------------------
  // Wiring
  // --------------------------------------------------------------------------

  /** Subscribe the loop to training and simulation events. Idempotent. */
  attach(): void {
    if (this.attached) return;
    this.attached = true;
    const run = (what: string, p: Promise<void>) =>
      p.catch((e) => console.error(`[ExperimentService] ${what} handler failed:`, e));
    trainingOrchestrator.on('model:completed', (e: TrainingCompletedEvent) => run('model:completed', this.onJobCompleted(e)));
    trainingOrchestrator.on('model:failed', (e: TrainingFailedEvent) => run('model:failed', this.onJobFailed(e)));
    trainingJobService.onJobEvent((ev) => {
      if (ev.type === 'training:job:cancelled') {
        void run('job:cancelled', this.onJobFailed({ jobId: ev.jobId, error: 'the training job was cancelled' }));
      }
    });
    simulationService.on('job:completed', (j: SimJob) => run('sim job:completed', this.onSimCompleted(j)));
    simulationService.on('job:failed', (j: SimJob) => run('sim job:failed', this.onSimFailed(j)));
  }
}

export const experimentService = new ExperimentService();
