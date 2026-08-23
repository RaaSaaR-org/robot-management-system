/**
 * @file DatasetCompatibilityPanel.test.tsx
 * @description That the report reads as a comparison, and that a
 *              multi-embodiment mixture reads as an answer rather than a
 *              warning.
 * @feature training
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DatasetCompatibilityPanel } from '../DatasetCompatibilityPanel';
import type { CompatibilityReport } from '../../types';

const checkCompatibility = vi.fn();

vi.mock('../../api', () => ({
  trainingApi: {
    checkCompatibility: (...a: unknown[]) => checkCompatibility(...a),
  },
}));

/** The contract's scenario: 43-wide GR00T next to a 28-wide Dex3 recording. */
function multiEmbodiment(): CompatibilityReport {
  return {
    datasetIds: ['ds-groot', 'ds-dex3'],
    verdict: 'multi_embodiment',
    headline: 'These two describe different robots and can be trained together as a mixture.',
    recommendation:
      'Train with per-embodiment projectors (GR00T N1.x embodiment tags). Do not concatenate them.',
    axes: [
      {
        axis: 'robotType',
        label: 'Robot type',
        verdict: 'differs',
        values: [
          { datasetId: 'ds-groot', datasetName: 'GR00T AppleToPlate', value: 'unitree_g1' },
          { datasetId: 'ds-dex3', datasetName: 'G1 Dex3 ObjectPlacement', value: 'Unitree_G1' },
        ],
        note: 'Each dataset keeps its own embodiment tag.',
      },
      {
        axis: 'actionWidth',
        label: 'Action width',
        verdict: 'differs',
        values: [
          { datasetId: 'ds-groot', datasetName: 'GR00T AppleToPlate', value: '43' },
          { datasetId: 'ds-dex3', datasetName: 'G1 Dex3 ObjectPlacement', value: '28' },
        ],
        note: 'Different action spaces need one projector head each.',
      },
      {
        axis: 'fps',
        label: 'FPS',
        verdict: 'match',
        values: [
          { datasetId: 'ds-groot', datasetName: 'GR00T AppleToPlate', value: '30' },
          { datasetId: 'ds-dex3', datasetName: 'G1 Dex3 ObjectPlacement', value: '30' },
        ],
        note: 'Same control rate, so no resampling.',
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  checkCompatibility.mockResolvedValue(multiEmbodiment());
});

describe('the comparison table', () => {
  it('asks the server about exactly the datasets it was given', async () => {
    render(<DatasetCompatibilityPanel datasetIds={['ds-groot', 'ds-dex3']} />);
    await waitFor(() => expect(checkCompatibility).toHaveBeenCalledWith(['ds-groot', 'ds-dex3']));
  });

  it('puts one column per dataset and one row per axis', async () => {
    render(<DatasetCompatibilityPanel datasetIds={['ds-groot', 'ds-dex3']} />);
    await screen.findByTestId('compatibility-panel');

    expect(screen.getByRole('columnheader', { name: 'GR00T AppleToPlate' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'G1 Dex3 ObjectPlacement' })).toBeInTheDocument();

    // The row that decides the verdict, with both values side by side.
    const row = screen.getByTestId('compatibility-axis-actionWidth');
    expect(row).toHaveTextContent('43');
    expect(row).toHaveTextContent('28');
    expect(row).toHaveTextContent('Differs');
  });

  it('leads with the headline and the recommendation', async () => {
    render(<DatasetCompatibilityPanel datasetIds={['ds-groot', 'ds-dex3']} />);
    await screen.findByTestId('compatibility-panel');

    expect(screen.getByTestId('compatibility-headline')).toHaveTextContent(
      'can be trained together as a mixture'
    );
    expect(screen.getByTestId('compatibility-recommendation')).toHaveTextContent(
      'per-embodiment projectors'
    );
  });

  it('calls a multi-embodiment mixture what it is, not a warning', async () => {
    const onReport = vi.fn();
    render(<DatasetCompatibilityPanel datasetIds={['ds-groot', 'ds-dex3']} onReport={onReport} />);
    await screen.findByTestId('compatibility-panel');

    expect(screen.getByTestId('compatibility-verdict')).toHaveTextContent(
      'Multi-embodiment mixture'
    );
    // Amber and red are for something that is wrong. Two different robots
    // trained as a mixture is the supported way to do it.
    const verdictBox = screen.getByTestId('compatibility-verdict').closest('div.rounded-lg');
    expect(verdictBox?.className).toContain('cobalt');
    expect(verdictBox?.className).not.toContain('red');
    expect(verdictBox?.className).not.toContain('amber');

    await waitFor(() =>
      expect(onReport).toHaveBeenLastCalledWith(expect.objectContaining({ verdict: 'multi_embodiment' }))
    );
  });

  it('reports an incompatible verdict as blocking', async () => {
    checkCompatibility.mockResolvedValue({
      ...multiEmbodiment(),
      verdict: 'incompatible',
      headline: 'One of these datasets is not ready.',
      recommendation: 'Finish or re-run the failed import first.',
      axes: [
        {
          axis: 'status',
          label: 'Status',
          verdict: 'blocking',
          values: [
            { datasetId: 'ds-groot', datasetName: 'GR00T AppleToPlate', value: 'failed' },
            { datasetId: 'ds-dex3', datasetName: 'G1 Dex3 ObjectPlacement', value: 'ready' },
          ],
          note: 'A dataset that never finished importing has no frames to train on.',
        },
      ],
    } satisfies CompatibilityReport);

    render(<DatasetCompatibilityPanel datasetIds={['ds-groot', 'ds-dex3']} />);
    await screen.findByTestId('compatibility-panel');

    expect(screen.getByTestId('compatibility-verdict')).toHaveTextContent('Cannot be trained together');
    expect(screen.getByTestId('compatibility-axis-status')).toHaveTextContent('Blocking');
  });

  it('says the comparison failed instead of rendering an empty table', async () => {
    checkCompatibility.mockRejectedValue(new Error('compatibility endpoint returned 500'));
    render(<DatasetCompatibilityPanel datasetIds={['ds-groot', 'ds-dex3']} />);
    expect(await screen.findByTestId('compatibility-error')).toHaveTextContent(
      'compatibility endpoint returned 500'
    );
  });

  it('asks nothing when there is nothing selected', () => {
    render(<DatasetCompatibilityPanel datasetIds={[]} />);
    expect(checkCompatibility).not.toHaveBeenCalled();
  });
});
