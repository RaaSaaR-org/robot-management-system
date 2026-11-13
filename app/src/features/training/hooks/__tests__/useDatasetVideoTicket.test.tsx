/**
 * @file useDatasetVideoTicket.test.tsx
 * @description The ticket a dataset's videos are played with (TASK-478).
 * @feature training
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../../api/datasetVideoApi', () => ({ getDatasetVideoTicket: vi.fn() }));

import { getDatasetVideoTicket } from '../../api/datasetVideoApi';
import { useDatasetVideoTicket } from '../useDatasetVideoTicket';

const mockGet = vi.mocked(getDatasetVideoTicket);

describe('useDatasetVideoTicket', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('is not ready until the ticket arrives, then hands it over', async () => {
    mockGet.mockResolvedValue('tkt-1');

    const { result } = renderHook(() => useDatasetVideoTicket('ds-1'));
    expect(result.current).toMatchObject({ ticket: null, ready: false });

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.ticket).toBe('tkt-1');
    expect(mockGet).toHaveBeenCalledWith('ds-1', { fresh: false });
  });

  it('is ready without a ticket when the request fails — sign-in may simply be off', async () => {
    mockGet.mockRejectedValue(new Error('404'));

    const { result } = renderHook(() => useDatasetVideoTicket('ds-1'));

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.ticket).toBeNull();
  });

  it('asks for nothing without a dataset', () => {
    const { result } = renderHook(() => useDatasetVideoTicket(undefined));

    expect(mockGet).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ ticket: null, ready: false });
  });

  it('never shows one dataset the ticket of another', async () => {
    mockGet.mockImplementation(async (id: string) => `tkt-${id}`);
    const { result, rerender } = renderHook(({ id }: { id: string }) => useDatasetVideoTicket(id), {
      initialProps: { id: 'ds-1' },
    });
    await waitFor(() => expect(result.current.ticket).toBe('tkt-ds-1'));

    rerender({ id: 'ds-2' });
    expect(result.current).toMatchObject({ ticket: null, ready: false });
    await waitFor(() => expect(result.current.ticket).toBe('tkt-ds-2'));
  });

  it('re-checks on a new episode and keeps the ticket in hand meanwhile', async () => {
    mockGet.mockResolvedValueOnce('tkt-1').mockResolvedValueOnce('tkt-2');
    const { result, rerender } = renderHook(
      ({ episode }: { episode: number }) => useDatasetVideoTicket('ds-1', episode),
      { initialProps: { episode: 0 } }
    );
    await waitFor(() => expect(result.current.ticket).toBe('tkt-1'));

    rerender({ episode: 1 });
    // No blank frame between episodes: still ready, still the old ticket.
    expect(result.current).toMatchObject({ ticket: 'tkt-1', ready: true });
    await waitFor(() => expect(result.current.ticket).toBe('tkt-2'));
    expect(mockGet).toHaveBeenLastCalledWith('ds-1', { fresh: false });
  });

  it('refresh() asks past the cache', async () => {
    mockGet.mockResolvedValueOnce('tkt-1').mockResolvedValueOnce('tkt-2');
    const { result } = renderHook(() => useDatasetVideoTicket('ds-1'));
    await waitFor(() => expect(result.current.ticket).toBe('tkt-1'));

    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.ticket).toBe('tkt-2'));
    expect(mockGet).toHaveBeenLastCalledWith('ds-1', { fresh: true });
  });

  it('keeps the ticket in hand when a refresh is refused', async () => {
    mockGet.mockResolvedValueOnce('tkt-1').mockRejectedValueOnce(new Error('503'));
    const { result } = renderHook(() => useDatasetVideoTicket('ds-1'));
    await waitFor(() => expect(result.current.ticket).toBe('tkt-1'));

    act(() => result.current.refresh());

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
    expect(result.current).toMatchObject({ ticket: 'tkt-1', ready: true });
  });
});
