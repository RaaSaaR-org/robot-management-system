/**
 * @file DatasetCompatibilityPanel.layout.test.tsx
 * @description The per-axis verdict is where it can be read (TASK-486). With
 *              three datasets the table was 826 px wide in a 532 px dialog: the
 *              Same / Differs column sat off the right edge and the second
 *              dataset's name was cut in half.
 * @feature training
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DatasetCompatibilityPanel } from '../DatasetCompatibilityPanel';
import { CompatibilityModal } from '../datasets/CompatibilityModal';
import type { CompatibilityReport, Dataset } from '../../types';

const checkCompatibility = vi.fn();

vi.mock('../../api', () => ({
  trainingApi: { checkCompatibility: (...a: unknown[]) => checkCompatibility(...a) },
}));

const NAMES = {
  'ds-so': 'Object in Box — SO-101 community set',
  'ds-g1': 'Apple to Plate — our G1 recording',
  'ds-nv': 'Apple to Plate — NVIDIA GR00T reference',
};

function threeWay(): CompatibilityReport {
  const values = (v: [string, string, string]) =>
    (Object.keys(NAMES) as (keyof typeof NAMES)[]).map((datasetId, i) => ({ datasetId, datasetName: NAMES[datasetId], value: v[i] }));
  return {
    datasetIds: Object.keys(NAMES),
    verdict: 'multi_embodiment',
    headline: 'These 3 datasets have different state width and action width.',
    recommendation: 'Train with a base model that carries per-embodiment projectors.',
    axes: [
      { axis: 'status', label: 'Dataset status', verdict: 'match', values: values(['ready', 'ready', 'ready']), note: 'Every member is ready.' },
      { axis: 'robotType', label: 'Robot type', verdict: 'differs', values: values(['so101_follower', 'unitree_g1', 'unitree_g1']), note: 'Each keeps its own embodiment tag.' },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  checkCompatibility.mockResolvedValue(threeWay());
});

describe('the comparison table layout', () => {
  it('puts the verdict column directly after the axis, before any dataset', async () => {
    render(<DatasetCompatibilityPanel datasetIds={Object.keys(NAMES)} />);
    await screen.findByTestId('compatibility-panel');

    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Axis', 'Verdict', ...Object.values(NAMES)]);

    const row = screen.getByTestId('compatibility-axis-robotType');
    const cells = within(row).getAllByRole('cell');
    expect(cells[0]).toHaveTextContent('Differs');
    expect(cells.slice(1).map((c) => c.textContent)).toEqual(['so101_follower', 'unitree_g1', 'unitree_g1']);
  });

  it('pins the axis and the verdict while the dataset columns scroll', async () => {
    render(<DatasetCompatibilityPanel datasetIds={Object.keys(NAMES)} />);
    await screen.findByTestId('compatibility-panel');

    for (const header of screen.getAllByRole('columnheader').slice(0, 2)) expect(header.className).toContain('sticky');
    expect(screen.getAllByRole('columnheader')[2].className).not.toContain('sticky');
    expect(screen.getByTestId('compatibility-axis-verdict-status').className).toContain('sticky');
    expect(within(screen.getByTestId('compatibility-axis-status')).getByRole('rowheader').className).toContain('sticky');
  });

  it('cuts a long dataset name with an ellipsis and keeps the whole name in the title', async () => {
    render(<DatasetCompatibilityPanel datasetIds={Object.keys(NAMES)} />);
    await screen.findByTestId('compatibility-panel');

    const header = screen.getByRole('columnheader', { name: NAMES['ds-nv'] });
    expect(header).toHaveAttribute('title', NAMES['ds-nv']);
    expect(header.querySelector('span')?.className).toContain('truncate');
  });

  it('shares the dialog between the dataset columns, and only scrolls once they would get too narrow', async () => {
    render(<DatasetCompatibilityPanel datasetIds={Object.keys(NAMES)} />);
    await screen.findByTestId('compatibility-panel');

    const table = screen.getByRole('table');
    expect(table.className).toContain('table-fixed');
    // 17rem of pinned columns + 9rem per dataset: 44rem (704 px) for three,
    // inside the 852 px the wide dialog leaves at 1280 px.
    expect(table.style.minWidth).toBe('44rem');
  });
});

describe('the compatibility dialog', () => {
  const dataset = (id: string, name: string): Dataset => ({
    id, name, robotTypeId: 'rt', storagePath: `/d/${id}`, lerobotVersion: 'v2.1', fps: 30, totalFrames: 10, totalDuration: 1,
    demonstrationCount: 1, infoJson: {} as Dataset['infoJson'], statsJson: {} as Dataset['statsJson'], status: 'ready',
    createdAt: '2026-11-13T00:00:00.000Z', updatedAt: '2026-11-13T00:00:00.000Z',
  });

  it('opens the report in the wide dialog, not the 576 px one', async () => {
    // Stable props: the dialog resets itself whenever `initialIds` changes identity.
    const ids = ['ds-so', 'ds-g1'];
    const datasets = [dataset('ds-so', NAMES['ds-so']), dataset('ds-g1', NAMES['ds-g1'])];
    render(<CompatibilityModal isOpen onClose={() => {}} onContinue={() => {}} initialIds={ids} datasets={datasets} />);
    expect(screen.getByTestId('compatibility-modal').className).toContain('max-w-md');
    fireEvent.click(screen.getByRole('button', { name: /Check 2 datasets/ }));
    await screen.findByTestId('compatibility-panel');
    expect(screen.getByTestId('compatibility-modal').className).toContain('max-w-4xl');
  });
});
