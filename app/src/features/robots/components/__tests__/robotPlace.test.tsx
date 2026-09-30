/**
 * @file robotPlace.test.tsx
 * @description Robot views answer "where is it" with `location.place` and
 *              nothing else (TASK-333): the card line, the location formatter
 *              and the Details tab's "Place" row.
 * @feature robots
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Robot } from '../../types/robots.types';
import { formatRobotLocation } from '../../types/robots.types';
import { robotPlace } from '../RobotCard';
import { InfoTab } from '../tabs/InfoTab';

// The site picker talks to the twins API; it is not what is under test.
vi.mock('../tabs/SiteSelect', () => ({ SiteSelect: () => null }));

function makeRobot(location: Robot['location']): Robot {
  return {
    id: 'robot-1',
    name: 'Atlas',
    model: 'G1',
    status: 'online',
    batteryLevel: 80,
    location,
    lastSeen: '2026-09-30T00:00:00.000Z',
    capabilities: [],
    createdAt: '2026-09-30T00:00:00.000Z',
    updatedAt: '2026-09-30T00:00:00.000Z',
  };
}

describe('robot place display', () => {
  it('shows the place and floor on the card line', () => {
    expect(robotPlace(makeRobot({ x: 1, y: 2, floor: '1', place: 'DOCK-1' }))).toBe('DOCK-1 · Floor 1');
  });

  it('says "Place unknown" when the robot is in no place', () => {
    expect(robotPlace(makeRobot({ x: 1, y: 2, place: null }))).toBe('Place unknown');
  });

  it('formats a location by its place', () => {
    expect(formatRobotLocation({ x: 1, y: 2, floor: '2', place: 'CHARGING-A' })).toBe('CHARGING-A - Floor 2');
    expect(formatRobotLocation({ x: 1, y: 2 })).toBe('(1.0, 2.0)');
  });

  it('labels the Details row "Place" and shows location.place', () => {
    render(<InfoTab robot={makeRobot({ x: 0, y: 0, place: 'AISLE-3' })} robotId="robot-1" />);
    expect(screen.getByText('Place')).toBeInTheDocument();
    expect(screen.getByText('AISLE-3')).toBeInTheDocument();
    expect(screen.queryByText('Zone')).not.toBeInTheDocument();
  });
});
