/**
 * @file importJobsStore.ts
 * @description Dataset imports running in the background (TASK-352): what each
 *              one is doing, its live log, and how it ended. The HF modal hands
 *              an import over here and closes; the top-bar panel reads it.
 * @feature training
 *
 * Fed by `useImportJobsFeed` (one socket, mounted in the layout) and by the
 * server's log route, which backfills whatever the socket missed. Which
 * imports are tracked survives a reload (localStorage); their lines do not,
 * and are fetched again.
 */

import { createStore } from '@/store';
import { toast } from '@/shared/components/ui/toast';
import { getErrorMessage, isNotFoundError } from '@/shared/utils';
import { trainingApi } from '../api/trainingApi';
import { describeImportFailure } from '../components/datasets/importFormat';
import type { HFImportProgress, ImportLogLine, ImportLogResponse } from '../types';

// ============================================================================
// TYPES
// ============================================================================

/** `cancelled`: the operator stopped it (TASK-371) — an end, but not a failure. */
export type ImportJobState = 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface ImportJob {
  datasetId: string;
  /** What the operator asked for — the repo id, or the dataset's name */
  label: string;
  state: ImportJobState;
  phase: HFImportProgress['phase'] | null;
  progress: number;
  currentFile: string | null;
  completedFiles: number | null;
  totalFiles: number | null;
  /** Bytes stored so far, and the selected total (null: the Hub did not size every file) — #370 */
  downloadedBytes: number | null;
  totalBytes: number | null;
  importMode: HFImportProgress['importMode'] | null;
  /** Why it failed, in the server's words */
  error: string | null;
  /** The commit the import pinned, and the LeRobot version it declares (TASK-358) */
  revision: string | null;
  lerobotVersion: string | null;
  lines: ImportLogLine[];
  /** Lines the server's bounded ring dropped before we saw them */
  dropped: number;
  /** False when the server no longer holds this import's log (it restarted) */
  logRetained: boolean;
  startedAt: string;
  endedAt: string | null;
  /** Toast the outcome. Off for an import opened only to read its log. */
  notify: boolean;
}

/** The subset of a WebSocket frame this store reads. */
export interface ImportFeedMessage {
  type?: string;
  datasetId?: string;
  error?: string;
  /** On `dataset:import:failed`: the operator cancelled it (TASK-371) */
  cancelled?: boolean;
  log?: ImportLogLine;
  importProgress?: Partial<HFImportProgress> & { status?: HFImportProgress['status'] };
}

/** What is known about an import beyond its label, when the caller knows it. */
export interface ImportJobMeta {
  revision?: string | null;
  lerobotVersion?: string | null;
}

interface ImportJobsState {
  jobs: Record<string, ImportJob>;
  /**
   * Imports the operator dismissed. `discover` would otherwise bring back a
   * row the server still calls `importing` — one a restart orphaned — on every
   * page load. Bounded; newest last.
   */
  dismissedIds: string[];
  /** Newest first */
  order: string[];
  panelOpen: boolean;
  /** The job whose log the panel shows expanded */
  focusedId: string | null;
}

interface ImportJobsActions {
  /** Start following an import the server has accepted. */
  track: (datasetId: string, label: string, meta?: ImportJobMeta) => void;
  /**
   * Follow an import found running (the datasets list after a reload, another
   * tab's import) — quietly: no panel, no toast. A no-op when already tracked.
   */
  follow: (datasetId: string, label: string, meta?: ImportJobMeta) => void;
  /**
   * Ask the server which Hub imports are running and follow the ones this
   * browser does not know about — started in another tab, on another machine,
   * or over the API (TASK-358). Skips what the operator dismissed.
   */
  discover: () => Promise<void>;
  /**
   * Open the panel on a dataset's import — following it first if it is not
   * already, quietly: whoever asks to read a log needs no toast about it.
   */
  show: (datasetId: string, label: string, meta?: ImportJobMeta) => void;
  /** Apply one socket frame. Frames about untracked datasets are ignored. */
  applyMessage: (message: ImportFeedMessage) => void;
  /** Merge in what the server says (GET /datasets/:id/import/log). */
  applyBackfill: (response: ImportLogResponse) => void;
  /** Fetch and merge the server's view of one import. */
  backfill: (datasetId: string) => Promise<void>;
  /**
   * Check every persisted job against the server, once per load (TASK-371).
   * Jobs the server does not know (404 — an earlier server or cluster on this
   * origin, or another organization's) are dropped instead of sitting there
   * stuck; the rest take the server's word; stale entries expire.
   */
  reconcile: () => Promise<void>;
  /**
   * Ask the server to stop a running import (TASK-371). Throws what the
   * server refused with, so the caller can say why.
   */
  cancel: (datasetId: string) => Promise<void>;
  dismiss: (datasetId: string) => void;
  clearFinished: () => void;
  openPanel: (datasetId?: string) => void;
  closePanel: () => void;
  togglePanel: () => void;
  focus: (datasetId: string | null) => void;
}

