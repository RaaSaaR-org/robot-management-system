/**
 * @file offlineTask.test.tsx
 * @description An offline robot's task name is what it was last doing, never
 *              "Running now" (TASK-388): the Overview tile and the fleet card.
 * @feature robots
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Robot } from '../../types/robots.types';
import { RobotQuickStats } from '../RobotQuickStats';
import { RobotCard } from '../RobotCard';

function makeRobot(over: Partial<Robot> = {}): Robot {
  return {
    id: 'sim-robot-g1-edu',
    name: 'G1 EDU',
    model: 'G1',
    status: 'offline',
    batteryLevel: 40,
    location: { x: 0, y: 0 },
    lastSeen: '2026-09-11T00:00:00.000Z',
    capabilities: [],
    currentTaskName: 'Protective stop',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-11T00:00:00.000Z',
    ...over,
  };
}

describe('current task of an offline robot', () => {
  it('the Overview tile marks it as last known, not running', () => {
    render(<RobotQuickStats robot={makeRobot()} />);
    expect(screen.getByText('Protective stop')).toBeInTheDocument();
    expect(screen.getByText('Last known — robot offline')).toBeInTheDocument();
    expect(screen.queryByText('Running now')).toBeNull();
  });

  it('the Overview tile still says "Running now" for an online robot', () => {
    render(<RobotQuickStats robot={makeRobot({ status: 'busy' })} />);
    expect(screen.getByText('Running now')).toBeInTheDocument();
  });

  it('the fleet card calls it the last task', () => {
    render(
      <MemoryRouter>
        <RobotCard robot={makeRobot()} />
      </MemoryRouter>
    );
    expect(screen.getByText('Last task: Protective stop')).toBeInTheDocument();
  });

  it('the fleet card says "Task" for an online robot', () => {
    render(
      <MemoryRouter>
        <RobotCard robot={makeRobot({ status: 'online' })} />
      </MemoryRouter>
    );
    expect(screen.getByText('Task: Protective stop')).toBeInTheDocument();
  });
});
