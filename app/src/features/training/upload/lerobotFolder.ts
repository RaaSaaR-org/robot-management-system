/**
 * @file lerobotFolder.ts
 * @description Reads a LeRobot dataset folder the user picked or dropped: finds
 *              the dataset root, builds the manifest the upload API accepts,
 *              and says what the folder holds — or why it is not a dataset —
 *              before a byte is sent (TASK-481).
 * @feature training
 *
 * The rules here are the server's own start rules (`docs/dataset-upload.md`,
 * "What may be uploaded"), applied early so the user reads them next to the
 * folder they just picked rather than as a refusal.
 */

// ============================================================================
// TYPES
// ============================================================================

/** One file of the picked folder, with its path relative to what was picked. */
export interface PickedFile {
  /** Forward slashes, no leading slash — `my-dataset/meta/info.json` */
  path: string;
  file: File;
}

/** One file that will be uploaded, with its path relative to the dataset root. */
export interface ManifestFile {
  /** `meta/info.json`, `videos/observation.images.head/chunk-000/file-000.mp4` */
  path: string;
  file: File;
  size: number;
}

export interface FolderSummary {
  /** `v3.0` */
  version: string | null;
  robotType: string | null;
  episodes: number | null;
  frames: number | null;
  fps: number | null;
  /** Camera feature keys with `observation.images.` stripped */
  cameras: string[];
  actionWidth: number | null;
  stateWidth: number | null;
}

export interface FolderInspection {
  /** The dataset root's own name, the default dataset name */
  rootName: string;
  /** Files the server stores, relative to the dataset root */
  files: ManifestFile[];
  totalBytes: number;
  /** Files in the folder that are not part of a LeRobot tree and stay behind */
  skipped: number;
  /** The parsed `meta/info.json`, sent with the start request */
  info: Record<string, unknown> | null;
  summary: FolderSummary;
  /** Reasons this folder cannot be uploaded. Empty means it can. */
  problems: string[];
  /** Things worth knowing that do not stop the upload */
  warnings: string[];
}

// ============================================================================
// PATH RULES
// ============================================================================

/**
 * Whether the upload API stores this path (relative to the dataset root).
 * The same four rules the Hugging Face importer selects by.
 */
export function isDatasetFile(path: string): boolean {
  if (path.startsWith('meta/')) return path.length > 'meta/'.length;
  if (path.startsWith('data/')) return path.endsWith('.parquet');
  if (path.startsWith('videos/')) return path.endsWith('.mp4');
  if (path.startsWith('images/')) return path.length > 'images/'.length;
  return false;
}

/**
 * A path the server would refuse the whole request for (`INVALID_PATH`).
 * Such a file is left behind rather than declared.
 */
function isRefusedPath(path: string): boolean {
  if (path.length === 0 || path.length > 1024) return true;
  if (path.includes('\\') || /[\u0000-\u001f\u007f]/.test(path)) return true;
  return path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');
}

const normalize = (path: string): string => path.replace(/^\/+/, '');

// ============================================================================
// COLLECTING FILES
// ============================================================================

/** Files of an `<input type="file" webkitdirectory>` selection. */
export function filesFromInput(list: FileList | File[]): PickedFile[] {
  return Array.from(list).map((file) => ({
    // Empty when the input was not a directory input: the bare name then.
    path: normalize((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name),
    file,
  }));
}

/** The subset of the File and Directory Entries API this module walks. */
export interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (ok: (file: File) => void, fail: (error: unknown) => void) => void;
  createReader?: () => { readEntries: (ok: (entries: FsEntry[]) => void, fail: (error: unknown) => void) => void };
}

/**
 * The entries of a drop. Must be called inside the `drop` handler, before
 * anything is awaited: the browser empties `dataTransfer.items` afterwards.
 */
