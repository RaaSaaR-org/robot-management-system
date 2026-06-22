/**
 * @file useApi.test.ts
 * @description Tests for the useApi and useApiOnce hooks (loading/success/error
 *   state machine, callbacks, abort/reset, immediate execution, and unmount cleanup).
 *   The hook receives its async apiFunction by argument, so the external boundary we
 *   mock is that function itself (vi.fn returning a resolved/rejected promise).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useApi, useApiOnce } from '../useApi';

describe('useApi', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts in the idle state with no data or error', () => {
    const apiFn = vi.fn().mockResolvedValue('ok');
    const { result } = renderHook(() => useApi(apiFn));

    expect(result.current.status).toBe('idle');
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.isSuccess).toBe(false);
    expect(apiFn).not.toHaveBeenCalled();
  });

  it('resolves the success path: sets data, success status, and returns the value', async () => {
    const apiFn = vi.fn().mockResolvedValue({ id: 'robot-123' });
    const onSuccess = vi.fn();
    const onSettled = vi.fn();
    const { result } = renderHook(() => useApi(apiFn, { onSuccess, onSettled }));

    let returned: unknown;
    await act(async () => {
      returned = await result.current.execute('robot-123');
    });

    expect(apiFn).toHaveBeenCalledWith('robot-123');
    expect(returned).toEqual({ id: 'robot-123' });
    expect(result.current.data).toEqual({ id: 'robot-123' });
    expect(result.current.status).toBe('success');
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(onSuccess).toHaveBeenCalledWith({ id: 'robot-123' });
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('transitions through the loading state while the request is in flight', async () => {
    let resolveFn!: (value: string) => void;
    const apiFn = vi.fn().mockImplementation(
      () => new Promise<string>((resolve) => { resolveFn = resolve; })
    );
    const { result } = renderHook(() => useApi(apiFn));

    let executePromise!: Promise<unknown>;
    act(() => {
      executePromise = result.current.execute();
    });

    // While pending, status should be loading.
    await waitFor(() => expect(result.current.isLoading).toBe(true));
    expect(result.current.status).toBe('loading');
    expect(result.current.isSuccess).toBe(false);

    await act(async () => {
      resolveFn('done');
      await executePromise;
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.status).toBe('success');
    expect(result.current.data).toBe('done');
  });

  it('handles the error path: sets a normalized ApiError, error status, returns null', async () => {
    const apiFn = vi.fn().mockRejectedValue(new Error('boom'));
    const onError = vi.fn();
    const onSettled = vi.fn();
    const { result } = renderHook(() => useApi(apiFn, { onError, onSettled }));

    let returned: unknown;
    await act(async () => {
      returned = await result.current.execute();
    });

    expect(returned).toBeNull();
    expect(result.current.status).toBe('error');
    expect(result.current.isError).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toMatchObject({
      code: 'UNKNOWN_ERROR',
      message: 'boom',
      statusCode: 0,
    });
    expect(onError).toHaveBeenCalledWith(result.current.error);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('falls back to a generic message for non-Error rejections', async () => {
    const apiFn = vi.fn().mockRejectedValue('plain string failure');
    const { result } = renderHook(() => useApi(apiFn));

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toMatchObject({
      code: 'UNKNOWN_ERROR',
      message: 'An unknown error occurred',
      statusCode: 0,
    });
  });

  it('clears a previous error when a subsequent call succeeds', async () => {
    const apiFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('first fails'))
      .mockResolvedValueOnce('second works');
    const { result } = renderHook(() => useApi(apiFn));

    await act(async () => {
      await result.current.execute();
    });
    expect(result.current.isError).toBe(true);

    await act(async () => {
      await result.current.execute();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.status).toBe('success');
    expect(result.current.data).toBe('second works');
  });

  it('reset() returns the hook to its idle state', async () => {
    const apiFn = vi.fn().mockResolvedValue('value');
    const { result } = renderHook(() => useApi(apiFn));

    await act(async () => {
      await result.current.execute();
    });
    expect(result.current.status).toBe('success');

    act(() => {
      result.current.reset();
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('runs immediately on mount with initialArgs when immediate is set', async () => {
    const apiFn = vi.fn().mockResolvedValue('auto');
    const { result } = renderHook(() =>
      useApi(apiFn, { immediate: true, initialArgs: ['x', 'y'] })
    );

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(apiFn).toHaveBeenCalledWith('x', 'y');
    expect(result.current.data).toBe('auto');
  });

  it('ignores AbortError rejections without entering the error state', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    const apiFn = vi.fn().mockRejectedValue(abortErr);
    const onError = vi.fn();
    const { result } = renderHook(() => useApi(apiFn, { onError }));

    let returned: unknown;
    await act(async () => {
      returned = await result.current.execute();
    });

    expect(returned).toBeNull();
    expect(result.current.status).not.toBe('error');
    expect(result.current.error).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not update state (or call callbacks) after unmount', async () => {
    let resolveFn!: (value: string) => void;
    const apiFn = vi.fn().mockImplementation(
      () => new Promise<string>((resolve) => { resolveFn = resolve; })
    );
    const onSuccess = vi.fn();
    const { result, unmount } = renderHook(() => useApi(apiFn, { onSuccess }));

    let executePromise!: Promise<unknown>;
    act(() => {
      executePromise = result.current.execute();
    });

    unmount();

    await act(async () => {
      resolveFn('late');
      await executePromise;
    });

    // mountedRef gate prevents state writes and success callback after unmount.
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('aborts the in-flight controller when execute is called again', async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort');
    const apiFn = vi.fn().mockResolvedValue('ok');
    const { result } = renderHook(() => useApi(apiFn));

    await act(async () => {
      await result.current.execute();
    });
    // Second execute should abort the controller created by the first.
    await act(async () => {
      await result.current.execute();
    });

    expect(abortSpy).toHaveBeenCalled();
    abortSpy.mockRestore();
  });
});

describe('useApiOnce', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('executes immediately and exposes state without an execute function', async () => {
    const apiFn = vi.fn().mockResolvedValue('once-result');
    const { result } = renderHook(() => useApiOnce(apiFn));

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(apiFn).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBe('once-result');
    expect('execute' in result.current).toBe(false);
  });

  it('surfaces errors from the one-time call', async () => {
    const apiFn = vi.fn().mockRejectedValue(new Error('once-fail'));
    const { result } = renderHook(() => useApiOnce(apiFn));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toMatchObject({ message: 'once-fail' });
  });
});
