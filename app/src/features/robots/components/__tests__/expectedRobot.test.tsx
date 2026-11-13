/**
 * @file expectedRobot.test.tsx
 * @description An expected robot (TASK-477) — on the fleet before its agent has
 *   ever registered — reads as "Not connected" or "Arriving" through the fleet
 *   card, the list table, the detail banner, the Overview and Details tabs and
 *   the dashboard's fleet markers, never as a robot that broke.
 * @feature robots
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { ConfirmHost } from '@/shared/components/ui/ConfirmDialog';
import { robotProvisioning, type Robot } from '../../types/robots.types';

function makeRobot(overrides: Partial<Robot> = {}): Robot {
  return {
    id: 'demo-g1-dex3',
    name: 'Unitree G1 with Dex3 hands',
    model: 'Unitree G1 EDU (Dex3-1)',
    status: 'offline',
    batteryLevel: null,
    location: { x: 0, y: 0 },
    // The row's creation time: an expected robot was never seen.
    lastSeen: new Date().toISOString(),
    capabilities: [],
    metadata: { robotType: 'g1_edu', provisioning: 'awaiting_agent', seededBy: 'demo-fleet' },
    createdAt: '2026-11-13T00:00:00.000Z',
    updatedAt: '2026-11-13T00:00:00.000Z',
    ...overrides,
  };
}

const g1 = makeRobot();
const arm = makeRobot({
  id: 'demo-so101',
  name: 'SO-101',
  model: 'SO-101 Follower',
  metadata: { robotType: 'so101', powerSource: 'ac_powered', provisioning: 'awaiting_agent' },
});
const duck = makeRobot({
  id: 'demo-microduck',
  name: 'MicroDuck',
  model: 'Pollen Robotics Microduck',
  metadata: { provisioning: 'arriving', provisioningNote: 'On order from Pollen Robotics.' },
});
const offline = makeRobot({ id: 'sim-robot-001', name: 'Sim G1', batteryLevel: 40, metadata: {} });

const { robotsState } = vi.hoisted(() => ({
  robotsState: {
    robots: [] as unknown[],
    selectedRobot: null,
    selectedRobotId: null,
    filters: {} as Record<string, unknown>,
    pagination: { page: 1, pageSize: 12, total: 4, totalPages: 1 },
    isLoading: false,
    error: null as string | null,
    fetchRobots: vi.fn().mockResolvedValue(undefined),
    selectRobot: vi.fn(),
    setFilters: vi.fn(),
    clearFilters: vi.fn(),
    setPage: vi.fn(),
    sendCommand: vi.fn(),
    clearError: vi.fn(),
  },
}));

vi.mock('../../hooks/useRobots', () => ({ useRobots: () => robotsState }));
vi.mock('@/features/alerts/hooks', () => ({
  useAlerts: () => ({ alerts: [], unacknowledgedCount: 0 }),
}));
// No supervisor covers these robots; the poll itself is not under test.
const useRobotReadiness = vi.hoisted(() => vi.fn(() => ({ readiness: null })));
vi.mock('../../hooks/useRobotReadiness', () => ({ useRobotReadiness }));
vi.mock('../readiness/RobotReadinessPanel', () => ({ RobotReadinessPanel: () => null }));
vi.mock('../visualization/Robot3DViewer', () => ({
  Robot3DViewer: () => <div data-testid="robot-3d-viewer" />,
  Robot3DViewerFallback: () => <div data-testid="robot-3d-fallback" />,
}));
vi.mock('../VlaControlSection', () => ({ VlaControlSection: () => null }));
vi.mock('../tabs/SiteSelect', () => ({ SiteSelect: () => null }));

import { RobotCard, robotBattery, robotLastSeen } from '../RobotCard';
import { RobotList } from '../RobotList';
import { RobotOfflineBanner } from '../RobotOfflineBanner';
import { RobotStatusTag } from '../common/RobotStatusTag';
import { OverviewTab } from '../tabs/OverviewTab';
import { InfoTab } from '../tabs/InfoTab';
import { useFleetStatus } from '@/features/fleet/hooks/useFleetStatus';

beforeEach(() => {
  robotsState.robots = [g1, arm, duck, offline];
  robotsState.filters = {};
  useRobotReadiness.mockClear();
  localStorage.clear();
});

describe('robotProvisioning', () => {
  it('reads the state and note the server stored', () => {
    expect(robotProvisioning(g1)).toEqual({ state: 'awaiting_agent' });
    expect(robotProvisioning(duck)).toEqual({ state: 'arriving', note: 'On order from Pollen Robotics.' });
  });

  it('is null for a registered robot, an unknown state, and any robot that is not offline', () => {
    expect(robotProvisioning(offline)).toBeNull();
    expect(robotProvisioning(makeRobot({ metadata: undefined }))).toBeNull();
    expect(robotProvisioning(makeRobot({ metadata: { provisioning: 'soon' } }))).toBeNull();
    // Stale metadata on a robot that is talking to us must not hide that it is online.
    expect(robotProvisioning(makeRobot({ status: 'online' }))).toBeNull();
  });
});

describe('the status tag', () => {
  it('says "Not connected" / "Arriving" instead of "Offline"', () => {
    const { rerender } = render(<RobotStatusTag status="offline" provisioning="awaiting_agent" />);
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    rerender(<RobotStatusTag status="offline" provisioning="arriving" />);
    expect(screen.getByText('Arriving')).toBeInTheDocument();
    expect(screen.queryByText('Offline')).toBeNull();
  });

  it('keeps the real status for a robot that is not offline, and for a plain offline robot', () => {
    const { rerender } = render(<RobotStatusTag status="online" provisioning="arriving" />);
    expect(screen.getByText('Online')).toBeInTheDocument();
    rerender(<RobotStatusTag status="offline" />);
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });
});

describe('the fleet card', () => {
  const card = (robot: Robot) =>
    render(
      <MemoryRouter>
        <RobotCard robot={robot} />
      </MemoryRouter>,
    );

  it('shows a robot that never connected as such, not as seen just now on AC', () => {
    card(g1);
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(screen.getByTestId('robot-card-provisioning')).toHaveTextContent('Never connected');
    expect(screen.queryByText(/Seen/)).toBeNull();
    expect(screen.queryByText('Place unknown')).toBeNull();
    expect(screen.queryByText('AC')).toBeNull();
  });

  it('shows the note of a robot that has not arrived', () => {
    card(duck);
    expect(screen.getByText('Arriving')).toBeInTheDocument();
    expect(screen.getByTestId('robot-card-provisioning')).toHaveTextContent('On order from Pollen Robotics.');
  });

  it('falls back to "Not delivered yet" when an arriving robot has no note', () => {
    card(makeRobot({ metadata: { provisioning: 'arriving' } }));
    expect(screen.getByTestId('robot-card-provisioning')).toHaveTextContent('Not delivered yet');
  });

  it('leaves an ordinary offline robot exactly as it was', () => {
    card(offline);
    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(screen.getByText(/^Seen /)).toBeInTheDocument();
    expect(screen.getByText('Place unknown')).toBeInTheDocument();
    expect(screen.queryByTestId('robot-card-provisioning')).toBeNull();
  });

  it('battery: unknown for an expected robot, AC only when it is mains powered', () => {
    expect(robotBattery(g1)).toEqual({ value: null, hint: 'Not reported yet' });
    expect(robotBattery(arm)).toEqual({ value: 'AC', hint: 'Mains powered' });
    // A registered robot with no battery is still AC, as before.
    expect(robotBattery(makeRobot({ metadata: {} }))).toEqual({ value: 'AC', hint: 'Mains powered' });
    expect(robotLastSeen(g1)).toBe('—');
    expect(robotLastSeen(offline)).not.toBe('—');
  });
});

describe('the fleet list table', () => {
  it('lists expected robots with their own status and no invented readings', () => {
    localStorage.setItem('robots.view', 'table');
    renderWithProviders(<RobotList onRegister={() => {}} />);
    const row = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;
    expect(within(row('MicroDuck')).getByText('Arriving')).toBeInTheDocument();
    expect(within(row('Unitree G1 with Dex3 hands')).getByText('Not connected')).toBeInTheDocument();
    expect(within(row('Unitree G1 with Dex3 hands')).queryByText('AC')).toBeNull();
    expect(within(row('SO-101')).getByText('AC')).toBeInTheDocument();
    expect(within(row('Sim G1')).getByText('Offline')).toBeInTheDocument();
  });
});

describe('unregistering from the fleet list', () => {
  const askToUnregister = async (name: string) => {
    renderWithProviders(
      <>
        <RobotList onRegister={() => {}} />
        <ConfirmHost />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: `Actions for ${name}` }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Unregister' }));
    return screen.findByRole('alertdialog');
  };
  // The confirm queue is module-level: answer the question, or it is still
  // the one on screen in the next test.
  const cancel = (dialog: HTMLElement) =>
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

  it('does not tell the operator to register an agent URL an expected robot never had', async () => {
    const dialog = await askToUnregister('MicroDuck');
    expect(dialog).toHaveTextContent('It has no agent connected, so nothing stops.');
    expect(dialog).not.toHaveTextContent('agent URL');
    cancel(dialog);
  });

  it('keeps the usual wording for a registered robot', async () => {
    const dialog = await askToUnregister('Sim G1');
    expect(dialog).toHaveTextContent('Register its agent URL again to bring it back.');
    cancel(dialog);
  });
});

describe('the detail page banner', () => {
  it('says a robot has not connected yet, without a "last seen"', () => {
    render(<RobotOfflineBanner robotName="SO-101" lastSeen={arm.lastSeen} robotId="demo-so101" provisioning={{ state: 'awaiting_agent' }} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'SO-101 has not connected yet. It goes live when its robot agent registers with this server.',
    );
    expect(screen.queryByText(/Last seen/)).toBeNull();
    expect(screen.queryByText(/is offline/)).toBeNull();
  });

  it('says a robot has not arrived, shows its note, and does not poll for a robot side', () => {
    render(
      <RobotOfflineBanner
        robotName="MicroDuck"
        lastSeen={duck.lastSeen}
        robotId="demo-microduck"
        provisioning={{ state: 'arriving', note: 'On order from Pollen Robotics.' }}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'MicroDuck has not arrived yet, so there is nothing to connect. On order from Pollen Robotics.',
    );
    expect(screen.queryByText(/Last seen/)).toBeNull();
    expect(useRobotReadiness).toHaveBeenCalledWith('demo-microduck', { enabled: false });
  });

  it('is unchanged for an ordinary offline robot', () => {
    render(<RobotOfflineBanner robotName="Sim G1" lastSeen="2026-09-11T00:00:00.000Z" robotId="sim-robot-001" />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Sim G1 is offline. Start its robot agent to see live telemetry and send commands.',
    );
    expect(screen.getByText(/Last seen/)).toBeInTheDocument();
    expect(useRobotReadiness).toHaveBeenCalledWith('sim-robot-001', { enabled: true });
  });
});

describe('the Overview tab', () => {
  const props = (robot: Robot) => ({
    robot,
    robotId: robot.id,
    telemetry: null,
    isTelemetryConnected: false,
    isCommandLoading: false,
    canExecuteCommands: false,
    onSendToCharge: async () => {},
    onReturnHome: async () => {},
  });

  it('does not draw the placeholder box for an expected robot it has no model of', () => {
    render(<OverviewTab {...props(duck)} />);
    expect(screen.getByText('No 3D model yet')).toBeInTheDocument();
    expect(screen.queryByTestId('robot-3d-viewer')).toBeNull();
    expect(screen.queryByTestId('robot-3d-fallback')).toBeNull();
  });

  it('still draws the model of an expected robot it knows, and the box for a registered generic one', async () => {
    const { unmount } = render(<OverviewTab {...props(g1)} />);
    expect(await screen.findByTestId('robot-3d-viewer')).toBeInTheDocument();
    expect(screen.queryByText('No 3D model yet')).toBeNull();
    unmount();
    render(<OverviewTab {...props(makeRobot({ metadata: {} }))} />);
    expect(await screen.findByTestId('robot-3d-viewer')).toBeInTheDocument();
    expect(screen.queryByText('No 3D model yet')).toBeNull();
  });
});

describe('the Details tab', () => {
  it('says "Added", and keeps the provisioning keys out of the metadata list', () => {
    render(
      <MemoryRouter>
        <InfoTab robot={duck} robotId={duck.id} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Added')).toBeInTheDocument();
    expect(screen.queryByText('Registered')).toBeNull();
    expect(screen.queryByText(/^Provisioning/)).toBeNull();
  });

  it('says "Registered" for a robot an agent registered', () => {
    render(
      <MemoryRouter>
        <InfoTab robot={offline} robotId={offline.id} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Registered')).toBeInTheDocument();
  });
});

describe('the dashboard fleet markers', () => {
  it('carry an unknown battery as null, so no robot is flagged "Battery at 0%"', () => {
    const { result } = renderHook(() => useFleetStatus());
    const byId = Object.fromEntries(result.current.robotMarkers.map((m) => [m.robotId, m.batteryLevel]));
    expect(byId).toEqual({ 'demo-g1-dex3': null, 'demo-so101': null, 'demo-microduck': null, 'sim-robot-001': 40 });
    expect(result.current.status.robotsNeedingAttention).toBe(0);
  });
});
