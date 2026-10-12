/**
 * @file AlertBannerGroup.test.tsx
 * @description Identical alerts read as one banner line with a count, and one
 *              Dismiss clears them all — otherwise each click puts the same
 *              line back and the button looks dead (TASK-388).
 * @feature alerts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { alertsApi } from '../../api/alertsApi';
import { AlertBanner, sameAlertGroup } from '../AlertBanner';
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

const reset = (id: string, over: Partial<Alert> = {}): Alert => ({
  id,
  severity: 'info',
  title: 'E-Stop Reset - G1',
  message: 'Emergency stop has been reset. Robot is ready for operation.',
  source: 'robot',
  sourceId: 'sim-robot-g1-edu',
  timestamp: '2026-08-22T10:00:00.000Z',
  acknowledged: false,
  dismissable: true,
  ...over,
});

beforeEach(() => {
  useAlertsStore.setState({ alerts: [] });
  vi.mocked(alertsApi.deleteAlert).mockResolvedValue(undefined);
});

async function renderWith(alerts: Alert[]) {
  vi.mocked(alertsApi.getActiveAlerts).mockResolvedValue(alerts);
  renderWithProviders(<AlertBanner />, { withAuth: false, routerEntries: ['/dashboard'] });
  await screen.findByText(alerts[0].title);
}

describe('AlertBanner grouping', () => {
  it('shows a count for identical alerts and dismisses them in one click', async () => {
    await renderWith([reset('r-1'), reset('r-2'), reset('r-3')]);

    expect(screen.getByTestId('alert-banner-count')).toHaveTextContent('×3');

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(alertsApi.deleteAlert).toHaveBeenCalledTimes(3);
    expect(vi.mocked(alertsApi.deleteAlert).mock.calls.map((c) => c[0]).sort()).toEqual([
      'r-1',
      'r-2',
      'r-3',
    ]);
    await waitFor(() => expect(screen.queryByText('E-Stop Reset - G1')).toBeNull());
  });

  it('leaves an alert from another robot for the next line', async () => {
    await renderWith([reset('r-1'), reset('r-2'), reset('o-1', { sourceId: 'other', title: 'E-Stop Reset - H1' })]);

    expect(screen.getByTestId('alert-banner-count')).toHaveTextContent('×2');

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(await screen.findByText('E-Stop Reset - H1')).toBeInTheDocument();
    expect(screen.queryByTestId('alert-banner-count')).toBeNull();
  });

  it('does not group the same title at a different severity', () => {
    const info = reset('r-1');
    const warning = reset('r-2', { severity: 'warning' });
    expect(sameAlertGroup(info, [info, warning]).map((a) => a.id)).toEqual(['r-1']);
  });
});
