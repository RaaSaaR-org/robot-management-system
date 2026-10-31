/**
 * @file KeyboardTeleopEStop.test.tsx
 * @description The keyboard teleop section's own E-STOP and header (TASK-453):
 *              an E-STOP for every robot that fires on one click without
 *              asking, a header that names the robot and says real or
 *              simulated, and Space labelled as no E-stop.
 * @feature robots
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';
import { act, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';

vi.mock('../../../../safety/api/safetyApi', () => ({ triggerRobotEStop: vi.fn().mockResolvedValue({}) }));
vi.mock('../../../api/controlLeaseApi', () => ({
  controlLeaseApi: {
    getControlLease: vi.fn().mockResolvedValue({
      capability: { version: 1, enabled: false, ttlMs: 5000, renewEveryMs: 1000 },
      holder: null,
    }),
    acquireControlLease: vi.fn(),
    renewControlLease: vi.fn(),
    releaseControlLease: vi.fn(),
  },
}));

import { triggerRobotEStop } from '../../../../safety/api/safetyApi';
import { KeyboardTeleopSection } from '../TeleopTab';
import { isSimRobot } from '../../../utils/simRobot';
import type { TeleopTabProps } from '../types';

const estop = vi.mocked(triggerRobotEStop);

const realRobot = { id: 'g1-edu-4', name: 'G1-EDU-4', model: 'Unitree G1 EDU (Dex3-1)' } as TeleopTabProps['robot'];
const simRobot = { id: 'sim-g1-edu-dev', name: 'G1-EDU dev', model: 'Unitree G1 EDU (29 DoF + Dex3-1)' } as TeleopTabProps['robot'];

beforeEach(() => vi.clearAllMocks());

/** Render, then let the lease hook's first fetch settle inside act. */
async function render(ui: ReactElement) {
  const result = rtlRender(ui);
  await act(async () => {});
  return result;
}

describe('KeyboardTeleopSection E-STOP (TASK-453)', () => {
  it.each([
    ['a real robot', realRobot],
    ['a simulated robot', simRobot],
  ])('shows an E-STOP for %s, alone in its own zone', async (_label, robot) => {
    await render(<KeyboardTeleopSection robot={robot} />);
    const zone = screen.getByTestId('teleop-estop-zone');
    expect(zone).toContainElement(screen.getByTestId('teleop-estop'));
    // The zone holds the E-STOP and nothing else.
    expect(zone.querySelectorAll('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: `Emergency stop ${robot.name}` })).toBeInTheDocument();
  });

  it('fires the robot E-stop on one click, without asking', async () => {
    await render(<KeyboardTeleopSection robot={realRobot} />);
    fireEvent.click(screen.getByTestId('teleop-estop'));
    await waitFor(() =>
      expect(estop).toHaveBeenCalledWith('g1-edu-4', expect.objectContaining({ triggeredBy: 'teleop-tab', reason: expect.any(String) })),
    );
    expect(estop).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('fires on Escape twice', async () => {
    await render(<KeyboardTeleopSection robot={realRobot} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(estop).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(estop).toHaveBeenCalledWith('g1-edu-4', expect.anything()));
  });

  it('shows none where the page has its own E-STOP', async () => {
    await render(<KeyboardTeleopSection robot={realRobot} estop={false} />);
    expect(screen.queryByTestId('teleop-estop')).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(estop).not.toHaveBeenCalled();
  });

  it('names a real robot as real', async () => {
    await render(<KeyboardTeleopSection robot={realRobot} />);
    expect(screen.getByText('Drive single joints of the real robot G1-EDU-4 from the keyboard.')).toBeInTheDocument();
    expect(screen.queryByText(/simulated/i)).toBeNull();
  });

  it('names a simulated robot as simulated', async () => {
    await render(<KeyboardTeleopSection robot={simRobot} />);
    expect(screen.getByText('Drive single joints of the simulated robot G1-EDU dev from the keyboard.')).toBeInTheDocument();
  });

  it('labels Space as no E-stop', async () => {
    await render(<KeyboardTeleopSection robot={realRobot} />);
    expect(screen.getByRole('list', { name: 'Keyboard controls' })).toHaveTextContent('Stop joints (not an E-stop)');
  });
});

describe('isSimRobot', () => {
  it('tells a sim robot by its id or its model', () => {
    expect(isSimRobot({ id: 'sim-g1-edu-dev', model: 'Unitree G1 EDU' })).toBe(true);
    expect(isSimRobot({ id: 'robot-1', model: 'SimBot H1' })).toBe(true);
    expect(isSimRobot({ id: 'g1-edu-4', model: 'Unitree G1 EDU (Dex3-1)' })).toBe(false);
  });
});
