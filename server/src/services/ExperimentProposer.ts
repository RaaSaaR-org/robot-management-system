/**
 * @file ExperimentProposer.ts
 * @description Two deterministic proposers for the experiment loop (TASK-242)
 *   that need no LLM, so the loop can be driven end to end:
 *   - data-ablation: baseline = the full dataset; each arm drops one
 *     low-scoring reward band, as a dataset view built with the same rule as
 *     `POST /datasets/:id/views/from-rewards` (TASK-240);
 *   - lr-sweep: baseline hyperparameters; each arm varies the learning rate only.
 * @feature training
 *
 * A proposer composes a ProposeExperimentInput; ExperimentService.propose then
 * validates it like any other proposal. Composing a data-ablation creates its
 * views — cheap metadata, no bytes — because an arm must cite a real dataset id.
 */

import { AppError } from '../utils/errors.js';
import { datasetService } from './DatasetService.js';
import { episodeRewardRepository } from '../repositories/EpisodeRewardRepository.js';
import type { DatasetSelection } from '../types/dataset-view.types.js';
import type {
  ArmInput,
  ExperimentBudget,
  ExperimentEvaluation,
  HyperparameterValue,
  ProposeExperimentInput,
} from '../types/experiment.types.js';

export type ProposerStrategy = 'data-ablation' | 'lr-sweep';

export function isProposerStrategy(v: unknown): v is ProposerStrategy {
  return v === 'data-ablation' || v === 'lr-sweep';
}

export type RewardType = 'robometer' | 'topreward';

/** Fields both strategies share. */
interface CommonBody {
  baseModel: string;
  fineTuneMethod: string;
  evaluation: ExperimentEvaluation;
  budget?: Partial<ExperimentBudget>;
  hyperparameters?: Record<string, HyperparameterValue>;
  initFromModelVersionId?: string | null;
  title?: string;
  hypothesis?: string;
}

export interface DataAblationBody extends CommonBody {
  datasetId: string;
  rewardType?: RewardType;
  /** Fractions of the lowest-scoring episodes each arm drops. Default [0.1, 0.25]. */
  bands?: number[];
}

export interface LrSweepBody extends CommonBody {
  datasetId: string;
  /** Learning rates for the arms. Default: baseline ÷ 3 and × 3. */
  learningRates?: number[];
}

export interface ProposerDeps {
  rewardScores(datasetId: string, rewardType: RewardType): Promise<Array<{ episodeIndex: number; score: number }>>;
  selectionFromRewards(datasetId: string, rewardType: RewardType, minScore: number): Promise<DatasetSelection>;
  createView(parentDatasetId: string, input: { name: string; description?: string; selection: DatasetSelection }): Promise<{ id: string }>;
}

const bad = (message: string) => new AppError(message, 400, 'EXPERIMENT_PROPOSER_INVALID');

export const DEFAULT_BANDS = [0.1, 0.25];
export const DEFAULT_LEARNING_RATE = 1e-4;

function pctLabel(q: number): string {
  return `${Math.round(q * 1000) / 10}%`;
}

/** Round to three significant digits, so 1e-4 / 3 reads 3.33e-5 and not 0.0000333333. */
function sig3(x: number): number {
  return Number(x.toPrecision(3));
}

export class ExperimentProposer {
  constructor(
    private readonly deps: ProposerDeps = {
      rewardScores: (id, t) => episodeRewardRepository.findByDataset(id, t),
      selectionFromRewards: (id, t, min) => datasetService.selectionFromRewards(id, t, min),
      createView: (id, input) => datasetService.createView(id, input),
    }
  ) {}

  async compose(strategy: ProposerStrategy, body: unknown): Promise<ProposeExperimentInput> {
    if (!body || typeof body !== 'object') throw bad('body must be an object');
    return strategy === 'data-ablation' ? this.dataAblation(body as DataAblationBody) : this.lrSweep(body as LrSweepBody);
  }

