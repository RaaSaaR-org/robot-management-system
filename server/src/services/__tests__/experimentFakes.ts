/**
 * @file experimentFakes.ts
 * @description In-memory stand-ins for the experiment loop's dependencies
 *   (TASK-242), shared by the service and integration tests.
 * @feature training
 */

import { vi } from 'vitest';
import type { Experiment, ExperimentArm } from '@prisma/client';
import type { ExperimentDeps } from '../ExperimentService.js';
import type {
  ArmCreateData,
  ExperimentCreateData,
  ExperimentWithArms,
  SimEpisodeData,
} from '../../repositories/ExperimentRepository.js';
import type { CompatibilityReport } from '../../types/mixture.types.js';

let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

export class FakeExperimentRepo {
  experiments = new Map<string, Experiment>();
  arms = new Map<string, ExperimentArm>();
  episodes = new Map<string, SimEpisodeData & { id: string }>();
  validations: Array<{ id: string; modelVersionId: string; domainGapScore: number | null }> = [];

  private withArms(e: Experiment): ExperimentWithArms {
    const arms = [...this.arms.values()]
      .filter((a) => a.experimentId === e.id)
      .sort((a, b) => Number(b.isBaseline) - Number(a.isBaseline));
    return { ...e, arms };
  }

  async create(data: ExperimentCreateData, arms: ArmCreateData[]): Promise<ExperimentWithArms> {
    const now = new Date();
    const exp: Experiment = {
      id: nextId('exp'),
      tenantId: null,
      status: 'proposed',
      approvedBy: null,
      approvedAt: null,
      rejectedReason: null,
      baselineArmId: null,
      verdictJson: null,
      createdAt: now,
      updatedAt: now,
      ...data,
    };
    this.experiments.set(exp.id, exp);
    for (const a of arms) {
      const arm: ExperimentArm = {
        id: nextId('arm'),
        experimentId: exp.id,
        trainingJobId: null,
        modelVersionId: null,
        simJobId: null,
        status: 'pending',
        failureReason: null,
        resultJson: null,
        createdAt: now,
        updatedAt: now,
        ...a,
      };
      this.arms.set(arm.id, arm);
      if (arm.isBaseline) exp.baselineArmId = arm.id;
    }
    return this.withArms(exp);
  }

  async findById(id: string) {
    const e = this.experiments.get(id);
    return e ? this.withArms(e) : null;
  }

  async list(filter: { status?: string }) {
    return [...this.experiments.values()].filter((e) => !filter.status || e.status === filter.status).map((e) => this.withArms(e));
  }

  async listForModelVersion(mv: string) {
    const ids = new Set([...this.arms.values()].filter((a) => a.modelVersionId === mv || a.initFromModelVersionId === mv).map((a) => a.experimentId));
    return [...ids].map((id) => this.withArms(this.experiments.get(id)!));
  }

  async updateExperiment(id: string, data: Partial<Experiment>) {
    const e = { ...this.experiments.get(id)!, ...data, updatedAt: new Date() };
    this.experiments.set(id, e);
    return e;
  }

  async markCompleted(id: string, verdictJson: string) {
    const e = this.experiments.get(id);
    if (!e || e.status !== 'running') return false;
    this.experiments.set(id, { ...e, status: 'completed', verdictJson });
    return true;
  }

  async updateArm(id: string, data: Partial<ExperimentArm>) {
    const a = { ...this.arms.get(id)!, ...data, updatedAt: new Date() };
    this.arms.set(id, a);
    return a;
  }

  async findArm(id: string) {
    return this.arms.get(id) ?? null;
  }

  async findArmByTrainingJobId(jobId: string) {
    return [...this.arms.values()].find((a) => a.trainingJobId === jobId) ?? null;
  }

  async findArmBySimJobId(jobId: string) {
    return [...this.arms.values()].find((a) => a.simJobId === jobId) ?? null;
  }

  async findTenantOfExperiment(id: string) {
    const e = this.experiments.get(id);
    return e ? { tenantId: e.tenantId } : null;
  }

  async createSimEpisodes(rows: SimEpisodeData[]) {
    return rows.map((r) => {
      const id = nextId('ee');
      this.episodes.set(id, { ...r, id });
      return id;
    });
  }

  async listEpisodes(ids: string[]) {
    return ids.filter((id) => this.episodes.has(id)).map((id) => {
      const e = this.episodes.get(id)!;
      return { id, success: e.success, durationMs: e.durationMs };
    });
  }

  async latestSimToRealValidation(mv: string) {
    const v = this.validations.filter((x) => x.modelVersionId === mv).at(-1);
    return v ? { id: v.id, domainGapScore: v.domainGapScore } : null;
  }
}

export const COMPATIBLE: CompatibilityReport = {
  datasetIds: [],
  verdict: 'compatible',
  headline: 'These datasets can be trained together.',
  recommendation: '',
  axes: [],
};

export function makeDeps(repo = new FakeExperimentRepo()) {
  let job = 0;
  let sim = 0;
  const deps = {
    repo,
    training: {
      submitJob: vi.fn(async () => ({ id: `job-${++job}` })),
      cancelJob: vi.fn(async () => ({})),
      checkMixture: vi.fn(async () => COMPATIBLE),
      checkInitFrom: vi.fn(async () => undefined),
    },
    freezeViews: vi.fn(async (ids: string[]) => ids.filter((id) => id.startsWith('view'))),
    sim: {
      isKnownEnvironment: vi.fn((env: string) => env === 'g1_apple_pnp'),
      submitEvaluation: vi.fn(() => ({ job: { jobId: `sim-${++sim}` }, taskPrompt: 'move the apple to the plate' })),
      cancelJob: vi.fn(() => ({})),
      taskPromptFor: vi.fn(() => 'move the apple to the plate'),
    },
    social: {
      putRating: vi.fn(async (_subject: unknown, _actor: unknown, _input: unknown) => ({})),
      createComment: vi.fn(async (_subject: unknown, _actor: unknown, _input: unknown) => ({})),
    },
    compliance: { logSystemEvent: vi.fn(async (_params: unknown) => ({})) },
    now: () => new Date('2026-09-30T12:00:00Z'),
  };
  return deps satisfies ExperimentDeps;
}
