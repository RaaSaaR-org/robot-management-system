/**
 * @file ComplianceDashboard.tsx
 * @description Main compliance monitoring dashboard with overview stats
 * @feature compliance
 */

import { useEffect } from 'react';
import { cn } from '@/shared/utils/cn';
import { Card } from '@/shared/components/ui/Card';
import { Button } from '@/shared/components/ui/Button';
import { useComplianceTrackerStore } from '../store/complianceTrackerStore';
import {
  REGULATORY_FRAMEWORK_LABELS,
  COMPLIANCE_STATUS_CONFIG,
  type RegulatoryFramework,
  type ComplianceStatus,
} from '../types';

export interface ComplianceDashboardProps {
  className?: string;
}

/**
 * Circular progress gauge component
 */
function ComplianceGauge({ score, size = 160 }: { score: number; size?: number }) {
  const radius = (size - 16) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  const getScoreColor = (score: number): string => {
    if (score >= 80) return 'text-green-500';
    if (score >= 60) return 'text-yellow-500';
    if (score >= 40) return 'text-orange-500';
    return 'text-red-500';
  };

  const getStrokeColor = (score: number): string => {
    if (score >= 80) return 'stroke-green-500';
    if (score >= 60) return 'stroke-yellow-500';
    if (score >= 40) return 'stroke-orange-500';
    return 'stroke-red-500';
  };

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg className="transform -rotate-90" width={size} height={size}>
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          className="text-gray-700"
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          className={cn('transition-all duration-500', getStrokeColor(score))}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn('text-4xl font-bold', getScoreColor(score))}>{score}%</span>
        <span className="text-sm text-theme-tertiary">Overall Score</span>
      </div>
    </div>
  );
}

/**
 * Framework score bar component
 */
function FrameworkScoreBar({
  framework,
  score,
  status,
}: {
  framework: RegulatoryFramework;
  score: number;
  status: ComplianceStatus;
}) {
  const statusConfig = COMPLIANCE_STATUS_CONFIG[status];

  const getBarColor = (score: number): string => {
    if (score >= 80) return 'bg-green-500';
    if (score >= 60) return 'bg-yellow-500';
    if (score >= 40) return 'bg-orange-500';
    return 'bg-red-500';
  };

  return (
    <div className="flex items-center gap-3">
      <div className="w-28 flex-shrink-0">
        <span className="text-sm font-medium text-theme-secondary">
          {REGULATORY_FRAMEWORK_LABELS[framework]}
        </span>
      </div>
      <div className="flex-1 h-3 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', getBarColor(score))}
          style={{ width: `${score}%` }}
        />
      </div>
      <div className="w-12 text-right">
        <span className="text-sm font-medium text-theme-primary">{score}%</span>
      </div>
      <div
        className={cn(
          'px-2 py-0.5 rounded text-xs font-medium',
          statusConfig.bgColor,
          statusConfig.textColor
        )}
      >
        {statusConfig.label}
      </div>
    </div>
  );
}

/**
 * Alert count card component
 */
function AlertCard({
  title,
  count,
  icon,
  variant = 'default',
}: {
  title: string;
  count: number;
  icon: React.ReactNode;
  variant?: 'default' | 'warning' | 'danger' | 'success';
}) {
  const variantStyles = {
    default: 'bg-gray-800/50 border-gray-700/50',
    warning: 'bg-yellow-900/20 border-yellow-700/50',
    danger: 'bg-red-900/20 border-red-700/50',
    success: 'bg-green-900/20 border-green-700/50',
  };

  const countStyles = {
    default: 'text-theme-primary',
    warning: 'text-yellow-400',
    danger: 'text-red-400',
    success: 'text-green-400',
  };

  return (
    <Card className={cn('p-4 border', variantStyles[variant])}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-gray-800/50 flex items-center justify-center">
          {icon}
        </div>
        <div>
          <div className={cn('text-2xl font-bold', countStyles[variant])}>{count}</div>
          <div className="text-sm text-theme-tertiary">{title}</div>
        </div>
      </div>
    </Card>
  );
}

/**
 * Recent activity item component
 */
