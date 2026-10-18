/**
 * @file SessionCompleted.test.tsx
 * @description The completed-session dataset card offers publishing to the
 *              Hugging Face Hub once the recording is a dataset (TASK-394).
 * @feature datacollection
 */

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionCompleted } from '../session/SessionCompleted';
import type { TeleoperationSession } from '../../types/datacollection.types';

vi.mock('@/features/training/components/PublishDatasetDialog', () => ({
  PublishDatasetDialog: ({ datasetId }: { datasetId: string }) => <div data-testid="publish-dialog">{datasetId}</div>,
}));

function session(over: Partial<TeleoperationSession> = {}): TeleoperationSession {
  return {
    id: 'sess-1',
    operatorId: 'op',
    robotId: 'g1-edu-4',
    type: 'vr_quest',
    status: 'completed',
    startedAt: '2026-10-17T10:00:00.000Z',
    endedAt: '2026-10-17T10:05:00.000Z',
    frameCount: 900,
    duration: 300,
    fps: 30,
    languageInstr: 'Pick up the apple',
    qualityScore: null,
    exportedDatasetId: 'ds-1',
    errorMessage: null,
    createdAt: '2026-10-17T10:00:00.000Z',
    updatedAt: '2026-10-17T10:05:00.000Z',
    ...over,
  } as TeleoperationSession;
}

function renderCompleted(s: TeleoperationSession) {
  return render(
    <MemoryRouter>
      <SessionCompleted session={s} robotName="G1" episodes={[]} onEditTask={vi.fn()} onCreateDataset={vi.fn()} />
    </MemoryRouter>,
  );
}

describe('SessionCompleted publish action', () => {
  it('opens the publish dialog for the session\'s dataset', () => {
    renderCompleted(session());
    expect(screen.queryByTestId('publish-dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('publish-dataset'));
    expect(screen.getByTestId('publish-dialog')).toHaveTextContent('ds-1');
  });

  it('offers no publish before there is a dataset', () => {
    renderCompleted(session({ exportedDatasetId: null }));
    expect(screen.queryByTestId('publish-dataset')).not.toBeInTheDocument();
  });
});
