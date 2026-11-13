/**
 * @file TrajectoryPanels.test.tsx
 * @description The joint chart mounts without Recharts' "width(-1) and height(-1)" warning (TASK-363)
 *              and shows one joint group at a time when the dataset names its groups (TASK-476)
 * @feature training
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JointChartPanel } from '../TrajectoryPanels';
import type { FrameData } from '../../../types';

const frames = [0, 1, 2].map((i) => ({
  frameIndex: i,
  timestamp: i / 30,
  action: [i, i],
  observationState: [i, i],
})) as unknown as FrameData[];

afterEach(() => vi.restoreAllMocks());

describe('JointChartPanel', () => {
  it('mounts its chart without a negative-size warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(<JointChartPanel frames={frames} jointNames={['j0', 'j1']} isLoading={false} currentTime={0} />);
    const sizeWarnings = warn.mock.calls.filter((args) => String(args[0]).includes('of chart should be greater than 0'));
    expect(sizeWarnings).toEqual([]);
  });

  it('draws every channel, with no group switch, for a dataset without joint groups', () => {
    render(<JointChartPanel frames={frames} jointNames={['j0', 'j1']} isLoading={false} currentTime={0} />);
    expect(screen.queryByRole('group', { name: 'Joint group' })).not.toBeInTheDocument();
    expect(within(screen.getByTestId('joint-chart-legend')).getByText('j0')).toBeInTheDocument();
    expect(within(screen.getByTestId('joint-chart-legend')).getByText('j1')).toBeInTheDocument();
  });

  describe('with joint groups (TASK-476)', () => {
    const groups = [
      { name: 'left_leg', start: 0, end: 2 },
      { name: 'left_arm', start: 2, end: 5 },
    ];
    const names = ['left_leg[0]', 'left_leg[1]', 'left_arm[0]', 'left_arm[1]', 'left_arm[2]'];
    // The legs stand still; the arm moves.
    const moving = [0, 1, 2].map((i) => ({
      frameIndex: i,
      timestamp: i / 30,
      action: [0, 0, i, -i, i / 2],
      observationState: [0, 0, i, -i, i / 2],
    })) as unknown as FrameData[];
    const legend = () => within(screen.getByTestId('joint-chart-legend'));

    it('opens on the group that moves most and shows only its channels', () => {
      render(<JointChartPanel frames={moving} jointNames={names} groups={groups} isLoading={false} currentTime={0} />);
      const picker = within(screen.getByRole('group', { name: 'Joint group' }));
      expect(picker.getByRole('button', { name: 'left arm' })).toHaveAttribute('aria-pressed', 'true');
      expect(legend().getByText('left_arm[1]')).toBeInTheDocument();
      expect(legend().queryByText('left_leg[0]')).not.toBeInTheDocument();
    });

    it('switches to another group when the viewer picks it', async () => {
      render(<JointChartPanel frames={moving} jointNames={names} groups={groups} isLoading={false} currentTime={0} />);
      await userEvent.click(screen.getByRole('button', { name: 'left leg' }));
      expect(screen.getByRole('button', { name: 'left leg' })).toHaveAttribute('aria-pressed', 'true');
      expect(legend().getByText('left_leg[0]')).toBeInTheDocument();
      expect(legend().getByText('left_leg[1]')).toBeInTheDocument();
      expect(legend().queryByText('left_arm[0]')).not.toBeInTheDocument();
    });
  });
});
