/**
 * @file ExperimentService.test.ts
 * @description The experiment loop's state machine (TASK-242): propose runs
 *   nothing, approval is human and spends, a finished run is evaluated, an
 *   evaluation is scored and rated, a failed arm does not block the verdict,
 *   and cancelling cascades to the jobs.
 * @feature training
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExperimentService, ExperimentError, EXPERIMENT_RUNNER } from '../ExperimentService.js';
import { FakeExperimentRepo, makeDeps } from './experimentFakes.js';
import type { Actor } from '../../types/social.types.js';
import type { ProposeExperimentInput } from '../../types/experiment.types.js';
import type { SimJob } from '../SimulationService.js';

// The real singleton loads jobs from the database on construction; the loop
// under test reaches the simulator only through injected deps.
vi.mock('../SimulationService.js', () => ({
  simulationService: { on: vi.fn(), submitEvaluation: vi.fn(), cancelJob: vi.fn() },
  isKnownEnvironment: vi.fn(),
  getEvalProfileForEnvironment: vi.fn(),
}));

const AGENT: Actor = { actorType: 'agent', actorId: 'planner', displayName: 'planner' };
const HUMAN: Actor = { actorType: 'user', actorId: 'u-1', displayName: 'Ada' };

function design(overrides: Partial<ProposeExperimentInput> = {}): ProposeExperimentInput {
  return {
    title: 'Drop shaky episodes',
    hypothesis: 'Dropping low-reward episodes raises sim success.',
    baseModel: 'groot_n1_7',
    fineTuneMethod: 'lora',
    evaluation: { environment: 'g1_apple_pnp', rolloutCount: 50 },
    budget: { maxArms: 3, maxGpuHours: 12, gpuHoursPerArm: 4 },
    arms: [
      { name: 'full', isBaseline: true, datasetRefs: [{ datasetId: 'ds-1' }], hyperparameters: { learning_rate: 1e-4 } },
      { name: 'drop 10%', datasetRefs: [{ datasetId: 'view-1' }], hyperparameters: { learning_rate: 1e-4 } },
      { name: 'lr 1e-5', datasetRefs: [{ datasetId: 'ds-1' }], hyperparameters: { learning_rate: 1e-5 } },
    ],
    ...overrides,
  };
}

function simJob(jobId: string, successRate: number, total: number): SimJob {
  const now = new Date();
  return {
    jobId,
    modelId: 'mv',
    environment: 'g1_apple_pnp',
    rolloutCount: total,
    backend: 'mujoco',
    status: 'completed',
    progress: 100,
    metrics: { successRate, avgStepsToCompletion: 10, collisionCount: 0, avgEpisodeDuration: 2.5 },
    createdAt: now,
    updatedAt: now,
  };
}

async function codeOf(p: Promise<unknown>): Promise<{ status: number; code: string; message: string }> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ExperimentError);
    const err = e as ExperimentError;
    return { status: err.statusCode, code: err.code, message: err.message };
  }
  throw new Error('expected a rejection');
}

let repo: FakeExperimentRepo;
let deps: ReturnType<typeof makeDeps>;
let svc: ExperimentService;

beforeEach(() => {
  repo = new FakeExperimentRepo();
  deps = makeDeps(repo);
  svc = new ExperimentService(deps);
});

describe('propose', () => {
  it('stores a proposal and runs nothing', async () => {
    const exp = await svc.propose(design(), AGENT);
    expect(exp.status).toBe('proposed');
    expect(exp.actorType).toBe('agent');
    expect(exp.arms).toHaveLength(3);
    expect(exp.baselineArmId).toBe(exp.arms.find((a) => a.isBaseline)!.id);
    expect(exp.arms.find((a) => a.name === 'lr 1e-5')!.varies).toEqual(['learning_rate (0.0001 → 0.00001)']);
    expect(deps.training.submitJob).not.toHaveBeenCalled();
    expect(deps.freezeViews).not.toHaveBeenCalled();
    expect(deps.sim.submitEvaluation).not.toHaveBeenCalled();
  });

  it('rejects an arm differing on two axes with a message naming both', async () => {
    const d = design();
    d.arms[1].hyperparameters = { learning_rate: 1e-5 };
    const err = await codeOf(svc.propose(d, AGENT));
    expect(err.code).toBe('EXPERIMENT_ARM_NOT_ONE_AXIS');
    expect(err.message).toContain('data (ds-1 → view-1)');
    expect(err.message).toContain('learning_rate (0.0001 → 0.00001)');
    expect(repo.experiments.size).toBe(0);
  });

  it('enforces the budget', async () => {
    const err = await codeOf(svc.propose(design({ budget: { maxArms: 3, maxGpuHours: 8, gpuHoursPerArm: 4 } }), AGENT));
    expect(err.code).toBe('EXPERIMENT_OVER_BUDGET');
    expect(err.message).toContain('12 GPU hours');
  });

  it('refuses an incompatible mixture with its headline', async () => {
    deps.training.checkMixture.mockResolvedValueOnce({ datasetIds: [], verdict: 'incompatible', headline: 'Action spaces differ.', recommendation: '', axes: [] });
    const err = await codeOf(svc.propose(design(), AGENT));
    expect(err.code).toBe('EXPERIMENT_MIXTURE_INCOMPATIBLE');
    expect(err.message).toContain('Action spaces differ.');
  });

  it('refuses a starting model of another architecture', async () => {
    deps.training.checkInitFrom.mockRejectedValueOnce(new Error('This run trains groot_n1_7 but "x" holds pi0 weights'));
    const d = design();
    d.arms[2] = { name: 'from mv', datasetRefs: [{ datasetId: 'ds-1' }], initFromModelVersionId: 'mv-pi0', hyperparameters: { learning_rate: 1e-4 } };
    const err = await codeOf(svc.propose(d, AGENT));
    expect(err.code).toBe('EXPERIMENT_INIT_FROM_INVALID');
  });

  it('validates the evaluation, the baseline and the names', async () => {
    expect((await codeOf(svc.propose(design({ evaluation: { environment: 'mars', rolloutCount: 5 } }), AGENT))).message).toContain('mars');
    const two = design();
    two.arms[1].isBaseline = true;
    expect((await codeOf(svc.propose(two, AGENT))).message).toContain('exactly one arm');
    expect((await codeOf(svc.propose(design({ arms: design().arms.slice(0, 1) }), AGENT))).message).toContain('at least one arm');
  });
});

describe('approve', () => {
  it('refuses an agent approver', async () => {
    const exp = await svc.propose(design(), AGENT);
    const err = await codeOf(svc.approve(exp.id, AGENT));
    expect(err.status).toBe(403);
    expect(deps.training.submitJob).not.toHaveBeenCalled();
  });

  it('freezes every cited view, logs the decision, and submits one job per arm', async () => {
    const exp = await svc.propose(design(), AGENT);
    const approved = await svc.approve(exp.id, HUMAN);
    expect(deps.freezeViews).toHaveBeenCalledWith(['ds-1', 'view-1', 'ds-1']);
    expect(deps.training.submitJob).toHaveBeenCalledTimes(3);
    expect(deps.training.submitJob).toHaveBeenCalledWith(
      expect.objectContaining({ mixture: [{ datasetId: 'view-1' }], baseModel: 'groot_n1_7', hyperparameters: { learning_rate: 1e-4 } })
    );
    expect(approved.status).toBe('running');
    expect(approved.approvedBy).toBe('u-1');
    expect(approved.arms.every((a) => a.status === 'training' && a.trainingJobId)).toBe(true);
    const log = deps.compliance.logSystemEvent.mock.calls[0][0] as { payload: { eventName: string; configuration: Record<string, unknown> } };
    expect(log.payload.eventName).toBe('experiment_approved');
    expect(log.payload.configuration.approver).toEqual(HUMAN);
    expect(log.payload.configuration.budget).toEqual({ maxArms: 3, maxGpuHours: 12, gpuHoursPerArm: 4 });
    expect(log.payload.configuration.frozenViewIds).toEqual(['view-1']);
  });

  it('only approves a proposed experiment', async () => {
    const exp = await svc.propose(design(), AGENT);
    await svc.approve(exp.id, HUMAN);
    expect((await codeOf(svc.approve(exp.id, HUMAN))).status).toBe(409);
  });

  it('fails an arm whose submission is refused, and keeps the rest running', async () => {
    deps.training.submitJob.mockRejectedValueOnce(new Error('no worker'));
    const exp = await svc.propose(design(), AGENT);
    const approved = await svc.approve(exp.id, HUMAN);
    expect(approved.arms.filter((a) => a.status === 'failed')).toHaveLength(1);
    expect(approved.arms.filter((a) => a.status === 'training')).toHaveLength(2);
    expect(approved.status).toBe('running');
  });

  it('rejects a proposal with a reason, human only', async () => {
    const exp = await svc.propose(design(), AGENT);
    expect((await codeOf(svc.reject(exp.id, AGENT, 'no'))).status).toBe(403);
    const r = await svc.reject(exp.id, HUMAN, 'not worth the GPU time');
    expect(r.status).toBe('rejected');
    expect(r.rejectedReason).toBe('not worth the GPU time');
  });
});

describe('the lifecycle after approval', () => {
  async function running() {
    const exp = await svc.propose(design(), AGENT);
    return svc.approve(exp.id, HUMAN);
  }

  it('advances a completed job to evaluating without manual action', async () => {
    const exp = await running();
    const arm = exp.arms[0];
    await svc.onJobCompleted({ jobId: arm.trainingJobId!, modelVersionId: 'mv-a' });
    const after = (await svc.get(exp.id)).arms.find((a) => a.id === arm.id)!;
    expect(after.status).toBe('evaluating');
    expect(after.modelVersionId).toBe('mv-a');
    expect(deps.sim.submitEvaluation).toHaveBeenCalledWith('mv-a', 'g1_apple_pnp', 50);
  });

  it('ignores a job that belongs to no arm', async () => {
    await running();
    await svc.onJobCompleted({ jobId: 'stranger', modelVersionId: 'mv-x' });
    expect(deps.sim.submitEvaluation).not.toHaveBeenCalled();
  });

  it('scores an arm from its episodes and rates the model with them as evidence', async () => {
    const exp = await running();
    const arm = exp.arms[1];
    await svc.onJobCompleted({ jobId: arm.trainingJobId!, modelVersionId: 'mv-b' });
    const simId = (await svc.get(exp.id)).arms.find((a) => a.id === arm.id)!.simJobId!;
    await svc.onSimCompleted(simJob(simId, 0.6, 50));
    const scored = (await svc.get(exp.id)).arms.find((a) => a.id === arm.id)!;
    expect(scored.status).toBe('scored');
    expect(scored.result).toMatchObject({ successCount: 30, episodeCount: 50, successRate: 0.6, meanDurationMs: 2500 });
    expect(repo.episodes.size).toBe(50);
    const [subject, actor, input] = deps.social.putRating.mock.calls[0] as unknown as [
      { subjectType: string; subjectId: string },
      Actor,
      { score: number; evidence: Array<{ kind: string; ids?: string[] }> },
    ];
    expect(subject).toMatchObject({ subjectType: 'model_version', subjectId: 'mv-b' });
    expect(actor).toEqual(EXPERIMENT_RUNNER);
    expect(input.score).toBe(0.6);
    expect(input.evidence[0].kind).toBe('evaluation_episode');
    expect(input.evidence[0].ids).toEqual(scored.result!.evaluationEpisodeIds);
    const ep = [...repo.episodes.values()][0];
    expect(ep.metadata).toMatchObject({ source: 'sim', simJobId: simId, armId: arm.id });
  });

  it('cites a sim-to-real validation when one exists', async () => {
    const exp = await running();
    const arm = exp.arms[0];
    repo.validations.push({ id: 's2r-1', modelVersionId: 'mv-a', domainGapScore: 0.2 });
    await svc.onJobCompleted({ jobId: arm.trainingJobId!, modelVersionId: 'mv-a' });
    const simId = (await svc.get(exp.id)).arms[0].simJobId!;
    await svc.onSimCompleted(simJob(simId, 0.5, 20));
    expect((await svc.get(exp.id)).arms[0].result!.domainGapScore).toBe(0.2);
    const input = deps.social.putRating.mock.calls[0][2] as { evidence: Array<{ kind: string }> };
    expect(input.evidence.map((e) => e.kind)).toEqual(['evaluation_episode', 'sim_to_real_validation']);
  });

  it('concludes with a failed arm and posts the verdict on the experiment', async () => {
    const exp = await running();
    const [base, a1, a2] = exp.arms;
    await svc.onJobFailed({ jobId: a2.trainingJobId!, error: 'OOM' });
    for (const [arm, rate] of [[base, 0.6], [a1, 0.64]] as const) {
      await svc.onJobCompleted({ jobId: arm.trainingJobId!, modelVersionId: `mv-${arm.id}` });
      const simId = (await svc.get(exp.id)).arms.find((a) => a.id === arm.id)!.simJobId!;
      await svc.onSimCompleted(simJob(simId, rate, 50));
    }
    const done = await svc.get(exp.id);
    expect(done.status).toBe('completed');
    expect(done.verdict!.winnerArmId).toBeNull();
    expect(done.verdict!.failedArmIds).toEqual([a2.id]);
    expect(done.verdict!.confidenceNote).toContain('No winner');
    expect(done.verdict!.deltas[0].episodeCount).toBe(50);
    expect(deps.social.createComment).toHaveBeenCalledTimes(1);
    const [subject, actor, input] = deps.social.createComment.mock.calls[0] as unknown as [
      { subjectType: string; subjectId: string },
      Actor,
      { body: string; evidence: Array<{ kind: string; id: string }> },
    ];
    expect(subject).toMatchObject({ subjectType: 'experiment', subjectId: exp.id });
    expect(actor).toEqual(EXPERIMENT_RUNNER);
    expect(input.body).toContain('No winner');
    expect(input.evidence).toContainEqual({ kind: 'training_job', id: a2.trainingJobId });
    expect(input.evidence).toContainEqual({ kind: 'model_version', id: `mv-${base.id}` });
  });

  it('fails an arm whose evaluation fails', async () => {
    const exp = await running();
    const arm = exp.arms[0];
    await svc.onJobCompleted({ jobId: arm.trainingJobId!, modelVersionId: 'mv-a' });
    const simId = (await svc.get(exp.id)).arms[0].simJobId!;
    await svc.onSimFailed({ ...simJob(simId, 0, 50), status: 'failed', failureReason: 'MuJoCo crashed' });
    const after = (await svc.get(exp.id)).arms[0];
    expect(after.status).toBe('failed');
    expect(after.failureReason).toContain('MuJoCo crashed');
  });

  it('cancelling cancels outstanding training jobs and sim evaluations', async () => {
    const exp = await running();
    const [base, a1] = exp.arms;
    await svc.onJobCompleted({ jobId: base.trainingJobId!, modelVersionId: 'mv-a' });
    const simId = (await svc.get(exp.id)).arms[0].simJobId!;
    const cancelled = await svc.cancel(exp.id, HUMAN);
    expect(cancelled.status).toBe('cancelled');
    expect(deps.training.cancelJob).toHaveBeenCalledTimes(2);
    expect(deps.training.cancelJob).toHaveBeenCalledWith(a1.trainingJobId);
    expect(deps.sim.cancelJob).toHaveBeenCalledWith(simId);
    expect(cancelled.arms.every((a) => a.status === 'cancelled')).toBe(true);
    // A late cancellation event for the arm's job changes nothing.
    await svc.onJobFailed({ jobId: a1.trainingJobId!, error: 'cancelled' });
    expect((await svc.get(exp.id)).arms.find((a) => a.id === a1.id)!.status).toBe('cancelled');
  });

  it('a completed experiment cannot be cancelled', async () => {
    const exp = await running();
    for (const arm of exp.arms) await svc.onJobFailed({ jobId: arm.trainingJobId!, error: 'x' });
    expect((await svc.get(exp.id)).status).toBe('completed');
    expect((await codeOf(svc.cancel(exp.id, HUMAN))).status).toBe(409);
  });
});
