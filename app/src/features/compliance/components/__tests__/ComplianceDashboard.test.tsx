/**
 * @file ComplianceDashboard.test.tsx
 * @description TASK-503: a framework with nothing tracked reads "Not assessed"
 *              with no score bar, an overdue one reads "Overdue", and the
 *              overall score says how many frameworks it covers.
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

  it('shows a framework with a missed deadline as "Overdue", with its score', () => {
    const nis2 = row('NIS2 Directive');

    expect(nis2.getByText('Overdue')).toBeInTheDocument();
    expect(nis2.getByText('1 open of 1')).toBeInTheDocument();
    expect(nis2.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '80');
  });

  it('says how many frameworks the overall score covers', () => {
    expect(screen.getByText('Across 2 of 3 frameworks · 1 not assessed')).toBeInTheDocument();
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
