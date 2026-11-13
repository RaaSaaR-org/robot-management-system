/**
 * @file FleetStats.test.tsx
 * @description TASK-485: robots that were never connected are named as
 *   expected, not counted as robots that are down.
 * @feature fleet
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FleetStats } from '../FleetStats';
import type { FleetStatus } from '../../types/fleet.types';

function status(overrides: Partial<FleetStatus>): FleetStatus {
  return {
    totalRobots: 0,
    robotsByStatus: { online: 0, offline: 0, busy: 0, error: 0, charging: 0, maintenance: 0, protective_stop: 0 },
    avgBatteryLevel: null,
    alertCounts: { critical: 0, error: 0, warning: 0, info: 0 },
    totalUnacknowledgedAlerts: 0,
    activeTaskCount: 0,
    robotsNeedingAttention: 0,
    ...overrides,
  };
}

describe('FleetStats: robots online', () => {
  it('counts online against the robots that have an agent and names the expected ones', () => {
    // The demo instance: one sim agent online, three expected robots.
    render(
      <FleetStats
        status={status({
          totalRobots: 4,
          expectedRobots: 3,
          robotsByStatus: { online: 1, offline: 3, busy: 0, error: 0, charging: 0, maintenance: 0, protective_stop: 0 },
        })}
      />,
    );
    const tile = screen.getByTestId('fleet-stat-online');
    expect(tile).toHaveTextContent('1');
    expect(tile).toHaveTextContent('/ 1');
    expect(tile).not.toHaveTextContent('/ 4');
    expect(tile).toHaveTextContent('3 more expected, not connected yet');
  });

  it('still shows a robot that dropped offline as missing', () => {
    render(
      <FleetStats
        status={status({
          totalRobots: 3,
          expectedRobots: 1,
          robotsByStatus: { online: 1, offline: 2, busy: 0, error: 0, charging: 0, maintenance: 0, protective_stop: 0 },
        })}
      />,
    );
    expect(screen.getByTestId('fleet-stat-online')).toHaveTextContent('/ 2');
  });

  it('is unchanged for a fleet without expected robots', () => {
    render(
      <FleetStats
        status={status({
          totalRobots: 2,
          robotsByStatus: { online: 1, offline: 0, busy: 1, error: 0, charging: 0, maintenance: 0, protective_stop: 0 },
        })}
      />,
    );
    const tile = screen.getByTestId('fleet-stat-online');
    expect(tile).toHaveTextContent('2');
    expect(tile).toHaveTextContent('/ 2');
    expect(tile).toHaveTextContent('Live from robot agents');
  });
});
