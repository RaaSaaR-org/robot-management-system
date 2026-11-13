/**
 * @file datasetUploadStore.ts
 * @description The one dataset upload this tab is running (TASK-481): its
 *              progress per file and overall, rate and time left, how it
 *              failed, resume and cancel, and the wait for the server's
 *              verdict after finish. It lives outside the dialog, so closing
 *              the dialog — or leaving the page — does not stop the upload.
 * @feature training
 *
 * The `File` handles cannot be put in a store (or survive a reload), so they
 * are held beside it; an upload interrupted by a reload stays on the server
 * until it is deleted from its row or the idle reaper removes it.
 */

import { createStore } from '@/store';
import { toast } from '@/shared/components/ui/toast';
import { datasetUploadApi, UploadRefusal } from '../api/datasetUploadApi';
import { trainingApi } from '../api/trainingApi';
import type { FolderInspection } from '../upload/lerobotFolder';
import {
  BROWSER_CHUNK_BYTES,
  planFiles,
  sendAndFinish,
  withControlRetry,
  type PlannedFile,
  type UploadProgress,
} from '../upload/uploadEngine';

// ============================================================================
// TYPES
// ============================================================================

export type UploadPhase =
  /** The start request is out; nothing exists on the server yet */
  | 'starting'
  /** Parts are being sent */
  | 'uploading'
  /** Every part is sent; the server is being asked to finish */
  | 'finishing'
  /** Finish accepted: the server assembles and verifies the files */
  | 'processing'
  /** The server validates the dataset */
  | 'validating'
  /** Stopped on an error; what was stored is still there and can be resumed */
  | 'failed'
  /** Cancel was asked; the server is removing what it holds */
  | 'cancelling';

/** A refusal in a shape the dialog can render: sentence, code, context. */
export interface UploadErrorView {
  message: string;
  /** The server's stable code, or what the client could tell (`NETWORK_ERROR`) */
  code: string;
  /** HTTP status; 0 when nothing came back */
  status: number;
  /** The fields that say what to change, as label/value text */
  context: { label: string; value: string }[];
}

export interface UploadFileProgress {
  id: number;
  path: string;
  size: number;
  sent: number;
  done: boolean;
}

export interface UploadJob {
  phase: UploadPhase;
  /** Null until the server accepted the start */
  datasetId: string | null;
  name: string;
  totalBytes: number;
  sentBytes: number;
  files: UploadFileProgress[];
  /** Bytes per second over the last few seconds; null before it can be measured */
  rate: number | null;
  /** Seconds left at that rate */
  etaSeconds: number | null;
  error: UploadErrorView | null;
}

export interface StartUploadInput {
  name: string;
  description?: string;
  robotTypeId?: string;
  inspection: FolderInspection;
}

interface DatasetUploadState {
  job: UploadJob | null;
  /** The upload dialog; in the store so the top-bar chip can reopen it */
  dialogOpen: boolean;
  /** Why the last start was refused — shown with the form, which is still filled in */
  startError: UploadErrorView | null;
}

interface DatasetUploadActions {
  openDialog: () => void;
  closeDialog: () => void;
  clearStartError: () => void;
  /** Declare the files and start sending. Resolves once the server accepted or refused. */
  start: (input: StartUploadInput) => Promise<void>;
  /** After a failure: ask the server what it holds and send the rest. */
  resume: () => Promise<void>;
  /** Stop, and have the server remove everything it stored. */
  cancel: () => Promise<void>;
}

export type DatasetUploadStore = DatasetUploadState & DatasetUploadActions;

// ============================================================================
// HELPERS
// ============================================================================

const TICK_MS = 500;
const RATE_WINDOW_MS = 8000;
export const VERDICT_POLL_MS = 1500;

export const uploadToastId = (datasetId: string): string => `dataset-upload-${datasetId}`;