  /**
   * Baseline: the whole dataset. Arm k: the dataset without its lowest-scoring
   * `bands[k]` fraction of episodes, by reward score. The cut is a minimum
   * score — the score of the first episode kept — so the view is exactly what
   * `views/from-rewards` with that minScore would make, and reproducible.
   * Bands that would drop nothing, or the same episodes as a smaller band,
   * make no arm: an arm that repeats another answers nothing new.
   */
  async dataAblation(body: DataAblationBody): Promise<ProposeExperimentInput> {
    if (typeof body.datasetId !== 'string' || !body.datasetId) throw bad('datasetId is required');
    const rewardType: RewardType = body.rewardType ?? 'robometer';
    if (rewardType !== 'robometer' && rewardType !== 'topreward') throw bad("rewardType must be 'robometer' or 'topreward'");
    const bands = body.bands ?? DEFAULT_BANDS;
    if (!Array.isArray(bands) || bands.length === 0 || bands.some((q) => typeof q !== 'number' || !(q > 0 && q < 1))) {
      throw bad('bands must be fractions between 0 and 1, e.g. [0.1, 0.25]');
    }

    const scores = (await this.deps.rewardScores(body.datasetId, rewardType)).map((r) => r.score).sort((a, b) => a - b);
    if (scores.length < 2) {
      throw bad(`Dataset ${body.datasetId} has no ${rewardType} reward scores to ablate on — run a reward-model job first.`);
    }

    const arms: ArmInput[] = [
      {
        name: 'full dataset',
        label: 'baseline',
        isBaseline: true,
        datasetRefs: [{ datasetId: body.datasetId }],
        initFromModelVersionId: body.initFromModelVersionId ?? null,
        hyperparameters: body.hyperparameters ?? {},
      },
    ];
    const seenCuts = new Set<number>();
    for (const q of [...bands].sort((a, b) => a - b)) {
      const minScore = scores[Math.min(scores.length - 1, Math.ceil(q * scores.length))];
      const dropped = scores.filter((s) => s < minScore).length;
      if (dropped === 0 || seenCuts.has(minScore)) continue;
      seenCuts.add(minScore);
      const selection = await this.deps.selectionFromRewards(body.datasetId, rewardType, minScore);
      const name = `drop lowest ${pctLabel(q)} by ${rewardType}`;
      const view = await this.deps.createView(body.datasetId, {
        name: `${name} (≥ ${minScore.toFixed(3)})`,
        description: `Experiment arm: keeps episodes with ${rewardType} score ≥ ${minScore}; drops ${dropped} of ${scores.length} scored episodes.`,
        selection,
      });
      arms.push({
        name,
        label: `drops ${dropped} low-${rewardType} episodes`,
        datasetRefs: [{ datasetId: view.id }],
        initFromModelVersionId: body.initFromModelVersionId ?? null,
        hyperparameters: body.hyperparameters ?? {},
      });
    }
    if (arms.length < 2) {
      throw bad(`Every band leaves the ${rewardType} scores of ${body.datasetId} unchanged — there is no low band to drop.`);
    }
    return {
      title: body.title ?? `Data ablation on ${body.datasetId} by ${rewardType}`,
      hypothesis:
        body.hypothesis ??
        `Dropping the lowest-${rewardType} episodes raises the sim success rate over training on every episode.`,
      baseModel: body.baseModel,
      fineTuneMethod: body.fineTuneMethod,
      budget: { maxArms: Math.max(arms.length, 2), ...(body.budget ?? {}) },
      evaluation: body.evaluation,
      arms,
    };
  }

  /** Baseline hyperparameters; each arm changes the learning rate and nothing else. */
  async lrSweep(body: LrSweepBody): Promise<ProposeExperimentInput> {
    if (typeof body.datasetId !== 'string' || !body.datasetId) throw bad('datasetId is required');
    const hp = { ...(body.hyperparameters ?? {}) };
    const baseLr = typeof hp.learning_rate === 'number' ? hp.learning_rate : DEFAULT_LEARNING_RATE;
    hp.learning_rate = baseLr;
    const rates = body.learningRates ?? [sig3(baseLr / 3), sig3(baseLr * 3)];
    if (!Array.isArray(rates) || rates.length === 0 || rates.some((r) => typeof r !== 'number' || !(r > 0) || !Number.isFinite(r))) {
      throw bad('learningRates must be positive numbers');
    }
    const distinct = [...new Set(rates)].filter((r) => r !== baseLr);
    if (distinct.length === 0) throw bad('every learning rate equals the baseline — nothing to sweep');
    const refs = [{ datasetId: body.datasetId }];
    const arms: ArmInput[] = [
      { name: `lr ${baseLr}`, label: 'baseline', isBaseline: true, datasetRefs: refs, initFromModelVersionId: body.initFromModelVersionId ?? null, hyperparameters: hp },
      ...distinct.map((lr) => ({
        name: `lr ${lr}`,
        label: `learning_rate ${baseLr} → ${lr}`,
        datasetRefs: refs,
        initFromModelVersionId: body.initFromModelVersionId ?? null,
        hyperparameters: { ...hp, learning_rate: lr },
      })),
    ];
    return {
      title: body.title ?? `Learning-rate sweep on ${body.datasetId}`,
      hypothesis: body.hypothesis ?? `A learning rate other than ${baseLr} changes the sim success rate on this data.`,
      baseModel: body.baseModel,
      fineTuneMethod: body.fineTuneMethod,
      budget: { maxArms: Math.max(arms.length, 2), ...(body.budget ?? {}) },
      evaluation: body.evaluation,
      arms,
    };
  }
}

export const experimentProposer = new ExperimentProposer();
