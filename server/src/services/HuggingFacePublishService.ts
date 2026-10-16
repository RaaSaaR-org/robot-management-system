/**
 * @file HuggingFacePublishService.ts
 * @description Publish a recorded LeRobot dataset from this server's disk to a
 *              Hugging Face Hub dataset repo, with a generated card, live
 *              progress and an audit entry.
 * @feature datasets
 *
 * WHY THIS REPLACED `push-to-hub` (TASK-394). The old route spawned a Python
 * script at a path that exists on one machine that is not this one, read the
 * files out of RustFS — which is down on every dev box, and which an
 * agent-recorded dataset never reaches — and took the Hub token in the request
 * body, i.e. through the browser. It could not publish a single dataset NeoDEM
 * records today.
 *
 * WHERE THE BYTES COME FROM. A dataset the robot agent records is a LeRobot
 * directory on local disk (`storagePath` is absolute). That directory is
 * uploaded as it is — `meta/`, `data/`, `videos/` — with `@huggingface/hub`,
 * which does the LFS/Xet transfer itself and needs no interpreter, venv or
 * system package. Nothing is staged and RustFS is not involved.
 *
 * THE TOKEN. The server's own credentials: `HF_TOKEN`, else the file at
 * `HF_TOKEN_PATH`, else `$HF_HOME/token`, else `~/.cache/huggingface/token` —
 * the file `hf auth login` writes, so a box that is logged in needs no extra
 * config. It is never returned, never logged, and scrubbed out of every error
 * message before one is kept.
 *
 * WHAT IS KEPT. The job lives in memory (one per dataset). The durable record
 * is the compliance log — start and outcome, with repo, commit and actor — plus
 * `huggingFaceRepoId` on rows that were not themselves imported from the Hub
 * (for those the column names the SOURCE, and overwriting it would erase where
 * the data came from).
 */

import { lstat, readFile, readdir } from 'fs/promises';
import { existsSync, readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { isAbsolute, join, posix } from 'path';
import { pathToFileURL } from 'url';
import * as hub from '@huggingface/hub';
import { datasetService } from './DatasetService.js';
import {
  buildDatasetCard,
  NEODEM_CARD_MARKER,
} from './huggingface/datasetCard.js';
import type { DatasetResponse } from '../types/dataset.types.js';

// ============================================================================
// TYPES
// ============================================================================

export type PublishPhase =
  | 'preparing'
  | 'creating_repo'
  | 'uploading'
  | 'committing'
  | 'done'
  | 'failed';

export interface PublishRequest {
  /** `<namespace>/<name>`, or a bare name that takes the default namespace. */
  repoId: string;
  private?: boolean;
  license?: string;
  tags?: string[];
  description?: string;
  /** Publish a dataset whose validation found errors anyway. */
  force?: boolean;
}

export interface PublishJob {
  datasetId: string;
  repoId: string;
  private: boolean;
  license: string;
  status: 'running' | 'done' | 'failed';
  phase: PublishPhase;
  message: string;
  filesTotal: number;
  filesDone: number;
  bytesTotal: number;
  bytesDone: number;
  /** Where the card came from: generated, the dataset's own README, or the Hub's (kept). */
  card: 'generated' | 'local' | 'kept' | null;
  /** True when this publish created the repo; false when it committed to an existing one. */
  repoCreated: boolean | null;
  url: string;
  commitOid?: string;
  commitUrl?: string;
  /** The LeRobot codebase-version tag set on the commit, e.g. `v3.0`. */
  versionTag?: string;
  warnings: string[];
  error?: string;
  forced: boolean;
  startedAt: string;
  finishedAt?: string;
}

export interface PublishStatus {
  configured: boolean;
  /** Where the token was found; never the token. */
  source: 'env' | 'file' | null;
  user: string | null;
  orgs: string[];
  defaultNamespace: string | null;
  error?: string;
}

/** The slice of `@huggingface/hub` this service uses — injectable for tests. */
export interface HubClient {
  whoAmI(params: { accessToken: string; hubUrl?: string }): Promise<{ name: string; type: string; orgs?: { name: string }[] }>;
  repoExists(params: { repo: hub.RepoDesignation; accessToken: string; hubUrl?: string }): Promise<boolean>;
  createRepo(params: {
    repo: hub.RepoDesignation;
    accessToken: string;
    visibility: 'public' | 'private';
    license?: string;
    hubUrl?: string;
  }): Promise<{ repoUrl: string }>;
  downloadFile(params: { repo: hub.RepoDesignation; path: string; accessToken: string; hubUrl?: string }): Promise<Blob | null>;
  uploadFilesWithProgress(params: {
    repo: hub.RepoDesignation;
    accessToken: string;
    files: Array<{ path: string; content: Blob | URL }>;
    commitTitle: string;
    commitDescription?: string;
    hubUrl?: string;
  }): AsyncGenerator<hub.CommitProgressEvent, hub.CommitOutput | undefined>;
  /** Point `tag` at `revision`, moving it when it already exists. */
  replaceTag(params: {
    repo: hub.RepoDesignation;
    tag: string;
    revision: string;
    message?: string;
    accessToken: string;
    hubUrl?: string;
  }): Promise<void>;
}

export interface PublishServiceOptions {
  hub?: HubClient;
  env?: NodeJS.ProcessEnv;
  home?: string;
  now?: () => Date;
}

/**
 * Why a publish was refused. Carries the HTTP status and a stable code, so the
 * service decides and the route only reports.
 */
export class PublishError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 | 409 | 502 | 503,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'PublishError';
  }
}

