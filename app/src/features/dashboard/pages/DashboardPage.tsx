/**
 * @file DashboardPage.tsx
 * @description The front door: fleet state first (online, busy, alerts,
 *   battery), then the map beside what needs attention, then a robot command
 *   panel. The fleet stop stays in the header in every state.
 * @feature dashboard
 * @dependencies @/features/fleet, @/features/safety, @/shared/components/ui
 * @stateAccess useFleetStatus (read)
 */

import { useCallback, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MessageSquare, RefreshCw } from 'lucide-react';
import { useFleetStatus, useZones, FleetStats, FleetMap } from '@/features/fleet';
import { FleetEmergencyStopButton } from '@/features/safety';
import {
  Button,
  ErrorState,
  LinkButton,
  PageHeader,
  Panel,
  SkeletonText,
  StatusTag,
} from '@/shared/components/ui';
import { NeedsAttentionPanel } from '../components/NeedsAttentionPanel';
import { CommandPanel } from '../components/CommandPanel';
import { OrchestratorDrawer } from '../components/OrchestratorDrawer';

/**
 * Fleet overview dashboard. `?drawer=chat` opens the orchestrator sheet (the
 * redirect target of the legacy /orchestrator route).
 */
export function DashboardPage() {
  const navigate = useNavigate();
  const { status, robotMarkers, floors, isLoading, error, refresh } = useFleetStatus();
  const { zones } = useZones();
  const [selectedFloor, setSelectedFloor] = useState(floors[0] || '1');

  const [searchParams, setSearchParams] = useSearchParams();
  const chatOpen = searchParams.get('drawer') === 'chat';
  const setDrawer = useCallback(
    (open: boolean) =>
      setSearchParams(
        (p) => {
          if (open) p.set('drawer', 'chat');
          else p.delete('drawer');
          return p;
        },
        { replace: true },
      ),
    [setSearchParams],
  );
  const closeChat = useCallback(() => setDrawer(false), [setDrawer]);

  const firstLoad = isLoading && robotMarkers.length === 0;

  const header = (
    <PageHeader
      eyebrow="Overview"
      title="Dashboard"
      description="Fleet state, the map and what needs you now."
      actions={
        <>
          <Button
            variant="secondary"
            onClick={() => setDrawer(true)}
            leftIcon={<MessageSquare className="h-4 w-4" />}
            aria-label="Ask orchestrator"
          >
            <span className="hidden sm:inline">Ask orchestrator</span>
          </Button>
          <Button
            variant="ghost"
            iconOnly
            onClick={() => void refresh()}
            isLoading={isLoading && !firstLoad}
            aria-label="Refresh fleet status"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          {/* Safety-critical: visible in every state, right-most, never a primary. */}
          <FleetEmergencyStopButton size="md" />
        </>
      }
    />
  );

  let body: React.ReactNode;
  if (error && robotMarkers.length === 0) {
    body = (
      <Panel>
        <ErrorState title="Couldn't load the fleet" message={error} onRetry={() => void refresh()} />
      </Panel>
    );
  } else if (firstLoad) {
    body = (
      <Panel>
        <SkeletonText lines={6} />
      </Panel>
    );
  } else {
    body = (
      <>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Panel className="xl:col-span-2">
            <Panel.Header
              title="Fleet map"
              actions={
                <div className="flex items-center gap-2">
                  <StatusTag tone="live" dot pulse>Live</StatusTag>
                  <LinkButton to="/fleet" variant="ghost" size="sm">
                    Open fleet
                  </LinkButton>
                </div>
              }
            />
            <FleetMap
              robots={robotMarkers}
              zones={zones}
              selectedFloor={selectedFloor}
              onFloorChange={setSelectedFloor}
              onRobotClick={(id) => navigate(`/robots/${id}`)}
              onRobotMapClick={(id) => navigate(`/agent?robot=${encodeURIComponent(id)}&tab=map`)}
            />
          </Panel>
          <NeedsAttentionPanel robots={robotMarkers} />
        </div>
        <CommandPanel robots={robotMarkers} />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {header}
      <FleetStats status={status} isLoading={firstLoad} />
      {body}
      <OrchestratorDrawer isOpen={chatOpen} onClose={closeChat} />
    </div>
  );
}
