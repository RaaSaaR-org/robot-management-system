/**
 * @file TrajectoryPanels.test.tsx
 * @description The joint chart mounts without Recharts' "width(-1) and height(-1)" warning (TASK-363)
 *              and shows one joint group at a time when the dataset names its groups (TASK-476)
 * @feature training
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JointChartPanel, rightSideColor } from '../TrajectoryPanels';
import { chartChannelColor } from '@/shared/components/ui';
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

  describe('the playback cursor (TASK-484)', () => {
    const cursor = () => screen.getByTestId('joint-chart-cursor');
    const at = (t: number) =>
      render(<JointChartPanel frames={frames} jointNames={['j0', 'j1']} isLoading={false} currentTime={t} />);

    it('is on the chart before playback starts', () => {
      at(0);
      expect(cursor()).toHaveAttribute('data-position', '0.000');
    });

    it('stays on the chart at the very end, past the last sample', () => {
      // Three samples end at 2/30 s; the video ends a frame later.
      at(3 / 30);
      expect(cursor()).toHaveAttribute('data-position', '1.000');
    });

    it('sits in proportion in between', () => {
      at(1 / 30);
      expect(cursor()).toHaveAttribute('data-position', '0.500');
    });

    it('glides only while playing, so a seek lands at once', () => {
      const { rerender } = at(0);
      expect(cursor().style.transition).toBe('');
      rerender(<JointChartPanel frames={frames} jointNames={['j0', 'j1']} isLoading={false} currentTime={0} isPlaying />);
      expect(cursor().style.transition).toContain('left');
    });

    it('is not drawn while there is no chart', () => {
      render(<JointChartPanel frames={[]} jointNames={['j0']} isLoading currentTime={0} />);
      expect(screen.queryByTestId('joint-chart-cursor')).not.toBeInTheDocument();
    });
  });

  it('gives each of seven channels a colour of its own (TASK-484)', () => {
    const names = Array.from({ length: 7 }, (_, i) => `left_arm[${i}]`);
    const wide = [0, 1, 2].map((i) => ({
      frameIndex: i,
      timestamp: i / 30,
      action: names.map(() => i),
      observationState: names.map(() => i),
    })) as unknown as FrameData[];
    render(<JointChartPanel frames={wide} jointNames={names} isLoading={false} currentTime={0} />);
    const swatches = within(screen.getByTestId('joint-chart-legend'))
      .getAllByText(/left_arm/)
      .map((label) => label.querySelector('span') as HTMLElement);
    expect(swatches).toHaveLength(7);
    // No colour twice, and none told apart only by being fainter.
    expect(new Set(swatches.map((s) => s.style.backgroundColor)).size).toBe(7);
    for (const s of swatches) expect(s.style.opacity).toBe('');
  });

  it("says the episode's own length when the chart was given a selection of its frames (TASK-492)", () => {
    const { rerender } = render(
      <JointChartPanel frames={frames} sampleCount={688} jointNames={['j0', 'j1']} isLoading={false} currentTime={0} />,
    );
    expect(screen.getByText(/688 samples \(3 drawn\)/)).toBeInTheDocument();
    // Every frame is on the chart: nothing to add.
    rerender(<JointChartPanel frames={frames} sampleCount={3} jointNames={['j0', 'j1']} isLoading={false} currentTime={0} />);
    expect(screen.getByText(/^3 samples · /)).toBeInTheDocument();
    rerender(<JointChartPanel frames={frames} jointNames={['j0', 'j1']} isLoading={false} currentTime={0} />);
    expect(screen.getByText(/^3 samples · /)).toBeInTheDocument();
  });

  it('does not show a sample count while the next episode loads (TASK-484)', () => {
    render(<JointChartPanel frames={frames} jointNames={['j0', 'j1']} isLoading currentTime={0} />);
    expect(screen.queryByText(/samples/)).not.toBeInTheDocument();
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

  describe('named joints of both sides in one group (TASK-494)', () => {
    const names = [
      'waist_yaw_joint',
      'left_shoulder_pitch_joint', 'right_shoulder_pitch_joint', 'left_elbow_joint', 'right_elbow_joint',
    ];
    const groups = [{ name: 'waist', start: 0, end: 1 }, { name: 'arms', start: 1, end: 5 }];
    const moving = [0, 1, 2].map((i) => ({
      frameIndex: i,
      timestamp: i / 30,
      action: [0, i, -i, i / 2, i / 3],
      observationState: [0, i, -i, i / 2, i / 3],
    })) as unknown as FrameData[];
    const legend = () => within(screen.getByTestId('joint-chart-legend'));
    const show = () => render(<JointChartPanel frames={moving} jointNames={names} groups={groups} isLoading={false} currentTime={0} />);

    it('lists a left/right pair once, by the joint, with the whole names on hover', () => {
      show();
      const entries = legend().getAllByRole('button');
      expect(entries.map((b) => b.textContent)).toEqual(['shoulder_pitch', 'elbow']);
      expect(entries[0]).toHaveAttribute('title', 'left_shoulder_pitch_joint · right_shoulder_pitch_joint');
      expect(screen.getByTestId('joint-chart-side-key')).toHaveTextContent(/left.*right/);
    });

    it('draws the pair in one hue, the right side stepped back, and each pair in its own', () => {
      show();
      const swatches = legend().getAllByTestId('joint-chart-swatch').map((s) => s.style.backgroundColor);
      expect(swatches).toEqual([
        chartChannelColor(0), rightSideColor(chartChannelColor(0)),
        chartChannelColor(1), rightSideColor(chartChannelColor(1)),
      ]);
    });

    it('drops the shared suffix for a group without sides, and pairs nothing', async () => {
      show();
      await userEvent.click(screen.getByRole('button', { name: 'waist' }));
      const entry = legend().getByRole('button', { name: 'waist_yaw_joint' });
      expect(entry).toHaveAttribute('title', 'waist_yaw_joint');
      expect(screen.queryByTestId('joint-chart-side-key')).not.toBeInTheDocument();
    });

    it('keeps one joint picked out when its legend entry is clicked, and lets go on the second click', async () => {
      show();
      const elbow = legend().getByRole('button', { name: 'elbow' });
      await userEvent.click(elbow);
      expect(elbow).toHaveAttribute('aria-pressed', 'true');
      expect(legend().getByRole('button', { name: 'shoulder_pitch' })).toHaveClass('opacity-50');
      await userEvent.click(elbow);
      await userEvent.unhover(elbow);
      expect(elbow).toHaveAttribute('aria-pressed', 'false');
      expect(legend().getByRole('button', { name: 'shoulder_pitch' })).not.toHaveClass('opacity-50');
    });
  });
});
