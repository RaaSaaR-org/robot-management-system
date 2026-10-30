/**
 * @file LiveView.test.tsx
 * @description The shared live view (TASK-427): the twin leads in Set up with
 *              the head camera as the picture-in-picture, swap and the view
 *              switch change the main view without inventing cameras, a camera
 *              main view is framed 4:3, no camera is one amber line with a Why,
 *              and an offline robot is a small empty state.
 * @feature datacollection
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { LiveView, cameraLabel, leadCameraOf, type LiveViewProps } from '../LiveView';

vi.mock('../../CameraStreamView', () => ({
  CameraStreamView: ({ label }: { label: string }) => <div data-testid="camera">{label}</div>,
}));
vi.mock('../../../../robots/components/visualization/Robot3DViewer', () => ({
  Robot3DViewer: () => <div data-testid="twin-canvas" />,
}));

const props = (over: Partial<LiveViewProps> = {}): LiveViewProps => ({
  robotId: 'g1',
  robotType: 'generic' as LiveViewProps['robotType'],
  online: true,
  live: true,
  cameras: { names: ['head_camera'], loading: false },
  defaultMain: 'twin',
  ...over,
});

describe('LiveView', () => {
  it('names cameras and picks the head camera to lead', () => {
    expect(cameraLabel('head_camera')).toBe('Head camera');
    expect(cameraLabel('wrist')).toBe('Wrist camera');
    expect(leadCameraOf(['wrist', 'head_cam'])).toBe('head_cam');
    expect(leadCameraOf([])).toBeNull();
  });

  it('leads with the twin in Set up, the head camera in the PiP, and swaps', async () => {
    render(<LiveView {...props()} />);
    expect(screen.getByTestId('live-view-frame')).toHaveAttribute('data-main', 'twin');
    expect(screen.getByTestId('session-twin')).toHaveAttribute('data-slot', 'main');
    expect(screen.getByTestId('session-lead-camera')).toHaveAttribute('data-slot', 'pip');
    expect(await screen.findByTestId('twin-canvas')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('live-view-swap'));
    expect(screen.getByTestId('live-view-frame')).toHaveAttribute('data-main', 'camera');
    expect(screen.getByTestId('session-lead-camera')).toHaveAttribute('data-slot', 'main');
    expect(screen.getByTestId('session-twin')).toHaveAttribute('data-slot', 'pip');
    // The view switch says which leads.
    expect(within(screen.getByTestId('live-view-switch')).getByRole('button', { name: /Head camera/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(screen.getByTestId('live-view-switch')).getByRole('button', { name: /Twin/ }));
    expect(screen.getByTestId('live-view-frame')).toHaveAttribute('data-main', 'twin');
  });

  it('leads with the camera in Record', () => {
    render(<LiveView {...props({ defaultMain: 'camera' })} />);
    expect(screen.getByTestId('session-lead-camera')).toHaveAttribute('data-slot', 'main');
  });

  it('invents no camera: none served is one amber line, the detail behind Why', () => {
    render(<LiveView {...props({ cameras: { names: [], loading: false, detail: 'pc2cam: connection refused' } })} />);
    expect(screen.queryByTestId('session-lead-camera')).toBeNull();
    expect(screen.queryByTestId('live-view-swap')).toBeNull();
    expect(screen.queryByText(/Top camera|Wrist camera/)).toBeNull();
    expect(screen.getByTestId('live-view-no-camera')).toHaveTextContent('No head camera. Takes record without video.');
    expect(screen.getByTestId('live-view-no-camera')).toHaveClass('text-signal-unknown');
    expect(screen.queryByText(/connection refused/)).toBeNull();
    fireEvent.click(screen.getByTestId('live-view-why'));
    expect(screen.getByTestId('live-view-why-text')).toHaveTextContent('The robot serves no camera: pc2cam: connection refused');
  });

  it('shows an offline robot as a small empty state, with no views', () => {
    render(<LiveView {...props({ online: false })} />);
    expect(screen.getByText('Robot offline')).toBeInTheDocument();
    expect(screen.queryByTestId('session-twin')).toBeNull();
    expect(screen.queryByTestId('live-view-expand')).toBeNull();
  });

  it('unmounts the twin and the cameras while the page\'s VR modal is open', () => {
    render(<LiveView {...props({ suspended: true })} />);
    expect(screen.queryByTestId('session-twin')).toBeNull();
    expect(screen.queryByTestId('camera')).toBeNull();
  });

  it('puts the expand button at the bottom when asked (clear of the E-STOP)', () => {
    render(<LiveView {...props({ expandAt: 'bottom' })} />);
    const expand = screen.getByTestId('live-view-expand');
    expect(expand.closest('.bottom-\\[26px\\]')).not.toBeNull();
  });
});
