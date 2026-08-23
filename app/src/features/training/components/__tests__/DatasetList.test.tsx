/**
 * @file DatasetList.test.tsx
 * @description The status filter's missing option, the difference between an
 *              empty list and a filtered one, and the mixture action bar.
 * @feature training
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DatasetList } from '../DatasetList';
import type { Dataset } from '../../types';

vi.mock('../../api/trainingApi', () => ({
  trainingApi: { getEpisodeVideoUrl: () => 'about:blank' },
}));

function dataset(over: Partial<Dataset> = {}): Dataset {
  return {
    id: 'ds1',
    name: 'GR00T AppleToPlate',
    robotTypeId: 'rt1',
    storagePath: '/data/ds1/',
    lerobotVersion: 'v2.1',
    fps: 30,
    totalFrames: 1000,
    totalDuration: 33,
    demonstrationCount: 5,
    infoJson: {} as Dataset['infoJson'],
    statsJson: {} as Dataset['statsJson'],
    status: 'ready',
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
    ...over,
  };
}

describe('the status filter', () => {
  it('can filter to importing, which is a status a dataset really has', () => {
    // `importing` was missing from the options, so a row stuck mid-import was
    // reachable only by "All Status".
    render(
      <DatasetList
        datasets={[
          dataset({ id: 'a', name: 'Ready one' }),
          dataset({ id: 'b', name: 'Importing one', status: 'importing' }),
        ]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Importing' }));
    expect(screen.getByText('Importing one')).toBeInTheDocument();
    expect(screen.queryByText('Ready one')).not.toBeInTheDocument();
  });
});

describe('an empty grid', () => {
  it('says "no match" when a filter is what emptied it', () => {
    // Otherwise the page tells someone with eleven datasets to import their
    // first one.
    render(<DatasetList datasets={[]} filtersActive />);
    expect(screen.getByText('No datasets match your filters.')).toBeInTheDocument();
    expect(screen.queryByText('No datasets yet')).not.toBeInTheDocument();
  });

  it('still offers the first-run copy when there is genuinely nothing', () => {
    render(<DatasetList datasets={[]} />);
    expect(screen.getByText('No datasets yet')).toBeInTheDocument();
  });
});

describe('mixture selection', () => {
  it('shows no action bar until something is selected', () => {
    render(<DatasetList datasets={[dataset()]} onToggleSelection={() => {}} selectedIds={[]} />);
    expect(screen.queryByTestId('mixture-action-bar')).not.toBeInTheDocument();
  });

  it('counts the selection and offers the next step', () => {
    const onPrepareTraining = vi.fn();
    render(
      <DatasetList
        datasets={[dataset(), dataset({ id: 'ds2', name: 'G1 Dex3 ObjectPlacement' })]}
        onToggleSelection={() => {}}
        onPrepareTraining={onPrepareTraining}
        selectedIds={['ds1', 'ds2']}
      />
    );

    expect(screen.getByTestId('mixture-action-bar')).toHaveTextContent('2 selected');
    fireEvent.click(screen.getByRole('button', { name: 'Prepare training run' }));
    expect(onPrepareTraining).toHaveBeenCalledTimes(1);
  });

  it('reports a click on a card checkbox as a selection', () => {
    const onToggleSelection = vi.fn();
    render(
      <DatasetList datasets={[dataset()]} onToggleSelection={onToggleSelection} selectedIds={[]} />
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Select GR00T AppleToPlate for a training mixture' })
    );
    expect(onToggleSelection).toHaveBeenCalledWith(expect.objectContaining({ id: 'ds1' }));
  });
});
