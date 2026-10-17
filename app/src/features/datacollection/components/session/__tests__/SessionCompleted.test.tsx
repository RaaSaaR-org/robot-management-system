/**
 * @file SessionCompleted.test.tsx
 * @description The review table names takes the way the session page did
 *              while recording: "Take N", 1-based (TASK-410 D2).
 * @feature datacollection
 */

import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { SessionCompleted } from '../SessionCompleted';
import type { EpisodeSummary, TeleoperationSession } from '../../../types/datacollection.types';

const session = {
  id: 'sess-1', operatorId: 'u', robotId: 'g1', type: 'vr_quest', status: 'completed', startedAt: null, endedAt: null,
  frameCount: 900, duration: 60, fps: 30, languageInstr: 'Wave', qualityScore: null, exportedDatasetId: null,
  errorMessage: null, createdAt: 'x', updatedAt: 'x',
} as TeleoperationSession;

const ep = (episodeIndex: number, over: Partial<EpisodeSummary> = {}): EpisodeSummary => ({
  episodeIndex, frameCount: 300, startTime: 0, endTime: 10, durationS: 10, ...over,
});

describe('SessionCompleted', () => {
  it('lists the kept takes as "Take N", 1-based, with no discarded take and no 0', () => {
    renderWithProviders(
      <SessionCompleted
        session={session}
        robotName="G1"
        episodes={[ep(0), ep(1, { discarded: true }), ep(2)]}
        onEditTask={vi.fn()}
        onCreateDataset={vi.fn()}
      />,
    );
    const table = screen.getByTestId('review-episodes');
    expect(table).toHaveTextContent('Take 1');
    expect(table).not.toHaveTextContent('Take 2');
    expect(table).toHaveTextContent('Take 3');
    expect(table).not.toHaveTextContent(/Episode \d/);
    expect(screen.getByText('Takes kept').nextSibling ?? screen.getByText('Takes kept').parentElement).toHaveTextContent('2');
  });
});