// ============================================================================
// CONSTANTS AND HELPERS
// ============================================================================

/** The LeRobot directories that are uploaded; everything else in the folder stays here. */
const PUBLISHED_DIRS = ['meta', 'data', 'videos'] as const;
const WHOAMI_TTL_MS = 60_000;

/** Hub repo-name rules: letters, digits, `-`, `_`, `.`; no `--` or `..`; ≤ 96 chars. */
const REPO_PART_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,94}[A-Za-z0-9])?$/;

export function isValidRepoPart(part: string): boolean {
  return REPO_PART_RE.test(part) && !part.includes('--') && !part.includes('..');
}

/** `name` → `<namespace>/name`; `ns/name` unchanged; anything else null. */
export function normalizeRepoId(repoId: string, defaultNamespace: string | null): string | null {
  const trimmed = repoId.trim();
  const parts = trimmed.split('/');
  if (parts.length === 1) {
    if (!defaultNamespace || !isValidRepoPart(parts[0]) || !isValidRepoPart(defaultNamespace)) return null;
    return `${defaultNamespace}/${parts[0]}`;
  }
  if (parts.length === 2 && isValidRepoPart(parts[0]) && isValidRepoPart(parts[1])) return trimmed;
  return null;
}

/** Remove the token — and anything shaped like a Hub token — from a message. */
export function scrubToken(message: string, token: string | null): string {
  let out = message;
  if (token) out = out.split(token).join('***');
  return out.replace(/hf_[A-Za-z0-9]{8,}/g, 'hf_***');
}

/** A dataset is degraded when its last validation found errors or a type change invalidated it. */
export function degradedReason(dataset: DatasetResponse): string | null {
  if (dataset.validation && dataset.validation.valid === false) {
    const first = dataset.validation.errors[0]?.message;
    return `its last validation found ${dataset.validation.errors.length} error(s)${first ? `: ${first}` : ''}`;
  }
  if (dataset.expectations?.invalidated) {
    return 'a robot-type change invalidated its validation and it has not been revalidated';
  }
  return null;
}

/** Whether the row's `huggingFaceRepoId` names where it was imported FROM. */
function isHubImport(dataset: DatasetResponse): boolean {
  return Boolean(dataset.sourceRevision || dataset.importMode);
}