export type ImportJobsStore = ImportJobsState & ImportJobsActions;

/** Lines kept per job in the browser — the server keeps 300. */
export const MAX_CLIENT_LINES = 500;

/** A finished job older than this is dropped on load (TASK-371). */
export const FINISHED_JOB_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * A job still `running` in this browser, older than this, that the server
 * cannot confirm either way (it is unreachable) is dropped on load: no Hub
 * import runs for a week (TASK-371).
 */
export const RUNNING_JOB_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Dismissed ids remembered, so `discover` does not resurrect them. */
export const MAX_DISMISSED = 50;

/**
 * One toast per import: "running in the background" and the outcome share it,
 * so the outcome replaces the stale one in place instead of stacking below it.
 */
export const importToastId = (datasetId: string): string => `dataset-import-${datasetId}`;

// ============================================================================
// HELPERS
// ============================================================================

function newJob(datasetId: string, label: string, notify = true, meta: ImportJobMeta = {}): ImportJob {
  return {
    datasetId,
    label,
    state: 'running',
    phase: null,
    progress: 0,
    currentFile: null,
    completedFiles: null,
    totalFiles: null,
    downloadedBytes: null,
    totalBytes: null,
    importMode: null,
    error: null,
    revision: meta.revision ?? null,
    lerobotVersion: meta.lerobotVersion ?? null,
    lines: [],
    dropped: 0,
    logRetained: true,
    startedAt: new Date().toISOString(),
    endedAt: null,
    notify,
  };
}

/** Copy what a progress frame measured onto a running job. */
function applyFrame(job: ImportJob, p: Partial<HFImportProgress>): void {
  job.phase = p.phase ?? (p.status === 'validating' ? 'validating' : job.phase);
  if (typeof p.progress === 'number') job.progress = Math.max(job.progress, p.progress);
  job.currentFile = p.currentFile ?? job.currentFile;
  job.completedFiles = p.completedFiles ?? job.completedFiles;
  job.totalFiles = p.totalFiles ?? job.totalFiles;
  job.downloadedBytes = p.downloadedBytes ?? job.downloadedBytes;
  // A frame from a phase that counts files only says nothing about bytes.
  if (p.totalBytes !== undefined) job.totalBytes = p.totalBytes;
  job.importMode = p.importMode ?? job.importMode;
}

/** What a backfill says when the server lost an import it was downloading. */
export const SERVER_RESTARTED_ERROR = 'The server restarted during the import, so it stopped; retry the import.';

const lineKey = (line: ImportLogLine) => `${line.at}|${line.level}|${line.message}`;

/**
 * The server's lines, plus any the socket delivered that the server's answer
 * did not include yet — a line broadcast while the GET was in flight. Kept in
 * time order and bounded.
 */
export function mergeLines(server: ImportLogLine[], local: ImportLogLine[]): ImportLogLine[] {
  const seen = new Set(server.map(lineKey));
  const merged = [...server, ...local.filter((l) => !seen.has(lineKey(l)))];
  merged.sort((a, b) => a.at.localeCompare(b.at));
  return merged.slice(-MAX_CLIENT_LINES);
}

/**
 * End a job. Ended stays ended — except that a late validation failure beats
 * a "completed" that only meant the download finished. True when it changed.
 */