const CONTEXT_LABEL: Record<string, string> = {
  expectedSize: 'Expected size',
  state: 'Upload state',
  missingFiles: 'Files missing',
  missingBytes: 'Bytes missing',
  maxBytes: 'Limit',
  maxFiles: 'File limit',
  totalBytes: 'Declared size',
  availableBytes: 'Free storage',
  path: 'File',
  partNumber: 'Part',
  attempts: 'Attempts',
  expected: 'Expected',
  actual: 'Actual',
};

function contextValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const shown = value.slice(0, 5).map((v) =>
      v && typeof v === 'object' && 'path' in v ? String((v as { path: unknown }).path) : contextValue(v),
    );
    return value.length > shown.length ? `${shown.join(', ')} and ${value.length - shown.length} more` : shown.join(', ');
  }
  try { return JSON.stringify(value) ?? ''; } catch { return String(value); }
}

/** Turn whatever was thrown into what the dialog shows. */
export function describeRefusal(error: unknown): UploadErrorView {
  if (!(error instanceof UploadRefusal)) {
    return {
      message: error instanceof Error ? error.message : 'The upload stopped for an unknown reason.',
      code: 'CLIENT_ERROR', status: 0, context: [],
    };
  }
  const context = Object.entries(error.context)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => ({ label: CONTEXT_LABEL[key] ?? key, value: contextValue(value).slice(0, 300) }))
    .filter((item) => item.value !== '');
  return { message: error.message, code: error.code, status: error.status, context };
}

/** What is held beside the store: file handles, the running request, the meter. */
interface Session {
  local: Map<string, Blob>;
  abort: AbortController;
  progress: UploadProgress | null;
  samples: { at: number; bytes: number }[];
  ticker: ReturnType<typeof setInterval> | null;
  /** Bumped whenever the job is replaced, so a stale loop stops writing */
  generation: number;
  /** The generation whose verdict is already being followed — one poll loop, not two */
  verdictGeneration: number;
}

const session: Session = {
  local: new Map(), abort: new AbortController(), progress: null, samples: [], ticker: null, generation: 0, verdictGeneration: -1,
};

/**
 * The dataset no longer exists on the server: deleted from its row (here, in
 * another tab or by someone else) or removed by the idle timeout. There is
 * nothing left to resume or to cancel.
 */
export const isDatasetGone = (error: unknown): boolean =>
  error instanceof UploadRefusal && error.status === 404 && (error.code === 'NOT_FOUND' || error.code === 'NO_UPLOAD');

const warnBeforeUnload = (event: BeforeUnloadEvent) => {
  event.preventDefault();
  // Chrome and Edge only ask when this is set.
  event.returnValue = '';
};

function guardUnload(on: boolean): void {
  if (typeof window === 'undefined') return;
  window.removeEventListener('beforeunload', warnBeforeUnload);
  if (on) window.addEventListener('beforeunload', warnBeforeUnload);
}

/** Put the dataset's current row into the datasets list (first, when it is new). */
async function refreshDatasetRow(datasetId: string): Promise<void> {
  try {
    const dataset = await trainingApi.getDataset(datasetId);
    const { useTrainingStore } = await import('./trainingStore');
    useTrainingStore.setState((state) => {
      const index = state.datasets.findIndex((d) => d.id === datasetId);
      if (index !== -1) state.datasets[index] = dataset;
      else state.datasets.unshift(dataset);
    });
  } catch {
    // The list catches up on its next fetch.
  }
}

async function removeDatasetRow(datasetId: string): Promise<void> {
  const { useTrainingStore } = await import('./trainingStore');
  useTrainingStore.setState((state) => {
    state.datasets = state.datasets.filter((d) => d.id !== datasetId);
  });
}

// ============================================================================
// STORE
// ============================================================================

