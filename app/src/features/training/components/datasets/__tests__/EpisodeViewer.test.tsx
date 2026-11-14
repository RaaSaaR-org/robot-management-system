/**
 * @file EpisodeViewer.test.tsx
 * @description The episode player says why there is no picture, instead of
 *              showing a blank box (TASK-478).
 * @feature training
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { EpisodeViewer, type EpisodeViewerProps } from '../EpisodeViewer';

const EGO = 'observation.images.ego_view';

function props(overrides: Partial<EpisodeViewerProps> = {}): EpisodeViewerProps {
  return {
    cameras: [EGO],
    srcFor: (cam) => `/api/datasets/ds-1/episodes/0/video/${cam}?ticket=tkt-1`,
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

/** What the browser answers `canPlayType` with, for every `<video>`. */
function browserPlays(answer: CanPlayTypeResult) {
  return vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue(answer);
}

/** Fire the media `error` event the way a browser does, with a MediaError code. */
function failVideo(video: HTMLVideoElement, code: number) {
  Object.defineProperty(video, 'error', { configurable: true, value: { code } });
  fireEvent.error(video);
}

const video = (container: HTMLElement) => container.querySelector('video');

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('EpisodeViewer', () => {
  it('plays the URL it is given', () => {
    browserPlays('probably');
    const { container } = render(<EpisodeViewer {...props({ codecFor: () => 'av1' })} />);

    expect(video(container)).toHaveAttribute('src', `/api/datasets/ds-1/episodes/0/video/${EGO}?ticket=tkt-1`);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('mounts no video while the ticket is on its way', () => {
    browserPlays('probably');
    const { container, rerender } = render(<EpisodeViewer {...props({ ready: false })} />);
    expect(video(container)).toBeNull();

    rerender(<EpisodeViewer {...props({ ready: true })} />);
    expect(video(container)).not.toBeNull();
  });

  describe('a codec this browser cannot play', () => {
    it('names AV1 and a browser that plays it, and requests nothing', () => {
      const canPlay = browserPlays('');
      const { container } = render(<EpisodeViewer {...props({ codecFor: () => 'av1' })} />);

      const notice = screen.getByTestId('video-codec-unsupported');
      expect(notice).toHaveTextContent("This browser can't play AV1 video");
      expect(notice).toHaveTextContent('Open this page in a current Chrome or Firefox to watch it.');
      expect(canPlay).toHaveBeenCalledWith('video/mp4; codecs="av01.0.05M.08"');
      expect(video(container)).toBeNull();
      // It is information, not an alarm, and there is nothing to retry.
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    });

    it('keeps the playback controls, and the camera label', () => {
      browserPlays('');
      render(<EpisodeViewer {...props({ codecFor: () => 'av1' })} />);

      expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
      expect(screen.getByText('ego_view')).toBeInTheDocument();
    });

    it('says so per camera: one that plays still plays', () => {
      vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockImplementation((mime) =>
        mime.includes('av01') ? '' : 'probably'
      );
      const { container } = render(
        <EpisodeViewer
          {...props({
            cameras: [EGO, 'observation.images.wrist'],
            codecFor: (cam) => (cam === EGO ? 'av1' : 'h264'),
          })}
        />
      );

      expect(screen.getAllByTestId('video-codec-unsupported')).toHaveLength(1);
      expect(container.querySelectorAll('video')).toHaveLength(1);
    });

    it('tries a codec the dataset does not declare', () => {
      const canPlay = browserPlays('');
      const { container } = render(<EpisodeViewer {...props()} />);

      expect(canPlay).not.toHaveBeenCalled();
      expect(video(container)).not.toBeNull();
    });

    it('names the codec when the bytes arrive and do not decode', () => {
      browserPlays('maybe');
      const { container } = render(<EpisodeViewer {...props({ codecFor: () => 'av1' })} />);

      failVideo(video(container)!, 3);

      expect(screen.getByTestId('video-codec-unsupported')).toHaveTextContent("This browser can't play AV1 video");
    });

    it('still says something when a decode fails on an undeclared codec', () => {
      const { container } = render(<EpisodeViewer {...props()} />);

      failVideo(video(container)!, 3);

      expect(screen.getByTestId('video-codec-unsupported')).toHaveTextContent("This browser can't decode this video");
    });
  });

  describe('a video that does not load', () => {
    it('shows an error state with Retry — a 404 or a network failure', () => {
      const { container } = render(<EpisodeViewer {...props()} />);

      failVideo(video(container)!, 4);

      const notice = screen.getByTestId('video-load-failed');
      expect(notice).toHaveTextContent("Couldn't load this video");
      expect(video(container)).toBeNull();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    it('mentions the codec as a possible cause when one is declared', () => {
      browserPlays('probably');
      const { container } = render(<EpisodeViewer {...props({ codecFor: () => 'av1' })} />);

      failVideo(video(container)!, 4);

      expect(screen.getByTestId('video-load-failed')).toHaveTextContent('It is stored as AV1');
    });

    it('Retry requests the video again', () => {
      const { container } = render(<EpisodeViewer {...props()} />);
      const first = video(container)!;
      failVideo(first, 4);

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

      expect(screen.queryByTestId('video-load-failed')).not.toBeInTheDocument();
      // A new element: the only way to make a browser re-request the same URL.
      expect(video(container)).not.toBeNull();
      expect(video(container)).not.toBe(first);
    });

    it('first asks once for fresh URLs — an expired ticket recovers by itself', () => {
      const onReload = vi.fn();
      const { container, rerender } = render(<EpisodeViewer {...props({ onReload })} />);

      failVideo(video(container)!, 4);

      expect(onReload).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('video-load-failed')).not.toBeInTheDocument();

      // The page answers with a new ticket; the video loads it.
      const fresh = (cam: string) => `/api/datasets/ds-1/episodes/0/video/${cam}?ticket=tkt-2`;
      rerender(<EpisodeViewer {...props({ onReload, srcFor: fresh })} />);
      expect(video(container)).toHaveAttribute('src', expect.stringContaining('ticket=tkt-2'));
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('shows the failure when the fresh URL fails too, and does not loop', () => {
      const onReload = vi.fn();
      const { container, rerender } = render(<EpisodeViewer {...props({ onReload })} />);
      failVideo(video(container)!, 4);
      const fresh = (cam: string) => `/api/datasets/ds-1/episodes/0/video/${cam}?ticket=tkt-2`;
      rerender(<EpisodeViewer {...props({ onReload, srcFor: fresh })} />);

      failVideo(video(container)!, 4);

      expect(screen.getByTestId('video-load-failed')).toBeInTheDocument();
      expect(onReload).toHaveBeenCalledTimes(1);

      // Retry is the viewer asking, so it asks for fresh URLs again.
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(onReload).toHaveBeenCalledTimes(2);
    });

    it('shows the failure when no fresh URL ever comes', () => {
      vi.useFakeTimers();
      const onReload = vi.fn();
      const { container } = render(<EpisodeViewer {...props({ onReload })} />);
      failVideo(video(container)!, 4);
      expect(screen.queryByTestId('video-load-failed')).not.toBeInTheDocument();

      act(() => { vi.advanceTimersByTime(4000); });

      expect(screen.getByTestId('video-load-failed')).toBeInTheDocument();
    });

    it('starts clean on another episode', () => {
      const { container, rerender } = render(<EpisodeViewer {...props()} />);
      failVideo(video(container)!, 4);
      expect(screen.getByTestId('video-load-failed')).toBeInTheDocument();

      const next = (cam: string) => `/api/datasets/ds-1/episodes/1/video/${cam}?ticket=tkt-1`;
      rerender(<EpisodeViewer {...props({ srcFor: next })} />);

      expect(screen.queryByTestId('video-load-failed')).not.toBeInTheDocument();
      expect(video(container)).toHaveAttribute('src', expect.stringContaining('/episodes/1/'));
    });
  });

  describe('controls that tell the truth (TASK-484)', () => {
    it('shows the playhead and the total in tenths, and never past the end', () => {
      render(<EpisodeViewer {...props({ currentTime: 19.9, duration: 19.67 })} />);
      expect(screen.getByTestId('transport-clock')).toHaveTextContent('0:19.7 / 0:19.7');
      expect(screen.getByLabelText('Seek')).toHaveValue('19.67');
    });

    it('reports every camera that has loaded, by name', () => {
      const onLoadedMetadata = vi.fn();
      const WRIST = 'observation.images.wrist';
      const { container } = render(
        <EpisodeViewer {...props({ cameras: [EGO, WRIST], onLoadedMetadata })} />,
      );
      const [first, second] = Array.from(container.querySelectorAll('video'));
      fireEvent.loadedMetadata(second!);
      fireEvent.loadedMetadata(first!);
      expect(onLoadedMetadata.mock.calls).toEqual([[WRIST], [EGO]]);
    });

    it('passes on a pause of the primary video only', () => {
      const onPlayingChange = vi.fn();
      const { container } = render(
        <EpisodeViewer {...props({ cameras: [EGO, 'observation.images.wrist'], onPlayingChange })} />,
      );
      const [first, second] = Array.from(container.querySelectorAll('video'));
      fireEvent.pause(second!);
      expect(onPlayingChange).not.toHaveBeenCalled();
      fireEvent.pause(first!);
      expect(onPlayingChange).toHaveBeenCalledTimes(1);
      expect(onPlayingChange).toHaveBeenLastCalledWith(false);
    });

    it('says when a camera ends in a notice instead of a video', () => {
      const onFailure = vi.fn();
      const { container } = render(<EpisodeViewer {...props({ onFailure })} />);
      expect(onFailure).not.toHaveBeenCalled();
      failVideo(video(container)!, 4);
      expect(screen.getByTestId('video-load-failed')).toBeInTheDocument();
      expect(onFailure).toHaveBeenCalledWith(EGO);
    });

    it('does not offer Play when the browser can play none of the cameras', () => {
      browserPlays('');
      render(<EpisodeViewer {...props({ codecFor: () => 'av1' })} />);
      expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
      expect(screen.getByLabelText('Seek')).toBeDisabled();
    });

    it('offers Play while one camera can still play', () => {
      browserPlays('');
      const WRIST = 'observation.images.wrist';
      render(
        <EpisodeViewer
          {...props({ cameras: [EGO, WRIST], codecFor: (cam) => (cam === EGO ? 'av1' : undefined) })}
        />,
      );
      expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled();
    });
  });

  describe('a video that is slow to arrive (TASK-501)', () => {
    it('says nothing for the first moment, then that it is loading', () => {
      vi.useFakeTimers();
      browserPlays('probably');
      render(<EpisodeViewer {...props()} />);
      expect(screen.queryByTestId('video-loading')).not.toBeInTheDocument();

      act(() => { vi.advanceTimersByTime(500); });
      expect(screen.getByTestId('video-loading')).toBeInTheDocument();
      expect(screen.getByRole('status', { name: 'Loading video…' })).toBeInTheDocument();
      expect(screen.queryByText('Still loading')).not.toBeInTheDocument();
    });

    it('offers Retry once it has taken long, and Retry requests the video again', () => {
      vi.useFakeTimers();
      browserPlays('probably');
      const onReload = vi.fn();
      const { container } = render(<EpisodeViewer {...props({ onReload })} />);
      const first = video(container);

      act(() => { vi.advanceTimersByTime(8000); });
      expect(screen.getByText('Still loading')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

      expect(onReload).toHaveBeenCalledTimes(1);
      expect(video(container)).not.toBe(first);
      // The new request starts its own wait.
      expect(screen.queryByTestId('video-loading')).not.toBeInTheDocument();
    });

    it('goes when the video answers, and stays away through a seek', () => {
      vi.useFakeTimers();
      browserPlays('probably');
      const { container } = render(<EpisodeViewer {...props()} />);
      act(() => { vi.advanceTimersByTime(500); });
      expect(screen.getByTestId('video-loading')).toBeInTheDocument();

      fireEvent.loadedMetadata(video(container)!);
      expect(screen.queryByTestId('video-loading')).not.toBeInTheDocument();

      // A seek makes the element wait for data again: that is not a load.
      fireEvent.seeking(video(container)!);
      fireEvent.waiting(video(container)!);
      act(() => { vi.advanceTimersByTime(20_000); });
      expect(screen.queryByTestId('video-loading')).not.toBeInTheDocument();
    });

    it('never shows for a video that answered in time', () => {
      vi.useFakeTimers();
      browserPlays('probably');
      const { container } = render(<EpisodeViewer {...props()} />);
      fireEvent.loadedData(video(container)!);
      act(() => { vi.advanceTimersByTime(20_000); });
      expect(screen.queryByTestId('video-loading')).not.toBeInTheDocument();
    });

    it('lets clicks through to the cell, except on Retry', () => {
      vi.useFakeTimers();
      browserPlays('probably');
      render(<EpisodeViewer {...props()} />);
      act(() => { vi.advanceTimersByTime(8000); });

      expect(screen.getByTestId('video-loading')).toHaveClass('pointer-events-none');
      expect(screen.getByRole('button', { name: 'Retry' })).toHaveClass('pointer-events-auto');
    });

    it('covers the wait for the ticket as well, and a new episode starts its own', () => {
      vi.useFakeTimers();
      browserPlays('probably');
      const { container, rerender } = render(<EpisodeViewer {...props({ ready: false })} />);
      act(() => { vi.advanceTimersByTime(500); });
      expect(screen.getByTestId('video-loading')).toBeInTheDocument();

      rerender(<EpisodeViewer {...props()} />);
      fireEvent.loadedMetadata(video(container)!);
      expect(screen.queryByTestId('video-loading')).not.toBeInTheDocument();

      rerender(<EpisodeViewer {...props({ srcFor: (cam) => `/api/datasets/ds-1/episodes/1/video/${cam}?ticket=tkt-1` })} />);
      expect(screen.queryByTestId('video-loading')).not.toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(500); });
      expect(screen.getByTestId('video-loading')).toBeInTheDocument();
    });

    it('leaves a failed video to its own notice', () => {
      vi.useFakeTimers();
      browserPlays('probably');
      const { container } = render(<EpisodeViewer {...props()} />);
      failVideo(video(container)!, 4);
      act(() => { vi.advanceTimersByTime(20_000); });

      expect(screen.getByTestId('video-load-failed')).toBeInTheDocument();
      expect(screen.queryByTestId('video-loading')).not.toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
    });
  });

  describe('which episode is playing (TASK-501)', () => {
    it('names the episode and where it stands in the dataset', () => {
      browserPlays('probably');
      render(<EpisodeViewer {...props({ episode: { index: 401, position: 402, count: 402 } })} />);
      expect(screen.getByTestId('viewer-episode')).toHaveTextContent('Episode 401 · 402 of 402');
    });

    it('says nothing when it is not told', () => {
      browserPlays('probably');
      render(<EpisodeViewer {...props()} />);
      expect(screen.queryByTestId('viewer-episode')).not.toBeInTheDocument();
    });
  });

  it('still says a dataset has no cameras', () => {
    render(<EpisodeViewer {...props({ cameras: [] })} />);
    expect(screen.getByTestId('no-cameras')).toBeInTheDocument();
  });
});
