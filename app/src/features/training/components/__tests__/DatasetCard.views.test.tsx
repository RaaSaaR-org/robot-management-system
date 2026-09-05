/**
 * @file DatasetCard.views.test.tsx
 * @description What the card says about a view: whose episodes it is, how many
 *              of them, and what can still be done to a frozen one (TASK-240).
 * @feature training
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DatasetCard } from '../DatasetCard';
import type { Dataset, DatasetSelection } from '../../types';

vi.mock('../../api/trainingApi', () => ({
  trainingApi: { getEpisodeVideoUrl: () => 'about:blank' },
}));

function selection(count: number): DatasetSelection {
  return {
    episodes: Array.from({ length: count }, (_, i) => ({ episodeIndex: i })),
    origin: { kind: 'reward', rewardType: 'robometer', minScore: 0.7 },
  };
}

function makeView(over: Partial<Dataset> = {}): Dataset {
  return {
    id: 'view-1',
    name: 'Clean takes only',
    robotTypeId: 'rt1',
    // A view copies no bytes — this is what that looks like on the row.
    storagePath: '',
    lerobotVersion: 'v3.0',
    fps: 30,
    totalFrames: 42600,
    totalDuration: 1420,
    demonstrationCount: 142,
    infoJson: {} as Dataset['infoJson'],
    statsJson: {} as Dataset['statsJson'],
    status: 'ready',
    kind: 'view',
    parentDatasetId: 'ds-parent',
    selection: selection(142),
    createdAt: '2026-09-05T00:00:00.000Z',
    updatedAt: '2026-09-05T00:00:00.000Z',
    ...over,
  };
}

const PARENT = { id: 'ds-parent', name: 'Warehouse picks', demonstrationCount: 400 };

describe('a view looks like a view', () => {
  it('names the dataset it was forked from and how much of it it takes', () => {
    // "142 episodes" reads like a small dataset. "142 of 400" is the fact the
    // experiment is about.
    render(<DatasetCard dataset={makeView()} parent={PARENT} />);
    expect(screen.getByTestId('dataset-view-badge')).toBeInTheDocument();
    const origin = screen.getByTestId('dataset-view-origin');
    expect(origin).toHaveTextContent('Warehouse picks');
    expect(origin).toHaveTextContent('142 of 400 episodes');
    // The rule the selection came from, for whoever reads this in a month.
    expect(origin).toHaveTextContent('robometer score ≥ 0.7');
  });

  it('takes the parent off the row when the server inlined it', () => {
    render(<DatasetCard dataset={makeView({ parent: PARENT })} />);
    expect(screen.getByTestId('dataset-view-origin')).toHaveTextContent('142 of 400 episodes');
  });

  it('says how many it selects, without inventing a total it does not have', () => {
    render(<DatasetCard dataset={makeView()} />);
    const origin = screen.getByTestId('dataset-view-origin');
    expect(origin).toHaveTextContent('142 episodes selected');
    expect(origin).not.toHaveTextContent('of 400');
  });

  it('leaves a materialized dataset alone', () => {
    // `kind` decides viewness and nothing else does: a materialized row may
    // carry a parent as provenance without being a view.
    render(
      <DatasetCard
        dataset={makeView({ kind: 'materialized', selection: null, storagePath: '/data/x/' })}
        parent={PARENT}
      />,
    );
    expect(screen.queryByTestId('dataset-view-badge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dataset-view-origin')).not.toBeInTheDocument();
  });
});

describe('a frozen view', () => {
  it('shows the lock and offers a duplicate instead of a delete', () => {
    // A frozen view is what a finished run was trained on. Deleting it is
    // refused by the server, so the card offers the thing that CAN happen
    // rather than a bin that answers 409.
    const onDelete = vi.fn();
    const onDuplicateView = vi.fn();
    render(
      <DatasetCard
        dataset={makeView({ frozenAt: '2026-09-05T10:00:00.000Z' })}
        parent={PARENT}
        onDelete={onDelete}
        onDuplicateView={onDuplicateView}
      />,
    );
    expect(screen.getByTestId('dataset-view-frozen')).toHaveTextContent('Frozen');
    expect(screen.getByTestId('dataset-view-duplicate')).toBeInTheDocument();
    expect(screen.queryByTitle('Delete view')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Delete dataset')).not.toBeInTheDocument();
  });

  it('keeps the delete on a view nothing has cited yet', () => {
    render(
      <DatasetCard dataset={makeView()} parent={PARENT} onDelete={vi.fn()} onDuplicateView={vi.fn()} />,
    );
    expect(screen.queryByTestId('dataset-view-frozen')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dataset-view-duplicate')).not.toBeInTheDocument();
    expect(screen.getByTitle('Delete view')).toBeInTheDocument();
  });

  it('never leaves a frozen view with a delete when no duplicate handler was given', () => {
    render(<DatasetCard dataset={makeView({ frozenAt: '2026-09-05T10:00:00.000Z' })} onDelete={vi.fn()} />);
    expect(screen.queryByTitle('Delete view')).not.toBeInTheDocument();
  });
});
