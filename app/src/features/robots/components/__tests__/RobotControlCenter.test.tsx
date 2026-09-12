/**
 * @file RobotControlCenter.test.tsx
 * @description Tests for the robot detail body: kit tabs in the URL, chat tab,
 *              offline hint and error banner
 * @feature robots
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { Robot, RobotTelemetry } from '../../types/robots.types';
import type { RobotControlCenterProps } from '../RobotControlCenter';

// Stub each tab so we can assert which view is mounted without their deps.
vi.mock('../tabs', () => ({
  OverviewTab: () => <div data-testid="tab-overview" />,
  TelemetryTab: () => <div data-testid="tab-telemetry" />,
  ActivityTab: () => <div data-testid="tab-activity" />,
  InfoTab: () => <div data-testid="tab-info" />,
  TeleopTab: () => <div data-testid="tab-teleop" />,
  PerceptionTab: () => <div data-testid="tab-perception" />,
  MotionTab: () => <div data-testid="tab-motion" />,
  VoiceTab: () => <div data-testid="tab-voice" />,
  ChatTab: ({ robot }: { robot: Robot }) => (
    <section aria-label={`Chat with ${robot.name}`} data-testid="tab-chat" />
  ),
}));

vi.mock('../RobotQuickStats', () => ({
  RobotQuickStats: () => <div data-testid="quick-stats" />,
}));

vi.mock('../RobotErrorBanner', () => ({
  RobotErrorBanner: () => <div data-testid="error-banner" />,
}));

import { RobotControlCenter } from '../RobotControlCenter';

function makeRobot(overrides: Partial<Robot> = {}): Robot {
  return {
    id: 'robot-1',
    name: 'Atlas',
    model: 'G1',
    status: 'online',
    batteryLevel: 80,
    location: { x: 0, y: 0 },
    lastSeen: '2026-06-22T00:00:00.000Z',
    capabilities: [],
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-22T00:00:00.000Z',
    ...overrides,
  };
}

const telemetry: RobotTelemetry = {
  robotId: 'robot-1',
  batteryLevel: 80,
  cpuUsage: 10,
  memoryUsage: 20,
  temperature: 30,
  sensors: {},
  timestamp: '2026-06-22T00:00:00.000Z',
};

function makeProps(overrides: Partial<RobotControlCenterProps> = {}): RobotControlCenterProps {
  return {
    robot: makeRobot(),
    robotId: 'robot-1',
    telemetry,
    isTelemetryConnected: true,
    telemetryLastUpdate: null,
    commandHistory: [],
    isCommandLoading: false,
    canExecuteCommands: true,
    tasks: [],
    onSendToCharge: vi.fn().mockResolvedValue(undefined),
    onReturnHome: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.search}</div>;
}

function renderAt(props: RobotControlCenterProps, search = '') {
  return render(
    <MemoryRouter initialEntries={[`/robots/robot-1${search}`]}>
      <RobotControlCenter {...props} />
      <LocationProbe />
    </MemoryRouter>
  );
}

describe('RobotControlCenter', () => {
  it('renders the Overview tab and its stat row by default', () => {
    renderAt(makeProps());
    expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
    expect(screen.getByTestId('quick-stats')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-telemetry')).not.toBeInTheDocument();
  });

  it('switches the active view when a tab is selected and writes ?tab=', async () => {
    const user = userEvent.setup();
    renderAt(makeProps());

    await user.click(screen.getByRole('tab', { name: /telemetry/i }));
    expect(screen.getByTestId('tab-telemetry')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-overview')).not.toBeInTheDocument();
    expect(screen.queryByTestId('quick-stats')).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('?tab=telemetry');

    await user.click(screen.getByRole('tab', { name: /teleop/i }));
    expect(screen.getByTestId('tab-teleop')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /overview/i }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^$/);
  });

  it('opens the tab named in the URL', () => {
    renderAt(makeProps(), '?tab=details');
    expect(screen.getByTestId('tab-info')).toBeInTheDocument();
  });

  it('marks the active tab with aria-selected', async () => {
    const user = userEvent.setup();
    renderAt(makeProps());

    const activityTab = screen.getByRole('tab', { name: /activity/i });
    expect(activityTab).toHaveAttribute('aria-selected', 'false');

    await user.click(activityTab);
    expect(activityTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('tab-activity')).toBeInTheDocument();
  });

  it('hides G1-only tabs for other robots and falls back to Overview', () => {
    renderAt(makeProps({ robot: makeRobot({ model: 'H1' }) }), '?tab=voice');
    expect(screen.queryByRole('tab', { name: /voice/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
  });

  it('opens the chat tab', async () => {
    const user = userEvent.setup();
    renderAt(makeProps());
    expect(screen.queryByTestId('tab-chat')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /chat/i }));
    expect(screen.getByRole('region', { name: /chat with atlas/i })).toBeInTheDocument();
  });

  it('shows the offline hint only for offline robots', () => {
    const hint = /atlas is offline\. start its robot agent/i;
    const { unmount } = renderAt(makeProps());
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
    unmount();

    renderAt(makeProps({ robot: makeRobot({ status: 'offline' }) }));
    expect(screen.getByText(hint)).toBeInTheDocument();
  });

  it('always renders the error banner', () => {
    renderAt(makeProps());
    expect(screen.getByTestId('error-banner')).toBeInTheDocument();
  });
});
