/**
 * @file datasetCompatibility.ts
 * @description Decide whether a set of datasets can be trained together, and
 *              say what each difference costs.
 * @feature training
 *
 * WHAT THIS IS FOR. An operator about to spend a night of GPU time on a mixture
 * of two Hub datasets has one question: will this produce a model, or will it
 * fail at 3am inside the data loader. Nothing in the platform answered it —
 * `submitJob` checked that a dataset existed and was `ready`, which is a check
 * about one dataset and says nothing about two.
 *
 * THE RULES ARE THE PRODUCT, so they are stated rather than implied:
 *
 *   - Different action or state width is NOT a failure. It is a
 *     multi-embodiment run: GR00T N1.x trains exactly this, one projector per
 *     embodiment. Refusing it would refuse the mixture the feature exists for.
 *     What it is not is concatenable, and the report says so.
 *   - Different fps IS a failure, unless one rate is an exact integer multiple
 *     of the other and the trainer is told to subsample. 25 and 30 fps mixed
 *     without resampling trains on two different notions of a second and the
 *     loss curve looks fine while it happens.
 *   - A member that is not `ready` blocks everything, because whatever a run
 *     would read from it has not been shown to exist.
 *
 * WHERE THE NUMBERS COME FROM. Widths are MEASURED values, read out of the
 * parquet by `validateDataset` and stored in `Dataset.validationJson`. A
 * dataset nobody has validated has no measured width — `info.json` still
 * DECLARES one, and that declaration is used, labelled as a declaration,
 * because it is the dataset's own manifest rather than our guess. When neither
 * exists the axis says `unknown` and unknown-vs-known counts as a difference:
 * an operator told "these might match" will assume they do, and finds out
 * otherwise several GPU hours in.
 */

import { prisma } from '../../database/index.js';
import type {
  AxisVerdict,
  CompatibilityAxis,
  CompatibilityReport,
  CompatibilityVerdict,
} from '../../types/mixture.types.js';

/**
 * The columns of a `Dataset` row this reads.
 *
 * JSON columns are accepted either as the raw string Prisma hands back or as an
 * already-parsed object, because the two callers differ: the compatibility
 * endpoint reads rows straight from Prisma, tests build objects.
 */
export interface CompatibilityDatasetInput {
  id: string;
  name: string;
  status: string;
  fps: number;
  lerobotVersion: string;
  robotTypeId: string;
  /** The joined RobotType's name, when the caller has it. */
  robotTypeName?: string | null;
  infoJson?: string | Record<string, unknown> | null;
  validationJson?: string | Record<string, unknown> | null;
}

/** How many datasets one report may cover. Mirrors the endpoint's 1..8. */
export const MAX_MIXTURE_MEMBERS = 8;

