/**
 * @file AlertBannerFinding.test.tsx
 * @description The sticky banner must never leak the `[finding:<id> run:<runId>]`
 *              machine tag TASK-212 appends to a patrol-finding alert, and must
 *              offer a deep link into the run instead.
 * @feature alerts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { alertsApi } from '../../api/alertsApi';
import { renderWithProviders } from '@/test/utils';
import { AlertBanner } from '../AlertBanner';
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
  id: 'a-1',
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

beforeEach(() => {
  useAlertsStore.setState({ alerts: [] });
});

/** Render the banner off the landing route (it hides on `/`) with one active alert. */
async function renderWith(a: Alert) {
  vi.mocked(alertsApi.getActiveAlerts).mockResolvedValue([a]);
  renderWithProviders(<AlertBanner />, { withAuth: false, routerEntries: ['/dashboard'] });
  await screen.findByText(a.title);
}

describe('AlertBanner finding link', () => {
  it('strips the machine tag and links into the run', async () => {
    await renderWith(alert());

    const link = screen.getByTestId('alert-banner-open-finding');
    expect(link).toHaveAttribute('href', '/patrol/runs/run-1#finding-f-1');
    expect(
      screen.getByText('Route Night round · Hall · source: enroute_semantic')
    ).toBeInTheDocument();
    expect(screen.queryByText(/\[finding:/)).toBeNull();
    expect(document.body.textContent).not.toContain('[finding:');
    expect(document.body.textContent).not.toContain('run:run-1]');
  });

  it('does not dismiss the alert when the finding link is clicked', async () => {
    await renderWith(alert());

    await userEvent.click(screen.getByTestId('alert-banner-open-finding'));

    expect(useAlertsStore.getState().alerts).toHaveLength(1);
    expect(screen.getByTestId('alert-banner-open-finding')).toBeInTheDocument();
  });

  it('a skipped-run alert (bare [run:<id>]) links to the RUN and says so', async () => {
    await renderWith(
      alert({
        id: 'a-3',
        title: 'Patrol "Night round" was skipped',
        message: 'Patrol "Night round" (patrol, scheduled) was skipped: battery 12% [run:run-s]',
      })
    );

    const link = screen.getByTestId('alert-banner-open-finding');
    // The tag names a run, not a finding: "Open finding" would send the
    // operator hunting for evidence a skipped run never produced.
    expect(link).toHaveAttribute('href', '/patrol/runs/run-s');
    expect(link).toHaveTextContent('Open run →');
    expect(document.body.textContent).not.toContain('Open finding');
    expect(document.body.textContent).not.toContain('[run:');
  });

  it('leaves an ordinary alert untouched and shows no link', async () => {
    await renderWith(alert({ id: 'a-2', title: 'Battery low', message: 'Battery at 12%' }));

    expect(screen.queryByTestId('alert-banner-open-finding')).toBeNull();
    expect(screen.getByText('Battery at 12%')).toBeInTheDocument();
  });
});

describe('AlertBanner sticky plate', () => {
  it('paints an opaque plate under the translucent severity tint', async () => {
    await renderWith(alert());

    // The bar sticks under the TopBar while the page scrolls beneath it. Every
    // dark-mode severity tint is `dark:bg-*-900/20`, so without an opaque plate
    // the page content shows straight through the alert.
    const sticky = screen.getByRole('alert');
    expect(sticky.className).toContain('sticky');
    expect(sticky.className).toContain('bg-theme-primary');

    const tinted = sticky.firstElementChild as HTMLElement;
    expect(tinted.className).toMatch(/dark:bg-yellow-900\/20/);
  });
});
