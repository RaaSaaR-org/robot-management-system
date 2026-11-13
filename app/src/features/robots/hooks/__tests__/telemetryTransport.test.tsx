/**
 * @file telemetryTransport.test.tsx
 * @description TASK-485: the telemetry and point-cloud hooks open no socket of
 *   their own in any build (the production build used to dial a hardcoded
 *   `wss://api.neodem.io/...` host on every robot page) and ask the API server
 *   nothing for a robot without a connected agent.
 * @feature robots
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const api = vi.hoisted(() => ({
  getTelemetry: vi.fn(),
  getPointCloud: vi.fn(),
}));

vi.mock('../../api/robotsApi', () => ({ robotsApi: { getTelemetry: api.getTelemetry } }));
vi.mock('../../api/sensorScansApi', () => ({ sensorScansApi: { getPointCloud: api.getPointCloud } }));

import { useTelemetryStream } from '../useTelemetryStream';
import { usePointCloudStream } from '../usePointCloudStream';
import { useRobotsStore } from '../../store/robotsStore';

const FRAME = { robotId: 'sim-robot-001', batteryLevel: 80, memoryUsage: 10, temperature: 30, sensors: {}, timestamp: 't' };

let sockets: string[];
const RealWebSocket = globalThis.WebSocket;

beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
  // Any socket these hooks open is a regression, in dev and in production alike.
  globalThis.WebSocket = class {
    constructor(url: string) {
      sockets.push(url);
    }
    close() {}
    addEventListener() {}
    removeEventListener() {}
  } as unknown as typeof WebSocket;
  api.getTelemetry.mockReset().mockResolvedValue(FRAME);
  api.getPointCloud.mockReset().mockResolvedValue({ robotId: 'sim-robot-001', pointCount: 0, positions: [], intensities: [] });
  useRobotsStore.setState({ telemetryCache: {} });
  vi.stubEnv('DEV', false);
  vi.stubEnv('VITE_DEMO_MODE', '');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  globalThis.WebSocket = RealWebSocket;
});

describe('useTelemetryStream', () => {
  it('polls the API server and opens no socket, in a production build too', async () => {
    const { result } = renderHook(() => useTelemetryStream('sim-robot-001'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(api.getTelemetry).toHaveBeenCalledWith('sim-robot-001');
    expect(result.current.telemetry).toEqual(FRAME);
    expect(result.current.isConnected).toBe(true);
    expect(sockets).toEqual([]);
  });

  it('asks nothing while disabled, and reports disconnected rather than an error', async () => {
    const { result } = renderHook(() => useTelemetryStream('demo-g1-dex3', { enabled: false }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(api.getTelemetry).not.toHaveBeenCalled();
    expect(sockets).toEqual([]);
    expect(result.current).toMatchObject({ telemetry: null, status: 'disconnected', isConnected: false, isPolling: false });
    // Retry on a disabled stream stays quiet as well.
    await act(async () => {
      result.current.connect();
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(api.getTelemetry).not.toHaveBeenCalled();
  });

  it('asks nothing without a robot id', async () => {
    renderHook(() => useTelemetryStream(''));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(api.getTelemetry).not.toHaveBeenCalled();
    expect(sockets).toEqual([]);
  });

  it('starts when the robot connects and stops when it goes away again', async () => {
    const { result, rerender } = renderHook(({ enabled }) => useTelemetryStream('demo-g1-dex3', { enabled }), {
      initialProps: { enabled: false },
    });
    rerender({ enabled: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(api.getTelemetry).toHaveBeenCalledTimes(1);
    expect(result.current.isConnected).toBe(true);

    rerender({ enabled: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(api.getTelemetry).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({ telemetry: null, isConnected: false });
  });

  it('prefers a frame the event socket broadcast over polling', async () => {
    const { result } = renderHook(() => useTelemetryStream('sim-robot-001'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    const polled = api.getTelemetry.mock.calls.length;
    const broadcast = { ...FRAME, batteryLevel: 55 };
    act(() => {
      useRobotsStore.getState().updateTelemetry('sim-robot-001', broadcast as never);
    });
    expect(result.current.telemetry).toMatchObject({ batteryLevel: 55 });
    expect(result.current.isPolling).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_100);
    });
    // The poll tick inside the freshness window is skipped.
    expect(api.getTelemetry.mock.calls.length).toBe(polled);
  });
});

describe('usePointCloudStream', () => {
  it('polls the snapshot route and opens no socket, in a production build too', async () => {
    renderHook(() => usePointCloudStream('sim-robot-001', { enabled: true }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(api.getPointCloud).toHaveBeenCalledWith('sim-robot-001', undefined);
    expect(sockets).toEqual([]);
  });

  it('asks nothing while disabled', async () => {
    const { result } = renderHook(() => usePointCloudStream('demo-g1-dex3', { enabled: false }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(api.getPointCloud).not.toHaveBeenCalled();
    expect(sockets).toEqual([]);
    expect(result.current.isConnected).toBe(false);
  });
});