function finish(job: ImportJob, state: Exclude<ImportJobState, 'running'>, error: string | null): boolean {
  if (job.state === 'failed' || job.state === 'cancelled') return false;
  if (job.state === 'succeeded' && state !== 'failed') return false;
  job.state = state;
  job.error = state === 'failed' ? error ?? 'Import failed' : null;
  job.endedAt = new Date().toISOString();
  if (state === 'succeeded') job.progress = 100;
  return true;
}

/**
 * Say how it ended, once, wherever the operator is now — and refresh the row
 * on the datasets page so its card stops saying "Importing".
 */
function announce(job: ImportJob, openPanel: (id: string) => void): void {
  const action = { label: 'Details', onClick: () => openPanel(job.datasetId) };
  const id = importToastId(job.datasetId);
  if (job.state === 'succeeded') {
    toast.success('Dataset imported', { id, description: job.label, action });
  } else if (job.state === 'cancelled') {
    toast.info('Dataset import cancelled', { id, description: job.label, action });
  } else {
    const cause = describeImportFailure(job.error, job.phase).headline;
    toast.error('Dataset import failed', { id, description: `${job.label}: ${cause}`, action });
  }
  void refreshDatasetRow(job.datasetId);
}

/** Jobs `reconcile` is checking right now; see `backfill`'s 404. */
const reconciling = new Set<string>();

async function refreshDatasetRow(datasetId: string): Promise<void> {
  try {
    const dataset = await trainingApi.getDataset(datasetId);
    const { useTrainingStore } = await import('./trainingStore');
    useTrainingStore.setState((state) => {
      const index = state.datasets.findIndex((d) => d.id === datasetId);
      if (index !== -1) state.datasets[index] = dataset;
    });
  } catch {
    // The list catches up on its next fetch; nothing here is worth a toast.
  }
}

// ============================================================================
// STORE
// ============================================================================

