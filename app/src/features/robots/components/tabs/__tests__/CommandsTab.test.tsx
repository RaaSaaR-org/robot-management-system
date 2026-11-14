/**
 * @file CommandsTab.test.tsx
 * @description The Activity tab's command history (TASK-504): a failed row says
 *              why the robot refused it and what the operator asked, a charge
 *              reads "Charge", and the panel copy is plain.
 * @feature robots
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Robot, RobotCommand } from '../../../types/robots.types';

vi.mock('@/features/command', () => ({
  CommandBar: () => <div data-testid="command-bar" />,
}));

import { CommandsTab } from '../CommandsTab';

const robot: Robot = {
  id: 'sim-robot-001',
  name: 'SimBot-01',
  model: 'Unitree G1 (simulated)',
  status: 'online',
  batteryLevel: 78,
  location: { x: 0, y: 0 },
  lastSeen: '2026-11-14T00:00:00.000Z',
  capabilities: [],
  metadata: { isSimulated: true, robotType: 'g1', powerSource: 'battery' },
  createdAt: '2026-11-14T00:00:00.000Z',
  updatedAt: '2026-11-14T00:00:00.000Z',
};

function command(overrides: Partial<RobotCommand>): RobotCommand {
  return {
    id: 'c',
    robotId: robot.id,
    type: 'charge',
    payload: {},
    status: 'completed',
    priority: 'normal',
    createdAt: '2026-11-14T10:00:00.000Z',
    ...overrides,
  };
}

function renderTab(commandHistory: RobotCommand[]) {
  return render(
    <MemoryRouter>
      <CommandsTab
        robot={robot}
        robotId={robot.id}
        commandHistory={commandHistory}
        isCommandLoading={false}
        canExecuteCommands
        onSendToCharge={vi.fn().mockResolvedValue(undefined)}
        onReturnHome={vi.fn().mockResolvedValue(undefined)}
      />
    </MemoryRouter>
  );
}

describe('CommandsTab (TASK-504)', () => {
  it('labels a charge "Charge"', () => {
    renderTab([command({ id: 'c1' })]);
    expect(screen.getByText('Charge')).toBeInTheDocument();
    expect(screen.queryByText('Go Charge')).toBeNull();
  });

  it('shows a failed row\'s reason and the phrase the operator typed', () => {
    renderTab([
      command({
        id: 'c2',
        type: 'move',
        status: 'failed',
        payload: { target: 'base', nlOriginalText: 'return to base' },
        errorMessage: 'No destination provided',
      }),
    ]);
    expect(screen.getByText('Move')).toBeInTheDocument();
    expect(screen.getByText('“return to base”')).toBeInTheDocument();
    expect(screen.getByText('No destination provided')).toBeInTheDocument();
  });

  it('a failed row without a phrase still shows its reason', () => {
    renderTab([command({ id: 'c3', status: 'failed', errorMessage: 'Battery sensor offline' })]);
    expect(screen.getByText('Battery sensor offline')).toBeInTheDocument();
    expect(screen.queryByText(/“/)).toBeNull();
  });

  it('a completed row shows only its label', () => {
    renderTab([
      command({ id: 'c4', type: 'return_home', payload: { nlOriginalText: 'go home' }, errorMessage: 'stale' }),
    ]);
    expect(screen.getByText('Return Home')).toBeInTheDocument();
    expect(screen.queryByText('“go home”')).toBeNull();
    expect(screen.queryByText('stale')).toBeNull();
  });

  it('says "use the buttons", not "quick act"', () => {
    renderTab([]);
    expect(screen.getByText(/Tell SimBot-01 what to do in plain words, or use the buttons\./)).toBeInTheDocument();
    expect(screen.queryByText(/quick act/)).toBeNull();
  });
});