/**
 * `@huggingface/hub` has no tag API, so this is the two calls
 * `huggingface_hub.HfApi.delete_tag` / `create_tag` make. Delete-then-create is
 * what `lerobot`'s own `push_to_hub` does to move the version tag to a new commit.
 */
export async function replaceTagOverRest(params: Parameters<HubClient['replaceTag']>[0]): Promise<void> {
  const { repo, tag, revision, message, accessToken } = params;
  const name = typeof repo === 'string' ? repo : repo.name;
  const base = `${(params.hubUrl ?? 'https://huggingface.co').replace(/\/+$/, '')}/api/datasets/${name}/tag`;
  const auth = { Authorization: `Bearer ${accessToken}` };
  const removed = await fetch(`${base}/${encodeURIComponent(tag)}`, { method: 'DELETE', headers: auth });
  if (!removed.ok && removed.status !== 404) {
    throw new Error(`removing the old ${tag} tag answered HTTP ${removed.status}`);
  }
  const created = await fetch(`${base}/${encodeURIComponent(revision)}`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(message ? { tag, message } : { tag }),
  });
  if (!created.ok) {
    const detail = await created.text().catch(() => '');
    throw new Error(`creating the ${tag} tag answered HTTP ${created.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
}

const defaultHub: HubClient = {
  whoAmI: (p) => hub.whoAmI(p) as unknown as ReturnType<HubClient['whoAmI']>,
  repoExists: (p) => hub.repoExists(p),
  createRepo: (p) => hub.createRepo(p),
  downloadFile: (p) => hub.downloadFile(p),
  uploadFilesWithProgress: (p) => hub.uploadFilesWithProgress(p),
  replaceTag: replaceTagOverRest,
};

// ============================================================================
// SERVICE
// ============================================================================

export class HuggingFacePublishService {
  private readonly hub: HubClient;
  private readonly env: NodeJS.ProcessEnv;
  private readonly home: string;
  private readonly now: () => Date;
  private readonly jobs = new Map<string, PublishJob>();
  private readonly runs = new Map<string, Promise<void>>();
  /** Datasets between the in-progress check and the job being stored — the awaits in between. */
  private readonly starting = new Set<string>();
  private whoamiCache: { token: string; at: number; value: { name: string; type: string; orgs: string[] } } | null = null;

  constructor(options: PublishServiceOptions = {}) {
    this.hub = options.hub ?? defaultHub;
    this.env = options.env ?? process.env;
    this.home = options.home ?? homedir();
    this.now = options.now ?? (() => new Date());
  }

  /** The token and where it came from, or nulls. Never leaves this class. */
  private resolveToken(): { token: string | null; source: 'env' | 'file' | null } {
    const fromEnv = this.env.HF_TOKEN?.trim();
    if (fromEnv) return { token: fromEnv, source: 'env' };
    const candidates = [
      this.env.HF_TOKEN_PATH,
      this.env.HF_HOME ? join(this.env.HF_HOME, 'token') : undefined,
      join(this.home, '.cache', 'huggingface', 'token'),
    ].filter((p): p is string => Boolean(p));
    for (const path of candidates) {
      try {
        if (!existsSync(path) || !statSync(path).isFile()) continue;
        // A few bytes, read once per request.
        const value = readFileSync(path, 'utf-8').trim();
        if (value) return { token: value, source: 'file' };
      } catch {
        // unreadable: try the next one
      }
    }
    return { token: null, source: null };
  }

  /** `HF_ENDPOINT`, the Hub's own convention for a mirror or a local test server. */
  private get hubUrl(): string {
    return (this.env.HF_ENDPOINT?.trim() || 'https://huggingface.co').replace(/\/+$/, '');
  }

  private hubParams(): { hubUrl?: string } {
    return this.env.HF_ENDPOINT?.trim() ? { hubUrl: this.hubUrl } : {};
  }

  private repoUrl(repoId: string): string {
    return `${this.hubUrl}/datasets/${repoId}`;
  }

  private defaultNamespace(user: string | null): string | null {
    return this.env.HF_PUBLISH_NAMESPACE?.trim() || user;
  }

  private async whoami(token: string): Promise<{ name: string; type: string; orgs: string[] }> {
    const cached = this.whoamiCache;
    if (cached && cached.token === token && this.now().getTime() - cached.at < WHOAMI_TTL_MS) return cached.value;
    const me = await this.hub.whoAmI({ accessToken: token, ...this.hubParams() });
    const value = { name: me.name, type: me.type, orgs: (me.orgs ?? []).map((o) => o.name) };
    this.whoamiCache = { token, at: this.now().getTime(), value };
    return value;
  }

  /** Whether publishing is set up on this server, and as whom. */
  async getStatus(): Promise<PublishStatus> {
    const { token, source } = this.resolveToken();
    if (!token) {
      return { configured: false, source: null, user: null, orgs: [], defaultNamespace: this.defaultNamespace(null) };
    }
    try {
      const me = await this.whoami(token);
      return { configured: true, source, user: me.name, orgs: me.orgs, defaultNamespace: this.defaultNamespace(me.name) };
    } catch (error) {
      return {
        configured: true,
        source,
        user: null,
        orgs: [],
        defaultNamespace: this.defaultNamespace(null),
        error: `The Hub did not accept the token or could not be reached: ${scrubToken(errorMessage(error), token)}`,
      };
    }
  }

  /** The current or last job for a dataset, or what the row remembers. */
  async getJob(datasetId: string): Promise<PublishJob | { status: 'none' } | { status: 'done'; url: string; repoId: string } | null> {
    // The row first: it is what the caller's tenant may see, and the job map is not scoped.
    const dataset = await datasetService.get(datasetId);
    if (!dataset) return null;
    const job = this.jobs.get(datasetId);
    if (job) return { ...job, warnings: [...job.warnings] };
    if (dataset.huggingFaceRepoId && !isHubImport(dataset)) {
      return { status: 'done', repoId: dataset.huggingFaceRepoId, url: this.repoUrl(dataset.huggingFaceRepoId) };
    }
    return { status: 'none' };
  }

  /**
   * Check everything that can be checked before a byte moves, then start the
   * upload in the background. Throws {@link PublishError} for every refusal.
   */
  async publish(datasetId: string, request: PublishRequest, actorId: string | null): Promise<PublishJob> {
    const running = this.jobs.get(datasetId);
    if (running?.status === 'running') {
      throw new PublishError(`A publish to ${running.repoId} is already running for this dataset`, 409, 'PUBLISH_IN_PROGRESS');
    }
    // The check above and this mark are one synchronous step: the checks below
    // await the database and the Hub, and a double click used to pass both.
    if (this.starting.has(datasetId)) {
      throw new PublishError('A publish is already being started for this dataset', 409, 'PUBLISH_IN_PROGRESS');
    }
    this.starting.add(datasetId);
    try {
      return await this.start(datasetId, request, actorId);
    } finally {
      this.starting.delete(datasetId);
    }
  }

  private async start(datasetId: string, request: PublishRequest, actorId: string | null): Promise<PublishJob> {
    const dataset = await datasetService.get(datasetId);
    if (!dataset) throw new PublishError('Dataset not found', 404, 'DATASET_NOT_FOUND');
    if (dataset.kind === 'view') {
      throw new PublishError('This dataset is a view with no files of its own — materialize it first', 409, 'DATASET_IS_VIEW');
    }
    if (dataset.status !== 'ready') {
      throw new PublishError(`Only a ready dataset can be published; this one is ${dataset.status}`, 409, 'DATASET_NOT_READY');
    }
    const degraded = degradedReason(dataset);
    if (degraded && !request.force) {
      throw new PublishError(`This dataset is degraded — ${degraded}. Publish with force to send it anyway.`, 409, 'DATASET_DEGRADED');
    }
    const root = dataset.storagePath;
    if (!root || !isAbsolute(root) || !existsSync(join(root, 'meta', 'info.json'))) {
      throw new PublishError(
        'The dataset\'s files are not on this server\'s disk (publishing reads the local LeRobot directory)',
        409,
        'DATASET_NOT_LOCAL',
      );
    }

    const { token } = this.resolveToken();
    if (!token) {
      throw new PublishError(
        'No Hugging Face token on the server — set HF_TOKEN or run `hf auth login` on the server host',
        503,
        'HF_TOKEN_MISSING',
      );
    }

    let me: { name: string; type: string; orgs: string[] };
    try {
      me = await this.whoami(token);
    } catch (error) {
      throw new PublishError(
        `The Hub did not accept the server's token or could not be reached: ${scrubToken(errorMessage(error), token)}`,
        502,
        'HUB_UNREACHABLE',
      );
    }

    const repoId = normalizeRepoId(request.repoId, this.defaultNamespace(me.name));
    if (!repoId) {
      throw new PublishError('repoId must be <namespace>/<name> with letters, digits, "-", "_" or "."', 400, 'INVALID_REPO_ID');
    }
    const namespace = repoId.split('/')[0];
    if (me.type === 'user' && namespace !== me.name && !me.orgs.includes(namespace)) {
      throw new PublishError(
        `The server's Hub account ${me.name} cannot write to ${namespace} (member of: ${me.orgs.join(', ') || 'no organisations'})`,
        403,
        'NAMESPACE_FORBIDDEN',
      );
    }

    const job: PublishJob = {
      datasetId,
      repoId,
      private: request.private ?? true,
      license: request.license ?? 'apache-2.0',
      status: 'running',
      phase: 'preparing',
      message: 'Collecting files',
      filesTotal: 0,
      filesDone: 0,
      bytesTotal: 0,
      bytesDone: 0,
      card: null,
      repoCreated: null,
      url: this.repoUrl(repoId),
      warnings: degraded ? [`Published although ${degraded}`] : [],
      forced: Boolean(degraded && request.force),
      startedAt: this.now().toISOString(),
    };
    this.jobs.set(datasetId, job);

    await datasetService.auditDatasetAction(datasetId, 'publish.huggingface.start', actorId, {
      repoId,
      private: job.private,
      license: job.license,
      forced: job.forced,
      hubUser: me.name,
    });

    this.runs.set(datasetId, this.run(job, dataset, root, request, token, actorId));
    return { ...job, warnings: [...job.warnings] };
  }

  private async run(
    job: PublishJob,
    dataset: DatasetResponse,
    root: string,
    request: PublishRequest,
    token: string,
    actorId: string | null,
  ): Promise<void> {
    const repo: hub.RepoDesignation = { type: 'dataset', name: job.repoId };
    try {
      const info = await readJson(join(root, 'meta', 'info.json'));
      const { files, skipped } = await collectFiles(root);
      if (skipped > 0) job.warnings.push(`${skipped} symlink(s) or special file(s) were left out`);
      if (!files.some((f) => f.path.startsWith('data/'))) {
        throw new Error('The dataset directory has no data/ files to publish');
      }

      job.phase = 'creating_repo';
      job.message = 'Checking the repository';
      const exists = await this.hub.repoExists({ repo, accessToken: token, ...this.hubParams() });
      if (!exists) {
        job.message = `Creating ${job.private ? 'private' : 'public'} repository`;
        await this.hub.createRepo({
          repo,
          accessToken: token,
          visibility: job.private ? 'private' : 'public',
          license: job.license,
          ...this.hubParams(),
        });
      } else if (request.private !== undefined) {
        job.warnings.push('The repository already existed; its visibility was left as it is on the Hub');
      }
      job.repoCreated = !exists;

      // The card: the dataset's own README wins, then a hand-written one on the
      // Hub, then a generated one.
      const uploads: Array<{ path: string; content: Blob | URL; size: number }> = files.map((f) => ({
        path: f.path,
        content: pathToFileURL(f.absolute),
        size: f.size,
      }));
      const localReadme = join(root, 'README.md');
      if (existsSync(localReadme)) {
        uploads.push({ path: 'README.md', content: pathToFileURL(localReadme), size: statSync(localReadme).size });
        job.card = 'local';
      } else {
        // A card that cannot be read is treated like a hand-written one:
        // overwriting what we could not see is worse than a stale card.
        let remoteText: string | null = null;
        let unreadable = false;
        if (exists) {
          try {
            const remote = await this.hub.downloadFile({ repo, path: 'README.md', accessToken: token, ...this.hubParams() });
            remoteText = remote ? await remote.text() : null;
          } catch {
            unreadable = true;
          }
        }
        if (unreadable || (remoteText !== null && !remoteText.includes(NEODEM_CARD_MARKER))) {
          job.card = 'kept';
          job.warnings.push(
            unreadable
              ? 'The repository\'s README.md could not be read; it was left as it is'
              : 'The repository has a hand-written README.md; it was kept',
          );
        } else {
          const card = buildDatasetCard({
            repoId: job.repoId,
            datasetName: dataset.name,
            description: request.description,
            license: job.license,
            tags: request.tags ?? [],
            info,
            tasks: await readTasks(root),
            robotTypeName: dataset.robotType?.name ?? null,
            publishedAt: this.now().toISOString(),
          });
          const blob = new Blob([card], { type: 'text/markdown' });
          uploads.push({ path: 'README.md', content: blob, size: blob.size });
          job.card = 'generated';
        }
      }

      const sizes = new Map(uploads.map((u) => [u.path, u.size]));
      job.filesTotal = uploads.length;
      job.bytesTotal = uploads.reduce((sum, u) => sum + u.size, 0);
      job.phase = 'uploading';
      job.message = `Uploading ${uploads.length} files`;

      const uploaded = new Map<string, number>();
      const iter = this.hub.uploadFilesWithProgress({
        repo,
        accessToken: token,
        files: uploads.map(({ path, content }) => ({ path, content })),
        commitTitle: `Publish ${dataset.name} from NeoDEM`,
        commitDescription:
          `${dataset.demonstrationCount} episodes, ${dataset.totalFrames} frames at ${dataset.fps} fps. ` +
          `NeoDEM dataset ${dataset.id}.`,
        ...this.hubParams(),
      });
      let output: hub.CommitOutput | undefined;
      for (;;) {
        const step = await iter.next();
        if (step.done) {
          output = step.value;
          break;
        }
        const event = step.value;
        if (event.event === 'phase') {
          if (event.phase === 'committing') {
            job.phase = 'committing';
            job.message = 'Creating the commit';
          }
        } else if (event.event === 'fileProgress' && event.state === 'uploading') {
          uploaded.set(event.path, Math.max(uploaded.get(event.path) ?? 0, event.progress));
          job.bytesDone = [...uploaded].reduce((sum, [p, frac]) => sum + frac * (sizes.get(p) ?? 0), 0);
          job.filesDone = [...uploaded.values()].filter((frac) => frac >= 1).length;
        }
      }

      job.filesDone = job.filesTotal;
      job.bytesDone = job.bytesTotal;
      job.commitOid = output?.commit.oid;
      job.commitUrl = output?.commit.url;

      // `LeRobotDataset(repo_id)` refuses a repo without a codebase-version
      // tag ("Your dataset must be tagged with a codebase version"), so the
      // data would be on the Hub and unloadable. Tag the commit just made, as
      // lerobot's own push_to_hub does. The upload itself already succeeded,
      // so a failed tag is a warning that says what it breaks, not a failure.
      const version = typeof info.codebase_version === 'string' ? info.codebase_version.trim() : '';
      if (!version) {
        job.warnings.push('meta/info.json names no codebase_version, so no version tag was set; LeRobotDataset will not load this repo without one');
      } else {
        job.message = `Tagging ${version}`;
        try {
          await this.hub.replaceTag({
            repo,
            tag: version,
            revision: job.commitOid ?? 'main',
            message: `LeRobot codebase ${version}, published from NeoDEM`,
            accessToken: token,
            ...this.hubParams(),
          });
          job.versionTag = version;
        } catch (error) {
          job.warnings.push(
            `The ${version} tag could not be set (${scrubToken(errorMessage(error), token)}); ` +
              `LeRobotDataset will not load this repo until it is — publish again or run \`hf repos tag create ${job.repoId} ${version} --repo-type dataset\``,
          );
        }
      }

      job.phase = 'done';
      job.status = 'done';
      job.message = 'Published';
      job.finishedAt = this.now().toISOString();

      if (!isHubImport(dataset)) {
        await datasetService.update(dataset.id, { huggingFaceRepoId: job.repoId }).catch((error: unknown) => {
          console.error('[HuggingFacePublish] could not record the repo on the dataset:', errorMessage(error));
        });
      }
    } catch (error) {
      job.status = 'failed';
      job.phase = 'failed';
      job.error = scrubToken(errorMessage(error), token);
      job.message = 'Publish failed';
      job.finishedAt = this.now().toISOString();
      console.error(`[HuggingFacePublish] ${dataset.id} → ${job.repoId} failed: ${job.error}`);
    }

    await datasetService.auditDatasetAction(dataset.id, 'publish.huggingface', actorId, {
      repoId: job.repoId,
      status: job.status,
      private: job.private,
      license: job.license,
      forced: job.forced,
      repoCreated: job.repoCreated,
      card: job.card,
      files: job.filesTotal,
      bytes: job.bytesTotal,
      commit: job.commitOid ?? null,
      versionTag: job.versionTag ?? null,
      url: job.url,
      error: job.error ?? null,
    });
  }

  /** Resolves when the dataset's running publish has finished (either way). */
  async settled(datasetId: string): Promise<void> {
    await this.runs.get(datasetId);
  }

  /** Test hook: forget jobs and the whoami cache. */
  reset(): void {
    this.jobs.clear();
    this.runs.clear();
    this.whoamiCache = null;
  }
}

