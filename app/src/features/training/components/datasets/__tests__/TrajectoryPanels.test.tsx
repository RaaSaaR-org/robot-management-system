/**
 * @file TrajectoryPanels.test.tsx
 * @description The joint chart mounts without Recharts' "width(-1) and height(-1)" warning (TASK-363)
 * @feature training
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
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
});
