/**
 * @file ComplianceDashboard.test.tsx
 * @description TASK-503: a framework with nothing tracked reads "Not assessed"
 *              with no score bar, an overdue one reads "Overdue", and the
 *              overall score says how many frameworks it covers. TASK-505: a
 *              framework with a deadline still open is not shown as compliant.
 *              TASK-508: the bar is the share of requirements met, so it is
 *              never full next to open items.
 * @feature compliance
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useComplianceTrackerStore } from '../../store/complianceTrackerStore';
import { ComplianceDashboard } from '../ComplianceDashboard';
import type { ComplianceDashboardStats, FrameworkScore } from '../../types';

const ALERTS = {
  criticalGaps: 0,
  expiringDocuments: 0,
  overdueTraining: 0,
  overdueInspections: 0,
  upcomingDeadlines: 0,
  pendingRiskReviews: 0,
};

function show(overallScore: number, frameworkScores: FrameworkScore[]) {
  const dashboardStats: ComplianceDashboardStats = {
    overallScore,
    frameworkScores,
    alerts: ALERTS,
    recentActivity: [],
    lastUpdated: '2026-11-14T00:00:00.000Z',
  };
  useComplianceTrackerStore.setState({
    dashboardStats,
    deadlines: [],
    recentActivity: [],
    isLoadingDashboard: false,
    isLoadingDeadlines: false,
    isLoadingActivity: false,
    error: null,
    // The component fetches on mount; the state above is the answer.
    fetchDashboardStats: vi.fn(() => Promise.resolve()),
    fetchRegulatoryDeadlines: vi.fn(() => Promise.resolve()),
    fetchRecentActivity: vi.fn(() => Promise.resolve()),
  });
  render(
    <MemoryRouter>
      <ComplianceDashboard />
    </MemoryRouter>,
  );
}

const row = (name: string) => within(screen.getByText(name).closest('li')!);

beforeEach(() => vi.clearAllMocks());

describe('the framework list', () => {
  beforeEach(() =>
    show(90, [
      { framework: 'ai_act', score: 100, status: 'compliant', openItems: 0, totalItems: 2 },
      { framework: 'nis2', score: 80, status: 'overdue', openItems: 1, totalItems: 1 },
      { framework: 'gdpr', score: 0, status: 'not_assessed', openItems: 0, totalItems: 0 },
    ]),
  );

  it('shows a framework with nothing tracked as "Not assessed", without a score bar', () => {
    const gdpr = row('GDPR');

    expect(gdpr.getByText('Not assessed')).toBeInTheDocument();
    expect(gdpr.getByText('Nothing tracked yet')).toBeInTheDocument();
    expect(gdpr.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(gdpr.queryByText('Compliant')).not.toBeInTheDocument();
  });

  it('shows a framework with a missed deadline as "Overdue", its bar empty while its one item is open', () => {
    const nis2 = row('NIS2 Directive');

    expect(nis2.getByText('Overdue')).toBeInTheDocument();
    expect(nis2.getByText('1 open of 1')).toBeInTheDocument();
    // No requirement counts from this server: the bar is the share of items not open (TASK-508).
    expect(nis2.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  it('does not draw an overdue framework as a green bar, even at a score of 80', () => {
    expect(row('NIS2 Directive').getByRole('progressbar')).toHaveClass('bg-signal-stopped');
    expect(row('EU AI Act').getByRole('progressbar')).toHaveClass('bg-signal-measured');
  });

  it('says how many frameworks the overall score covers', () => {
    expect(screen.getByText('Across 2 of 3 frameworks · 1 not assessed')).toBeInTheDocument();
  });
});

describe('a framework with a deadline still open (TASK-505)', () => {
  beforeEach(() =>
    show(100, [
      { framework: 'ai_act', score: 100, status: 'in_progress', openItems: 1, totalItems: 1 },
      { framework: 'machinery_regulation', score: 100, status: 'at_risk', openItems: 1, totalItems: 1 },
    ]),
  );

  it('reads "In progress", not "Compliant", while a deadline ahead has requirements open', () => {
    const aiAct = row('EU AI Act');

    expect(aiAct.getByText('In progress')).toBeInTheDocument();
    expect(aiAct.queryByText('Compliant')).not.toBeInTheDocument();
    expect(aiAct.getByText('1 open of 1')).toBeInTheDocument();
  });

  it('draws an at-risk framework amber, even at a score of 100', () => {
    const machinery = within(screen.getByText('At risk').closest('li')!);

    expect(machinery.getByRole('progressbar')).toHaveClass('bg-signal-unknown');
  });
});

describe('the bar is the share of requirements met (TASK-508)', () => {
  beforeEach(() =>
    show(92, [
      // The live case: a score of 100 with its one deadline at 0 of 8.
      { framework: 'ai_act', score: 100, status: 'in_progress', openItems: 1, totalItems: 1, metRequirements: 0, totalRequirements: 8 },
      { framework: 'cra', score: 100, status: 'in_progress', openItems: 1, totalItems: 1, metRequirements: 3, totalRequirements: 5 },
      { framework: 'red', score: 100, status: 'compliant', openItems: 0, totalItems: 2, metRequirements: 6, totalRequirements: 6 },
    ]),
  );

  it('draws no full bar next to "1 open of 1"', () => {
    const aiAct = row('EU AI Act');

    expect(aiAct.getByText('1 open of 1')).toBeInTheDocument();
    expect(aiAct.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(aiAct.getByText('0%')).toBeInTheDocument();
    expect(aiAct.queryByText('100%')).not.toBeInTheDocument();
  });

  it('draws a part-done framework partial and amber, not green', () => {
    const cra = row('Cyber Resilience Act');

    expect(cra.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '60');
    expect(cra.getByRole('progressbar')).toHaveClass('bg-signal-unknown');
  });

  it('draws a framework with every requirement met full and green', () => {
    const red = row('Radio Equipment Directive');

    expect(red.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(red.getByRole('progressbar')).toHaveClass('bg-signal-measured');
  });

  it('leaves the overall score as the server gives it', () => {
    const tile = within(screen.getByText('Compliance score').parentElement!.parentElement!);
    expect(tile.getByText('92')).toBeInTheDocument();
  });
});

describe('the overall score', () => {
  it('counts every framework when all are assessed', () => {
    show(100, [{ framework: 'ai_act', score: 100, status: 'compliant', openItems: 0, totalItems: 2 }]);

    expect(screen.getByText('Across 1 frameworks')).toBeInTheDocument();
  });

  it('shows no number when nothing is assessed at all', () => {
    show(100, [
      { framework: 'ai_act', score: 0, status: 'not_assessed', openItems: 0, totalItems: 0 },
      { framework: 'gdpr', score: 0, status: 'not_assessed', openItems: 0, totalItems: 0 },
    ]);

    const tile = within(screen.getByText('Compliance score').parentElement!.parentElement!);
    expect(screen.getByText('Across 0 of 2 frameworks · 2 not assessed')).toBeInTheDocument();
    expect(tile.queryByText('100')).not.toBeInTheDocument();
  });
});