export const useImportJobsStore = createStore<ImportJobsStore>(
  (set, get) => {
    /** Run a mutation on one tracked job, and announce it if that ended it. */
    const update = (datasetId: string, mutate: (job: ImportJob) => boolean | void): void => {
      let ended: ImportJob | null = null;
      set((state) => {
        const job = state.jobs[datasetId];
        if (!job) return;
        if (mutate(job) === true) ended = { ...job };
      });
      if (!ended) return;
      if ((ended as ImportJob).notify) announce(ended, get().openPanel);
      // One last read: the feed closes once nothing runs, and a line said
      // after the closing frame would otherwise never arrive.
      void get().backfill(datasetId);
    };

    /** Forget jobs outright — not dismissed, since nothing will bring them back. */
    const drop = (ids: string[]): void => {
      if (ids.length === 0) return;
      set((state) => {
        for (const id of ids) delete state.jobs[id];
        state.order = state.order.filter((id) => !ids.includes(id));
        if (state.focusedId && !state.jobs[state.focusedId]) state.focusedId = null;
        if (state.order.length === 0) state.panelOpen = false;
      });
    };

    return {
      jobs: {},
      order: [],
      dismissedIds: [],
      panelOpen: false,
      focusedId: null,

      track: (datasetId, label, meta) => {
        set((state) => {
          // A retry of a tracked import starts over in the same slot, and
          // keeps what it knew about the source when the caller passes nothing.
          const known = state.jobs[datasetId];
          state.jobs[datasetId] = newJob(datasetId, label, true, {
            revision: meta?.revision ?? known?.revision,
            lerobotVersion: meta?.lerobotVersion ?? known?.lerobotVersion,
          });
          state.dismissedIds = state.dismissedIds.filter((id) => id !== datasetId);
          state.order = [datasetId, ...state.order.filter((id) => id !== datasetId)];
          state.focusedId = datasetId;
        });
      },

      follow: (datasetId, label, meta) => {
        if (get().jobs[datasetId]) return;
        set((state) => {
          state.jobs[datasetId] = newJob(datasetId, label, false, meta);
          state.order = [...state.order, datasetId];
        });
        void get().backfill(datasetId);
      },

      discover: async () => {
        try {
          const { datasets } = await trainingApi.listDatasets({ status: ['importing', 'validating'] });
          const { dismissedIds, follow } = get();
          for (const d of datasets ?? []) {
            if (!d.huggingFaceRepoId || dismissedIds.includes(d.id)) continue;
            follow(d.id, d.huggingFaceRepoId, { revision: d.sourceRevision, lerobotVersion: d.lerobotVersion });
          }
        } catch (error) {
          // The panel just shows less; the datasets page still follows what it lists.
          console.warn('[ImportJobs] discover failed:', getErrorMessage(error, 'unknown error'));
        }
      },

      show: (datasetId, label, meta) => {
        if (!get().jobs[datasetId]) {
          set((state) => {
            state.jobs[datasetId] = newJob(datasetId, label, false, meta);
            state.order = [datasetId, ...state.order];
          });
        }
        get().openPanel(datasetId);
        void get().backfill(datasetId);
      },

      applyMessage: (message) => {
        const { type, datasetId } = message;
        if (!type || !datasetId || !get().jobs[datasetId]) return;

        if (type === 'dataset:import:log' && message.log) {
          const line = message.log;
          update(datasetId, (job) => {
            job.lines.push(line);
            if (job.lines.length > MAX_CLIENT_LINES) job.lines.splice(0, job.lines.length - MAX_CLIENT_LINES);
          });
        } else if (type === 'dataset:import:progress' && message.importProgress) {
          const ip = message.importProgress;
          update(datasetId, (job) => {
            if (job.state === 'running') applyFrame(job, ip);
            if (ip.status === 'failed') return finish(job, ip.cancelled ? 'cancelled' : 'failed', ip.error ?? null);
          });
        } else if (type === 'dataset:import:completed') {
          // "Completed" is the DOWNLOAD. With NATS the row is still
          // `validating` and the verdict comes later, so this is not the end:
          // ask the row, and finish only on `ready` or `failed`. Without NATS
          // the row is already `ready` and the answer comes straight back.
          update(datasetId, (job) => {
            if (job.state === 'running') job.phase = 'validating';
          });
          void get().backfill(datasetId);
        } else if (type === 'dataset:validation:completed') {
          update(datasetId, (job) => finish(job, 'succeeded', null));
        } else if (type === 'dataset:import:failed') {
          update(datasetId, (job) => finish(job, message.cancelled ? 'cancelled' : 'failed', message.error ?? null));
        } else if (type === 'dataset:validation:failed') {
          // With NATS, the verdict on a download that finished arrives here.
          update(datasetId, (job) => finish(job, 'failed', `Validation failed: ${message.error ?? 'see the dataset'}`));
        }
      },

      applyBackfill: (response) => {
        update(response.datasetId, (job) => {
          job.lines = mergeLines(response.lines, job.lines);
          job.dropped = response.dropped;
          job.logRetained = response.retained;
          job.revision = response.sourceRevision ?? job.revision ?? null;
          job.lerobotVersion = response.lerobotVersion ?? job.lerobotVersion ?? null;
          const p = response.progress;
          if (p && job.state === 'running') applyFrame(job, p);
          if (response.status === 'failed' && response.importError?.cancelled) {
            return finish(job, 'cancelled', null);
          }
          if (response.status === 'failed') {
            return finish(job, 'failed', response.importError?.error ?? 'Validation failed — see the dataset');
          }
          if (response.status === 'ready') return finish(job, 'succeeded', null);
          // Still `importing` on a server that holds no log for it: the
          // process that was downloading is gone (a restart), and nothing
          // will ever move this row again. Say so instead of spinning.
          if (response.status === 'importing' && !response.retained) {
            return finish(job, 'failed', SERVER_RESTARTED_ERROR);
          }
        });
      },

      backfill: async (datasetId) => {
        try {
          get().applyBackfill(await trainingApi.getImportLog(datasetId));
        } catch (error) {
          // A 404 is a dataset somebody deleted: there is nothing left to watch.
          const notFound = isNotFoundError(error);
          if (notFound && reconciling.has(datasetId)) {
            // Persisted from an earlier load: `reconcile` is deciding whether it
            // is a ghost, and a ghost gets no "failed" toast on its way out.
          } else if (notFound) {
            update(datasetId, (job) => finish(job, 'failed', 'The dataset no longer exists'));
          } else {
            console.warn('[ImportJobs] backfill failed:', getErrorMessage(error, 'unknown error'));
          }
        }
      },

      reconcile: async () => {
        const now = Date.now();
        const age = (iso: string | null) => (iso ? now - new Date(iso).getTime() : 0);
        // Old outcomes first: nobody needs yesterday's toast-worthy news, and
        // there is no reason to ask the server about them.
        drop(get().order.filter((id) => {
          const job = get().jobs[id];
          return job && job.state !== 'running' && age(job.endedAt ?? job.startedAt) > FINISHED_JOB_TTL_MS;
        }));

        const ghosts: string[] = [];
        const ids = [...get().order];
        for (const id of ids) reconciling.add(id);
        await Promise.all(ids.map(async (id) => {
          try {
            get().applyBackfill(await trainingApi.getImportLog(id));
          } catch (error) {
            const job = get().jobs[id];
            // Unknown to this server: a ghost from another one, not a failure.
            if (isNotFoundError(error)) ghosts.push(id);
            else if (job?.state === 'running' && age(job.startedAt) > RUNNING_JOB_TTL_MS) ghosts.push(id);
            else console.warn('[ImportJobs] reconcile failed:', getErrorMessage(error, 'unknown error'));
          }
        }));
        drop(ghosts);
        for (const id of ids) reconciling.delete(id);
      },

      cancel: async (datasetId) => {
        const { status } = await trainingApi.cancelImport(datasetId);
        // `cancelling`: the run is still unwinding, and its closing frame
        // ends the job; until then it honestly is still running.
        if (status === 'cancelled') update(datasetId, (job) => finish(job, 'cancelled', null));
      },

      dismiss: (datasetId) => {
        set((state) => {
          state.dismissedIds = [...state.dismissedIds.filter((id) => id !== datasetId), datasetId].slice(-MAX_DISMISSED);
          delete state.jobs[datasetId];
          state.order = state.order.filter((id) => id !== datasetId);
          if (state.focusedId === datasetId) state.focusedId = null;
          if (state.order.length === 0) state.panelOpen = false;
        });
      },

      clearFinished: () => {
        set((state) => {
          const finished = state.order.filter((id) => state.jobs[id] && state.jobs[id].state !== 'running');
          state.dismissedIds = [...state.dismissedIds.filter((id) => !finished.includes(id)), ...finished].slice(-MAX_DISMISSED);
          state.order = state.order.filter((id) => state.jobs[id]?.state === 'running');
          for (const id of Object.keys(state.jobs)) {
            if (state.jobs[id].state !== 'running') delete state.jobs[id];
          }
          if (state.focusedId && !state.jobs[state.focusedId]) state.focusedId = null;
          if (state.order.length === 0) state.panelOpen = false;
        });
      },

      openPanel: (datasetId) => {
        set((state) => {
          state.panelOpen = true;
          if (datasetId) state.focusedId = datasetId;
        });
      },

      closePanel: () => set((state) => { state.panelOpen = false; }),

      togglePanel: () => set((state) => { state.panelOpen = !state.panelOpen; }),

      focus: (datasetId) => set((state) => { state.focusedId = datasetId; }),
    };
  },
  {
    name: 'importJobs',
    persist: true,
    storageKey: 'neodem-import-jobs',
    // Which imports are followed survives a reload; their lines are fetched
    // again, so they are not written to localStorage.
    partialize: (state) => ({
      order: state.order,
      dismissedIds: state.dismissedIds,
      jobs: Object.fromEntries(
        Object.entries(state.jobs).map(([id, job]) => [id, { ...job, lines: [] }]),
      ),
    }),
  },
);

/** Imports still running — what the top-bar badge counts. */
export const selectRunningCount = (state: ImportJobsStore): number =>
  state.order.filter((id) => state.jobs[id]?.state === 'running').length;
