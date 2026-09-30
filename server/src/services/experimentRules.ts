/**
 * @file experimentRules.ts
 * @description The pure rules of the experiment loop (TASK-242): how an arm
 *   differs from its baseline, the budget check, and the sampling-noise rule
 *   that decides whether a verdict may name a winner.
 * @feature training
 *
 * Kept free of I/O so every rule is tested as arithmetic, not through mocks.
 */

import type { MixtureMemberInput } from '../types/mixture.types.js';
import type {
  ArmComparison,
  ArmResult,
  ExperimentBudget,
  ExperimentVerdict,
  HyperparameterValue,
} from '../types/experiment.types.js';

// ============================================================================
// ONE AXIS PER ARM
// ============================================================================

/** The parts of an arm that can differ from the baseline. */
export interface ArmShape {
  name: string;
  datasetRefs: MixtureMemberInput[];
  initFromModelVersionId?: string | null;
  hyperparameters?: Record<string, HyperparameterValue>;
}

function describeData(refs: MixtureMemberInput[]): string {
  return refs.map((r) => (r.weight !== undefined && r.weight !== 1 ? `${r.datasetId}×${r.weight}` : r.datasetId)).join(' + ');
}

/** Order-independent key of a mixture: the same members at the same weights. */
function dataKey(refs: MixtureMemberInput[]): string {
  return refs
    .map((r) => `${r.datasetId}@${r.weight ?? 1}`)
    .sort()
    .join('|');
}

function showValue(v: HyperparameterValue | undefined): string {
  return v === undefined ? 'default' : String(v);
}

/**
 * Every axis on which `arm` differs from `baseline`, each as one phrase
 * ("learning_rate (0.0001 → 0.00001)"). The axes are the data, the starting
 * model, and each hyperparameter key on its own — so two changed
 * hyperparameters are two axes, which is the point.
 */
export function armDifferences(arm: ArmShape, baseline: ArmShape): string[] {
  const diffs: string[] = [];
  if (dataKey(arm.datasetRefs) !== dataKey(baseline.datasetRefs)) {
    diffs.push(`data (${describeData(baseline.datasetRefs)} → ${describeData(arm.datasetRefs)})`);
  }
  const armInit = arm.initFromModelVersionId ?? null;
  const baseInit = baseline.initFromModelVersionId ?? null;
  if (armInit !== baseInit) {
    diffs.push(`starting model (${baseInit ?? 'foundation weights'} → ${armInit ?? 'foundation weights'})`);
  }
  const a = arm.hyperparameters ?? {};
  const b = baseline.hyperparameters ?? {};
  for (const key of [...new Set([...Object.keys(b), ...Object.keys(a)])].sort()) {
    if (a[key] !== b[key]) diffs.push(`${key} (${showValue(b[key])} → ${showValue(a[key])})`);
  }
  return diffs;
}

/**
 * Null when the arm varies exactly one thing against the baseline; otherwise
 * the one sentence a person reads first, naming every difference.
 */
export function oneAxisViolation(arm: ArmShape, baseline: ArmShape): string | null {
  const diffs = armDifferences(arm, baseline);
  if (diffs.length === 1) return null;
  if (diffs.length === 0) {
    return `Arm "${arm.name}" is identical to the baseline, so it answers no question — change exactly one thing.`;
  }
  const listed = diffs.length === 2 ? `both ${diffs[0]} and ${diffs[1]}` : diffs.join(', ');
  return `Arm "${arm.name}" differs from the baseline in ${listed} — an arm varies exactly one thing, or its result cannot be attributed to either.`;
}

// ============================================================================
// BUDGET
// ============================================================================

/** The most arms any experiment may run, whatever its budget says. */
export const PLATFORM_MAX_ARMS = 8;

/** The most GPU hours one experiment may ask for (EXPERIMENT_MAX_GPU_HOURS). */
export function platformMaxGpuHours(): number {
  const raw = Number(process.env.EXPERIMENT_MAX_GPU_HOURS);
  return Number.isFinite(raw) && raw > 0 ? raw : 96;
}

export const DEFAULT_BUDGET: ExperimentBudget = { maxArms: 4, maxGpuHours: 24, gpuHoursPerArm: 4 };

/** Normalise a partial budget; throws with a sentence when it is malformed. */
export function readBudget(raw: Partial<ExperimentBudget> | undefined): ExperimentBudget {
  const b = { ...DEFAULT_BUDGET, ...(raw ?? {}) };
  for (const key of ['maxArms', 'maxGpuHours', 'gpuHoursPerArm'] as const) {
    if (typeof b[key] !== 'number' || !Number.isFinite(b[key]) || b[key] <= 0) {
      throw new Error(`budget.${key} must be a positive number`);
    }
  }
  if (!Number.isInteger(b.maxArms)) throw new Error('budget.maxArms must be a whole number');
  return b;
}