function ActivityItem({
  description,
  timestamp,
  activityType,
}: {
  description: string;
  timestamp: string;
  activityType: string;
}) {
  const formatTime = (iso: string) => {
    const date = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'deadline_update':
        return (
          <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        );
      case 'gap_created':
      case 'gap_closed':
        return (
          <svg className="w-4 h-4 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        );
      case 'training_completed':
      case 'training_expired':
        return (
          <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
        );
      case 'inspection_completed':
      case 'inspection_scheduled':
        return (
          <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case 'risk_assessment_updated':
        return (
          <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        );
      default:
        return (
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
    }
  };

  return (
    <div className="flex items-start gap-3 py-2">
      <div className="mt-0.5">{getTypeIcon(activityType)}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-theme-secondary truncate">{description}</p>
        <p className="text-xs text-theme-tertiary">{formatTime(timestamp)}</p>
      </div>
    </div>
  );
}

/**
 * Main Compliance Dashboard component
 */
export function ComplianceDashboard({ className }: ComplianceDashboardProps) {
  const {
    dashboardStats,
    recentActivity,
    isLoadingDashboard,
    isLoadingActivity,
    error,
    fetchDashboardStats,
    fetchRecentActivity,
    refreshAll,
    clearError,
  } = useComplianceTrackerStore();

  // Fetch data on mount
  useEffect(() => {
    fetchDashboardStats();
    fetchRecentActivity(10);
  }, [fetchDashboardStats, fetchRecentActivity]);

  if (isLoadingDashboard) {
    return (
      <div className={cn('space-y-6', className)}>
        {/* Loading skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="glass-card p-6 lg:col-span-1 animate-pulse">
            <div className="h-40 bg-gray-700 rounded-full mx-auto w-40" />
          </Card>
          <Card className="glass-card p-6 lg:col-span-2 animate-pulse">
            <div className="space-y-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-6 bg-gray-700 rounded" />
              ))}
            </div>
          </Card>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-gray-800 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Card className={cn('glass-card p-6', className)}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-red-900/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <p className="text-red-400 text-center">{error}</p>
          <Button variant="secondary" onClick={() => { clearError(); fetchDashboardStats(); }}>
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  if (!dashboardStats) {
    return (
      <Card className={cn('glass-card p-6 text-center', className)}>
        <p className="text-theme-tertiary">No compliance data available</p>
        <Button variant="primary" className="mt-4" onClick={fetchDashboardStats}>
          Load Dashboard
        </Button>
      </Card>
    );
  }

  return (
    <div className={cn('space-y-6', className)}>
      {/* Top Row: Score Gauge + Framework Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Overall Score Gauge */}
        <Card className="glass-card p-6 flex flex-col items-center justify-center">
          <h3 className="text-lg font-semibold text-theme-primary mb-4">Overall Compliance</h3>
          <ComplianceGauge score={dashboardStats.overallScore} />
          <Button
            variant="secondary"
            size="sm"
            className="mt-4"
            onClick={refreshAll}
          >
            Refresh Data
          </Button>
        </Card>

        {/* Framework Scores */}
        <Card className="glass-card p-6 lg:col-span-2">
          <h3 className="text-lg font-semibold text-theme-primary mb-4">Framework Compliance</h3>
          <div className="space-y-3">
            {dashboardStats.frameworkScores.map((fw) => (
              <FrameworkScoreBar
                key={fw.framework}
                framework={fw.framework}
                score={fw.score}
                status={fw.status}
              />
            ))}
          </div>
        </Card>
      </div>

      {/* Alert Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <AlertCard
          title="Upcoming Deadlines"
          count={dashboardStats.alerts.upcomingDeadlines}
          variant={dashboardStats.alerts.upcomingDeadlines > 0 ? 'warning' : 'default'}
          icon={
            <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          }
        />
        <AlertCard
          title="Expiring Documents"
          count={dashboardStats.alerts.expiringDocuments}
          variant={dashboardStats.alerts.expiringDocuments > 0 ? 'warning' : 'default'}
          icon={
            <svg className="w-5 h-5 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          }
        />
        <AlertCard
          title="Overdue Training"
          count={dashboardStats.alerts.overdueTraining}
          variant={dashboardStats.alerts.overdueTraining > 0 ? 'danger' : 'success'}
          icon={
            <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          }
        />
        <AlertCard
          title="Open Gaps"
          count={dashboardStats.alerts.criticalGaps}
          variant={dashboardStats.alerts.criticalGaps > 5 ? 'danger' : dashboardStats.alerts.criticalGaps > 0 ? 'warning' : 'success'}
          icon={
            <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          }
        />
      </div>

      {/* Recent Activity */}
      <Card className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-theme-primary">Recent Activity</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fetchRecentActivity(10)}
            disabled={isLoadingActivity}
          >
            {isLoadingActivity ? 'Loading...' : 'Refresh'}
          </Button>
        </div>
        {recentActivity.length > 0 ? (
          <div className="divide-y divide-gray-700/50">
            {recentActivity.map((activity) => (
              <ActivityItem
                key={activity.id}
                description={activity.description}
                timestamp={activity.timestamp}
                activityType={activity.type}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-theme-tertiary">No recent activity</p>
          </div>
        )}
      </Card>
    </div>
  );
}
