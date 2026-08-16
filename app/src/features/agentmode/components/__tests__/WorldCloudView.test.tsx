/**
 * @file WorldCloudView.test.tsx
 * @description The robot's 3-D world cloud on the Map tab (TASK-211): the
 *              orbit target is frozen per robot so the 3 s poll — which hands
 *              the view a fresh cloud object every time — does not snap the
 *              camera back to the centroid while the operator is orbiting. The
 *              points themselves still follow every poll; a new robot gets a
 *              new pivot.
 * @feature agentmode
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { WorldCloudView } from '../WorldCloudView';
import { useAgentModeStore } from '../../store/agentmodeStore';
import type { RobotCloudPayload } from '../../types/agentmode.types';

const viewerProps = vi.fn();
vi.mock('@/features/robots/components/visualization/PointCloudViewer', () => ({
  PointCloudViewer: (props: Record<string, unknown>) => {
    viewerProps(props);
    return <div data-testid="viewer" />;
  },
}));

function encode(xyz: number[]): string {
  const f = new Float32Array(xyz);
  return btoa(String.fromCharCode(...new Uint8Array(f.buffer)));
}

const cloud = (xyz: number[], over: Partial<RobotCloudPayload> = {}): RobotCloudPayload => ({
  ok: true,
  frame: 'odom',
  frameId: 'boot',
  voxelM: 0.05,
  pointCount: xyz.length / 3,
  returned: xyz.length / 3,
  encoding: 'f32-xyz-b64',
  positions: encode(xyz),
  frames: 1,
  lastIntegratedAt: new Date().toISOString(),
  pose: null,
  ...over,
});

const lastProps = () => viewerProps.mock.calls[viewerProps.mock.calls.length - 1][0] as { orbitTarget: [number, number, number]; frame: { pointCount: number } };

beforeEach(() => {
  useAgentModeStore.getState().reset();
  useAgentModeStore.setState({ fetchRobotCloud: vi.fn(async () => {}) });
  viewerProps.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (document as unknown as { visibilityState?: unknown }).visibilityState;
});

/** Take over `document.visibilityState`; the afterEach hands it back. */
function stubVisibility(get: () => DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get });
}

describe('WorldCloudView polling', () => {
  /**
   * One poll is ~1.3 MB of base64 off the robot. The grid poll has always
   * skipped hidden tabs; this one did not, so an operator who left the Map tab
   * on 3-D and switched browser tabs had the robot encode full clouds for ten
   * minutes for a view nobody was looking at.
   */
  it('does not poll while the tab is hidden, and catches up the moment it comes back', async () => {
    vi.useFakeTimers();
    let visibility: DocumentVisibilityState = 'visible';
    stubVisibility(() => visibility);
    const fetchRobotCloud = vi.fn(async () => {});
    useAgentModeStore.setState({ fetchRobotCloud });

    render(<WorldCloudView robotId="g1" pollMs={3000} />);
    expect(fetchRobotCloud).toHaveBeenCalledTimes(1); // the first load is still immediate

    visibility = 'hidden';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9500);
    });
    expect(fetchRobotCloud).toHaveBeenCalledTimes(1);

    visibility = 'visible';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(fetchRobotCloud).toHaveBeenCalledTimes(2);

    // …and the cadence resumes with the tab.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(fetchRobotCloud).toHaveBeenCalledTimes(3);
  });

  it('never stacks two cloud reads: a slow one is skipped, not queued', async () => {
    // On a slow link the bare interval piled up 1.3 MB requests, and an
    // out-of-order response flipped the view back to an older cloud.
    vi.useFakeTimers();
    stubVisibility(() => 'visible');
    let release: () => void = () => {};
    const fetchRobotCloud = vi.fn(
      (_robotId: string, _maxPoints?: number) =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    useAgentModeStore.setState({ fetchRobotCloud });

    render(<WorldCloudView robotId="g1" pollMs={1000} />);
    expect(fetchRobotCloud).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetchRobotCloud).toHaveBeenCalledTimes(1);

    await act(async () => {
      release();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetchRobotCloud).toHaveBeenCalledTimes(2);
  });

  it('stops polling on unmount', async () => {
    vi.useFakeTimers();
    stubVisibility(() => 'visible');
    const fetchRobotCloud = vi.fn(async () => {});
    useAgentModeStore.setState({ fetchRobotCloud });
    const { unmount } = render(<WorldCloudView robotId="g1" pollMs={1000} />);
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetchRobotCloud).toHaveBeenCalledTimes(1);
    // The visibility listener leaves with it: a return to the tab must not
    // wake a view that is gone.
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(fetchRobotCloud).toHaveBeenCalledTimes(1);
  });
});

describe('WorldCloudView', () => {
  it('shows the empty state without a cloud', () => {
    render(<WorldCloudView robotId="g1" />);
    expect(screen.getByTestId('agent-cloud-empty')).toBeInTheDocument();
  });

  it('keeps the orbit target from the first cloud when a later poll delivers a new cloud with another centroid', () => {
    useAgentModeStore.setState({ robotCloud: cloud([0, 0, 0, 2, 2, 0]), robotCloudStatus: 'ok' });
    const { rerender } = render(<WorldCloudView robotId="g1" />);
    expect(screen.getByTestId('agent-cloud-view')).toBeInTheDocument();
    const first = lastProps();
    expect(first.orbitTarget).toEqual([1, 1, 0]);

    // A fresh object with a very different centroid — as every poll produces.
    act(() => useAgentModeStore.setState({ robotCloud: cloud([10, 10, 0, 12, 12, 0, 14, 14, 0]) }));
    rerender(<WorldCloudView robotId="g1" />);
    const second = lastProps();
    expect(second.frame.pointCount).toBe(3); // the points did follow the poll
    expect(second.orbitTarget).toBe(first.orbitTarget); // the pivot did not
  });

  it('takes a new orbit target when the robot changes', () => {
    useAgentModeStore.setState({ robotCloud: cloud([0, 0, 0, 2, 2, 0]), robotCloudStatus: 'ok' });
    const { rerender } = render(<WorldCloudView robotId="g1" />);
    expect(lastProps().orbitTarget).toEqual([1, 1, 0]);

    act(() => useAgentModeStore.setState({ robotCloud: cloud([10, 10, 0, 12, 12, 0]) }));
    rerender(<WorldCloudView robotId="h1" />);
    expect(lastProps().orbitTarget).toEqual([11, 11, 0]);
  });
});
