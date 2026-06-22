/**
 * @file RobotErrorBanner.test.tsx
 * @description Tests for the deduplicated robot error/warning/maintenance banner
 * @feature robots
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RobotErrorBanner } from '../RobotErrorBanner';
import type { Robot, RobotTelemetry } from '../../types/robots.types';

function makeRobot(overrides: Partial<Robot> = {}): Robot {
  return {
    id: 'robot-1',
    name: 'Test Bot',
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

describe('RobotErrorBanner', () => {
  it('renders nothing when there are no errors, warnings, or maintenance', () => {
    const { container } = render(
      <RobotErrorBanner robot={makeRobot()} telemetry={makeTelemetry()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when telemetry is null and metadata is clean', () => {
    const { container } = render(<RobotErrorBanner robot={makeRobot()} telemetry={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders an error row from a single telemetry error', () => {
    render(
      <RobotErrorBanner
        robot={makeRobot()}
        telemetry={makeTelemetry({ errors: ['Critical battery level'] })}
      />
    );
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('Critical battery level')).toBeInTheDocument();
  });

  it('deduplicates repeated telemetry messages into a single unique row', () => {
    render(
      <RobotErrorBanner
        robot={makeRobot()}
        telemetry={makeTelemetry({
          errors: ['Overheat', 'Overheat', '  Overheat  ', ''],
        })}
      />
    );
    // Collapses to one unique message -> label is singular "Error", no "+N more"
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('Overheat')).toBeInTheDocument();
    expect(screen.queryByText(/more/)).not.toBeInTheDocument();
  });

  it('collapses multiple unique errors to one line with "+N more"', () => {
    render(
      <RobotErrorBanner
        robot={makeRobot()}
        telemetry={makeTelemetry({ errors: ['E1', 'E2', 'E3'] })}
      />
    );
    // Plural label reflects unique count
    expect(screen.getByText('3 Errors')).toBeInTheDocument();
    // Only the first message shows when collapsed
    expect(screen.getByText('E1')).toBeInTheDocument();
    expect(screen.queryByText('E2')).not.toBeInTheDocument();
    expect(screen.getByText('+2 more')).toBeInTheDocument();
  });

  it('expands and collapses the unique list on click', async () => {
    const user = userEvent.setup();
    render(
      <RobotErrorBanner
        robot={makeRobot()}
        telemetry={makeTelemetry({ errors: ['E1', 'E2', 'E3'] })}
      />
    );

    const toggle = screen.getByRole('button', { name: /3 Errors/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // Expanded list shows the remaining messages
    expect(screen.getByText('E2')).toBeInTheDocument();
    expect(screen.getByText('E3')).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('E2')).not.toBeInTheDocument();
  });

  it('does not expand a single-item row (not expandable)', async () => {
    const user = userEvent.setup();
    render(
      <RobotErrorBanner
        robot={makeRobot()}
        telemetry={makeTelemetry({ errors: ['Only one'] })}
      />
    );
    const toggle = screen.getByRole('button', { name: /Error/i });
    // canExpand is false -> aria-expanded omitted
    expect(toggle).not.toHaveAttribute('aria-expanded');
    await user.click(toggle);
    expect(toggle).not.toHaveAttribute('aria-expanded');
  });

  it('renders warning rows from telemetry warnings', () => {
    render(
      <RobotErrorBanner
        robot={makeRobot()}
        telemetry={makeTelemetry({ warnings: ['Low disk', 'High latency'] })}
      />
    );
    expect(screen.getByText('2 Warnings')).toBeInTheDocument();
    expect(screen.getByText('Low disk')).toBeInTheDocument();
  });

  it('renders a maintenance row from robot metadata', () => {
    render(
      <RobotErrorBanner
        robot={makeRobot({ metadata: { maintenanceReason: 'Scheduled service' } })}
        telemetry={makeTelemetry()}
      />
    );
    expect(screen.getByText('Maintenance')).toBeInTheDocument();
    expect(screen.getByText('Scheduled service')).toBeInTheDocument();
  });

  it('merges metadata errorCode + errorMessage into the error list', () => {
    render(
      <RobotErrorBanner
        robot={makeRobot({ metadata: { errorCode: 'E_FAULT', errorMessage: 'Joint stuck' } })}
        telemetry={makeTelemetry({ errors: ['Telemetry error'] })}
      />
    );
    expect(screen.getByText('2 Errors')).toBeInTheDocument();
    // Metadata error comes first (code: message)
    expect(screen.getByText('E_FAULT: Joint stuck')).toBeInTheDocument();
  });

  it('renders metadata errorCode alone when no errorMessage', () => {
    render(
      <RobotErrorBanner
        robot={makeRobot({ metadata: { errorCode: 'E_FAULT' } })}
        telemetry={makeTelemetry()}
      />
    );
    expect(screen.getByText('E_FAULT')).toBeInTheDocument();
  });

  it('renders all three severities simultaneously', () => {
    render(
      <RobotErrorBanner
        robot={makeRobot({ metadata: { maintenanceReason: 'Service due' } })}
        telemetry={makeTelemetry({ errors: ['Boom'], warnings: ['Careful'] })}
      />
    );
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('Warning')).toBeInTheDocument();
    expect(screen.getByText('Maintenance')).toBeInTheDocument();
  });
});
