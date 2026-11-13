/**
 * @file EpisodeViewer.throttle.test.tsx
 * @description A rate-limited episode video waits and loads again by itself,
 *              says so only when the wait lasts, and the play button follows
 *              the video (TASK-482).
 * @feature training
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { RATE_LIMIT_HINT_DELAY_MS, isRateLimitHintVisible, resetRateLimitStatus } from '@/api/rateLimitStatus';
import { EpisodeViewer, type EpisodeViewerProps } from '../EpisodeViewer';

const EGO = 'observation.images.ego_view';
const srcOf = (episode: number) => (cam: string) => `/api/datasets/ds-1/episodes/${episode}/video/${cam}?ticket=tkt-1`;

function props(overrides: Partial<EpisodeViewerProps> = {}): EpisodeViewerProps {
  return {
    cameras: [EGO],
    srcFor: srcOf(0),
    primaryCamera: EGO,
    videoRefs: { current: {} },
    onTimeUpdate: vi.fn(),
    onLoadedMetadata: vi.fn(),
    onEnded: vi.fn(),
    isPlaying: false,
    onPlayPause: vi.fn(),
    currentTime: 0,
    duration: 10,
    onSeek: vi.fn(),
    speed: '1',
    onSpeedChange: vi.fn(),
    ...overrides,
  };
}

/** Fire the media `error` event for a failed request (MEDIA_ERR_SRC_NOT_SUPPORTED). */
async function failVideo(video: HTMLVideoElement) {
  Object.defineProperty(video, 'error', { configurable: true, value: { code: 4 } });
  fireEvent.error(video);
  // Let the probe's promise settle.
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

const video = (container: HTMLElement) => container.querySelector('video');

beforeEach(() => {
  vi.useFakeTimers();
  resetRateLimitStatus();
});

afterEach(() => {
  act(() => resetRateLimitStatus());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a rate-limited episode video', () => {
  it('waits as long as the server asked, then loads again by itself', async () => {
    const probeThrottle = vi.fn(async () => 3000);
    const onReload = vi.fn();
    const { container } = render(<EpisodeViewer {...props({ probeThrottle, onReload })} />);
    const first = video(container)!;

    await failVideo(first);

    expect(probeThrottle).toHaveBeenCalledWith(expect.stringContaining('/episodes/0/video/'));
    // Not a failure, and not a ticket problem: nothing is asked of the viewer.
    expect(screen.queryByTestId('video-load-failed')).not.toBeInTheDocument();
    expect(onReload).not.toHaveBeenCalled();
    expect(video(container)).toBeNull();

    act(() => { vi.advanceTimersByTime(2999); });
    expect(video(container)).toBeNull();

    act(() => { vi.advanceTimersByTime(1); });
    // A new element: the same URL, requested again.
    expect(video(container)).not.toBeNull();
    expect(video(container)).not.toBe(first);
    expect(video(container)).toHaveAttribute('src', first.getAttribute('src'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(isRateLimitHintVisible()).toBe(false);
  });

  it('says nothing for a wait shorter than a moment', async () => {
    const { container } = render(<EpisodeViewer {...props({ probeThrottle: async () => 1000 })} />);
    await failVideo(video(container)!);

    act(() => { vi.advanceTimersByTime(999); });
    expect(screen.queryByTestId('video-throttled')).not.toBeInTheDocument();
    expect(screen.getByTestId('video-pending')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByTestId('video-throttled')).not.toBeInTheDocument();
    expect(video(container)).not.toBeNull();
  });

  it('says it is waiting once the wait lasts, in place of the picture', async () => {
    const { container } = render(<EpisodeViewer {...props({ probeThrottle: async () => 20_000 })} />);
    await failVideo(video(container)!);

    act(() => { vi.advanceTimersByTime(RATE_LIMIT_HINT_DELAY_MS); });

    const notice = screen.getByTestId('video-throttled');
    expect(notice).toHaveTextContent('Waiting for the server');
    expect(notice).toHaveTextContent('loads by itself');
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(20_000); });
    expect(screen.queryByTestId('video-throttled')).not.toBeInTheDocument();
    expect(video(container)).not.toBeNull();
  });

  it('stops after a few tries and offers Retry, rather than loop for ever', async () => {
    const probeThrottle = vi.fn(async () => 1000);
    const { container } = render(<EpisodeViewer {...props({ probeThrottle })} />);

    for (let reload = 0; reload < 4; reload++) {
      await failVideo(video(container)!);
      expect(screen.queryByTestId('video-load-failed')).not.toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(1000); });
    }
    await failVideo(video(container)!);

    expect(screen.getByTestId('video-load-failed')).toBeInTheDocument();
    expect(probeThrottle).toHaveBeenCalledTimes(5);

    // Retry is the viewer asking: the automatic tries start over.
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await failVideo(video(container)!);
    expect(screen.queryByTestId('video-load-failed')).not.toBeInTheDocument();
  });

  it('treats any other failure as before: one reload with fresh URLs, then the error', async () => {
    const onReload = vi.fn();
    const { container, rerender } = render(<EpisodeViewer {...props({ probeThrottle: async () => null, onReload })} />);

    await failVideo(video(container)!);
    expect(onReload).toHaveBeenCalledTimes(1);

    const fresh = (cam: string) => `/api/datasets/ds-1/episodes/0/video/${cam}?ticket=tkt-2`;
    rerender(<EpisodeViewer {...props({ probeThrottle: async () => null, onReload, srcFor: fresh })} />);
    await failVideo(video(container)!);

    expect(screen.getByTestId('video-load-failed')).toBeInTheDocument();
  });

  it('treats a probe that itself fails as any other failure', async () => {
    const probeThrottle = vi.fn(async () => { throw new Error('offline'); });
    const { container } = render(<EpisodeViewer {...props({ probeThrottle })} />);
    await failVideo(video(container)!);
    expect(screen.getByTestId('video-load-failed')).toBeInTheDocument();
  });

  it('drops the answer for an episode the viewer has already left', async () => {
    let answer: (ms: number | null) => void = () => {};
    const probeThrottle = vi.fn(() => new Promise<number | null>((resolve) => { answer = resolve; }));
    const { container, rerender } = render(<EpisodeViewer {...props({ probeThrottle })} />);

    Object.defineProperty(video(container)!, 'error', { configurable: true, value: { code: 4 } });
    fireEvent.error(video(container)!);
    rerender(<EpisodeViewer {...props({ probeThrottle, srcFor: srcOf(1) })} />);
    await act(async () => { answer(30_000); await Promise.resolve(); await Promise.resolve(); });

    // Episode 1 plays; episode 0's 429 does not put it on hold.
    expect(video(container)).toHaveAttribute('src', expect.stringContaining('/episodes/1/'));
    act(() => { vi.advanceTimersByTime(RATE_LIMIT_HINT_DELAY_MS); });
    expect(screen.queryByTestId('video-throttled')).not.toBeInTheDocument();
  });
});

describe('the play button', () => {
  it('follows the primary video starting and stopping', () => {
    const onPlayingChange = vi.fn();
    const { container } = render(<EpisodeViewer {...props({ onPlayingChange })} />);

    fireEvent.play(video(container)!);
    expect(onPlayingChange).toHaveBeenLastCalledWith(true);

    fireEvent.pause(video(container)!);
    expect(onPlayingChange).toHaveBeenLastCalledWith(false);
  });
});
