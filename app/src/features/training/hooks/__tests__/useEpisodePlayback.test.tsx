/**
 * @file useEpisodePlayback.test.tsx
 * @description The transport controls say what the videos are doing: after an
 *              episode switch, a failed load and the end of the video (TASK-484).
 * @feature training
 */

import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ChangeEvent } from 'react';
import { useEpisodePlayback, type EpisodePlaybackOptions } from '../useEpisodePlayback';

const EGO = 'observation.images.ego_view';
const WRIST = 'observation.images.wrist';

/**
 * A `<video>` as far as the hook can tell: it plays, pauses, and — like the
 * real element — falls back to paused at 1× when it is given a new source.
 */
function fakeVideo(duration = 20) {
  const video = {
    paused: true,
    playbackRate: 1,
    defaultPlaybackRate: 1,
    currentTime: 0,
    duration,
    readyState: 4,
    error: null as null | { code: number },
    play: vi.fn(() => { video.paused = false; return Promise.resolve(); }),
    pause: vi.fn(() => { video.paused = true; }),
    /** What the browser does to the element when React hands it another `src`. */
    loadNewSource(nextDuration: number) {
      video.paused = true;
      video.playbackRate = 1;
      video.defaultPlaybackRate = 1;
      video.currentTime = 0;
      video.duration = nextDuration;
    },
  };
  return video;
}

function setup(initial: Partial<EpisodePlaybackOptions> = {}) {
  const options: EpisodePlaybackOptions = {
    episodeKey: 'ds:0',
    datasetKey: 'ds',
    primaryCamera: EGO,
    windowFor: () => undefined,
    fallbackDuration: 19.7,
    ...initial,
  };
  const hook = renderHook((p: EpisodePlaybackOptions) => useEpisodePlayback(p), { initialProps: options });
  const ego = fakeVideo(19.67);
  hook.result.current.videoRefs.current[EGO] = ego as unknown as HTMLVideoElement;
  return { ...hook, ego, options };
}

