/**
 * @file datasetCard.ts
 * @description The README.md a NeoDEM-published dataset carries on the Hugging
 *              Face Hub: LeRobot-style front matter plus what the recording is.
 * @feature datasets
 *
 * A card is the first thing anyone (or any loader) reads about a dataset repo,
 * so it is built from the files being uploaded, never from what the row in our
 * database hopes they contain: fps, episode and frame counts, cameras and
 * feature shapes come out of `meta/info.json`, task instructions out of
 * `meta/tasks.jsonl`. When a value is not there the card says "unknown" rather
 * than guessing.
 *
 * Front matter follows the cards `lerobot`'s own `push_to_hub` writes —
 * `task_categories: robotics`, a `LeRobot` tag and a `configs` entry pointing
 * at the parquet files — so the Hub's dataset viewer and `LeRobotDataset`
 * both find the data without a hand-written card.
 *
 * {@link NEODEM_CARD_MARKER} is how a later publish knows it may replace the
 * card: a card without it was written by a person and is kept.
 */

/** Present in every generated card; absent means a person wrote it. */
export const NEODEM_CARD_MARKER = '<!-- generated-by: neodem dataset publish -->';

export interface DatasetCardInput {
  repoId: string;
  datasetName: string;
  description?: string;
  license: string;
  tags: string[];
  /** Parsed `meta/info.json`; `{}` when it could not be read. */
  info: Record<string, unknown>;
  /** One instruction per task, in task_index order. */
  tasks: string[];
  /** Robot type as the database names it, used when info.json has none. */
  robotTypeName?: string | null;
  publishedAt: string;
}

interface FeatureSpec {
  dtype?: unknown;
  shape?: unknown;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** YAML-safe scalar: quoted unless it is a plain identifier. */
function yamlScalar(value: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) ? value : JSON.stringify(value);
}

/** Markdown table cell: no pipes or newlines. */
function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
}

/** Hub size category for `size_categories`, from the frame count. */
export function sizeCategory(frames: number | null): string | null {
  if (frames === null) return null;
  if (frames < 1_000) return 'n<1K';
  if (frames < 10_000) return '1K<n<10K';
  if (frames < 100_000) return '10K<n<100K';
  if (frames < 1_000_000) return '100K<n<1M';
  return '1M<n<10M';
}

/** The robot type a card names: info.json first, the database's name second. */
export function cardRobotType(info: Record<string, unknown>, fallback?: string | null): string {
  return asString(info.robot_type) ?? asString(fallback) ?? 'unknown';
}

/** Hub tag form of a robot type: `Unitree_G1_Dex3` → `unitree_g1_dex3`. */
export function robotTag(robotType: string): string | null {
  const tag = robotType.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return tag && tag !== 'unknown' ? tag : null;
}