function parseJson(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The structural report inside `validationJson`.
 *
 * `DatasetService` writes `{ validatedAt, breakdown, report }`; older rows and
 * hand-written fixtures hold the bare report. Both are unwrapped here so a
 * dataset does not silently read as "never validated" because of its wrapper.
 */
function structureReport(validationJson: unknown): Record<string, unknown> | null {
  const outer = parseJson(validationJson);
  if (!outer) return null;
  const inner = parseJson(outer.report);
  return inner ?? outer;
}

/** Where a width came from, which is what makes the value trustworthy or not. */
type WidthSource = 'observed' | 'declared' | null;

interface Width {
  value: number | null;
  source: WidthSource;
}

function declaredWidth(info: Record<string, unknown> | null, feature: string): number | null {
  const features = parseJson(info?.features);
  const entry = parseJson(features?.[feature]);
  const shape = entry?.shape;
  if (Array.isArray(shape) && typeof shape[0] === 'number') return shape[0];
  return null;
}

function readWidth(
  ds: CompatibilityDatasetInput,
  key: 'observedStateWidth' | 'observedActionWidth',
  feature: 'observation.state' | 'action',
): Width {
  const observed = structureReport(ds.validationJson)?.[key];
  if (typeof observed === 'number') return { value: observed, source: 'observed' };
  const declared = declaredWidth(parseJson(ds.infoJson), feature);
  if (declared !== null) return { value: declared, source: 'declared' };
  return { value: null, source: null };
}

function widthLabel(width: Width): string {
  if (width.value === null) return 'unknown';
  // The provenance travels with the number: "43" is a measurement, "43
  // (declared)" is a claim by the file that has never been opened.
  return width.source === 'declared' ? `${width.value} (declared)` : String(width.value);
}

/**
 * Camera feature keys.
 *
 * Validation lists them after opening `info.json`; when it never ran, they are
 * derived from the features map the same way validation does — a `video` or
 * `image` dtype is a camera and nothing else is.
 */
function readCameraKeys(ds: CompatibilityDatasetInput): string[] {
  const fromReport = structureReport(ds.validationJson)?.imageKeys;
  if (Array.isArray(fromReport)) return [...fromReport].map(String).sort();

  const features = parseJson(parseJson(ds.infoJson)?.features);
  if (!features) return [];
  return Object.entries(features)
    .filter(([, spec]) => {
      const dtype = parseJson(spec)?.dtype;
      return dtype === 'video' || dtype === 'image';
    })
    .map(([key]) => key)
    .sort();
}

/** What the trainer calls the embodiment, which is not the RobotType row's name. */
function robotTypeLabel(ds: CompatibilityDatasetInput): string {
  const fromInfo = parseJson(ds.infoJson)?.robot_type;
  if (typeof fromInfo === 'string' && fromInfo.trim()) return fromInfo.trim();
  if (ds.robotTypeName?.trim()) return ds.robotTypeName.trim();
  return ds.robotTypeId;
}

function fpsLabel(fps: number): string {
  if (!Number.isFinite(fps) || fps <= 0) return 'unknown';
  return `${Number(fps.toFixed(3))} fps`;
}

function distinct(values: string[]): string[] {
  return [...new Set(values)];
}

function axis(
  name: CompatibilityAxis['axis'],
  label: string,
  verdict: AxisVerdict,
  datasets: CompatibilityDatasetInput[],
  value: (ds: CompatibilityDatasetInput) => string,
  note: string,
): CompatibilityAxis {
  return {
    axis: name,
    label,
    verdict,
    values: datasets.map((ds) => ({ datasetId: ds.id, datasetName: ds.name, value: value(ds) })),
    note,
  };
}

/**
 * Is the faster rate a whole number of times the slower one?
 *
 * Tolerant, because a recorded rate is 10.12 or 29.97 as often as it is a round
 * number — but tolerant only about float noise, not about 29.97 vs 30, which
 * are different rates and drift apart over a long episode.
 */
function isIntegerMultiple(slow: number, fast: number): boolean {
  if (slow <= 0 || fast <= 0) return false;
  const ratio = fast / slow;
  const nearest = Math.round(ratio);
  return nearest >= 2 && Math.abs(ratio - nearest) < 1e-6;
}

function buildFpsAxis(datasets: CompatibilityDatasetInput[]): CompatibilityAxis {
  const rates = datasets.map((d) => d.fps);
  const known = rates.filter((r) => Number.isFinite(r) && r > 0);
  const value = (ds: CompatibilityDatasetInput) => fpsLabel(ds.fps);

  if (known.length !== rates.length) {
    return axis('fps', 'Frame rate', 'blocking', datasets, value,
      'At least one member has no recorded frame rate, so there is no way to line its timestamps '
      + 'up with the others — validate it before mixing rather than assuming they match.');
  }
  if (distinct(known.map(String)).length === 1) {
    return axis('fps', 'Frame rate', 'match', datasets, value,
      `Every member was recorded at ${fpsLabel(known[0])}, so one timestep means the same thing `
      + 'across the mixture and nothing has to be resampled.');
  }

  const slow = Math.min(...known);
  const fast = Math.max(...known);
  if (isIntegerMultiple(slow, fast)) {
    const factor = Math.round(fast / slow);
    return axis('fps', 'Frame rate', 'differs', datasets, value,
      `${fpsLabel(fast)} is exactly ${factor}× ${fpsLabel(slow)}, so the trainer can subsample the `
      + 'faster data down to the slower rate — it must be configured to, because mixing them '
      + 'as-is trains the policy on two different playback speeds.');
  }
  return axis('fps', 'Frame rate', 'blocking', datasets, value,
    `${fpsLabel(slow)} and ${fpsLabel(fast)} do not divide, so no subsampling aligns them; `
    + 'resample one dataset offline before mixing, or train on them separately.');
}

function buildWidthAxis(
  name: 'stateWidth' | 'actionWidth',
  label: string,
  datasets: CompatibilityDatasetInput[],
): CompatibilityAxis {
  const key = name === 'stateWidth' ? 'observedStateWidth' : 'observedActionWidth';
  const feature = name === 'stateWidth' ? 'observation.state' : 'action';
  const widths = new Map(datasets.map((ds) => [ds.id, readWidth(ds, key, feature)]));
  const value = (ds: CompatibilityDatasetInput) => widthLabel(widths.get(ds.id)!);
  const vectors = [...widths.values()];
  const unknown = vectors.filter((w) => w.value === null).length;
  const numbers = distinct(vectors.filter((w) => w.value !== null).map((w) => String(w.value)));

  const thing = name === 'stateWidth' ? 'state vector' : 'action vector';
  const head = name === 'stateWidth' ? 'proprioception encoder' : 'action head';

  if (unknown > 0 && datasets.length > 1) {
    return axis(name, label, 'differs', datasets, value,
      `${unknown} of ${datasets.length} members have no ${thing} width on record — neither measured `
      + `nor declared — so this has to be treated as a mismatch: a wrong ${thing} width is not `
      + 'discovered until the run is hours old. Validate those datasets to turn this into a real answer.');
  }
  if (numbers.length <= 1) {
    const only = vectors.find((w) => w.value !== null);
    return axis(name, label, 'match', datasets, value,
      only
        ? `Every member has a ${only.value}-wide ${thing}, so a single ${head} fits the whole mixture `
          + 'and the data can be concatenated.'
        : `No member records a ${thing} width, so nothing could be compared here.`);
  }
  return axis(name, label, 'differs', datasets, value,
    `The members' ${thing}s are ${numbers.join(' and ')} wide: no single ${head} emits all of them, `
    + 'so this trains only as a multi-embodiment mixture with one projector per embodiment — '
    + 'concatenating the datasets would feed the model vectors of two different meanings.');
}

function buildCameraAxis(datasets: CompatibilityDatasetInput[]): CompatibilityAxis {
  const keys = new Map(datasets.map((ds) => [ds.id, readCameraKeys(ds)]));
  const value = (ds: CompatibilityDatasetInput) => {
    const list = keys.get(ds.id)!;
    return list.length ? list.join(', ') : 'none';
  };
  const sets = [...keys.values()];
  const shared = sets.reduce<string[]>(
    (acc, list) => acc.filter((k) => list.includes(k)),
    sets[0] ?? [],
  );
  const identical = distinct(sets.map((s) => s.join('|'))).length === 1;

  if (identical) {
    const only = sets[0] ?? [];
    return axis('cameraKeys', 'Camera keys', 'match', datasets, value,
      only.length
        ? `All members expose ${only.join(', ')}, so one vision encoder sees the same views everywhere.`
        : 'No member has a camera feature, so this is a state-only mixture and no vision head is involved.');
  }
  if (shared.length === 0) {
    return axis('cameraKeys', 'Camera keys', 'differs', datasets, value,
      'The members share no camera key at all, so a vision policy has no view common to the whole '
      + 'mixture — it needs either a per-embodiment vision head or a decision about which view maps '
      + 'onto which.');
  }
  return axis('cameraKeys', 'Camera keys', 'differs', datasets, value,
    `Only ${shared.join(', ')} is present in every member; the other views exist in some datasets and `
    + 'not others, so the run either drops them or trains a head on frames it will not always get.');
}

function buildStatusAxis(datasets: CompatibilityDatasetInput[]): CompatibilityAxis {
  const value = (ds: CompatibilityDatasetInput) => ds.status;
  const broken = datasets.filter((ds) => ds.status !== 'ready');
  if (broken.length === 0) {
    return axis('status', 'Dataset status', 'match', datasets, value,
      'Every member is ready, so the files a run would open have been accounted for.');
  }
  return axis('status', 'Dataset status', 'blocking', datasets, value,
    `${broken.map((d) => `${d.name} is ${d.status}`).join('; ')} — a dataset that is not ready has not `
    + 'been shown to hold the files its manifest names, so a run started now fails when the loader '
    + 'opens it, not when it is submitted.');
}

function buildVersionAxis(datasets: CompatibilityDatasetInput[]): CompatibilityAxis {
  const value = (ds: CompatibilityDatasetInput) => ds.lerobotVersion || 'unknown';
  const versions = distinct(datasets.map(value));
  if (versions.length === 1) {
    return axis('lerobotVersion', 'LeRobot version', 'match', datasets, value,
      `Every member is ${versions[0]}, so one reader loads the whole mixture.`);
  }
  return axis('lerobotVersion', 'LeRobot version', 'differs', datasets, value,
    `The mixture spans ${versions.join(' and ')}; each dataset is loaded by the reader for its own `
    + 'version, which costs nothing at training time but means the run needs both readers installed.');
}

function buildRobotTypeAxis(datasets: CompatibilityDatasetInput[]): CompatibilityAxis {
  const value = robotTypeLabel;
  const labels = distinct(datasets.map(value));
  if (labels.length === 1) {
    return axis('robotType', 'Robot type', 'match', datasets, value,
      `Every member was recorded on ${labels[0]}, so one embodiment tag covers the run.`);
  }
  return axis('robotType', 'Robot type', 'differs', datasets, value,
    `The members come from ${labels.join(' and ')}; the run needs one embodiment tag per member and a `
    + 'policy that can carry more than one, and the resulting model is not a drop-in for either robot alone.');
}

function headlineFor(
  verdict: CompatibilityVerdict,
  datasets: CompatibilityDatasetInput[],
  axes: CompatibilityAxis[],
): { headline: string; recommendation: string } {
  const n = datasets.length;
  const blocking = axes.filter((a) => a.verdict === 'blocking');
  const differing = axes.filter((a) => a.verdict === 'differs');

  switch (verdict) {
    case 'incompatible':
      return {
        headline:
          `These ${n} datasets cannot be trained together: `
          + blocking.map((a) => `${a.label.toLowerCase()} is blocking`).join(', ') + '.',
        recommendation: blocking.map((a) => a.note).join(' '),
      };
    case 'multi_embodiment': {
      const widths = axes.filter(
        (a) => (a.axis === 'actionWidth' || a.axis === 'stateWidth') && a.verdict === 'differs',
      );
      const named = widths.map((a) => a.label.toLowerCase()).join(' and ');
      // An unrecorded width and a genuinely different one lead to the same
      // verdict but not to the same next action, and telling an operator their
      // data is multi-embodiment when the truth is that nobody has looked is
      // how a report stops being believed.
      const unproven = widths.some((a) => a.values.some((v) => v.value === 'unknown'));
      return {
        headline: unproven
          ? `These ${n} datasets cannot be shown to share an action space — ${named} is unrecorded for at `
            + 'least one member, so they have to be treated as a multi-embodiment mixture until it is.'
          : `These ${n} datasets have different ${named} — they are trainable as a multi-embodiment `
            + 'mixture, never as one concatenated dataset.',
        recommendation: unproven
          ? 'Validate the members with no recorded width; that turns this into a real answer and may '
            + 'well make the mixture concatenable. Until then, train with per-embodiment projectors.'
          : 'Train with a base model that carries per-embodiment projectors (GR00T N1.x) and tag each '
            + 'member with its own embodiment. If you wanted one shared action head, drop all but one '
            + 'embodiment from the mixture instead.',
      };
    }
    case 'compatible':
      return {
        headline:
          `These ${n} datasets can be concatenated; they differ only in `
          + differing.map((a) => a.label.toLowerCase()).join(', ') + '.',
        recommendation:
          'Nothing here changes the tensors the model sees. Read the notes below so the differences '
          + 'are a decision rather than a surprise.',
      };
    default:
      return {
        headline:
          n === 1
            ? 'One dataset: nothing to reconcile, it trains on its own.'
            : `All ${n} datasets share one embodiment, frame rate and camera set — they concatenate cleanly.`,
        recommendation:
          n === 1
            ? 'Add a second dataset to see what mixing them would cost.'
            : 'Train them as one dataset; weights still control how much of each the sampler draws.',
      };
  }
}

/**
 * The axes, reduced to one verdict — in strict precedence.
 *
 * The width check sits ABOVE the general "something differs" case on purpose:
 * a mixture that differs only in name is `compatible`, but one whose action
 * spaces differ is `multi_embodiment`, and calling that merely "compatible"
 * would let somebody concatenate two datasets that must not be concatenated.
 */
function rollUp(axes: CompatibilityAxis[]): CompatibilityVerdict {
  if (axes.some((a) => a.verdict === 'blocking')) return 'incompatible';
  const widthDiffers = axes.some(
    (a) => (a.axis === 'stateWidth' || a.axis === 'actionWidth') && a.verdict === 'differs',
  );
  if (widthDiffers) return 'multi_embodiment';
  if (axes.some((a) => a.verdict === 'differs')) return 'compatible';
  return 'identical';
}

/**
 * Judge a set of datasets.
 *
 * A single dataset is a legal input and produces the same axes, so the UI can
 * show the same panel before the second dataset is chosen.
 */
export function analyzeCompatibility(
  datasets: CompatibilityDatasetInput[],
): CompatibilityReport {
  if (datasets.length === 0) {
    throw new Error('analyzeCompatibility needs at least one dataset');
  }

  const axes: CompatibilityAxis[] = [
    buildStatusAxis(datasets),
    buildVersionAxis(datasets),
    buildRobotTypeAxis(datasets),
    buildFpsAxis(datasets),
    buildWidthAxis('stateWidth', 'State width', datasets),
    buildWidthAxis('actionWidth', 'Action width', datasets),
    buildCameraAxis(datasets),
  ];

  const verdict = rollUp(axes);

  return {
    datasetIds: datasets.map((d) => d.id),
    verdict,
    ...headlineFor(verdict, datasets, axes),
    axes,
  };
}

/**
 * A mixture this refused.
 *
 * Lives here rather than beside the submission code because the refusal is the
 * analyzer's, and because a route needs to recognise it without importing the
 * whole job service. Carries the whole report, not just the sentence: the
 * caller shows the headline AND the axis that blocked, and neither is
 * reconstructable from a message string.
 */
export class MixtureIncompatibleError extends Error {
  constructor(readonly report: CompatibilityReport) {
    super(report.headline);
    this.name = 'MixtureIncompatibleError';
  }
}

/**
 * A request naming a dataset that is not in the database.
 *
 * Separate from a generic failure because the caller answers it differently: a
 * missing id is a 404-shaped mistake in the request, not a verdict about data.
 */
export class UnknownDatasetError extends Error {
  constructor(readonly datasetIds: string[]) {
    super(`Unknown dataset${datasetIds.length > 1 ? 's' : ''}: ${datasetIds.join(', ')}`);
    this.name = 'UnknownDatasetError';
  }
}

/**
 * Read the rows and judge them, in the order the caller asked for.
 *
 * Order matters downstream: member 0 of a mixture becomes the job's
 * `datasetId`, and `findMany` does not promise to return the ids in the order
 * they were given.
 */
export async function analyzeDatasetIds(datasetIds: string[]): Promise<CompatibilityReport> {
  if (datasetIds.length === 0) {
    throw new Error('datasetIds must name at least one dataset');
  }
  if (datasetIds.length > MAX_MIXTURE_MEMBERS) {
    throw new Error(
      `A mixture may hold at most ${MAX_MIXTURE_MEMBERS} datasets; ${datasetIds.length} were given`,
    );
  }
  // Refused here rather than at the insert, where the (trainingJobId,
  // datasetId) unique constraint surfaces as a Prisma error code.
  const duplicates = datasetIds.filter((id, i) => datasetIds.indexOf(id) !== i);
  if (duplicates.length > 0) {
    throw new Error(
      `A dataset can appear in a mixture only once; ${[...new Set(duplicates)].join(', ')} is repeated. `
      + 'Raise its weight instead of listing it twice.',
    );
  }

  const rows = await prisma.dataset.findMany({
    where: { id: { in: datasetIds } },
    include: { robotType: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const missing = datasetIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new UnknownDatasetError(missing);
  }

  return analyzeCompatibility(
    datasetIds.map((id) => {
      const row = byId.get(id)!;
      return {
        id: row.id,
        name: row.name,
        status: row.status,
        fps: row.fps,
        lerobotVersion: row.lerobotVersion,
        robotTypeId: row.robotTypeId,
        robotTypeName: row.robotType?.name ?? null,
        infoJson: row.infoJson,
        validationJson: row.validationJson,
      };
    }),
  );
}
