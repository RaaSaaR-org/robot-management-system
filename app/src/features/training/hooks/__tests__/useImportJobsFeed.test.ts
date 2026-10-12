/**
 * @file useImportJobsFeed.test.ts
 * @description The layout-level import feed (TASK-352): a socket only while
 *              something runs, frames into the store, a backfill on open.
 * @feature training
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const getImportLog = vi.fn();
const listDatasets = vi.fn();
vi.mock('../../api/trainingApi', () => ({
  trainingApi: {
    getImportLog: (...a: unknown[]) => getImportLog(...a),
    listDatasets: (...a: unknown[]) => listDatasets(...a),
    getDataset: vi.fn().mockRejectedValue(new Error('n/a')),
  },
}));

import { useImportJobsFeed } from '../useImportJobsFeed';
import { useImportJobsStore } from '../../store/importJobsStore';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  close(): void {
    this.closed = true;
  }
  emit(payload: unknown): void {
    act(() => this.onmessage?.({ data: JSON.stringify(payload) }));
  }
}

const store = () => useImportJobsStore.getState();

beforeEach(() => {
  // After msw's interceptor has replaced the global (see HFDatasetBrowserModal.test).
  vi.stubGlobal('WebSocket', FakeWebSocket);
  FakeWebSocket.instances = [];
  getImportLog.mockReset();
  getImportLog.mockImplementation((id: string) => Promise.resolve({
    datasetId: id, status: 'importing', importError: null, progress: null, lines: [], dropped: 0, retained: true,
  }));
  listDatasets.mockReset();
  listDatasets.mockResolvedValue({ datasets: [] });
  useImportJobsStore.setState({ jobs: {}, order: [], dismissedIds: [], panelOpen: false, focusedId: null });
});

describe('useImportJobsFeed', () => {
  it('follows a Hub import started elsewhere, quietly, and skips a dismissed one (TASK-358)', async () => {
    listDatasets.mockResolvedValue({
      datasets: [
        { id: 'ds-api', status: 'importing', huggingFaceRepoId: 'lerobot/pusht', sourceRevision: 'a'.repeat(40), lerobotVersion: 'v3.0' },
        { id: 'ds-gone', status: 'importing', huggingFaceRepoId: 'lerobot/xarm_lift_medium' },
        { id: 'ds-upload', status: 'importing' },
      ],
    });
    useImportJobsStore.setState({ dismissedIds: ['ds-gone'] });

    renderHook(() => useImportJobsFeed());
    await vi.waitFor(() => expect(store().order).toEqual(['ds-api']));

    expect(listDatasets).toHaveBeenCalledWith({ status: ['importing', 'validating'] });
    expect(store().jobs['ds-api']).toMatchObject({ label: 'lerobot/pusht', notify: false, revision: 'a'.repeat(40), lerobotVersion: 'v3.0' });
    expect(store().panelOpen).toBe(false);
  });

  it('holds no socket while nothing is running', () => {
    renderHook(() => useImportJobsFeed());
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('opens one when an import starts, applies its frames, and lets go when it ends', async () => {
    renderHook(() => useImportJobsFeed());
    act(() => store().track('ds-1', 'lerobot/pusht'));

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(getImportLog).toHaveBeenCalledWith('ds-1');
    const socket = FakeWebSocket.instances[0]!;

    socket.emit({
      type: 'dataset:import:log',
      datasetId: 'ds-1',
      log: { at: '2026-10-12T10:00:00Z', level: 'info', message: 'Downloading 3 files from the Hub' },
    });
    expect(store().jobs['ds-1']!.lines.map((l) => l.message)).toContain('Downloading 3 files from the Hub');

    // Without NATS the row is `ready` by the time "completed" goes out.
    getImportLog.mockImplementation((id: string) => Promise.resolve({
      datasetId: id, status: 'ready', importError: null, progress: null, lines: [], dropped: 0, retained: true,
    }));
    socket.emit({ type: 'dataset:import:completed', datasetId: 'ds-1' });
    await vi.waitFor(() => expect(store().jobs['ds-1']!.state).toBe('succeeded'));
    expect(socket.closed).toBe(true);
  });

  it('stays connected through validation, so a later validation failure is heard (NATS)', async () => {
    renderHook(() => useImportJobsFeed());
    act(() => store().track('ds-1', 'lerobot/pusht'));
    const socket = FakeWebSocket.instances[0]!;

    // The download is done; the row says `validating` and the worker has not answered.
    getImportLog.mockImplementation((id: string) => Promise.resolve({
      datasetId: id, status: 'validating', importError: null, progress: null, lines: [], dropped: 0, retained: true,
    }));
    socket.emit({ type: 'dataset:import:completed', datasetId: 'ds-1' });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(store().jobs['ds-1']!.state).toBe('running');
    expect(socket.closed).toBe(false);

    socket.emit({ type: 'dataset:validation:failed', datasetId: 'ds-1', error: 'missing meta/tasks.parquet' });
    expect(store().jobs['ds-1']).toMatchObject({ state: 'failed', error: 'Validation failed: missing meta/tasks.parquet' });
    expect(socket.closed).toBe(true);
  });
});
