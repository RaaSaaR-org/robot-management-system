/**
 * @file datasetMeta.ts
 * @description The two meta files a GR00T-style LeRobot v2.1 dataset carries
 *              instead of what the rest of this code expects: per-episode
 *              statistics (`meta/episodes_stats.jsonl`) in place of
 *              `meta/stats.json`, and the joint groups of its state and action
 *              vectors (`meta/modality.json`) in place of per-channel `names`.
 * @feature training
 *
 * Both are pure parsers over file text, so they answer the same for a dataset
 * on this disk and one in RustFS — the caller reads through a `DatasetTree`.
 */

/** Where a v2.1 dataset keeps its per-episode statistics. */
export const EPISODE_STATS_PATH = 'meta/episodes_stats.jsonl';
/** Where a GR00T-style dataset names the joint groups of its vectors. */
export const MODALITY_PATH = 'meta/modality.json';

/** One feature's statistics, in the shape `meta/stats.json` stores them. */
export interface FeatureStats {
  min: unknown;
  max: unknown;
  mean: unknown;
  std: unknown;
  count: number[];
}

export type DatasetStats = Record<string, FeatureStats>;

export interface AggregatedEpisodeStats {
  stats: DatasetStats;
  /** Episode rows that were read. */
  episodes: number;
  /** Lines that were not a JSON object with a `stats` map. */
  skippedLines: number;
}

interface FlatEpisodeStats {
  min: number[];
  max: number[];
  mean: number[];
  std: number[];
  count: number;
}

const STAT_KEYS = ['min', 'max', 'mean', 'std'] as const;

/** A numeric array of any nesting, flattened; null when it holds anything else. */
function flatNumbers(value: unknown): number[] | null {
  if (!Array.isArray(value)) return typeof value === 'number' && Number.isFinite(value) ? [value] : null;
  const flat = (value as unknown[]).flat(Infinity);
  return flat.length > 0 && flat.every((v) => typeof v === 'number' && Number.isFinite(v))
    ? (flat as number[])
    : null;
}

/** `values` poured back into the nesting of `template` (image stats are `[[[r]], [[g]], [[b]]]`). */
function reshapeLike(template: unknown, values: number[]): unknown {
  let cursor = 0;
  const walk = (node: unknown): unknown => (Array.isArray(node) ? node.map(walk) : values[cursor++]);
  return Array.isArray(template) ? walk(template) : values;
}

function flatEpisodeStats(raw: unknown): FlatEpisodeStats | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const [min, max, mean, std] = STAT_KEYS.map((key) => flatNumbers(record[key]));
  const count = flatNumbers(record.count)?.[0];
  if (!min || !max || !mean || !std || count === undefined || count <= 0) return null;
  if (max.length !== min.length || mean.length !== min.length || std.length !== min.length) return null;
  return { min, max, mean, std, count };
}

/**
 * Dataset-wide statistics from the per-episode ones of a v2.1 dataset.
 *
 * The same arithmetic as LeRobot's `aggregate_feature_stats`
 * (`lerobot/datasets/compute_stats.py`): min of mins, max of maxes, a
 * count-weighted mean, and a standard deviation pooled through the law of total
 * variance — each episode contributes its own variance plus the squared
 * distance of its mean from the overall mean, weighted by its frame count.
 *
 * An episode whose entry for a feature is malformed, or a different width from
 * the first one seen, is left out of that feature rather than failing the file.
 */
