/**
 * @file AlertActions.test.tsx
 * @description Acknowledging and dismissing must reach the server: a purely
 *              local flip looks like it worked and is undone by the next fetch
 *              of /alerts/active. Also covers the robot chip, which needs the
 *              robot list the /alerts route never used to load.
 * @feature alerts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { alertsApi } from '../../api/alertsApi';
import { robotsApi } from '@/features/robots/api/robotsApi';
import { useRobotsStore } from '@/features/robots/store/robotsStore';
import { AlertList } from '../AlertList';
import { AlertBanner } from '../AlertBanner';
import { useAlertsStore } from '../../store/alertsStore';
import type { Alert } from '../../types/alerts.types';

vi.mock('../../api/alertsApi', () => ({
  alertsApi: {
    acknowledgeAlert: vi.fn(),
    deleteAlert: vi.fn(),
    getActiveAlerts: vi.fn(),
    getAlertHistory: vi.fn(),
    getAlertCounts: vi.fn(),
  },
}));

vi.mock('@/features/robots/api/robotsApi', () => ({
  robotsApi: { listRobots: vi.fn() },
}));

const critical = (over: Partial<Alert> = {}): Alert => ({
  id: 'a-1',
  severity: 'critical',
  title: 'Emergency stop engaged',
  message: 'Robot halted in Hall',
  source: 'robot',
  sourceId: 'sim-robot-g1-edu',
  timestamp: '2026-08-16T01:02:00.000Z',
  acknowledged: false,
  dismissable: true,
  ...over,
});

const warning = (over: Partial<Alert> = {}): Alert => ({
  ...critical(),
  id: 'a-2',
  severity: 'warning',
  title: 'Battery low',
  message: 'Battery at 12%',
  ...over,
});

const robot = {
  id: 'sim-robot-g1-edu',
  name: 'G1 EDU',
  model: 'Unitree G1 EDU',
  status: 'online',
  batteryLevel: 80,
  location: { x: 0, y: 0, zone: '' },
  lastSeen: 'x',
  capabilities: [],
  createdAt: 'x',
  updatedAt: 'x',
};

beforeEach(() => {
  vi.clearAllMocks();
  useAlertsStore.setState({ alerts: [], error: null });
  // A hard load starts with an empty, non-persistent robots store.
  useRobotsStore.setState({ robots: [] });
  vi.mocked(robotsApi.listRobots).mockResolvedValue({
    robots: [robot] as never,
    pagination: { page: 1, pageSize: 12, total: 1, totalPages: 1 },
  });
});

/** Render the given component with `alerts` as the server's active list. */
async function renderWith(ui: React.ReactElement, alerts: Alert[]) {
  vi.mocked(alertsApi.getActiveAlerts).mockResolvedValue(alerts);
  renderWithProviders(ui, { withAuth: false, routerEntries: ['/alerts'] });
  await screen.findByText(alerts[0].title);
}

describe('AlertList acknowledge/dismiss reach the server', () => {
  it('acknowledging sends the PATCH, and the refetched list no longer carries the alert', async () => {
    const alert = critical();
    await renderWith(<AlertList />, [alert]);
    vi.mocked(alertsApi.acknowledgeAlert).mockResolvedValue({
      ...alert,
      acknowledged: true,
      acknowledgedAt: '2026-08-16T01:03:00.000Z',
    });

    await userEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));

    expect(alertsApi.acknowledgeAlert).toHaveBeenCalledWith('a-1');

    // The server honours the acknowledgement, so /alerts/active drops it —
    // where before the PATCH never happened and the refetch handed it back.
    vi.mocked(alertsApi.getActiveAlerts).mockResolvedValue([]);
    await act(async () => {
      await useAlertsStore.getState().fetchActiveAlerts();
    });

    expect(screen.queryByText('Emergency stop engaged')).toBeNull();
  });

  it('a rejected acknowledge rolls the row back and shows the reason', async () => {
    await renderWith(<AlertList />, [critical()]);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(alertsApi.acknowledgeAlert).mockRejectedValue(new Error('Server unavailable'));

    await userEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));

    await screen.findByText('Server unavailable');
    // Still unacknowledged: the button is only rendered while it is.
    expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeInTheDocument();
    expect(useAlertsStore.getState().alerts[0].acknowledged).toBe(false);
    errSpy.mockRestore();
  });

  it('dismissing sends the DELETE and drops the row', async () => {
    await renderWith(<AlertList />, [warning()]);
    vi.mocked(alertsApi.deleteAlert).mockResolvedValue(undefined);

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss alert' }));

    expect(alertsApi.deleteAlert).toHaveBeenCalledWith('a-2');
    await waitFor(() => expect(screen.queryByText('Battery low')).toBeNull());
  });

  it('a rejected dismiss puts the row back and shows the reason', async () => {
    await renderWith(<AlertList />, [warning()]);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(alertsApi.deleteAlert).mockRejectedValue(new Error('Delete failed'));

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss alert' }));

    await screen.findByText('Delete failed');
    expect(screen.getByText('Battery low')).toBeInTheDocument();
    errSpy.mockRestore();
  });
});

describe('AlertBanner acknowledge/dismiss reach the server', () => {
  it('acknowledging the banner sends the PATCH', async () => {
    const alert = critical();
    await renderWith(<AlertBanner />, [alert]);
    vi.mocked(alertsApi.acknowledgeAlert).mockResolvedValue({
      ...alert,
      acknowledged: true,
      acknowledgedAt: '2026-08-16T01:03:00.000Z',
    });

    await userEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));

    expect(alertsApi.acknowledgeAlert).toHaveBeenCalledWith('a-1');
    await waitFor(() => expect(screen.queryByText('Emergency stop engaged')).toBeNull());
  });

  it('dismissing a non-critical banner alert sends the DELETE', async () => {
    await renderWith(<AlertBanner />, [warning()]);
    vi.mocked(alertsApi.deleteAlert).mockResolvedValue(undefined);

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(alertsApi.deleteAlert).toHaveBeenCalledWith('a-2');
    await waitFor(() => expect(screen.queryByText('Battery low')).toBeNull());
  });
});

describe('AlertList robot chip on a hard load', () => {
  it('fetches the robots nobody else on /alerts loads and shows the name as a link', async () => {
    await renderWith(<AlertList />, [warning()]);

    const link = await screen.findByRole('link', { name: 'G1 EDU' });
    expect(link).toHaveAttribute('href', '/robots/sim-robot-g1-edu');
    expect(screen.queryByText('sim-robot-g1-edu')).toBeNull();
  });

  it('keeps the raw ID unlinked when the robot really is gone', async () => {
    vi.mocked(robotsApi.listRobots).mockResolvedValue({
      robots: [],
      pagination: { page: 1, pageSize: 12, total: 0, totalPages: 0 },
    });

    await renderWith(<AlertList />, [warning()]);

    await waitFor(() => expect(robotsApi.listRobots).toHaveBeenCalled());
    expect(screen.getByText('sim-robot-g1-edu')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'sim-robot-g1-edu' })).toBeNull();
  });
});
