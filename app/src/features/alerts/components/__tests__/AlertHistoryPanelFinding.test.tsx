/**
 * @file AlertHistoryPanelFinding.test.tsx
 * @description The Alerts page "History" tab must not show the
 *              `[finding:<id> run:<runId>]` machine tag TASK-212 appends to a
 *              patrol-finding alert.
 * @feature alerts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { AlertHistoryPanel } from '../AlertHistoryPanel';
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

const alert = (over: Partial<Alert> = {}): Alert => ({
  id: 'h-1',
  severity: 'warning',
  title: 'unexpected object in Hall (0.4 m²)',
  message: 'Route Night round · Hall · source: enroute_semantic [finding:f-1 run:run-1]',
  source: 'robot',
  sourceId: 'g1',
  timestamp: '2026-08-16T01:02:00.000Z',
  acknowledged: false,
  dismissable: true,
  ...over,
});

/** Seed the store's history directly; the panel renders it with autoFetch off. */
function renderWith(history: Alert[]) {
  useAlertsStore.setState({
    history,
    isHistoryLoading: false,
    historyPagination: { page: 1, pageSize: 20, total: history.length, totalPages: 1 },
  });
  renderWithProviders(<AlertHistoryPanel autoFetch={false} />, { withAuth: false });
}

beforeEach(() => {
  useAlertsStore.setState({ alerts: [], history: [] });
});

describe('AlertHistoryPanel finding tag', () => {
  it('strips the machine tag from the message', () => {
    renderWith([alert()]);

    expect(
      screen.getByText('Route Night round · Hall · source: enroute_semantic')
    ).toBeInTheDocument();
    expect(screen.queryByText(/\[finding:/)).toBeNull();
    expect(document.body.textContent).not.toContain('[finding:');
    expect(document.body.textContent).not.toContain('run:run-1]');
  });

  it('leaves an ordinary alert message unchanged', () => {
    renderWith([alert({ id: 'h-2', title: 'Battery low', message: 'Battery at 12%' })]);

    expect(screen.getByText('Battery at 12%')).toBeInTheDocument();
  });
});