/** Deduplicated, case-insensitively, keeping the first spelling. */
export function mergeTags(...groups: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of groups.flat()) {
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** The tags every NeoDEM card carries, before the operator's own. */
export function defaultCardTags(robotType: string): string[] {
  return mergeTags(['LeRobot', 'neodem', 'teleoperation'], [robotTag(robotType) ?? ''].filter(Boolean));
}

/** Whether `info.json` says the data came out of a simulator. */
export function isSimulated(info: Record<string, unknown>): boolean | null {
  const neodem = info._neodem;
  if (neodem && typeof neodem === 'object') {
    const simulated = (neodem as Record<string, unknown>).simulated;
    if (typeof simulated === 'boolean') return simulated;
  }
  return null;
}

/** Build the README.md for a dataset repo. Pure: same input, same card. */
export function buildDatasetCard(input: DatasetCardInput): string {
  const { info } = input;
  const robotType = cardRobotType(info, input.robotTypeName);
  const fps = asNumber(info.fps);
  const episodes = asNumber(info.total_episodes);
  const frames = asNumber(info.total_frames);
  const version = asString(info.codebase_version) ?? 'unknown';
  const features = (info.features && typeof info.features === 'object'
    ? (info.features as Record<string, FeatureSpec>)
    : {}) as Record<string, FeatureSpec>;
  const cameras = Object.entries(features)
    .filter(([, spec]) => spec?.dtype === 'video' || spec?.dtype === 'image')
    .map(([key, spec]) => ({ key, shape: Array.isArray(spec.shape) ? spec.shape.join('×') : 'unknown' }));
  const simulated = isSimulated(info);
  const neodem = (info._neodem && typeof info._neodem === 'object' ? info._neodem : {}) as Record<string, unknown>;
  const tags = mergeTags(defaultCardTags(robotType), input.tags);
  const size = sizeCategory(frames);

  const front: string[] = ['---', `license: ${yamlScalar(input.license)}`, 'task_categories:', '- robotics', 'tags:'];
  for (const tag of tags) front.push(`- ${yamlScalar(tag)}`);
  if (size) front.push('size_categories:', `- ${yamlScalar(size)}`);
  front.push('configs:', '- config_name: default', '  data_files: data/*/*.parquet', '---');

  const provenance =
    simulated === true
      ? 'Simulation — recorded in NeoDEM\'s MuJoCo digital twin' +
        (asString(neodem.scene) ? ` (scene \`${asString(neodem.scene)}\`)` : '')
      : simulated === false
        ? 'Real robot — teleoperated on physical hardware'
        : 'Unknown — the recording does not say whether it is real or simulated';

  const body: string[] = [
    NEODEM_CARD_MARKER,
    '',
    `# ${input.datasetName}`,
    '',
    input.description?.trim() ||
      `Teleoperation demonstrations recorded with [NeoDEM](https://github.com/RaaSaaR-org/robot-management-system) in the LeRobot ${version} format.`,
    '',
    '## Tasks',
    '',
    ...(input.tasks.length > 0 ? input.tasks.map((task) => `- ${task.replace(/\s*\n\s*/g, ' ')}`) : ['- unknown']),
    '',
    '## Dataset summary',
    '',
    '| | |',
    '| --- | --- |',
    `| Robot type | \`${cell(robotType)}\` |`,
    `| Source | ${cell(provenance)} |`,
    `| Format | LeRobot \`${cell(version)}\` |`,
    `| Frame rate | ${fps !== null ? `${fps} fps` : 'unknown'} |`,
    `| Episodes | ${episodes !== null ? episodes : 'unknown'} |`,
    `| Frames | ${frames !== null ? frames : 'unknown'} |`,
    `| Cameras | ${cameras.length > 0 ? cameras.map((c) => `\`${cell(c.key)}\` (${c.shape})`).join(', ') : 'none'} |`,
    `| License | \`${cell(input.license)}\` |`,
    '',
  ];

  const featureRows = Object.entries(features);
  if (featureRows.length > 0) {
    body.push('## Features', '', '| Feature | dtype | shape |', '| --- | --- | --- |');
    for (const [key, spec] of featureRows) {
      const shape = Array.isArray(spec?.shape) ? `[${spec.shape.join(', ')}]` : 'unknown';
      body.push(`| \`${cell(key)}\` | ${cell(String(spec?.dtype ?? 'unknown'))} | ${shape} |`);
    }
    body.push('');
  }

  body.push(
    '## Usage',
    '',
    '```python',
    'from lerobot.datasets.lerobot_dataset import LeRobotDataset',
    '',
    `dataset = LeRobotDataset("${input.repoId}")`,
    '```',
    '',
    '## Provenance',
    '',
    `Recorded and published with NeoDEM, the open Physical AI platform, at ZeMA — Zentrum für Mechatronik und Automatisierungstechnik gGmbH. Published ${input.publishedAt}.`,
    '',
  );

  return `${front.join('\n')}\n\n${body.join('\n')}`;
}
