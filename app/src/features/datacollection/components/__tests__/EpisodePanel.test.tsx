/**
 * @file EpisodePanel.test.tsx
 * @description Tests for the live episode row — specifically that dropped frames
 *              are reported when there are any and stay silent when there are
 *              not, including on sessions recorded before the recorder counted
 *              them at all.
 * @feature datacollection
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EpisodePanel } from '../EpisodePanel';
import type { EpisodeSummary } from '../../types/datacollection.types';

function episode(over: Partial<EpisodeSummary> = {}): EpisodeSummary {
  return {
    episodeIndex: 0,
    frameCount: 1200,
    startTime: 0,
    endTime: 40,
    durationS: 40,
    ...over,
  };
}

function renderPanel(episodes: EpisodeSummary[]) {
  return render(
    <EpisodePanel
      episodes={episodes}
      currentEpisode={0}
      numEpisodes={null}
      isRecording
      canDiscard
      onNextEpisode={vi.fn()}
      onDiscardEpisode={vi.fn()}
    />,
  );
}

describe('EpisodePanel dropped frames', () => {
  it('reports the drops on the episode that lost frames', () => {
    renderPanel([episode({ droppedFrames: 143 })]);
    expect(screen.getByTestId('episode-dropped-0')).toHaveTextContent('143 dropped');
  });

  it('says nothing at all when the recorder kept up', () => {
    // "0 dropped" on every healthy episode is how an operator learns to stop
    // reading the one line they need to notice.
    renderPanel([episode({ droppedFrames: 0 })]);
    expect(screen.queryByTestId('episode-dropped-0')).toBeNull();
    expect(screen.getByTestId('episode-row-0')).not.toHaveTextContent('dropped');
  });

  it('renders a session recorded before drops were counted', () => {
    // `droppedFrames` is optional precisely so these keep working: an absent
    // count is not a claim of zero, and it must not print as one.
    renderPanel([episode()]);
    expect(screen.queryByTestId('episode-dropped-0')).toBeNull();
    expect(screen.getByTestId('episode-row-0')).toHaveTextContent('1,200 frames');
  });

  it('reports each episode separately', () => {
    renderPanel([
      episode({ episodeIndex: 0 }),
      episode({ episodeIndex: 1, droppedFrames: 7 }),
      episode({ episodeIndex: 2, droppedFrames: 0 }),
    ]);
    expect(screen.queryByTestId('episode-dropped-0')).toBeNull();
    expect(screen.getByTestId('episode-dropped-1')).toHaveTextContent('7 dropped');
    expect(screen.queryByTestId('episode-dropped-2')).toBeNull();
  });
});