/** Null when `armCount` arms fit the budget and the platform limits; else why not. */
export function budgetViolation(budget: ExperimentBudget, armCount: number): string | null {
  if (budget.maxArms > PLATFORM_MAX_ARMS) {
    return `budget.maxArms is ${budget.maxArms}, above the platform limit of ${PLATFORM_MAX_ARMS} arms per experiment.`;
  }
  const ceiling = platformMaxGpuHours();
  if (budget.maxGpuHours > ceiling) {
    return `budget.maxGpuHours is ${budget.maxGpuHours}, above the platform limit of ${ceiling} GPU hours per experiment.`;
  }
  if (armCount > budget.maxArms) {
    return `${armCount} arms exceed the budget of ${budget.maxArms}.`;
  }
  const needed = armCount * budget.gpuHoursPerArm;
  if (needed > budget.maxGpuHours) {
    return `${armCount} arms × ${budget.gpuHoursPerArm} GPU hours = ${needed} GPU hours, over the budget of ${budget.maxGpuHours}.`;
  }
  return null;
}

// ============================================================================
// THE NOISE RULE
// ============================================================================

/** Below this many rollouts per arm the normal approximation is not trusted at all. */
export const MIN_EPISODES_PER_ARM = 10;

/** Family-wise false-positive rate across all comparisons in one experiment. */
export const FAMILY_ALPHA = 0.05;

/**
 * Inverse of the standard normal CDF (Acklam's rational approximation,
 * relative error < 1.2e-9 — far below anything a success rate can resolve).
 */