export function entriesFromDrop(dataTransfer: DataTransfer | null): FsEntry[] {
  const entries: FsEntry[] = [];
  for (const item of Array.from(dataTransfer?.items ?? [])) {
    if (item.kind !== 'file') continue;
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  return entries;
}

/** Every file under the dropped entries, depth first. */
export async function filesFromEntries(entries: FsEntry[]): Promise<PickedFile[]> {
  const out: PickedFile[] = [];
  const walk = async (entry: FsEntry): Promise<void> => {
    if (entry.isFile && entry.file) {
      const file = await new Promise<File>((ok, fail) => entry.file!(ok, fail));
      out.push({ path: normalize(entry.fullPath || entry.name), file });
      return;
    }
    if (!entry.isDirectory || !entry.createReader) return;
    const reader = entry.createReader();
    // `readEntries` answers in batches (100 in Chrome) and has to be asked
    // again until it answers with nothing.
    for (;;) {
      const batch = await new Promise<FsEntry[]>((ok, fail) => reader.readEntries(ok, fail));
      if (batch.length === 0) break;
      for (const child of batch) await walk(child);
    }
  };
  for (const entry of entries) await walk(entry);
  return out;
}

// ============================================================================
// INSPECTION
// ============================================================================

const EMPTY_SUMMARY: FolderSummary = {
  version: null, robotType: null, episodes: null, frames: null, fps: null,
  cameras: [], actionWidth: null, stateWidth: null,
};

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function featureWidth(features: Record<string, unknown>, key: string): number | null {
  const shape = (features[key] as { shape?: unknown } | undefined)?.shape;
  return Array.isArray(shape) ? asNumber(shape[0]) : null;
}

/** What `meta/info.json` says about the dataset. */
export function summarizeInfo(info: Record<string, unknown>): FolderSummary {
  const features = (info.features && typeof info.features === 'object' ? info.features : {}) as Record<string, unknown>;
  const cameras = Object.entries(features)
    .filter(([, feature]) => {
      const dtype = (feature as { dtype?: unknown } | null)?.dtype;
      return dtype === 'video' || dtype === 'image';
    })
    .map(([key]) => key.replace(/^observation\.images?\./, ''));
  return {
    version: typeof info.codebase_version === 'string' ? info.codebase_version : null,
    robotType: typeof info.robot_type === 'string' && info.robot_type ? info.robot_type : null,
    episodes: asNumber(info.total_episodes),
    frames: asNumber(info.total_frames),
    fps: asNumber(info.fps),
    cameras,
    actionWidth: featureWidth(features, 'action'),
    stateWidth: featureWidth(features, 'observation.state'),
  };
}

/**
 * Look at what was picked and decide whether it is a LeRobot dataset.
 * Reads one file (`meta/info.json`); everything else is judged by its path.
 */
export async function inspectFolder(picked: PickedFile[]): Promise<FolderInspection> {
  const topName = picked[0]?.path.split('/')[0] ?? '';
  const base: FolderInspection = {
    rootName: topName, files: [], totalBytes: 0, skipped: picked.length,
    info: null, summary: EMPTY_SUMMARY, problems: [], warnings: [],
  };

  if (picked.length === 0) {
    return { ...base, problems: ['The folder is empty.'] };
  }

  // The dataset root is wherever `meta/info.json` sits — the folder itself or,
  // when its parent was picked, one level down. The shallowest one wins.
  const candidates = picked
    .filter((p) => p.path === 'meta/info.json' || p.path.endsWith('/meta/info.json'))
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path));
  if (candidates.length === 0) {
    const archive = picked.length === 1 && /\.(zip|tgz|tar|gz)$/i.test(picked[0].path);
    return {
      ...base,
      problems: [archive
        ? 'This is an archive. Unpack it and pick the dataset folder — the one that contains meta/ and data/.'
        : 'No meta/info.json in this folder, so it is not a LeRobot dataset. Pick the folder that contains meta/ and data/.'],
    };
  }

  const infoPath = candidates[0].path;
  const prefix = infoPath.slice(0, infoPath.length - 'meta/info.json'.length);
  const rootName = prefix.replace(/\/$/, '').split('/').pop() || topName || 'dataset';
  const warnings: string[] = [];
  const problems: string[] = [];
  if (candidates.length > 1) {
    warnings.push(`This folder holds ${candidates.length} datasets. Only "${rootName}" is uploaded — pick another one's own folder to upload it.`);
  }

  const files: ManifestFile[] = [];
  let skipped = 0;
  for (const p of picked) {
    const rel = p.path.startsWith(prefix) ? p.path.slice(prefix.length) : null;
    if (rel === null || !isDatasetFile(rel) || isRefusedPath(rel)) { skipped += 1; continue; }
    files.push({ path: rel, file: p.file, size: p.file.size });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);

  let info: Record<string, unknown> | null = null;
  try {
    const text = await candidates[0].file.text();
    if (text.trim() === '') {
      problems.push('meta/info.json is empty.');
    } else {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) info = parsed as Record<string, unknown>;
      else problems.push('meta/info.json is not a JSON object.');
    }
  } catch {
    problems.push('meta/info.json is not valid JSON.');
  }

  const summary = info ? summarizeInfo(info) : EMPTY_SUMMARY;
  if (info) {
    if (!summary.version) {
      problems.push('meta/info.json has no codebase_version.');
    } else if (!/^v[23]\./.test(summary.version)) {
      problems.push(`LeRobot ${summary.version} is not supported — the instance takes v2.x and v3.0 datasets.`);
    }
    if (!summary.robotType) problems.push('meta/info.json has no robot_type.');
    if (!summary.fps || summary.fps <= 0) problems.push('meta/info.json has no positive fps.');
    if (!info.features || typeof info.features !== 'object' || Object.keys(info.features).length === 0) {
      problems.push('meta/info.json lists no features.');
    }
  }

  const has = (test: (path: string) => boolean) => files.some((f) => test(f.path));
  if (!has((p) => p.startsWith('data/') && p.endsWith('.parquet'))) {
    problems.push('No episode tables: data/ holds no .parquet file.');
  }
  if (summary.version?.startsWith('v3.')) {
    if (!has((p) => p.startsWith('meta/episodes/') && p.endsWith('.parquet'))) {
      problems.push('No episode index: a v3.0 dataset needs meta/episodes/**/*.parquet.');
    }
  } else if (summary.version?.startsWith('v2.')) {
    if (!has((p) => p === 'meta/episodes.jsonl' || p === 'meta/episodes.json')) {
      problems.push('No episode index: a v2.x dataset needs meta/episodes.jsonl.');
    }
  }

  const hasCameraFiles = has((p) => p.startsWith('videos/') || p.startsWith('images/'));
  if (summary.cameras.length > 0 && !hasCameraFiles) {
    warnings.push(
      `The dataset declares ${summary.cameras.length === 1 ? 'a camera' : `${summary.cameras.length} cameras`} but the folder has no videos/ — it is uploaded as tables only, without video.`,
    );
  }

  return { rootName, files, totalBytes, skipped, info, summary, problems, warnings };
}
