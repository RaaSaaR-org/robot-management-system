/**
 * @file DatasetStatsPanel.test.tsx
 * @description The statistics panel: per-channel rows of the state and action vectors,
 *              by joint group when the dataset names its groups (TASK-476)
 * @feature training
 */

import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DatasetStatsPanel } from '../DatasetStatsPanel';
import type { DatasetModality, FeatureStats } from '../../../types';

const vector = (offset: number): FeatureStats => ({
  min: [0, 1, 2, 3, 4].map((v) => v + offset - 1),
  max: [0, 1, 2, 3, 4].map((v) => v + offset + 1),
  mean: [0, 1, 2, 3, 4].map((v) => v + offset),
  std: [0.1, 0.2, 0.3, 0.4, 0.5],
  count: [1603],
});
const STATS = { 'observation.state': vector(0), action: vector(10) };
const GROUPS = [
  { name: 'left_leg', start: 0, end: 2 },
  { name: 'left_arm', start: 2, end: 5 },
];
const MODALITY: DatasetModality = { state: GROUPS, action: GROUPS };

const rowLabels = () => screen.getAllByTestId(/^stats-row-/).map((row) => within(row).getAllByRole('cell')[0]!.textContent);

describe('DatasetStatsPanel', () => {
  it('says so when the dataset has no statistics', () => {
    render(<DatasetStatsPanel stats={null} isLoading={false} modality={null} />);
    expect(screen.getByText('No statistics for this dataset')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('lists every channel under its info.json name when there are no joint groups', () => {
    render(
      <DatasetStatsPanel
        stats={{ 'observation.state': { min: [0, 0], max: [1, 2], mean: [0.5, 1], std: [0.25, 0.5], count: [300] } }}
        isLoading={false}
        modality={null}
        names={{ state: ['motor_0', 'motor_1'] }}
      />,
    );
    expect(rowLabels()).toEqual(['motor_0', 'motor_1']);
    expect(screen.getByText(/300 frames/)).toBeInTheDocument();
    // Only the state vector has statistics, so there is nothing to switch between.
    expect(screen.queryByRole('group', { name: 'Vector' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Statistics joint group' })).not.toBeInTheDocument();
  });

  it('ignores placeholder names that do not fit the vector', () => {
    render(
      <DatasetStatsPanel
        stats={{ action: { mean: [1, 2, 3], std: [0, 0, 0] } }}
        isLoading={false}
        modality={null}
        names={{ action: ['action_from_policy'] }}
      />,
    );
    expect(rowLabels()).toEqual(['ch[0]', 'ch[1]', 'ch[2]']);
  });

  it('shows one joint group at a time, labelled by body part and index', async () => {
    render(<DatasetStatsPanel stats={STATS} isLoading={false} modality={MODALITY} names={{ state: ['observation_to_policy'] }} />);
    expect(rowLabels()).toEqual(['left_leg[0]', 'left_leg[1]']);

    await userEvent.click(screen.getByRole('button', { name: 'left arm' }));
    expect(rowLabels()).toEqual(['left_arm[0]', 'left_arm[1]', 'left_arm[2]']);
    const row = within(screen.getByTestId('stats-row-3')).getAllByRole('cell').map((c) => c.textContent);
    expect(row).toEqual(['left_arm[1]', '2', '4', '3', '0.4']);

    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(rowLabels()).toHaveLength(5);
  });

  it('switches between the state and the action vector', async () => {
    render(<DatasetStatsPanel stats={STATS} isLoading={false} modality={MODALITY} />);
    await userEvent.click(screen.getByRole('button', { name: 'Action' }));
    const row = within(screen.getByTestId('stats-row-0')).getAllByRole('cell').map((c) => c.textContent);
    expect(row).toEqual(['left_leg[0]', '9', '11', '10', '0.1']);
  });

  it('reads the state vector of a row keyed the old way (observation)', () => {
    render(<DatasetStatsPanel stats={{ observation: { mean: [1], std: [0] } }} isLoading={false} modality={null} />);
    expect(rowLabels()).toEqual(['ch[0]']);
  });
});