export const useDatasetUploadStore = createStore<DatasetUploadStore>(
  (set, get) => {
    const stopTicker = () => {
      if (session.ticker) clearInterval(session.ticker);
      session.ticker = null;
    };

    /** Copy the meter into the store: bytes, per-file bars, rate, time left. */
    const tick = () => {
      const progress = session.progress;
      if (!progress) return;
      const now = Date.now();
      const sent = progress.sentBytes();
      session.samples.push({ at: now, bytes: sent });
      while (session.samples.length > 2 && now - session.samples[0].at > RATE_WINDOW_MS) session.samples.shift();
      const oldest = session.samples[0];
      const elapsed = (now - oldest.at) / 1000;
      const rate = elapsed >= 1 ? Math.max(0, (sent - oldest.bytes) / elapsed) : null;
      set((state) => {
        const job = state.job;
        if (!job) return;
        job.sentBytes = sent;
        job.rate = rate;
        job.etaSeconds = rate && rate > 0 ? (job.totalBytes - sent) / rate : null;
        for (const file of job.files) {
          file.sent = progress.fileSent(file.id);
          file.done = progress.fileDone(file.id);
        }
      });
    };

    const startTicker = () => {
      stopTicker();
      session.samples = [];
      session.ticker = setInterval(tick, TICK_MS);
    };

    const fail = (error: unknown) => {
      stopTicker();
      tick();
      guardUnload(false);
      const view = describeRefusal(error);
      set((state) => {
        if (!state.job) return;
        state.job.phase = 'failed';
        state.job.error = view;
        state.job.rate = null;
        state.job.etaSeconds = null;
      });
      // Said where the operator is now, when the dialog is not in front of them.
      if (!get().dialogOpen) {
        toast.error('Dataset upload stopped', {
          id: get().job?.datasetId ? uploadToastId(get().job!.datasetId!) : undefined,
          description: view.message,
          action: { label: 'Show', onClick: () => get().openDialog() },
        });
      }
    };

    /** The dataset was deleted under the upload: the upload is over, and that is not a failure. */
    const endAsGone = async (datasetId: string, name: string): Promise<void> => {
      session.generation += 1;
      stopTicker();
      session.abort.abort();
      session.local = new Map();
      session.progress = null;
      guardUnload(false);
      set((state) => { state.job = null; state.dialogOpen = false; });
      await removeDatasetRow(datasetId);
      toast.info('Upload ended', {
        id: uploadToastId(datasetId),
        description: `${name} was deleted on the server, so its upload stopped. Nothing of it is kept.`,
      });
    };

    /** Follow the dataset from "finish accepted" to ready or failed. */
    const awaitVerdict = async (datasetId: string, name: string, generation: number): Promise<void> => {
      // Finish and a late cancel can both hand over to the verdict.
      if (session.verdictGeneration === generation) return;
      session.verdictGeneration = generation;
      for (;;) {
        if (session.generation !== generation) return;
        let outcome: { ok: boolean; reason?: string } | null = null;
        try {
          const status = await datasetUploadApi.status(datasetId);
          if (session.generation !== generation) return;
          if (status.status === 'ready') {
            outcome = { ok: true };
          } else if (status.status === 'failed' || status.state === 'failed') {
            outcome = { ok: false, reason: status.importError?.error ?? 'It did not pass validation — open the dataset for the report.' };
          } else {
            const phase: UploadPhase = status.status === 'validating' ? 'validating' : 'processing';
            if (get().job?.phase !== phase) {
              set((state) => { if (state.job) state.job.phase = phase; });
              void refreshDatasetRow(datasetId);
            }
          }
        } catch (error) {
          if (session.generation !== generation) return;
          // Gone: deleted from its row while it was validating.
          if (error instanceof UploadRefusal && error.status === 404) {
            set((state) => { state.job = null; state.dialogOpen = false; });
            return;
          }
          // Anything else is the network; the verdict is still coming.
        }
        if (outcome) {
          set((state) => { state.job = null; state.dialogOpen = false; });
          await refreshDatasetRow(datasetId);
          if (outcome.ok) {
            toast.success('Dataset uploaded', { id: uploadToastId(datasetId), description: `${name} is ready.` });
          } else {
            toast.error('Dataset upload failed', { id: uploadToastId(datasetId), description: `${name}: ${outcome.reason}`, duration: null });
          }
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, VERDICT_POLL_MS));
      }
    };

    /** Send what is missing, finish, and hand over to the verdict. */
    const run = async (datasetId: string, name: string, files: PlannedFile[], chunkSize: number): Promise<void> => {
      const generation = session.generation;
      session.abort = new AbortController();
      guardUnload(true);
      startTicker();
      try {
        await sendAndFinish({
          api: datasetUploadApi,
          datasetId,
          files,
          chunkSize,
          local: session.local,
          transport: datasetUploadApi.sendPart,
          signal: session.abort.signal,
          onProgress: (progress) => { session.progress = progress; },
          onFinishing: () => {
            tick();
            set((state) => { if (state.job) state.job.phase = 'finishing'; });
          },
        });
      } catch (error) {
        if (session.generation !== generation) return;
        // Cancel is under way: that path reports for itself, whatever the
        // requests it interrupted (a part, or a finish the cancel overtook) answer.
        if (get().job?.phase === 'cancelling') return;
        if (isDatasetGone(error)) { await endAsGone(datasetId, name); return; }
        fail(error);
        return;
      }
      if (session.generation !== generation) return;
      stopTicker();
      guardUnload(false);
      // The files are with the server; the folder is not needed any more.
      session.local = new Map();
      session.progress = null;
      set((state) => {
        if (!state.job) return;
        state.job.phase = 'processing';
        state.job.sentBytes = state.job.totalBytes;
        state.job.rate = null;
        state.job.etaSeconds = null;
        for (const file of state.job.files) { file.sent = file.size; file.done = true; }
        // It ends on the dataset's row, which shows the rest.
        state.dialogOpen = false;
      });
      toast.info('Upload received — the server is checking it', {
        id: uploadToastId(datasetId),
        description: `${name} appears in the list as ready once validation passes.`,
      });
      void refreshDatasetRow(datasetId);
      void awaitVerdict(datasetId, name, generation);
    };

    return {
      job: null,
      dialogOpen: false,
      startError: null,

      openDialog: () => set((state) => { state.dialogOpen = true; }),
      closeDialog: () => set((state) => { state.dialogOpen = false; }),
      clearStartError: () => set((state) => { state.startError = null; }),

      start: async ({ name, description, robotTypeId, inspection }) => {
        if (get().job || !inspection.info) return;
        session.generation += 1;
        session.local = new Map(inspection.files.map((f) => [f.path, f.file]));
        set((state) => {
          state.startError = null;
          state.job = {
            phase: 'starting', datasetId: null, name,
            totalBytes: inspection.totalBytes, sentBytes: 0,
            files: [], rate: null, etaSeconds: null, error: null,
          };
        });

        let files: PlannedFile[];
        let started;
        try {
          started = await withControlRetry(
            () => datasetUploadApi.start({
              name,
              description: description || undefined,
              robotTypeId: robotTypeId || undefined,
              info: inspection.info!,
              chunkSize: BROWSER_CHUNK_BYTES,
              files: inspection.files.map((f) => ({ path: f.path, size: f.size })),
            }),
            { retryNetwork: false },
          );
          files = planFiles(started.files, session.local);
        } catch (error) {
          const view = describeRefusal(error);
          set((state) => { state.job = null; state.startError = view; });
          if (!get().dialogOpen) {
            toast.error("Couldn't start the upload", {
              description: view.message,
              action: { label: 'Show', onClick: () => get().openDialog() },
            });
          }
          return;
        }

        set((state) => {
          if (!state.job) return;
          state.job.phase = 'uploading';
          state.job.datasetId = started.datasetId;
          state.job.totalBytes = started.totalBytes;
          state.job.files = files.map((f) => ({ id: f.id, path: f.path, size: f.size, sent: 0, done: false }));
        });
        void refreshDatasetRow(started.datasetId);
        void run(started.datasetId, name, files, started.chunkSize);
      },

      resume: async () => {
        const job = get().job;
        if (!job || job.phase !== 'failed' || !job.datasetId) return;
        const { datasetId, name } = job;
        set((state) => { if (state.job) { state.job.phase = 'uploading'; state.job.error = null; } });
        let files: PlannedFile[];
        let chunkSize: number;
        try {
          // The store is the record of what arrived; nothing it holds is re-sent.
          const status = await withControlRetry(() => datasetUploadApi.status(datasetId), { retryNetwork: true });
          if (status.state === 'processing' || status.state === 'completed') {
            // Finish got through after all; only the verdict is outstanding.
            set((state) => { if (state.job) { state.job.phase = 'processing'; state.dialogOpen = false; } });
            void awaitVerdict(datasetId, name, session.generation);
            return;
          }
          if (status.state !== 'uploading') {
            throw new UploadRefusal({
              status: 409, code: 'UPLOAD_NOT_ACCEPTING',
              message: 'The server no longer accepts parts for this upload. Cancel it and start again.',
              context: { state: status.state },
            });
          }
          chunkSize = status.chunkSize;
          files = planFiles(status.files, session.local);
        } catch (error) {
          if (isDatasetGone(error)) { await endAsGone(datasetId, name); return; }
          fail(error);
          return;
        }
        void run(datasetId, name, files, chunkSize);
      },

      cancel: async () => {
        const job = get().job;
        if (!job || !job.datasetId || job.phase === 'cancelling') return;
        const { datasetId, name } = job;
        const before = job.phase;
        set((state) => { if (state.job) state.job.phase = 'cancelling'; });
        stopTicker();
        session.abort.abort();
        guardUnload(false);
        try {
          await withControlRetry(() => datasetUploadApi.cancel(datasetId), { retryNetwork: true });
        } catch (error) {
          // 404: it is already gone, which is what was asked for.
          if (!(error instanceof UploadRefusal && error.status === 404)) {
            const view = describeRefusal(error);
            const processing = error instanceof UploadRefusal
              && (error.code === 'UPLOAD_PROCESSING' || error.code === 'UPLOAD_COMPLETED');
            set((state) => {
              if (!state.job) return;
              // Finish was accepted before the cancel arrived: it is the server's now.
              state.job.phase = processing ? 'processing' : 'failed';
              state.job.error = processing ? null : view;
            });
            if (processing) {
              toast.info('Too late to cancel', {
                description: `${name} is already being checked by the server. Delete it from the list once that ends.`,
              });
              set((state) => { state.dialogOpen = false; });
              void awaitVerdict(datasetId, name, session.generation);
            } else if (before !== 'failed') {
              toast.error("Couldn't cancel the upload", { description: view.message });
            }
            return;
          }
        }
        session.generation += 1;
        session.local = new Map();
        session.progress = null;
        guardUnload(false);
        set((state) => { state.job = null; state.dialogOpen = false; });
        await removeDatasetRow(datasetId);
        toast.info('Upload cancelled', { id: uploadToastId(datasetId), description: `Nothing of ${name} was kept on the server.` });
      },
    };
  },
  { name: 'datasetUpload' },
);

// ============================================================================
// SELECTORS
// ============================================================================

/** 0–100 of the bytes, or null when there is nothing to measure. */
export function uploadPercent(job: UploadJob | null): number | null {
  if (!job || job.totalBytes <= 0) return null;
  return Math.min(100, (job.sentBytes / job.totalBytes) * 100);
}

/** True while leaving the tab would lose the upload. */
export const isSending = (job: UploadJob | null): boolean =>
  job !== null && (job.phase === 'starting' || job.phase === 'uploading' || job.phase === 'finishing');

/** For tests: forget the running upload without telling the server. */
export function resetDatasetUploadStore(): void {
  session.generation += 1;
  session.verdictGeneration = -1;
  session.abort.abort();
  if (session.ticker) clearInterval(session.ticker);
  session.ticker = null;
  session.local = new Map();
  session.progress = null;
  guardUnload(false);
  useDatasetUploadStore.setState({ job: null, dialogOpen: false, startError: null });
}
