/**
 * @file ExperimentLoop.integration.test.ts
 * @description A fake completed job drives an arm from `training` through
 *   `scored` and produces a Rating row, through the real SocialService
 *   (evidence checks, one-rating-per-actor, compliance logging) (TASK-242).
 * @feature training
 */

import { describe, it, expect, vi } from 'vitest';
import type { Comment, Rating } from '@prisma/client';
import { ExperimentService, EXPERIMENT_RUNNER } from '../ExperimentService.js';
import { SocialService, type SocialComplianceSink } from '../SocialService.js';
import type { SocialRepository, CommentCreateData, RatingWriteData } from '../../repositories/SocialRepository.js';
import { FakeExperimentRepo, makeDeps } from './experimentFakes.js';
import type { SimJob } from '../SimulationService.js';

// The real singleton loads jobs from the database on construction; the loop
// under test reaches the simulator only through injected deps.
vi.mock('../SimulationService.js', () => ({
  simulationService: { on: vi.fn(), submitEvaluation: vi.fn(), cancelJob: vi.fn() },
  isKnownEnvironment: vi.fn(),
  getEvalProfileForEnvironment: vi.fn(),
}));

/** Only what the loop's writes touch; existence answered from the experiment fake. */
class SocialStore {
  ratings: Rating[] = [];
  comments: Comment[] = [];
  constructor(private readonly exp: FakeExperimentRepo) {}
  async existingEvaluationEpisodeIds(ids: string[]) {
    return new Set(ids.filter((id) => this.exp.episodes.has(id)));
  }
  async modelVersionExists(id: string) {
    return [...this.exp.arms.values()].some((a) => a.modelVersionId === id);
  }
  async trainingJobExists(id: string) {
    return [...this.exp.arms.values()].some((a) => a.trainingJobId === id);
  }
  async simToRealValidationExists() {
    return false;
  }
  async findRating(subjectType: string, subjectKey: string, actorType: string, actorId: string) {
    return this.ratings.find((r) => r.subjectType === subjectType && r.subjectKey === subjectKey && r.actorType === actorType && r.actorId === actorId) ?? null;
  }
  async createRating(data: RatingWriteData) {
    const now = new Date();
    const row: Rating = { id: `r-${this.ratings.length + 1}`, tenantId: null, createdAt: now, updatedAt: now, ...data };
    this.ratings.push(row);
    return row;
  }
  async updateRating(id: string, data: RatingWriteData) {
    const i = this.ratings.findIndex((r) => r.id === id);
    this.ratings[i] = { ...this.ratings[i], ...data, updatedAt: new Date() };
    return this.ratings[i];
  }
  async findComment() {
    return null;
  }
  async createComment(data: CommentCreateData) {
    const row: Comment = { id: `c-${this.comments.length + 1}`, tenantId: null, editedAt: null, deletedAt: null, createdAt: new Date(), ...data };
    this.comments.push(row);
    return row;
  }
}

function completedSim(jobId: string, successfulEpisodes: number, totalEpisodes: number): SimJob {
  const now = new Date();
  return {
    jobId,
    modelId: 'mv',
    environment: 'g1_apple_pnp',
    rolloutCount: totalEpisodes,
    backend: 'mujoco',
    status: 'completed',
    progress: 100,
    // The real evaluator reports the counts beside the rate (metrics.py).
    metrics: {
      successRate: successfulEpisodes / totalEpisodes,
      avgStepsToCompletion: 300,
      collisionCount: 0,
      avgEpisodeDuration: 12,
      totalEpisodes,
      successfulEpisodes,
    } as SimJob['metrics'],
    createdAt: now,
    updatedAt: now,
  };
}

describe('experiment loop, end to end on fakes', () => {
  it('drives an arm from training to scored and writes the runner agent rating', async () => {
    const repo = new FakeExperimentRepo();
    const store = new SocialStore(repo);
    const sink = { logAIDecision: vi.fn().mockResolvedValue({}) };
    const social = new SocialService(store as unknown as SocialRepository, sink as unknown as SocialComplianceSink);
    const deps = { ...makeDeps(repo), social };
    const svc = new ExperimentService(deps);

    const proposed = await svc.propose(
      {
        title: 'Two-arm data ablation',
        hypothesis: 'Dropping the lowest 10% by robometer helps.',
        baseModel: 'groot_n1_7',
        fineTuneMethod: 'lora',
        evaluation: { environment: 'g1_apple_pnp', rolloutCount: 40 },
        arms: [
          { name: 'full dataset', isBaseline: true, datasetRefs: [{ datasetId: 'ds-1' }] },
          { name: 'drop lowest 10%', datasetRefs: [{ datasetId: 'view-1' }] },
        ],
      },
      { actorType: 'agent', actorId: 'planner', displayName: 'planner' }
    );
    const exp = await svc.approve(proposed.id, { actorType: 'user', actorId: 'u-1', displayName: 'Ada' });
    const [base, arm] = exp.arms;
    expect(arm.status).toBe('training');

    // The worker reports the run done; the orchestrator's hook fires.
    await svc.onJobCompleted({ jobId: arm.trainingJobId!, modelVersionId: 'mv-arm' });
    const evaluating = (await svc.get(exp.id)).arms.find((a) => a.id === arm.id)!;
    expect(evaluating.status).toBe('evaluating');

    await svc.onSimCompleted(completedSim(evaluating.simJobId!, 34, 40));
    const scored = (await svc.get(exp.id)).arms.find((a) => a.id === arm.id)!;
    expect(scored.status).toBe('scored');
    expect(scored.result).toMatchObject({ successCount: 34, episodeCount: 40, meanDurationMs: 12000 });

    expect(store.ratings).toHaveLength(1);
    const rating = store.ratings[0];
    expect(rating).toMatchObject({ subjectType: 'model_version', subjectId: 'mv-arm', actorType: 'agent', actorId: EXPERIMENT_RUNNER.actorId, score: 0.85 });
    expect(JSON.parse(rating.evidenceJson)).toEqual([{ kind: 'evaluation_episode', ids: scored.result!.evaluationEpisodeIds }]);
    expect(sink.logAIDecision).toHaveBeenCalledTimes(1);

    // The baseline settles too; the verdict lands as a comment on the experiment.
    await svc.onJobCompleted({ jobId: base.trainingJobId!, modelVersionId: 'mv-base' });
    const baseSim = (await svc.get(exp.id)).arms.find((a) => a.id === base.id)!.simJobId!;
    await svc.onSimCompleted(completedSim(baseSim, 20, 40));
    const done = await svc.get(exp.id);
    expect(done.status).toBe('completed');
    // 34/40 vs 20/40: delta 0.35, pooled 0.675, SE 0.1047, z 3.34 > 1.96.
    expect(done.verdict!.winnerArmId).toBe(arm.id);
    expect(store.ratings).toHaveLength(2);
    expect(store.comments).toHaveLength(1);
    expect(store.comments[0]).toMatchObject({ subjectType: 'experiment', subjectId: exp.id, actorId: 'experiment-runner' });
    expect(store.comments[0].body).toContain('Winner: "drop lowest 10%"');
  });
});
