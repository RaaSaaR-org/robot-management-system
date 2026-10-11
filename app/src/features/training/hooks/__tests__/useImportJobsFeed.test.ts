/**
 * @file useImportJobsFeed.test.ts
 * @description The layout-level import feed (TASK-352): a socket only while
 *              something runs, frames into the store, a backfill on open.
 * @feature training
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const getImportLog = vi.fn();
vi.mock('../../api/trainingApi', () => ({
  trainingApi: {
    getImportLog: (...a: unknown[]) => getImportLog(...a),
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
  useImportJobsStore.setState({ jobs: {}, order: [], panelOpen: false, focusedId: null });
});

describe('useImportJobsFeed', () => {
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
