/**
 * @file DashboardPage.tsx
 * @description Fleet overview dashboard page
 * @feature dashboard
 * @dependencies @/features/fleet, @/features/alerts/components, react-router-dom
 * @stateAccess useFleetStatus (read)
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useFleetStatus, FleetStats, FleetMap } from '@/features/fleet';
import { AlertBanner } from '@/features/alerts/components';
import { Button } from '@/shared/components/ui/Button';
import { Spinner } from '@/shared/components/ui/Spinner';

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Fleet overview dashboard page.
 * Displays aggregated fleet statistics, interactive map,
 * and critical alert banner.
 */
export function DashboardPage() {
  const navigate = useNavigate();
  const { status, robotMarkers, floors, isLoading, error, refresh } = useFleetStatus();

  // Floor selector state
  const [selectedFloor, setSelectedFloor] = useState(floors[0] || '1');

  // Handle robot click on map
  const handleRobotClick = (robotId: string) => {
    navigate(`/robots/${robotId}`);
  };

  // Loading state
  if (isLoading && robotMarkers.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-red-500">{error}</p>
        <Button onClick={refresh}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-theme-primary">Fleet Dashboard</h1>
          <p className="text-theme-secondary mt-1">Real-time fleet monitoring and control</p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={isLoading}>
          {isLoading ? (
            <>
              <Spinner size="sm" className="mr-2" />
              Refreshing...
            </>
          ) : (
            <>
              <svg
                className="w-4 h-4 mr-2"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Refresh
            </>
          )}
        </Button>
      </header>

      {/* Critical Alert Banner */}
      <AlertBanner />

      {/* Fleet Statistics */}
      <FleetStats status={status} isLoading={isLoading} />

      {/* Fleet Map */}
      <FleetMap
        robots={robotMarkers}
        selectedFloor={selectedFloor}
        onFloorChange={setSelectedFloor}
        onRobotClick={handleRobotClick}
      />

      {/* Quick Actions */}
      <div className="card-elevated p-6">
        <h2 className="text-lg font-semibold text-theme-primary mb-4">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/robots"
            className="inline-flex items-center px-4 py-2 bg-cobalt text-white rounded-brand hover:bg-cobalt-600 transition-colors"
          >
            <svg
              className="w-4 h-4 mr-2"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
              />
            </svg>
            View All Robots
          </Link>
          <Link
            to="/tasks"
            className="inline-flex items-center px-4 py-2 bg-theme-hover text-theme-primary rounded-brand hover:bg-theme-hover/80 transition-colors"
          >
            <svg
              className="w-4 h-4 mr-2"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
              />
            </svg>
            Manage Tasks
          </Link>
          {status.robotsNeedingAttention > 0 && (
            <button
              onClick={() => navigate('/robots?filter=attention')}
              className="inline-flex items-center px-4 py-2 bg-red-500/10 text-red-600 dark:text-red-400 rounded-brand hover:bg-red-500/20 transition-colors"
            >
              <svg
                className="w-4 h-4 mr-2"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              {status.robotsNeedingAttention} Robots Need Attention
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
