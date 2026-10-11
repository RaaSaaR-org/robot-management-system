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
import { getErrorMessage } from '@/shared/utils';
import { trainingApi } from '../api/trainingApi';
import type { HFImportProgress, ImportLogLine, ImportLogResponse } from '../types';

// ============================================================================
// TYPES
// ============================================================================

export type ImportJobState = 'running' | 'succeeded' | 'failed';

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
  /** Why it failed, in the server's words */
  error: string | null;
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
  log?: ImportLogLine;
  importProgress?: Partial<HFImportProgress> & { status?: HFImportProgress['status'] };
}

interface ImportJobsState {
  jobs: Record<string, ImportJob>;
  /** Newest first */
  order: string[];
  panelOpen: boolean;
  /** The job whose log the panel shows expanded */
  focusedId: string | null;
}

interface ImportJobsActions {
  /** Start following an import the server has accepted. */
  track: (datasetId: string, label: string) => void;
  /**
   * Open the panel on a dataset's import — following it first if it is not
   * already, quietly: whoever asks to read a log needs no toast about it.
   */
  show: (datasetId: string, label: string) => void;
  /** Apply one socket frame. Frames about untracked datasets are ignored. */
  applyMessage: (message: ImportFeedMessage) => void;
  /** Merge in what the server says (GET /datasets/:id/import/log). */
  applyBackfill: (response: ImportLogResponse) => void;
  /** Fetch and merge the server's view of one import. */
  backfill: (datasetId: string) => Promise<void>;
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

// ============================================================================
// HELPERS
// ============================================================================

function newJob(datasetId: string, label: string, notify = true): ImportJob {
  return {
    datasetId,
    label,
    state: 'running',
    phase: null,
    progress: 0,
    currentFile: null,
    completedFiles: null,
    totalFiles: null,
    error: null,
    lines: [],
    dropped: 0,
    logRetained: true,
    startedAt: new Date().toISOString(),
    endedAt: null,
    notify,
  };
}

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
  if (job.state === 'failed') return false;
  if (job.state === 'succeeded' && state === 'succeeded') return false;
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
  if (job.state === 'succeeded') {
    toast.success('Dataset imported', { description: job.label, action });
  } else {
    toast.error('Dataset import failed', { description: `${job.label}: ${job.error}`, action });
  }
  void refreshDatasetRow(job.datasetId);
}

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

    return {
      jobs: {},
      order: [],
      panelOpen: false,
      focusedId: null,

      track: (datasetId, label) => {
        set((state) => {
          // A retry of a tracked import starts over in the same slot.
          state.jobs[datasetId] = newJob(datasetId, label);
          state.order = [datasetId, ...state.order.filter((id) => id !== datasetId)];
          state.focusedId = datasetId;
        });
      },

      show: (datasetId, label) => {
        if (!get().jobs[datasetId]) {
          set((state) => {
            state.jobs[datasetId] = newJob(datasetId, label, false);
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
            if (ip.status === 'failed') return finish(job, 'failed', ip.error ?? null);
            if (job.state !== 'running') return;
            job.phase = ip.phase ?? job.phase;
            job.progress = ip.progress ?? job.progress;
            job.currentFile = ip.currentFile ?? job.currentFile;
            job.completedFiles = ip.completedFiles ?? job.completedFiles;
            job.totalFiles = ip.totalFiles ?? job.totalFiles;
          });
        } else if (type === 'dataset:import:completed') {
          update(datasetId, (job) => finish(job, 'succeeded', null));
        } else if (type === 'dataset:import:failed') {
          update(datasetId, (job) => finish(job, 'failed', message.error ?? null));
        } else if (type === 'dataset:validation:failed') {
          // With NATS, "completed" means the files are in and validation is
          // queued; this is the verdict that arrives afterwards.
          update(datasetId, (job) => finish(job, 'failed', `Validation failed: ${message.error ?? 'see the dataset'}`));
        }
      },

      applyBackfill: (response) => {
        update(response.datasetId, (job) => {
          job.lines = mergeLines(response.lines, job.lines);
          job.dropped = response.dropped;
          job.logRetained = response.retained;
          const p = response.progress;
          if (p && job.state === 'running') {
            job.phase = p.phase ?? job.phase;
            job.progress = Math.max(job.progress, p.progress);
            job.currentFile = p.currentFile ?? job.currentFile;
            job.completedFiles = p.completedFiles ?? job.completedFiles;
            job.totalFiles = p.totalFiles ?? job.totalFiles;
          }
          if (response.status === 'failed') {
            return finish(job, 'failed', response.importError?.error ?? 'Validation failed — see the dataset');
          }
          if (response.status === 'ready') return finish(job, 'succeeded', null);
        });
      },

      backfill: async (datasetId) => {
        try {
          get().applyBackfill(await trainingApi.getImportLog(datasetId));
        } catch (error) {
          // A 404 is a dataset somebody deleted: there is nothing left to watch.
          const status = (error as { response?: { status?: number } }).response?.status;
          if (status === 404) {
            update(datasetId, (job) => finish(job, 'failed', 'The dataset no longer exists'));
          } else {
            console.warn('[ImportJobs] backfill failed:', getErrorMessage(error, 'unknown error'));
          }
        }
      },

      dismiss: (datasetId) => {
        set((state) => {
          delete state.jobs[datasetId];
          state.order = state.order.filter((id) => id !== datasetId);
          if (state.focusedId === datasetId) state.focusedId = null;
          if (state.order.length === 0) state.panelOpen = false;
        });
      },

      clearFinished: () => {
        set((state) => {
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
      jobs: Object.fromEntries(
        Object.entries(state.jobs).map(([id, job]) => [id, { ...job, lines: [] }]),
      ),
    }),
  },
);

/** Imports still running — what the top-bar badge counts. */
export const selectRunningCount = (state: ImportJobsStore): number =>
  state.order.filter((id) => state.jobs[id]?.state === 'running').length;