describe('useEpisodePlayback', () => {
  it('keeps playing at the chosen speed on the next episode', () => {
    const { result, rerender, ego, options } = setup();
    act(() => result.current.onLoadedMetadata(EGO));
    act(() => result.current.setSpeed('2'));
    act(() => result.current.togglePlay());
    expect(ego.paused).toBe(false);
    expect(ego.playbackRate).toBe(2);
    expect(result.current.isPlaying).toBe(true);

    // Another episode: the element is reset by the browser, then loads.
    ego.loadNewSource(15.93);
    rerender({ ...options, episodeKey: 'ds:2', fallbackDuration: 15.9 });
    // Not yet loaded: the controls already show the new episode, from zero.
    expect(result.current.currentTime).toBe(0);
    expect(result.current.duration).toBe(15.9);
    act(() => result.current.onLoadedMetadata(EGO));

    expect(ego.paused).toBe(false);
    expect(ego.playbackRate).toBe(2);
    expect(result.current.isPlaying).toBe(true);
    expect(result.current.speed).toBe('2');
    expect(result.current.duration).toBe(15.93);
  });

  it('stays paused on the next episode when it was paused, and still applies the speed', () => {
    const { result, rerender, ego, options } = setup();
    act(() => result.current.setSpeed('0.5'));
    ego.loadNewSource(12);
    rerender({ ...options, episodeKey: 'ds:1' });
    act(() => result.current.onLoadedMetadata(EGO));
    expect(ego.play).not.toHaveBeenCalled();
    expect(ego.playbackRate).toBe(0.5);
    expect(result.current.isPlaying).toBe(false);
  });

  it('applies the speed again when the highlighted one is clicked', () => {
    const { result, ego } = setup();
    act(() => result.current.setSpeed('2'));
    ego.playbackRate = 1; // the element lost it
    act(() => result.current.setSpeed('2'));
    expect(ego.playbackRate).toBe(2);
  });

  it('shows Play again when the video ends, with the clock on the total', () => {
    const { result, ego } = setup();
    act(() => result.current.onLoadedMetadata(EGO));
    act(() => result.current.togglePlay());
    ego.currentTime = 19.5;
    act(() => result.current.onTimeUpdate());
    ego.currentTime = 19.67;
    ego.paused = true;
    act(() => { result.current.onPause(); result.current.onEnded(); });
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.currentTime).toBe(19.67);
    expect(result.current.duration).toBe(19.67);
  });

  it('does not carry "ended" over: the episode after one that ended waits for Play', () => {
    const { result, rerender, ego, options } = setup();
    act(() => result.current.togglePlay());
    ego.paused = true;
    act(() => result.current.onEnded());
    ego.loadNewSource(10);
    rerender({ ...options, episodeKey: 'ds:3' });
    act(() => result.current.onLoadedMetadata(EGO));
    expect(ego.paused).toBe(true);
    expect(result.current.isPlaying).toBe(false);
  });

  it('shows Play when the primary video fails to load', () => {
    const { result, ego } = setup();
    act(() => result.current.togglePlay());
    expect(result.current.isPlaying).toBe(true);
    act(() => result.current.onFailure(EGO));
    expect(result.current.isPlaying).toBe(false);
    expect(ego.pause).toHaveBeenCalled();
  });

  it('keeps playing when only a second camera fails', () => {
    const { result } = setup();
    act(() => result.current.togglePlay());
    act(() => result.current.onFailure(WRIST));
    expect(result.current.isPlaying).toBe(true);
  });

  it('shows Play when the browser refuses to play', async () => {
    const { result, ego } = setup();
    ego.play.mockImplementation(() => Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' })));
    await act(async () => { result.current.togglePlay(); });
    expect(result.current.isPlaying).toBe(false);
  });

  it('does not take a play interrupted by the next episode for a refusal', async () => {
    const { result, ego } = setup();
    ego.play.mockImplementation(() => Promise.reject(Object.assign(new Error('interrupted'), { name: 'AbortError' })));
    await act(async () => { result.current.togglePlay(); });
    expect(result.current.isPlaying).toBe(true);
  });

  it('ignores the pause of an element that is between two episodes', () => {
    const { result, ego } = setup();
    act(() => result.current.togglePlay());
    ego.paused = true;
    ego.readyState = 0;
    act(() => result.current.onPause());
    expect(result.current.isPlaying).toBe(true);
  });

  it('pauses on the button, and on a pause the element reports itself', () => {
    const { result, ego } = setup();
    act(() => result.current.togglePlay());
    act(() => result.current.togglePlay());
    expect(ego.paused).toBe(true);
    expect(result.current.isPlaying).toBe(false);

    act(() => result.current.togglePlay());
    ego.paused = true; // a media key
    act(() => result.current.onPause());
    expect(result.current.isPlaying).toBe(false);
  });

  it('follows a video that starts without the button, and keeps it across an episode switch', () => {
    const { result, rerender, ego, options } = setup();
    ego.paused = false; // a media key
    act(() => result.current.onPlayingChange(true));
    expect(result.current.isPlaying).toBe(true);

    ego.loadNewSource(12);
    rerender({ ...options, episodeKey: 'ds:1' });
    act(() => result.current.onLoadedMetadata(EGO));
    expect(ego.paused).toBe(false);
    expect(result.current.isPlaying).toBe(true);

    ego.paused = true;
    act(() => result.current.onPlayingChange(false));
    expect(result.current.isPlaying).toBe(false);
  });

  it('starts and speeds every camera, and seeks them together', () => {
    const { result, ego } = setup();
    const wrist = fakeVideo(19.67);
    result.current.videoRefs.current[WRIST] = wrist as unknown as HTMLVideoElement;
    act(() => result.current.setSpeed('2'));
    act(() => result.current.togglePlay());
    expect(wrist.paused).toBe(false);
    expect(wrist.playbackRate).toBe(2);

    act(() => result.current.seek({ target: { value: '7.5' } } as ChangeEvent<HTMLInputElement>));
    expect(ego.currentTime).toBe(7.5);
    expect(wrist.currentTime).toBe(7.5);
    expect(result.current.currentTime).toBe(7.5);
  });

  it('stops at the end of a chunked episode and starts it over on Play', () => {
    const win = { from: 100, to: 110 };
    const { result, ego } = setup({ windowFor: () => win, fallbackDuration: 10 });
    ego.currentTime = 100;
    act(() => result.current.onLoadedMetadata(EGO));
    expect(result.current.duration).toBe(10);
    act(() => result.current.togglePlay());
    ego.currentTime = 109.98;
    act(() => result.current.onTimeUpdate());
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.currentTime).toBe(10);

    act(() => result.current.togglePlay());
    expect(ego.currentTime).toBe(100);
    expect(result.current.currentTime).toBe(0);
    expect(result.current.isPlaying).toBe(true);
  });

  it('stops when the dataset changes', () => {
    const { result, rerender, options } = setup();
    act(() => result.current.togglePlay());
    rerender({ ...options, datasetKey: 'other', episodeKey: null });
    expect(result.current.isPlaying).toBe(false);
  });
});
