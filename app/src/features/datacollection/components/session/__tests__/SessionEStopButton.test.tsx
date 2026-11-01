/**
 * @file SessionEStopButton.test.tsx
 * @description The session page's E-STOP (TASK-410 D5): one press fires the
 *              robot E-stop, Escape twice within a second fires it, a single
 *              Escape or Escape while typing does not.
 * @feature datacollection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SessionEStopButton } from '../SessionEStopButton';

vi.mock('../../../../safety/api/safetyApi', () => ({ triggerRobotEStop: vi.fn().mockResolvedValue({}) }));
import { triggerRobotEStop } from '../../../../safety/api/safetyApi';
const estop = vi.mocked(triggerRobotEStop);

beforeEach(() => vi.clearAllMocks());

describe('SessionEStopButton', () => {
  it('fires the robot E-stop on one press, without asking', async () => {
    render(<SessionEStopButton robotId="g1" robotName="G1" />);
    fireEvent.click(screen.getByTestId('session-estop'));
    await waitFor(() => expect(estop).toHaveBeenCalledWith('g1', expect.objectContaining({ reason: expect.any(String) })));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('fires on Escape twice within a second, not on one Escape', async () => {
    const now = vi.spyOn(Date, 'now');
    render(<SessionEStopButton robotId="g1" robotName="G1" />);
    now.mockReturnValue(1000);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(estop).not.toHaveBeenCalled();
    now.mockReturnValue(3000); // too late: this one starts a new pair
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(estop).not.toHaveBeenCalled();
    now.mockReturnValue(3600);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(estop).toHaveBeenCalledTimes(1));
    now.mockRestore();
  });

  it('does not count Escape pressed while typing', () => {
    render(<SessionEStopButton robotId="g1" robotName="G1" />);
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(estop).not.toHaveBeenCalled();
    input.remove();
  });
});
