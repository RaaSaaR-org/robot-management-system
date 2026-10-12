/**
 * @file importJobsStore.test.ts
 * @description The background-import tracker (TASK-352): socket frames, the
 *              server backfill, and how an import's end is decided and said.
 * @feature training
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiRequestError } from '@/api/client';

const getImportLog = vi.fn();
const getDataset = vi.fn();
const cancelImport = vi.fn();

vi.mock('../../api/trainingApi', () => ({
  trainingApi: {
    getImportLog: (...a: unknown[]) => getImportLog(...a),
    getDataset: (...a: unknown[]) => getDataset(...a),
    cancelImport: (...a: unknown[]) => cancelImport(...a),
  },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastInfo = vi.fn();
vi.mock('@/shared/components/ui/toast', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
    info: (...a: unknown[]) => toastInfo(...a),
  },
}));

import {
  FINISHED_JOB_TTL_MS,
  RUNNING_JOB_TTL_MS,
  SERVER_RESTARTED_ERROR,
  importToastId,
  mergeLines,
  selectRunningCount,
  useImportJobsStore,
  type ImportJob,
} from '../importJobsStore';
import type { ImportLogResponse } from '../../types';

const ID = 'ds-1';
const store = () => useImportJobsStore.getState();
const job = () => store().jobs[ID]!;

function line(at: string, message: string, level: 'info' | 'warn' | 'error' = 'info') {
  return { at, level, message };
}

function backfill(over: Partial<ImportLogResponse> = {}): ImportLogResponse {
  return {
    datasetId: ID,
    status: 'importing',
    importError: null,
    progress: null,
    lines: [],
    dropped: 0,
    retained: true,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getDataset.mockRejectedValue(new Error('not in this test'));
  useImportJobsStore.setState({ jobs: {}, order: [], dismissedIds: [], panelOpen: false, focusedId: null });
});

describe('following an import', () => {
  it('ignores frames about imports nobody asked to follow', () => {
    store().applyMessage({ type: 'dataset:import:log', datasetId: 'other', log: line('t1', 'hi') });
    expect(store().order).toEqual([]);
  });

  it('collects log lines and progress while it runs', () => {
    store().track(ID, 'lerobot/pusht');
    store().applyMessage({ type: 'dataset:import:log', datasetId: ID, log: line('t1', 'Downloading 3 files') });
    store().applyMessage({
      type: 'dataset:import:progress',
      datasetId: ID,
      importProgress: { status: 'importing', phase: 'downloading', progress: 40, completedFiles: 1, totalFiles: 3, currentFile: 'data/a.parquet' },
    });

    expect(job()).toMatchObject({
      state: 'running', phase: 'downloading', progress: 40, completedFiles: 1, totalFiles: 3, currentFile: 'data/a.parquet',
    });
    expect(job().lines.map((l) => l.message)).toEqual(['Downloading 3 files']);
    expect(selectRunningCount(store())).toBe(1);
  });

  it('ends on success with one toast, once the row says ready', async () => {
    // Without NATS the row is already `ready` when "completed" goes out.
    getImportLog.mockResolvedValue(backfill({ status: 'ready' }));
    store().track(ID, 'lerobot/pusht');
    store().applyMessage({ type: 'dataset:import:completed', datasetId: ID });
    store().applyMessage({ type: 'dataset:import:completed', datasetId: ID });

    await vi.waitFor(() => expect(job().state).toBe('succeeded'));
    expect(job()).toMatchObject({ progress: 100, error: null });
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(selectRunningCount(store())).toBe(0);
  });

  it('keeps an import running while the server is still validating it (NATS)', async () => {
    // "completed" means the download; the row is `validating` until the worker answers.
    getImportLog.mockResolvedValue(backfill({
      status: 'validating',
      progress: { datasetId: ID, status: 'validating', phase: 'validating', progress: 90, completedFiles: 3, totalFiles: 3 },
    }));
    store().track(ID, 'lerobot/pusht');
    store().applyMessage({ type: 'dataset:import:completed', datasetId: ID });
    await vi.waitFor(() => expect(getImportLog).toHaveBeenCalled());
    await Promise.resolve();

    expect(job()).toMatchObject({ state: 'running', phase: 'validating' });
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(selectRunningCount(store())).toBe(1);

    // The verdict, when it comes, ends it.
    store().applyMessage({ type: 'dataset:validation:completed', datasetId: ID });
    expect(job().state).toBe('succeeded');
    expect(toastSuccess).toHaveBeenCalledTimes(1);
  });

  it('copies byte progress off the frames, and a failed frame stops the bar where it was', () => {
    store().track(ID, 'unitree/g1');
    store().applyMessage({
      type: 'dataset:import:progress',
      datasetId: ID,
      importProgress: {
        status: 'importing', phase: 'downloading', progress: 50, completedFiles: 4, totalFiles: 10,
        downloadedBytes: 500, totalBytes: 1000, importMode: 'full',
      },
    });
    expect(job()).toMatchObject({ downloadedBytes: 500, totalBytes: 1000, importMode: 'full' });

    store().applyMessage({
      type: 'dataset:import:progress',
      datasetId: ID,
      importProgress: { status: 'failed', phase: 'downloading', progress: 50, downloadedBytes: 500, totalBytes: 1000, error: 'terminated' },
    });
    expect(job()).toMatchObject({ state: 'failed', error: 'terminated', progress: 50, downloadedBytes: 500 });
  });

  it('ends on failure with the reason, and a late progress frame cannot revive it', () => {
    store().track(ID, 'lerobot/pusht');
    store().applyMessage({ type: 'dataset:import:failed', datasetId: ID, error: '500 Server Error' });
    store().applyMessage({
      type: 'dataset:import:progress', datasetId: ID, importProgress: { status: 'importing', progress: 60 },
    });

    expect(job()).toMatchObject({ state: 'failed', error: '500 Server Error' });
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(String(toastError.mock.calls[0]![1].description)).toContain('500 Server Error');
  });

  it('lets a validation verdict that arrives after "completed" turn it into a failure', () => {
    store().track(ID, 'lerobot/pusht');
    store().applyMessage({ type: 'dataset:import:completed', datasetId: ID });
    store().applyMessage({ type: 'dataset:validation:failed', datasetId: ID, error: 'missing meta/info.json' });

    expect(job()).toMatchObject({ state: 'failed', error: 'Validation failed: missing meta/info.json' });
  });
});

describe('the server backfill', () => {
  it('fills in what the socket missed, without duplicating what it did not', () => {
    store().track(ID, 'lerobot/pusht');
    store().applyMessage({ type: 'dataset:import:log', datasetId: ID, log: line('2026-10-12T10:00:02Z', 'b') });
    store().applyBackfill(backfill({
      lines: [line('2026-10-12T10:00:01Z', 'a'), line('2026-10-12T10:00:02Z', 'b')],
      progress: { datasetId: ID, status: 'importing', phase: 'downloading', progress: 30 },
    }));

    expect(job().lines.map((l) => l.message)).toEqual(['a', 'b']);
    expect(job().progress).toBe(30);
  });

  it('settles an import that failed before anything was listening, with the stored reason', async () => {
    store().track(ID, 'lerobot/pusht');
    getImportLog.mockResolvedValue(backfill({
      status: 'failed',
      retained: false,
      importError: { phase: 'metadata', error: 'repo not found', repoId: 'lerobot/pusht', failedAt: '2026-10-12T10:00:00Z' },
    }));

    await store().backfill(ID);

    expect(job()).toMatchObject({ state: 'failed', error: 'repo not found', logRetained: false });
  });

  it('fails an import the server lost to a restart instead of spinning for ever', async () => {
    store().track(ID, 'lerobot/pusht');
    getImportLog.mockResolvedValue(backfill({ status: 'importing', retained: false }));

    await store().backfill(ID);

    expect(job()).toMatchObject({ state: 'failed', error: SERVER_RESTARTED_ERROR });
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('keeps waiting on a validation a restart did not stop (the worker may still answer)', async () => {
    store().track(ID, 'lerobot/pusht');
    getImportLog.mockResolvedValue(backfill({ status: 'validating', retained: false }));

    await store().backfill(ID);

    expect(job().state).toBe('running');
  });

  it('restores a reloaded mid-download import: phase, bytes and lines', async () => {
    // What localStorage brings back after a reload: the job, without its lines.
    store().track(ID, 'unitree/g1');
    useImportJobsStore.setState((state) => { state.jobs[ID]!.lines = []; });
    getImportLog.mockResolvedValue(backfill({
      lines: [line('2026-10-12T10:00:01Z', 'Downloading 10 files from the Hub (1.0 KB)')],
      progress: {
        datasetId: ID, status: 'importing', phase: 'downloading', progress: 42,
        completedFiles: 4, totalFiles: 10, downloadedBytes: 400, totalBytes: 1000,
      },
    }));

    await store().backfill(ID);

    expect(job()).toMatchObject({
      state: 'running', phase: 'downloading', downloadedBytes: 400, totalBytes: 1000, completedFiles: 4,
    });
    expect(job().lines).toHaveLength(1);
  });

  it('follows an import found running, quietly and only once', async () => {
    getImportLog.mockResolvedValue(backfill());
    store().follow(ID, 'lerobot/pusht');
    store().follow(ID, 'lerobot/pusht');

    expect(store().order).toEqual([ID]);
    expect(store().panelOpen).toBe(false);
    expect(job().notify).toBe(false);
    await vi.waitFor(() => expect(getImportLog).toHaveBeenCalledTimes(1));
  });

  it('opens a log quietly: reading an ended import does not toast about it', async () => {
    getImportLog.mockResolvedValue(backfill({ status: 'failed', importError: null }));
    store().show(ID, 'lerobot/pusht');
    await vi.waitFor(() => expect(job().state).toBe('failed'));

    expect(store().panelOpen).toBe(true);
    expect(store().focusedId).toBe(ID);
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe('mergeLines', () => {
  it('keeps time order', () => {
    const merged = mergeLines([line('t2', 'two')], [line('t1', 'one'), line('t3', 'three')]);
    expect(merged.map((l) => l.message)).toEqual(['one', 'two', 'three']);
  });
});

describe('tidying up', () => {
  it('clears finished imports and keeps running ones', () => {
    store().track('a', 'a');
    store().track('b', 'b');
    store().applyMessage({ type: 'dataset:validation:completed', datasetId: 'a' });
    store().clearFinished();
    expect(store().order).toEqual(['b']);
    expect(store().dismissedIds).toEqual(['a']);
  });
});

describe('what the operator sees of an import (TASK-358)', () => {
  it('replaces the "running in the background" toast in place with the outcome', () => {
    store().track(ID, 'lerobot/pusht');
    store().applyMessage({ type: 'dataset:validation:completed', datasetId: ID });
    expect(toastSuccess.mock.calls[0]![1]).toMatchObject({ id: importToastId(ID) });
  });

  it('says the cause first in the failure toast', () => {
    store().track(ID, 'lerobot/pusht');
    store().applyMessage({
      type: 'dataset:import:failed',
      datasetId: ID,
      error: 'File data/chunk-000/episode_000001.parquet: write to rustfs failed after 3 attempt(s): connect ECONNREFUSED 10.0.0.1:9000',
    });
    expect(toastError.mock.calls[0]![1]).toMatchObject({
      id: importToastId(ID),
      description: 'lerobot/pusht: Storage unreachable (ECONNREFUSED)',
    });
  });

  it('learns the pinned commit and LeRobot version from the server, and keeps them across a retry', () => {
    store().track(ID, 'lerobot/pusht');
    store().applyBackfill(backfill({ sourceRevision: 'f'.repeat(40), lerobotVersion: 'v3.0' }));
    expect(job()).toMatchObject({ revision: 'f'.repeat(40), lerobotVersion: 'v3.0' });

    store().track(ID, 'lerobot/pusht');
    expect(job()).toMatchObject({ state: 'running', revision: 'f'.repeat(40), lerobotVersion: 'v3.0' });
  });

  it('remembers a dismissal until the import is started again', () => {
    store().track(ID, 'lerobot/pusht');
    store().applyMessage({ type: 'dataset:import:failed', datasetId: ID, error: 'x' });
    store().dismiss(ID);
    expect(store().dismissedIds).toEqual([ID]);
    store().track(ID, 'lerobot/pusht');
    expect(store().dismissedIds).toEqual([]);
  });
});

// ============================================================================
// TASK-371: reconciling what a reload remembers, and cancelling
// ============================================================================

/** A job as an earlier load left it in localStorage. */
function remembered(id: string, over: Partial<ImportJob> = {}): void {
  store().follow(id, `org/${id}`);
  useImportJobsStore.setState((state) => {
    Object.assign(state.jobs[id]!, { notify: true, ...over });
  });
}

