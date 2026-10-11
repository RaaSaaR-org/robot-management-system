/**
 * @file importJobsStore.test.ts
 * @description The background-import tracker (TASK-352): socket frames, the
 *              server backfill, and how an import's end is decided and said.
 * @feature training
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getImportLog = vi.fn();
const getDataset = vi.fn();

vi.mock('../../api/trainingApi', () => ({
  trainingApi: {
    getImportLog: (...a: unknown[]) => getImportLog(...a),
    getDataset: (...a: unknown[]) => getDataset(...a),
  },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('@/shared/components/ui/toast', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
    info: vi.fn(),
  },
}));

import { mergeLines, selectRunningCount, useImportJobsStore } from '../importJobsStore';
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
  useImportJobsStore.setState({ jobs: {}, order: [], panelOpen: false, focusedId: null });
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

  it('ends on success with one toast', () => {
    store().track(ID, 'lerobot/pusht');
    store().applyMessage({ type: 'dataset:import:completed', datasetId: ID });
    store().applyMessage({ type: 'dataset:import:completed', datasetId: ID });

    expect(job()).toMatchObject({ state: 'succeeded', progress: 100, error: null });
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(selectRunningCount(store())).toBe(0);
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
    store().applyMessage({ type: 'dataset:import:completed', datasetId: 'a' });
    store().clearFinished();
    expect(store().order).toEqual(['b']);
  });
});
