/**
 * @file RobotControlCenter.test.tsx
 * @description Tests for the robot detail layout: tab switching + chat drawer
 * @feature robots
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Robot, RobotTelemetry } from '../../types/robots.types';
import type { RobotControlCenterProps } from '../RobotControlCenter';

// Stub each tab so we can assert which view is mounted without their deps.
vi.mock('../tabs', () => ({
  OverviewTab: () => <div data-testid="tab-overview" />,
  TelemetryTab: () => <div data-testid="tab-telemetry" />,
  CommandsTab: () => <div data-testid="tab-commands" />,
  TasksTab: () => <div data-testid="tab-tasks" />,
  InfoTab: () => <div data-testid="tab-info" />,
  TeleopTab: () => <div data-testid="tab-teleop" />,
}));

vi.mock('../RobotChatPanel', () => ({
  RobotChatPanel: () => <div data-testid="robot-chat-panel" />,
}));

vi.mock('../RobotOfflineBanner', () => ({
  RobotOfflineBanner: () => <div data-testid="offline-banner" />,
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

describe('RobotControlCenter', () => {
  it('renders the Overview tab by default', () => {
    render(<RobotControlCenter {...makeProps()} />);
    expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-telemetry')).not.toBeInTheDocument();
  });

  it('switches the active view when a tab is selected', async () => {
    const user = userEvent.setup();
    render(<RobotControlCenter {...makeProps()} />);

    // Desktop tablist has role=tab buttons (one set rendered)
    await user.click(screen.getByRole('tab', { name: /telemetry/i }));
    expect(screen.getByTestId('tab-telemetry')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-overview')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /teleop/i }));
    expect(screen.getByTestId('tab-teleop')).toBeInTheDocument();
  });

  it('marks the active tab with aria-selected', async () => {
    const user = userEvent.setup();
    render(<RobotControlCenter {...makeProps()} />);

    const commandsTab = screen.getByRole('tab', { name: /commands/i });
    expect(commandsTab).toHaveAttribute('aria-selected', 'false');

    await user.click(commandsTab);
    expect(commandsTab).toHaveAttribute('aria-selected', 'true');
  });

  it('does not render the chat drawer until opened', () => {
    render(<RobotControlCenter {...makeProps()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('robot-chat-panel')).not.toBeInTheDocument();
  });

  it('opens and closes the chat drawer', async () => {
    const user = userEvent.setup();
    render(<RobotControlCenter {...makeProps()} />);

    // Two "Open chat" buttons exist (desktop + mobile FAB); the first is fine.
    await user.click(screen.getAllByRole('button', { name: /open chat/i })[0]);

    const dialog = screen.getByRole('dialog', { name: /chat with atlas/i });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByTestId('robot-chat-panel')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /close chat/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the offline banner only for offline robots', () => {
    const { rerender } = render(<RobotControlCenter {...makeProps()} />);
    expect(screen.queryByTestId('offline-banner')).not.toBeInTheDocument();

    rerender(<RobotControlCenter {...makeProps({ robot: makeRobot({ status: 'offline' }) })} />);
    expect(screen.getByTestId('offline-banner')).toBeInTheDocument();
  });

  it('always renders the error banner', () => {
    render(<RobotControlCenter {...makeProps()} />);
    expect(screen.getByTestId('error-banner')).toBeInTheDocument();
  });
});
