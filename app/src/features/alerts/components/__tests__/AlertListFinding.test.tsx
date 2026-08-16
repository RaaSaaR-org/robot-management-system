/**
 * @file AlertListFinding.test.tsx
 * @description A robot alert raised for a patrol finding carries
 *              `[finding:<id> run:<runId>]`; the list shows an "Open finding"
 *              link into the run and keeps the tag out of the prose.
 * @feature alerts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { alertsApi } from '../../api/alertsApi';
import { renderWithProviders } from '@/test/utils';
import { AlertList } from '../AlertList';
import { useAlertsStore } from '../../store/alertsStore';
import type { Alert } from '../../types/alerts.types';

vi.mock('../../api/alertsApi', () => ({
  alertsApi: {
    acknowledgeAlert: vi.fn(),
    getActiveAlerts: vi.fn(),
    getAlertHistory: vi.fn(),
    getAlertCounts: vi.fn(),
  },
}));

const alert = (over: Partial<Alert>): Alert => ({
  id: 'a-1',
  severity: 'warning',
  title: 'unexpected object in Hall (0.4 m²)',
  message: 'Route Night round · run run-1 · Hall · 01:02 [finding:f-1 run:run-1]',
  source: 'robot',
  sourceId: 'g1',
  timestamp: '2026-08-16T01:02:00.000Z',
  acknowledged: false,
  dismissable: true,
  ...over,
});

beforeEach(() => {
  useAlertsStore.setState({ alerts: [] });
});

/** Render with the given alert as the server's active list (the list fetches on mount). */
async function renderWith(a: Alert) {
  vi.mocked(alertsApi.getActiveAlerts).mockResolvedValue([a]);
  renderWithProviders(<AlertList />, { withAuth: false });
  await screen.findByText(a.title);
}

describe('AlertList finding link', () => {
  it('links a robot finding alert into RunDetail and strips the tag', async () => {
    await renderWith(alert({}));
    const link = screen.getByTestId('alert-open-finding');
    expect(link).toHaveAttribute('href', '/patrol/runs/run-1#finding-f-1');
    expect(screen.getByText('Route Night round · run run-1 · Hall · 01:02')).toBeInTheDocument();
    expect(screen.queryByText(/\[finding:/)).toBeNull();
  });

  it('shows no link for an ordinary robot alert', async () => {
    await renderWith(alert({ id: 'a-2', title: 'Battery low', message: 'Battery at 12%' }));
    expect(screen.queryByTestId('alert-open-finding')).toBeNull();
    expect(screen.getByText('Battery at 12%')).toBeInTheDocument();
  });
});