export function inverseNormalCdf(p: number): number {
  if (!(p > 0 && p < 1)) throw new Error(`inverseNormalCdf needs 0 < p < 1, got ${p}`);
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) return -inverseNormalCdf(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * The two-sided critical z for `comparisons` simultaneous comparisons against
 * the baseline, Bonferroni-corrected: each test runs at FAMILY_ALPHA / k, so
 * adding arms makes each one harder to call — which is what stops an agent from
 * proposing twenty arms and reporting whichever one got lucky.
 * k = 1 → 1.96, k = 2 → 2.24, k = 3 → 2.39.
 */
export function criticalZ(comparisons: number): number {
  const k = Math.max(1, comparisons);
  return inverseNormalCdf(1 - FAMILY_ALPHA / (2 * k));
}

export interface Tally {
  successCount: number;
  episodeCount: number;
}

/**
 * THE rule: is an arm's success rate distinguishable from the baseline's at
 * these episode counts? A two-proportion z-test with a pooled standard error.
 *
 *   p_arm  = s_arm  / n_arm          p_base = s_base / n_base
 *   delta  = p_arm − p_base
 *   p_pool = (s_arm + s_base) / (n_arm + n_base)
 *   SE     = sqrt( p_pool · (1 − p_pool) · (1/n_arm + 1/n_base) )
 *   z      = delta / SE
 *   significant  ⇔  |z| > z_crit   (z_crit from criticalZ above)
 *
 * Worked: 8/12 vs 11/12 — delta 0.25, p_pool 0.79, SE 0.166, z 1.51 < 1.96:
 * within noise, however large 25 points looks. 280/400 vs 240/400 — delta 0.10,
 * p_pool 0.65, SE 0.0337, z 2.97 > 1.96: a real difference.
 *
 * Fewer than MIN_EPISODES_PER_ARM rollouts on either side is never called.
 * SE = 0 happens only when both arms are all-success or all-failure, where the
 * delta is 0 and there is nothing to call either.
 */
export function compareToBaseline(arm: Tally, baseline: Tally, zCrit: number): Omit<ArmComparison, 'armId' | 'name'> {
  const pArm = arm.episodeCount > 0 ? arm.successCount / arm.episodeCount : 0;
  const pBase = baseline.episodeCount > 0 ? baseline.successCount / baseline.episodeCount : 0;
  const delta = pArm - pBase;
  const base = { successRate: pArm, episodeCount: arm.episodeCount, delta };
  if (arm.episodeCount < MIN_EPISODES_PER_ARM || baseline.episodeCount < MIN_EPISODES_PER_ARM) {
    return { ...base, standardError: 0, zScore: 0, significant: false, direction: 'too_few_episodes' };
  }
  const pPool = (arm.successCount + baseline.successCount) / (arm.episodeCount + baseline.episodeCount);
  const standardError = Math.sqrt(pPool * (1 - pPool) * (1 / arm.episodeCount + 1 / baseline.episodeCount));
  const zScore = standardError > 0 ? delta / standardError : 0;
  const significant = standardError > 0 && Math.abs(zScore) > zCrit;
  const direction = !significant ? 'within_noise' : delta > 0 ? 'better' : 'worse';
  return { ...base, standardError, zScore, significant, direction };
}

function pct(x: number): string {
  return `${Math.round(x * 1000) / 10}%`;
}

function pts(x: number): string {
  const v = Math.round(x * 1000) / 10;
  return `${v >= 0 ? '+' : ''}${v} pts`;
}

export interface ScoredArm {
  id: string;
  name: string;
  result: ArmResult | null;
}

/**
 * The verdict over every arm against the baseline. Names a winner only when
 * the noise rule says the difference is real, and says so when it is not.
 *
 *  - some arm significantly better → the best of those wins (the note says
 *    when several beat the baseline, since they are not compared to each other);
 *  - every comparable arm significantly worse → the baseline wins;
 *  - otherwise → no winner, and the note names the counts that were not enough.
 */
export function buildVerdict(baseline: ScoredArm, others: ScoredArm[], now = new Date()): ExperimentVerdict {
  const failedArmIds = [baseline, ...others].filter((a) => !a.result).map((a) => a.id);
  const scored = others.filter((a): a is ScoredArm & { result: ArmResult } => a.result !== null);
  const zCrit = criticalZ(scored.length);
  const verdict = (winnerArmId: string | null, deltas: ArmComparison[], confidenceNote: string): ExperimentVerdict => ({
    winnerArmId,
    baselineArmId: baseline.id,
    baselineSuccessRate: baseline.result?.successRate ?? null,
    baselineEpisodeCount: baseline.result?.episodeCount ?? 0,
    deltas,
    criticalZ: zCrit,
    confidenceNote,
    failedArmIds,
    concludedAt: now.toISOString(),
  });

  if (!baseline.result) {
    return verdict(null, [], `The baseline "${baseline.name}" did not produce a result, so no arm can be compared — no winner.`);
  }
  const b = baseline.result;
  if (scored.length === 0) {
    return verdict(null, [], `No arm besides the baseline produced a result — no winner.`);
  }

  const deltas: ArmComparison[] = scored.map((a) => ({
    armId: a.id,
    name: a.name,
    ...compareToBaseline(a.result, b, zCrit),
  }));
  const lines = deltas.map((d) => {
    const r = scored.find((a) => a.id === d.armId)!.result;
    const call =
      d.direction === 'too_few_episodes'
        ? `too few rollouts to judge (need ${MIN_EPISODES_PER_ARM} per arm)`
        : d.direction === 'within_noise'
          ? `|z| ${Math.abs(d.zScore).toFixed(2)} ≤ ${zCrit.toFixed(2)}: within sampling noise`
          : `|z| ${Math.abs(d.zScore).toFixed(2)} > ${zCrit.toFixed(2)}: ${d.direction} than baseline`;
    return `"${d.name}" ${r.successCount}/${r.episodeCount} (${pct(d.successRate)}), ${pts(d.delta)} — ${call}.`;
  });
  const head = `Baseline "${baseline.name}" ${b.successCount}/${b.episodeCount} (${pct(b.successRate)}).`;
  const failedNote = failedArmIds.length > 0 ? ` ${failedArmIds.length} arm(s) failed and are left out.` : '';

  const better = deltas.filter((d) => d.direction === 'better').sort((x, y) => y.delta - x.delta);
  if (better.length > 0) {
    const w = better[0];
    const several =
      better.length > 1
        ? ` ${better.length} arms beat the baseline; they were not tested against each other, so "${w.name}" leads only on its point estimate.`
        : '';
    return verdict(w.armId, deltas, `Winner: "${w.name}". ${head} ${lines.join(' ')}${several}${failedNote}`);
  }
  if (deltas.every((d) => d.direction === 'worse')) {
    return verdict(baseline.id, deltas, `Winner: the baseline — every arm did measurably worse. ${head} ${lines.join(' ')}${failedNote}`);
  }
  return verdict(
    null,
    deltas,
    `No winner: no arm differs from the baseline by more than sampling noise at these episode counts. ${head} ${lines.join(' ')} More rollouts per arm would narrow the noise.${failedNote}`
  );
}