export function aggregateEpisodeStats(jsonl: string): AggregatedEpisodeStats {
  const perFeature = new Map<string, { template: unknown; rows: FlatEpisodeStats[] }>();
  let episodes = 0;
  let skippedLines = 0;

  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    let stats: unknown;
    try {
      stats = (JSON.parse(line) as { stats?: unknown } | null)?.stats;
    } catch {
      stats = undefined;
    }
    if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
      skippedLines += 1;
      continue;
    }
    episodes += 1;
    for (const [feature, raw] of Object.entries(stats as Record<string, unknown>)) {
      const flat = flatEpisodeStats(raw);
      if (!flat) continue;
      const seen = perFeature.get(feature);
      if (!seen) {
        perFeature.set(feature, { template: (raw as { mean: unknown }).mean, rows: [flat] });
      } else if (seen.rows[0]!.min.length === flat.min.length) {
        seen.rows.push(flat);
      }
    }
  }

  const stats: DatasetStats = {};
  for (const [feature, { template, rows }] of perFeature) {
    const width = rows[0]!.min.length;
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    const min = new Array<number>(width).fill(Infinity);
    const max = new Array<number>(width).fill(-Infinity);
    const mean = new Array<number>(width).fill(0);
    const variance = new Array<number>(width).fill(0);
    for (const row of rows) {
      for (let i = 0; i < width; i += 1) {
        if (row.min[i]! < min[i]!) min[i] = row.min[i]!;
        if (row.max[i]! > max[i]!) max[i] = row.max[i]!;
        mean[i]! += (row.mean[i]! * row.count) / total;
      }
    }
    for (const row of rows) {
      for (let i = 0; i < width; i += 1) {
        const delta = row.mean[i]! - mean[i]!;
        variance[i]! += ((row.std[i]! ** 2 + delta ** 2) * row.count) / total;
      }
    }
    stats[feature] = {
      min: reshapeLike(template, min),
      max: reshapeLike(template, max),
      mean: reshapeLike(template, mean),
      std: reshapeLike(template, variance.map(Math.sqrt)),
      count: [total],
    };
  }
  return { stats, episodes, skippedLines };
}

/** A named slice `[start, end)` of a state or action vector. */
export interface ChannelGroup {
  name: string;
  start: number;
  end: number;
}

/** The joint groups of a dataset's `observation.state` and `action` vectors. */
export interface DatasetModality {
  state: ChannelGroup[];
  action: ChannelGroup[];
}

function vectorWidth(info: unknown, feature: string): number | null {
  const shape = (info as { features?: Record<string, { shape?: unknown }> } | null)?.features?.[feature]?.shape;
  const width = Array.isArray(shape) ? shape[0] : undefined;
  return typeof width === 'number' && width > 0 ? width : null;
}

function groupsOf(section: unknown, feature: string, width: number | null): ChannelGroup[] {
  if (!section || typeof section !== 'object' || Array.isArray(section)) return [];
  const groups: ChannelGroup[] = [];
  for (const [name, raw] of Object.entries(section as Record<string, unknown>)) {
    const entry = raw as { start?: unknown; end?: unknown; original_key?: unknown } | null;
    if (!entry || typeof entry !== 'object') continue;
    // An entry with `original_key` indexes into ANOTHER column
    // (`action.effort_left_leg`, 0..6), not into the vector being labelled.
    if (entry.original_key !== undefined && entry.original_key !== feature) continue;
    const { start, end } = entry;
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
    if ((start as number) < 0 || (end as number) <= (start as number)) continue;
    if (width !== null && (end as number) > width) continue;
    groups.push({ name, start: start as number, end: end as number });
  }
  groups.sort((a, b) => a.start - b.start);
  // Two names for one channel would label it twice; the earlier slice keeps it.
  const kept: ChannelGroup[] = [];
  for (const group of groups) {
    const previous = kept[kept.length - 1];
    if (!previous || group.start >= previous.end) kept.push(group);
  }
  return kept;
}

/**
 * The state and action joint groups out of a GR00T `meta/modality.json`.
 *
 * `info`, when given, is the dataset's `info.json`: a group that reaches past
 * the declared width of the vector is dropped. Returns null when the file
 * names no usable group at all, so a caller can treat it as absent.
 */
export function parseModality(json: unknown, info?: unknown): DatasetModality | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const { state, action } = json as { state?: unknown; action?: unknown };
  const modality: DatasetModality = {
    state: groupsOf(state, 'observation.state', vectorWidth(info, 'observation.state')),
    action: groupsOf(action, 'action', vectorWidth(info, 'action')),
  };
  return modality.state.length > 0 || modality.action.length > 0 ? modality : null;
}
