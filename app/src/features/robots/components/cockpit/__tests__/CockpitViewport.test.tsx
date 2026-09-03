/**
 * @file CockpitViewport.test.tsx
 * @description Asking for the robot's camera must never answer with a rendering
 *   of the robot.
 * @feature robots
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../visualization/Robot3DViewer', () => ({
  Robot3DViewer: () => <div data-testid="robot-3d-viewer" />,
}));

vi.mock('../../../api/cameraApi', async () => {
  const actual =
    await vi.importActual<typeof import('../../../api/cameraApi')>('../../../api/cameraApi');
  return { ...actual, fetchRobotCameras: vi.fn(), fetchCameraTicket: vi.fn() };
});

import { fetchRobotCameras, fetchCameraTicket } from '../../../api/cameraApi';
import { CockpitViewport } from '../CockpitViewport';

const mockList = vi.mocked(fetchRobotCameras);
const mockTicket = vi.mocked(fetchCameraTicket);

const props = {
  robotId: 'g1-edu-4',
  robotType: 'g1_edu' as const,
  telemetryConnected: true,
};

describe('CockpitViewport', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockTicket.mockReset();
    mockTicket.mockResolvedValue({ ticket: 'tkt-1', expiresIn: 120 });
  });

  it('offers the cameras the robot actually serves', async () => {
    mockList.mockResolvedValue({ cameras: ['head_camera'], source: 'realsense' });

    render(<CockpitViewport {...props} />);

    expect(await screen.findByRole('button', { name: /head_camera/i })).toBeInTheDocument();
  });

  it('says there is no camera instead of offering one that cannot work', async () => {
    mockList.mockResolvedValue({
      cameras: [],
      source: null,
      detail: 'no camera source available: no RealSense device is attached',
    });

    render(<CockpitViewport {...props} />);

    expect(await screen.findByText(/no camera/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /head_camera/i })).not.toBeInTheDocument();
  });

  it('shows why a selected camera has no feed, not the 3D model', async () => {
    // The bug this test exists for: selecting the robot's own camera fell
    // through to `Robot3DViewer`, so the operator was shown a rendering of the
    // robot in place of what the robot sees — the one picture that is certainly
    // not the camera's view, with only a small NO SIGNAL pill to say so.
    mockList.mockResolvedValue({ cameras: ['head_camera'], source: 'realsense' });
    mockTicket.mockRejectedValue(new Error('403'));

    render(<CockpitViewport {...props} />);
    await userEvent.click(await screen.findByRole('button', { name: /head_camera/i }));

    expect(await screen.findByText(/no camera feed/i)).toBeInTheDocument();
    expect(screen.queryByTestId('robot-3d-viewer')).not.toBeInTheDocument();
  });

  it('offers a way back to the model from the failure panel', async () => {
    mockList.mockResolvedValue({ cameras: ['head_camera'], source: 'realsense' });
    mockTicket.mockRejectedValue(new Error('403'));

    render(<CockpitViewport {...props} />);
    await userEvent.click(await screen.findByRole('button', { name: /head_camera/i }));
    await userEvent.click(await screen.findByRole('button', { name: /show 3d model/i }));

    await waitFor(() => expect(screen.getByTestId('robot-3d-viewer')).toBeInTheDocument());
  });

  it('re-tickets on Retry, so a refused ticket is recoverable', async () => {
    // `denied` is sticky for a (robot, camera) pair: nothing but a new ticket
    // request clears it. A Retry button that only re-asked for the camera LIST
    // left the operator pressing it forever on the very message — "the server
    // refused a stream ticket" — that it was showing them.
    mockList.mockResolvedValue({ cameras: ['head_camera'], source: 'realsense' });
    mockTicket.mockRejectedValueOnce(new Error('403'));

    render(<CockpitViewport {...props} />);
    await userEvent.click(await screen.findByRole('button', { name: /head_camera/i }));
    expect(await screen.findByText(/refused a stream ticket/i)).toBeInTheDocument();

    mockTicket.mockResolvedValue({ ticket: 'tkt-2', expiresIn: 120 });
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(screen.queryByText(/no camera feed/i)).not.toBeInTheDocument());
    expect(mockTicket).toHaveBeenCalledTimes(2);
  });

  it('still shows the posed model when the model source is the one selected', async () => {
    mockList.mockResolvedValue({ cameras: [], source: null, detail: 'nothing attached' });

    render(<CockpitViewport {...props} />);

    expect(await screen.findByTestId('robot-3d-viewer')).toBeInTheDocument();
  });
});
