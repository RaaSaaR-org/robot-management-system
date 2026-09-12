/**
 * @file RobotList.test.tsx
 * @description Per-role rendering of the fleet list's destructive controls
 *   (TASK-284). Drives the real `useAuthStore` rather than mocking `useAuth`:
 *   the permission seam itself is what is under test, so mocking the hook
 *   would mock the boundary away. Asserts on the rendered menu, never on
 *   `can()` having been called.
 * @feature robots
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { useAuthStore } from '@/features/auth/store/authStore';
import { MOCK_USER } from '@/mocks/mockData';
import type { UserRole } from '@/features/auth/types/auth.types';
import type { Robot } from '../../types/robots.types';

const robot: Robot = {
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
};

// The list's data source is not the seam under test — only the role is.
const { robotsState } = vi.hoisted(() => ({
  robotsState: {
    robots: [] as unknown[],
    selectedRobot: null,
    selectedRobotId: null,
    filters: {} as Record<string, unknown>,
    pagination: { page: 1, pageSize: 12, total: 1, totalPages: 1 },
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

import { RobotList } from '../RobotList';

function signInAs(role: UserRole) {
  useAuthStore.setState({
    user: { ...MOCK_USER, role },
    isAuthenticated: true,
    isInitialized: true,
  });
}

/** Open the one row's kebab and return the menu it portals to <body>. */
function openRowActions(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${robot.name}` }));
  return screen.getByRole('menu');
}

beforeEach(() => {
  robotsState.robots = [robot];
  robotsState.error = null;
  localStorage.clear();
});

describe('RobotList destructive controls', () => {
  it('offers a viewer no way to unregister a robot or register one', () => {
    signInAs('viewer');
    renderWithProviders(<RobotList onRegister={vi.fn()} />);

    // The row menu still opens — reading and navigating are untouched.
    openRowActions();
    expect(screen.getByRole('menuitem', { name: /open control center/i })).toBeInTheDocument();
    // Filtered out, not disabled: a viewer never acquires `robots:write`.
    expect(screen.queryByRole('menuitem', { name: /unregister/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /register robot/i })).not.toBeInTheDocument();
  });

  it.each(['member', 'owner'] as const)('lets a %s unregister and register', (role) => {
    signInAs(role);
    renderWithProviders(<RobotList onRegister={vi.fn()} />);

    const unregister = (openRowActions(), screen.getByRole('menuitem', { name: /unregister/i }));
    expect(unregister).toBeEnabled();
    expect(screen.getByRole('button', { name: /register robot/i })).toBeInTheDocument();
  });

  it('opens the register modal when a member uses the toolbar button', () => {
    signInAs('member');
    const onRegister = vi.fn();
    renderWithProviders(<RobotList onRegister={onRegister} />);

    fireEvent.click(screen.getByRole('button', { name: /register robot/i }));
    expect(onRegister).toHaveBeenCalledTimes(1);
  });

  it('drops the empty state’s register action for a viewer but keeps it for a member', () => {
    robotsState.robots = [];

    signInAs('viewer');
    const { unmount } = renderWithProviders(<RobotList onRegister={vi.fn()} />);
    expect(screen.getByText('No robots yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /register robot/i })).not.toBeInTheDocument();
    unmount();

    signInAs('member');
    renderWithProviders(<RobotList onRegister={vi.fn()} />);
    expect(screen.getByText('No robots yet')).toBeInTheDocument();
    // Two for a member with an empty fleet: the toolbar's and the empty
    // state's. The point is that both are gone above, not that there is one.
    expect(screen.getAllByRole('button', { name: /register robot/i })).toHaveLength(2);
  });
});
