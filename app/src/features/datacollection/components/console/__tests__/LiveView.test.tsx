/**
 * @file LiveView.test.tsx
 * @description The shared live view (TASK-427): the twin leads in Set up with
 *              the head camera as the picture-in-picture, swap and the view
 *              switch change the main view without inventing cameras, a camera
 *              main view is framed 4:3, no camera is one amber line with a Why,
 *              and an offline robot is a small empty state. TASK-442: wrist
 *              tiles under the main view, their swap and offline plate, and a
 *              session without wrist cameras rendering exactly as before.
 * @feature datacollection
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { LiveView, cameraLabel, leadCameraOf, type LiveViewProps } from '../LiveView';

vi.mock('../../CameraStreamView', () => ({
  CameraStreamView: ({ label, cameraName }: { label: string; cameraName: string }) => (
    <div data-testid="camera" data-camera={cameraName}>{label}</div>
  ),
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

describe('LiveView wrist tiles (TASK-442)', () => {
  const ALL = ['head_camera', 'left_wrist_camera', 'right_wrist_camera'];
  const WRISTS = ['left_wrist_camera', 'right_wrist_camera'];
  const streams = () => screen.queryAllByTestId('camera').map((c) => c.getAttribute('data-camera')).sort();

  it('renders a head-only session exactly as without the prop', () => {
    const { container: without } = render(<LiveView {...props({ defaultMain: 'camera' })} />);
    const before = without.innerHTML;
    const { container: empty } = render(<LiveView {...props({ defaultMain: 'camera', wristCameras: [] })} />);
    expect(empty.innerHTML).toBe(before);
    expect(screen.queryByTestId('live-view-wrists')).toBeNull();
    expect(screen.queryByTestId('session-wrist-left')).toBeNull();
  });

  it('puts the head view big and the two wrists beneath it, left on the left', () => {
    render(<LiveView {...props({ defaultMain: 'camera', cameras: { names: ALL, loading: false }, wristCameras: WRISTS })} />);
    expect(screen.getByTestId('session-lead-camera')).toHaveAttribute('data-slot', 'main');
    const row = screen.getByTestId('live-view-wrists');
    // Under the main frame, not on it.
    expect(within(screen.getByTestId('live-view-frame')).queryByTestId('session-wrist-left')).toBeNull();
    const tiles = within(row).getAllByTestId(/^session-wrist-(left|right)$/);
    expect(tiles.map((t) => t.getAttribute('data-testid'))).toEqual(['session-wrist-left', 'session-wrist-right']);
    expect(screen.getByTestId('session-wrist-left-label')).toHaveTextContent('Left wrist');
    expect(screen.getByTestId('session-wrist-right-label')).toHaveTextContent('Right wrist');
    expect(screen.getByTestId('session-camera-left_wrist_camera')).toHaveAttribute('data-slot', 'tile');
    // Head main, twin PiP, one stream per wrist: three streams, none twice.
    expect(streams()).toEqual(ALL.slice().sort());
    expect(screen.getByTestId('session-twin')).toHaveAttribute('data-slot', 'pip');
  });

  it('swaps a wrist into the main view and the head into its tile, and back', () => {
    render(<LiveView {...props({ defaultMain: 'camera', cameras: { names: ALL, loading: false }, wristCameras: WRISTS })} />);
    fireEvent.click(screen.getByTestId('session-wrist-left-swap'));
    expect(screen.getByTestId('session-camera-left_wrist_camera')).toHaveAttribute('data-slot', 'main');
    expect(screen.getByTestId('session-wrist-left')).toHaveAttribute('data-camera', 'head_camera');
    expect(screen.getByTestId('session-wrist-left-label')).toHaveTextContent('Head camera');
    expect(screen.getByTestId('session-lead-camera')).toHaveAttribute('data-slot', 'tile');
    expect(streams()).toEqual(ALL.slice().sort());
    // The view switch keeps every camera and says which leads.
    const sw = within(screen.getByTestId('live-view-switch'));
    expect(sw.getAllByRole('button').map((b) => b.textContent)).toEqual(['Twin', 'Head camera', 'Left wrist', 'Right wrist']);
    expect(sw.getByRole('button', { name: /Left wrist/ })).toHaveAttribute('aria-pressed', 'true');
    // Clicking the head tile swaps back.
    fireEvent.click(screen.getByTestId('session-wrist-left-swap'));
    expect(screen.getByTestId('session-lead-camera')).toHaveAttribute('data-slot', 'main');
    expect(screen.getByTestId('session-wrist-left')).toHaveAttribute('data-camera', 'left_wrist_camera');
  });

  it('shows an offline plate for a wrist the robot does not serve, and opens no stream for it', () => {
    render(<LiveView {...props({ defaultMain: 'camera', cameras: { names: ['head_camera', 'right_wrist_camera'], loading: false }, wristCameras: WRISTS })} />);
    expect(screen.getByTestId('session-wrist-left-offline')).toHaveTextContent('Left wrist camera offline');
    expect(screen.queryByTestId('session-wrist-left-swap')).toBeNull();
    expect(streams()).toEqual(['head_camera', 'right_wrist_camera']);
  });

  it('unmounts the tiles while the VR modal is open, and on an offline robot', () => {
    const { rerender } = render(<LiveView {...props({ cameras: { names: ALL, loading: false }, wristCameras: WRISTS, suspended: true })} />);
    expect(screen.queryByTestId('live-view-wrists')).toBeNull();
    expect(screen.queryByTestId('camera')).toBeNull();
    rerender(<LiveView {...props({ cameras: { names: ALL, loading: false }, wristCameras: WRISTS, online: false })} />);
    expect(screen.queryByTestId('live-view-wrists')).toBeNull();
  });
});
