/**
 * @file robotStatus.protective-stop.test.tsx
 * @description `protective_stop` through its four app-side consumers
 *   (TASK-294 AC5): the status tag's label, the fleet list's status filter,
 *   the fleet-status counter, and `isRobotAvailable`. The value already
 *   travels end to end — this is the coverage that keeps it doing so, so each
 *   case drives the real consumer rather than re-asserting the constant maps.
 * @feature robots
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, renderHook, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { isRobotAvailable } from '../../types/robots.types';
import type { Robot } from '../../types/robots.types';

function makeRobot(overrides: Partial<Robot> = {}): Robot {
  return {
    id: 'robot-1',
    name: 'Atlas',
    model: 'G1',
    status: 'online',
    batteryLevel: 80,
    location: { x: 0, y: 0 },
    lastSeen: '2026-09-12T00:00:00.000Z',
    capabilities: [],
    createdAt: '2026-09-12T00:00:00.000Z',
    updatedAt: '2026-09-12T00:00:00.000Z',
    ...overrides,
  };
}

const stopped = makeRobot({ id: 'robot-1', name: 'Atlas', status: 'protective_stop' });
const running = makeRobot({ id: 'robot-2', name: 'Bolt', status: 'online' });

// Both the list and the fleet-status hook read the fleet through this module
// (the hook via the `@/features/robots/hooks` barrel, which re-exports it), so
// one mock feeds both. The data source is not the seam under test.
const { robotsState } = vi.hoisted(() => ({
  robotsState: {
    robots: [] as unknown[],
    selectedRobot: null,
    selectedRobotId: null,
    filters: {} as Record<string, unknown>,
    pagination: { page: 1, pageSize: 12, total: 2, totalPages: 1 },
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

import { RobotStatusTag } from '../common/RobotStatusTag';
import { RobotList } from '../RobotList';
import { useFleetStatus } from '@/features/fleet/hooks/useFleetStatus';

beforeEach(() => {
  robotsState.robots = [stopped, running];
  robotsState.filters = {};
  robotsState.error = null;
  localStorage.clear();
});

describe('a robot in protective stop', () => {
  it('shows "Protective stop" as its status tag, not the raw enum value', () => {
    render(<RobotStatusTag status={stopped.status} />);
    expect(screen.getByText('Protective stop')).toBeInTheDocument();
    expect(screen.queryByText(/protective_stop/i)).not.toBeInTheDocument();
  });

  it('is what the fleet list returns when filtered to protective stop', () => {
    robotsState.filters = { status: 'protective_stop' };
    renderWithProviders(<RobotList onRegister={vi.fn()} />);

    expect(screen.getByText('Atlas')).toBeInTheDocument();
    // The online robot is filtered out, so the status is a real filter value.
    expect(screen.queryByText('Bolt')).not.toBeInTheDocument();
    // The toolbar's status <select> carries the same words, so read the tag
    // off the card: exactly one row, wearing the status.
    const tags = screen
      .getAllByText('Protective stop')
      .filter((el) => el.tagName !== 'OPTION');
    expect(tags).toHaveLength(1);
  });

  it('is counted by the fleet-status aggregation', () => {
    const { result } = renderHook(() => useFleetStatus());

    expect(result.current.status.robotsByStatus.protective_stop).toBe(1);
    expect(result.current.status.robotsByStatus.online).toBe(1);
    expect(result.current.status.totalRobots).toBe(2);
  });

  it('is not available for commands', () => {
    expect(isRobotAvailable(stopped)).toBe(false);
    expect(isRobotAvailable(running)).toBe(true);
  });
});