// What apiClient really rejects with: its interceptor turns the axios error into
// an ApiRequestError, which carries `statusCode` and no `response` (TASK-388).
const notFound = () =>
  new ApiRequestError({ code: 'NOT_FOUND', message: 'Dataset not found', statusCode: 404 });
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

describe('reconciling remembered imports with the server (TASK-371)', () => {
  beforeEach(() => {
    getImportLog.mockResolvedValue(backfill());
  });

  it('drops jobs the server does not know, quietly, instead of showing them stuck or failed', async () => {
    remembered('ghost');
    remembered('ghost-done', { state: 'failed', endedAt: hoursAgo(1) });
    remembered('live');
    getImportLog.mockImplementation((id: string) =>
      id.startsWith('ghost') ? Promise.reject(notFound()) : Promise.resolve(backfill({ datasetId: id })));
    // What the layout's feed does at the same moment for running jobs.
    const reconciling = store().reconcile();
    await store().backfill('ghost');
    await reconciling;

    expect(store().order).toEqual(['live']);
    expect(store().jobs.ghost).toBeUndefined();
    expect(store().jobs['ghost-done']).toBeUndefined();
    expect(store().jobs.live!.state).toBe('running');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('takes the server\'s word for the ones it knows — an import that finished while the tab was closed', async () => {
    remembered('done-meanwhile');
    getImportLog.mockResolvedValue(backfill({ datasetId: 'done-meanwhile', status: 'ready' }));

    await store().reconcile();

    expect(store().jobs['done-meanwhile']!.state).toBe('succeeded');
  });

  it('expires finished jobs older than a day without asking about them', async () => {
    remembered('old', { state: 'succeeded', endedAt: new Date(Date.now() - FINISHED_JOB_TTL_MS - 1000).toISOString() });
    remembered('recent', { state: 'failed', error: 'boom', endedAt: hoursAgo(2) });
    getImportLog.mockResolvedValue(backfill({ datasetId: 'recent', status: 'failed' }));
    getImportLog.mockClear(); // `follow` above read both; the reload is what is under test

    await store().reconcile();

    expect(store().order).toEqual(['recent']);
    expect(getImportLog).not.toHaveBeenCalledWith('old');
  });

  it('drops a week-old "running" job the server cannot confirm, and keeps a young one', async () => {
    remembered('ancient', { startedAt: new Date(Date.now() - RUNNING_JOB_TTL_MS - 1000).toISOString() });
    remembered('young');
    getImportLog.mockRejectedValue(new Error('Network Error'));

    await store().reconcile();

    expect(store().order).toEqual(['young']);
  });

  it('still marks a dataset deleted under a live session as gone', async () => {
    store().track(ID, 'lerobot/pusht');
    getImportLog.mockRejectedValue(notFound());

    await store().backfill(ID);

    expect(job()).toMatchObject({ state: 'failed', error: 'The dataset no longer exists' });
  });
});

describe('cancelling an import (TASK-371)', () => {
  it('ends the job as cancelled once the server says it stopped', async () => {
    store().track(ID, 'lerobot/pusht');
    cancelImport.mockResolvedValue({ datasetId: ID, status: 'cancelled' });
    getImportLog.mockResolvedValue(backfill({
      status: 'failed',
      importError: { phase: 'downloading', error: 'Import cancelled by the operator', failedAt: hoursAgo(0), cancelled: true },
    }));

    await store().cancel(ID);

    expect(cancelImport).toHaveBeenCalledWith(ID);
    expect(job()).toMatchObject({ state: 'cancelled', error: null });
    expect(selectRunningCount(store())).toBe(0);
    expect(toastInfo).toHaveBeenCalledWith('Dataset import cancelled', expect.objectContaining({ id: importToastId(ID) }));
    expect(toastError).not.toHaveBeenCalled();
  });

  it('keeps it running while the server is still unwinding, and ends it on the closing frame', async () => {
    store().track(ID, 'lerobot/pusht');
    cancelImport.mockResolvedValue({ datasetId: ID, status: 'cancelling' });

    await store().cancel(ID);
    expect(job().state).toBe('running');

    store().applyMessage({
      type: 'dataset:import:progress',
      datasetId: ID,
      importProgress: { status: 'failed', phase: 'downloading', progress: 40, error: 'Import cancelled by the operator', cancelled: true },
    });
    expect(job().state).toBe('cancelled');
    // The `failed` event that follows does not turn it into a failure.
    store().applyMessage({ type: 'dataset:import:failed', datasetId: ID, error: 'Import cancelled by the operator', cancelled: true });
    expect(job().state).toBe('cancelled');
  });

  it('reads a cancelled row from the backfill as cancelled, not failed', () => {
    store().track(ID, 'lerobot/pusht');
    store().applyBackfill(backfill({
      status: 'failed',
      importError: { phase: 'metadata', error: 'Import cancelled by the operator', failedAt: hoursAgo(0), cancelled: true },
    }));
    expect(job().state).toBe('cancelled');
  });

  it('passes the server\'s refusal on and leaves the job alone', async () => {
    store().track(ID, 'lerobot/pusht');
    cancelImport.mockRejectedValue(Object.assign(new Error('already validating'), { response: { status: 409 } }));

    await expect(store().cancel(ID)).rejects.toThrow('already validating');
    expect(job().state).toBe('running');
  });
});