// ============================================================================
// FILES
// ============================================================================

interface LocalFile {
  path: string;
  absolute: string;
  size: number;
}

/**
 * Every regular file under `meta/`, `data/` and `videos/`, with its repo path.
 * Symlinks are left out — following one could publish a file from outside the
 * dataset — and counted so the job can say so.
 */
export async function collectFiles(root: string): Promise<{ files: LocalFile[]; skipped: number }> {
  const files: LocalFile[] = [];
  let skipped = 0;
  async function walk(dir: string, rel: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = join(dir, entry.name);
      const path = rel ? posix.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) {
        await walk(absolute, path);
      } else if (entry.isFile()) {
        const stat = await lstat(absolute);
        files.push({ path, absolute, size: stat.size });
      } else {
        skipped += 1;
      }
    }
  }
  for (const dir of PUBLISHED_DIRS) {
    const absolute = join(root, dir);
    try {
      const stat = await lstat(absolute);
      if (stat.isDirectory()) await walk(absolute, dir);
      else if (stat.isSymbolicLink()) skipped += 1;
    } catch {
      // not there: `videos/` is absent in a dataset with no cameras
    }
  }
  return { files, skipped };
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  try {
    const value = JSON.parse(await readFile(path, 'utf-8'));
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Task instructions from `meta/tasks.jsonl` (v2.1, and written beside the v3.0 parquet by NeoDEM). */
export async function readTasks(root: string): Promise<string[]> {
  try {
    const text = await readFile(join(root, 'meta', 'tasks.jsonl'), 'utf-8');
    return text
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as { task_index?: number; task?: string })
      .sort((a, b) => (a.task_index ?? 0) - (b.task_index ?? 0))
      .map((row) => row.task)
      .filter((task): task is string => typeof task === 'string' && task.trim().length > 0);
  } catch {
    return [];
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const huggingFacePublishService = new HuggingFacePublishService();
