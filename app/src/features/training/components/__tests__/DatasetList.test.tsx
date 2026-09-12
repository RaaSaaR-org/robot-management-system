/**
 * @file DatasetList.test.tsx
 * @description The status filter's missing option, the difference between an
 *              empty list and a filtered one, and the mixture picker.
 * @feature training
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DatasetList } from '../DatasetList';
import { CompatibilityModal } from '../datasets/CompatibilityModal';
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

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'importing' } });
    expect(screen.getByText('Importing one')).toBeInTheDocument();
    expect(screen.queryByText('Ready one')).not.toBeInTheDocument();
  });
});

describe('an empty table', () => {
  it('says "no match" when a filter is what emptied it', () => {
    // Otherwise the page tells someone with eleven datasets to import their
    // first one.
    render(<DatasetList datasets={[]} filtersActive />);
    expect(screen.getByText('No datasets match')).toBeInTheDocument();
    expect(screen.queryByText('No datasets yet')).not.toBeInTheDocument();
  });

  it('still offers the first-run copy when there is genuinely nothing', () => {
    render(<DatasetList datasets={[]} />);
    expect(screen.getByText('No datasets yet')).toBeInTheDocument();
  });
});

describe('mixture selection', () => {
  const two = [dataset(), dataset({ id: 'ds2', name: 'G1 Dex3 ObjectPlacement' })];

  it('cannot check compatibility until two are picked', () => {
    render(<CompatibilityModal isOpen onClose={() => {}} datasets={two} onContinue={() => {}} />);
    expect(screen.getByTestId('mixture-count')).toHaveTextContent('0 selected');
    expect(screen.getByRole('button', { name: /^Check/ })).toBeDisabled();
  });

  it('counts the selection and offers the next step', () => {
    render(
      <CompatibilityModal isOpen onClose={() => {}} datasets={two} initialIds={['ds1', 'ds2']} onContinue={() => {}} />
    );
    expect(screen.getByTestId('mixture-count')).toHaveTextContent('2 selected');
    expect(screen.getByRole('button', { name: 'Check 2 datasets' })).toBeEnabled();
  });

  it('reports a click on a checkbox as a selection', () => {
    render(<CompatibilityModal isOpen onClose={() => {}} datasets={two} onContinue={() => {}} />);
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Select GR00T AppleToPlate for a training mixture' })
    );
    expect(screen.getByTestId('mixture-count')).toHaveTextContent('1 selected — pick another to compare them');
  });
});
