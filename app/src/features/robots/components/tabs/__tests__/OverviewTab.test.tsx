/**
 * @file OverviewTab.test.tsx
 * @description Tests for the robot Overview tab quick actions + availability gating
 * @feature robots
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Robot, RobotTelemetry } from '../../../types/robots.types';
import type { OverviewTabProps } from '../types';

// Mock the lazy-loaded 3D viewer module (heavy three.js import). The OverviewTab
// imports Robot3DViewerFallback from the `../visualization` barrel, which in turn
// re-exports from this same file — so both names must be stubbed here.
vi.mock('../../visualization/Robot3DViewer', () => ({
  Robot3DViewer: () => <div data-testid="robot-3d-viewer" />,
  Robot3DViewerFallback: () => <div data-testid="robot-3d-fallback" />,
}));

// VlaControlSection pulls in the VLA status hook (network) — stub it.
vi.mock('../../VlaControlSection', () => ({
  VlaControlSection: () => <div data-testid="vla-control" />,
}));

import { OverviewTab } from '../OverviewTab';

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

function makeTelemetry(overrides: Partial<RobotTelemetry> = {}): RobotTelemetry {
  return {
    robotId: 'robot-1',
    batteryLevel: 80,
    cpuUsage: 10,
    memoryUsage: 20,
    temperature: 30,
    sensors: {},
    timestamp: '2026-06-22T00:00:00.000Z',
    ...overrides,
  };
}

function makeProps(overrides: Partial<OverviewTabProps> = {}): OverviewTabProps {
  return {
    robot: makeRobot(),
    robotId: 'robot-1',
    telemetry: makeTelemetry(),
    isTelemetryConnected: true,
    isCommandLoading: false,
    canExecuteCommands: true,
    onSendToCharge: vi.fn().mockResolvedValue(undefined),
    onReturnHome: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('OverviewTab', () => {
  it('renders the Quick Actions section with Charge and Home buttons', () => {
    render(<OverviewTab {...makeProps()} />);
    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /charge/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /home/i })).toBeInTheDocument();
  });

  it('enables quick actions when commands can be executed', () => {
    render(<OverviewTab {...makeProps({ canExecuteCommands: true })} />);
    expect(screen.getByRole('button', { name: /charge/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /home/i })).toBeEnabled();
  });

  it('disables quick actions when canExecuteCommands is false', () => {
    render(<OverviewTab {...makeProps({ canExecuteCommands: false })} />);
    expect(screen.getByRole('button', { name: /charge/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /home/i })).toBeDisabled();
  });

  it('shows the unavailable hint when the robot is not online/busy', () => {
    render(
      <OverviewTab {...makeProps({ robot: makeRobot({ status: 'offline' }) })} />
    );
    expect(screen.getByText(/must be online to receive commands/i)).toBeInTheDocument();
    expect(screen.getByText('offline')).toBeInTheDocument();
  });

  it('hides the unavailable hint when the robot is available', () => {
    render(<OverviewTab {...makeProps({ robot: makeRobot({ status: 'online' }) })} />);
    expect(screen.queryByText(/must be online to receive commands/i)).not.toBeInTheDocument();
  });

  it('derives the robot type badge from telemetry over metadata', () => {
    render(
      <OverviewTab
        {...makeProps({
          telemetry: makeTelemetry({ robotType: 'h1' }),
          robot: makeRobot({ metadata: { robotType: 'so101' } }),
        })}
      />
    );
    expect(screen.getByText('H1')).toBeInTheDocument();
  });

  it('falls back to the generic robot type when none provided', () => {
    render(<OverviewTab {...makeProps({ telemetry: makeTelemetry(), robot: makeRobot() })} />);
    expect(screen.getByText('GENERIC')).toBeInTheDocument();
  });

  it('shows Live status when telemetry is connected', () => {
    render(<OverviewTab {...makeProps({ isTelemetryConnected: true })} />);
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('shows Offline status when telemetry is disconnected', () => {
    render(<OverviewTab {...makeProps({ isTelemetryConnected: false })} />);
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });
});
