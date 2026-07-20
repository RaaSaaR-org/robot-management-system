/**
 * @file DashboardPage.tsx
 * @description Fleet overview dashboard page with animated hero header
 * @feature dashboard
 * @dependencies @/features/fleet, @/features/alerts/components, react-router-dom
 * @stateAccess useFleetStatus (read)
 */

import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { MessageSquare, RefreshCw, X } from 'lucide-react';
import { useFleetStatus, useZones, FleetStats, FleetMap } from '@/features/fleet';
import { FleetEmergencyStopButton } from '@/features/safety';
import { CommandBar } from '@/features/command/components/CommandBar';
import { Button } from '@/shared/components/ui/Button';
import { PageHeader } from '@/shared/components/ui/PageHeader';
import { Spinner } from '@/shared/components/ui/Spinner';
import { OrchestratorChatPage } from '@/features/a2a/pages/OrchestratorChatPage';

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Fleet overview dashboard page.
 * Displays animated hero header with key stats, fleet statistics,
 * interactive map, and critical alert banner.
 */
export function DashboardPage() {
  const navigate = useNavigate();
  const { status, robotMarkers, floors, isLoading, error, refresh } = useFleetStatus();
  const { zones } = useZones();

  // Floor selector state
  const [selectedFloor, setSelectedFloor] = useState(floors[0] || '1');

  // Orchestrator chat drawer — opened from header button or via
  // ?drawer=chat (the redirect from the legacy /orchestrator route).
  const [searchParams, setSearchParams] = useSearchParams();
  const [chatOpen, setChatOpen] = useState(searchParams.get('drawer') === 'chat');
  useEffect(() => {
    setChatOpen(searchParams.get('drawer') === 'chat');
  }, [searchParams]);
  const openChat = () => {
    const next = new URLSearchParams(searchParams);
    next.set('drawer', 'chat');
    setSearchParams(next, { replace: true });
  };
  const closeChat = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('drawer');
    setSearchParams(next, { replace: true });
  };

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
      <PageHeader
        title="Fleet Dashboard"
        subtitle="Real-time fleet monitoring and control"
        actions={
          <>
            {/* E-Stop always visible — safety-critical, must be accessible on all viewports */}
            <FleetEmergencyStopButton size="md" />
            {/* Chat/Refresh collapse to icon-only below sm so the action row
                fits a 390px viewport without clipping or horizontal scroll */}
            <Button
              size="sm"
              variant="outline"
              onClick={openChat}
              leftIcon={<MessageSquare className="w-4 h-4" />}
              aria-label="Open orchestrator chat"
            >
              <span className="hidden sm:inline">Chat</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={refresh}
              isLoading={isLoading}
              leftIcon={<RefreshCw className="w-4 h-4" />}
              aria-label="Refresh fleet status"
            >
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </>
        }
      />

      {/* Fleet Statistics with entrance animation */}
      <FleetStats status={status} isLoading={isLoading} />

      {/* Fleet Map */}
      <FleetMap
        robots={robotMarkers}
        zones={zones}
        selectedFloor={selectedFloor}
        onFloorChange={setSelectedFloor}
        onRobotClick={handleRobotClick}
      />

      {/* Command Bar (uses first available robot) */}
      {robotMarkers.length > 0 && (
        <CommandBar
          robotId={robotMarkers[0].robotId}
          robotName={robotMarkers[0].name}
        />
      )}

      {/* Quick Actions */}
      <div className="card-elevated p-6">
        <h2 className="text-lg font-semibold text-theme-primary mb-4">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/robots"
            className="inline-flex items-center px-4 py-2 bg-cobalt text-white rounded-brand hover:bg-cobalt-600 transition-colors"
          >
            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
            </svg>
            View All Robots
          </Link>
          <Link
            to="/processes"
            className="inline-flex items-center px-4 py-2 bg-theme-hover text-theme-primary rounded-brand hover:bg-theme-hover/80 transition-colors"
          >
            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            Manage Tasks
          </Link>
          <Link
            to="/pipeline"
            className="inline-flex items-center px-4 py-2 bg-turquoise-500/10 text-turquoise-600 dark:text-turquoise-400 rounded-brand hover:bg-turquoise-500/20 transition-colors border border-turquoise-500/20"
          >
            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Train a Skill
          </Link>
          {status.robotsNeedingAttention > 0 && (
            <button
              onClick={() => navigate('/robots?filter=attention')}
              className="inline-flex items-center px-4 py-2 bg-red-500/10 text-red-600 dark:text-red-400 rounded-brand hover:bg-red-500/20 transition-colors"
            >
              <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              {status.robotsNeedingAttention} {status.robotsNeedingAttention === 1 ? 'Robot Needs' : 'Robots Need'} Attention
            </button>
          )}
        </div>
      </div>

      {/* Orchestrator chat drawer (TASK-147 — folded from /orchestrator) */}
      {chatOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40"
            onClick={closeChat}
            aria-hidden="true"
          />
          <aside
            className="fixed top-0 right-0 z-50 h-full w-full sm:w-[480px] bg-theme-surface border-l border-theme shadow-2xl flex flex-col"
            role="dialog"
            aria-label="Orchestrator chat"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-theme">
              <h2 className="text-base font-semibold text-theme-primary">Orchestrator</h2>
              <button
                type="button"
                onClick={closeChat}
                className="p-1 rounded hover:bg-theme-secondary/20 text-theme-secondary"
                aria-label="Close chat"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <OrchestratorChatPage />
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
