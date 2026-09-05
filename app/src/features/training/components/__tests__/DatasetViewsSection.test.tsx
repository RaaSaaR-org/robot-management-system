/**
 * @file DatasetViewsSection.test.tsx
 * @description What the Views section of a dataset says about each fork, and
 *              which control a frozen one gets (TASK-240).
 * @feature training
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { DatasetViewsSection } from '../DatasetViewsSection';
import type { DatasetViewSummary } from '../../types';

function makeView(over: Partial<DatasetViewSummary> = {}): DatasetViewSummary {
  return {
    id: 'view-1',
    name: 'Clean takes only',
    description: null,
    kind: 'view',
    status: 'ready',
    fps: 30,
    parentDatasetId: 'ds-parent',
    parentName: 'Warehouse picks',
    parentDemonstrationCount: 400,
    rootDatasetId: 'ds-parent',
    demonstrationCount: 142,
    totalFrames: 42600,
    totalDuration: 1420,
    selection: {
      episodes: Array.from({ length: 142 }, (_, i) => ({ episodeIndex: i })),
      origin: { kind: 'flags', decision: 'remove' },
    },
    resolvedEpisodes: [],
    frozenAt: null,
    materializedPath: null,
    createdAt: '2026-09-05T00:00:00.000Z',
    updatedAt: '2026-09-05T00:00:00.000Z',
    ...over,
  };
}

describe('the Views section', () => {
  it('says how much of the parent each view takes, and by what rule', () => {
    render(<DatasetViewsSection parentEpisodeCount={400} views={[makeView()]} />);
    const row = screen.getByTestId('view-row-view-1');
    expect(row).toHaveTextContent('142 of 400 episodes');
    expect(row).toHaveTextContent('Everything an operator did not flag');
  });

  it('offers a duplicate and no delete once a run has frozen the view', () => {
    render(
      <DatasetViewsSection
        parentEpisodeCount={400}
        views={[makeView({ frozenAt: '2026-09-05T10:00:00.000Z' })]}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
      />,
    );
    expect(screen.getByTestId('view-frozen-view-1')).toHaveTextContent('Frozen');
    expect(screen.getByTestId('view-duplicate-view-1')).toBeInTheDocument();
    expect(screen.queryByTestId('view-delete-view-1')).not.toBeInTheDocument();
  });

  it('shows the server’s reason when an action is refused', async () => {
    // The 409 for a frozen view names the training job holding it, and that
    // sentence is the whole answer to "why did nothing happen".
    const onDelete = vi.fn().mockRejectedValue({
      // The api client's rejection envelope, not an Error instance.
      code: 'VIEW_FROZEN',
      statusCode: 409,
      message: 'Frozen: training job job-7 cites this selection',
    });
    render(
      <DatasetViewsSection parentEpisodeCount={400} views={[makeView()]} onDelete={onDelete} />,
    );
    fireEvent.click(screen.getByTestId('view-delete-view-1'));
    await waitFor(() =>
      expect(screen.getByTestId('views-row-error')).toHaveTextContent('job-7'),
    );
  });

  it('says a dataset has no views instead of showing an empty box', () => {
    render(<DatasetViewsSection parentEpisodeCount={400} views={[]} />);
    expect(screen.getByTestId('dataset-views-section')).toHaveTextContent('No views yet');
  });
});
