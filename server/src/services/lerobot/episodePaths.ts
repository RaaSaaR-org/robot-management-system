/**
 * @file episodePaths.ts
 * @description Where a LeRobot v2.x dataset keeps one episode's parquet and videos
 * @feature datasets
 *
 * LeRobot v2.1 writes one parquet and one mp4 per episode, grouped into chunk
 * directories: episode N lives in chunk `floor(N / chunks_size)`, with
 * `chunks_size` (default 1000) and the path templates in `meta/info.json`.
 * Every reader of such a tree — object storage, the server's disk, the
 * curation frame sampler — asks this file, so none of them can assume
 * `chunk-000` on its own (TASK-479).
 */

/** The fields of `meta/info.json` that place an episode's files. */
export interface EpisodePathInfo {
  chunks_size?: number;
  data_path?: string | null;
  video_path?: string | null;
}

export const DEFAULT_CHUNKS_SIZE = 1000;
export const V2_DATA_PATH = 'data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet';
/** Standard LeRobot v2.1 order: chunk directory first. */
export const V2_VIDEO_PATH = 'videos/chunk-{episode_chunk:03d}/{video_key}/episode_{episode_index:06d}.mp4';
/** The order the Cosmos and neural-trajectory converters write: camera key first. */
export const V2_VIDEO_PATH_KEY_FIRST = 'videos/{video_key}/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.mp4';

/**
 * Expand a LeRobot path template such as
 * `data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet`.
 * A placeholder with no value is left as it is.
 */
export function formatPathTemplate(template: string, vars: Record<string, number | string>): string {
  return template.replace(/\{(\w+)(?::0?(\d+)d)?\}/g, (whole, name: string, width?: string) => {
    if (!(name in vars)) return whole;
    const value = String(vars[name]);
    return width ? value.padStart(Number(width), '0') : value;
  });
}

/** Episodes per chunk directory: `info.chunks_size` when it is a positive number, else 1000. */
export function chunksSizeOf(info: EpisodePathInfo | null | undefined): number {
  const size = Number(info?.chunks_size);
  return Number.isFinite(size) && size >= 1 ? Math.floor(size) : DEFAULT_CHUNKS_SIZE;
}

/** The chunk directory index of an episode. */
export function episodeChunkOf(info: EpisodePathInfo | null | undefined, episodeIndex: number): number {
  return Math.floor(episodeIndex / chunksSizeOf(info));
}

/** A per-episode (v2.x) template, as opposed to a v3.0 `{chunk_index}/{file_index}` one. */
function perEpisodeTemplate(template: string | null | undefined): string | null {
  return typeof template === 'string' && template.includes('{episode_index') ? template : null;
}

/**
 * A relative path that stays inside the dataset: no absolute path, no `..`
 * segment, no placeholder left unexpanded. `info.json` is data from disk or
 * from a foreign repository, so its templates are not trusted to stay put.
 */
function isContainedPath(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\\') || /^[A-Za-z]:/.test(path)) return false;
  if (path.includes('{') || path.includes('}')) return false;
  return !path.split('/').some((segment) => segment === '..' || segment === '');
}

function unique(paths: string[]): string[] {
  return [...new Set(paths)].filter(isContainedPath);
}

/**
 * The parquet of one episode, relative to the dataset root: the path
 * `info.data_path` and `info.chunks_size` name.
 */
export function episodeDataPath(info: EpisodePathInfo | null | undefined, episodeIndex: number): string {
  return formatPathTemplate(perEpisodeTemplate(info?.data_path) ?? V2_DATA_PATH, {
    episode_chunk: episodeChunkOf(info, episodeIndex),
    episode_index: episodeIndex,
  });
}

/**
 * Every place the parquet of one episode may be, most likely first:
 * the path `info.json` names, the standard path for the episode's chunk, and
 * `chunk-000` — the v3.0 converter once kept every episode there whatever
 * `chunks_size` it declared, and such a tree may still be on disk.
 */
export function episodeDataCandidates(info: EpisodePathInfo | null | undefined, episodeIndex: number): string[] {
  const vars = { episode_chunk: episodeChunkOf(info, episodeIndex), episode_index: episodeIndex };
  return unique([
    episodeDataPath(info, episodeIndex),
    formatPathTemplate(V2_DATA_PATH, vars),
    formatPathTemplate(V2_DATA_PATH, { ...vars, episode_chunk: 0 }),
  ]);
}

/**
 * Every place the mp4 of one episode and camera may be, most likely first:
 * the path `info.video_path` names, then both directory orders in use
 * (chunk-first and key-first) for the episode's chunk, then for `chunk-000`.
 *
 * `videoKey` is the full feature key (`observation.images.top`); the caller
 * has already checked that it is a plain identifier.
 */
export function episodeVideoCandidates(
  info: EpisodePathInfo | null | undefined,
  videoKey: string,
  episodeIndex: number,
): string[] {
  const vars = {
    episode_chunk: episodeChunkOf(info, episodeIndex),
    episode_index: episodeIndex,
    video_key: videoKey,
  };
  const legacy = { ...vars, episode_chunk: 0 };
  const template = perEpisodeTemplate(info?.video_path);
  return unique([
    ...(template ? [formatPathTemplate(template, vars)] : []),
    formatPathTemplate(V2_VIDEO_PATH, vars),
    formatPathTemplate(V2_VIDEO_PATH_KEY_FIRST, vars),
    formatPathTemplate(V2_VIDEO_PATH, legacy),
    formatPathTemplate(V2_VIDEO_PATH_KEY_FIRST, legacy),
  ]);
}
