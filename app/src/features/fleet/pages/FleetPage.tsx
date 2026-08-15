/**
 * @file FleetPage.tsx
 * @description Fleet management page with map and zone configuration
 * @feature fleet
 * @dependencies @/features/fleet/components, @/features/fleet/hooks, @/features/robots/hooks
 */

import { useState, useCallback, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/components/ui/Button';
import { PageHeader } from '@/shared/components/ui/PageHeader';
import { Tabs } from '@/shared/components/ui/Tabs';
import { FleetMap } from '../components/FleetMap';
import { ZoneConfigPanel } from '../components/ZoneConfigPanel';
import { ZoneFormModal } from '../components/ZoneFormModal';
import { useZones, useZoneEditor } from '../hooks';
import { useRobots } from '@/features/robots/hooks/useRobots';
import { RobotsPage } from '@/features/robots/pages/RobotsPage';
import type { Zone, ZoneBounds, RobotMapMarker } from '../types/fleet.types';

type FleetTab = 'list' | 'map';

// ============================================================================
// TYPES
// ============================================================================

export interface FleetPageProps {
  /** Additional class names */
  className?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * FleetPage - Main page for fleet management with map and zone configuration.
 *
 * Features:
 * - Interactive fleet map with robot positions
 * - Zone management panel
 * - Zone creation/editing modals
 * - Real-time robot tracking
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <Routes>
 *       <Route path="/fleet" element={<FleetPage />} />
 *     </Routes>
 *   );
 * }
 * ```
 */
export function FleetPage({ className }: FleetPageProps) {
  const navigate = useNavigate();

  // Tab state synced via ?tab= so /robots → /fleet?tab=list redirect
  // lands on the right tab.
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab: FleetTab = searchParams.get('tab') === 'list' ? 'list' : 'map';
  const setActiveTab = (id: FleetTab) => {
    const next = new URLSearchParams(searchParams);
    if (id === 'map') next.delete('tab');
    else next.set('tab', id);
    setSearchParams(next, { replace: true });
  };

  const [selectedFloor, setSelectedFloor] = useState('1');
  const [showZonePanel, setShowZonePanel] = useState(false);
  const [showZoneModal, setShowZoneModal] = useState(false);
  const [editingZone, setEditingZone] = useState<Zone | null>(null);
  const [drawnBounds, setDrawnBounds] = useState<ZoneBounds | null>(null);

  // Hooks - useZones auto-fetches on mount
  const { zones, selectedZone, selectZone, refresh: refreshZones, setCurrentFloor } = useZones();
  const { editorMode, setEditorMode, editingZone: storeEditingZone, showFormModal } = useZoneEditor();
  const { robots, fetchRobots } = useRobots();

  // Fetch robots on mount
  useEffect(() => {
    fetchRobots();
  }, [fetchRobots]);

  // Sync floor with zone store
  useEffect(() => {
    setCurrentFloor(selectedFloor);
  }, [selectedFloor, setCurrentFloor]);

  // Sync modal state with store
  useEffect(() => {
    if (showFormModal && storeEditingZone) {
      setEditingZone(storeEditingZone);
      setShowZoneModal(true);
    }
  }, [showFormModal, storeEditingZone]);

  // Transform robots to map markers
  const robotMarkers: RobotMapMarker[] = robots.map((robot) => ({
    robotId: robot.id,
    name: robot.name,
    status: robot.status,
    batteryLevel: robot.batteryLevel,
    position: {
      x: robot.location.x,
      y: robot.location.y,
    },
    floor: robot.location.floor || '1',
    currentTask: robot.currentTaskName,
    metadata: robot.metadata,
  }));

  // Handle robot click - navigate to detail
  const handleRobotClick = useCallback(
    (robotId: string) => {
      navigate(`/robots/${robotId}`);
    },
    [navigate]
  );

  // "Open robot's map" — the map the ROBOT built, on the Agent Mode page.
  const handleRobotMapClick = useCallback(
    (robotId: string) => {
      navigate(`/agent?robot=${encodeURIComponent(robotId)}&tab=map`);
    },
    [navigate]
  );

  // Handle zone modal close
  const handleModalClose = useCallback(() => {
    setShowZoneModal(false);
    setEditingZone(null);
    setDrawnBounds(null);
  }, []);

  // Handle zone saved
  const handleZoneSaved = useCallback(() => {
    refreshZones();
    handleModalClose();
  }, [refreshZones, handleModalClose]);

  // Toggle draw mode
  const handleToggleDrawMode = useCallback(() => {
    setEditorMode(editorMode === 'draw' ? 'view' : 'draw');
  }, [editorMode, setEditorMode]);

  // Handle zone drawn from map editor
  const handleZoneDrawn = useCallback(
    (bounds: ZoneBounds) => {
      setDrawnBounds(bounds);
      setEditingZone(null);
      setShowZoneModal(true);
      setEditorMode('view'); // Exit draw mode after drawing
    },
    [setEditorMode]
  );

  // Handle zone edit from map
  const handleEditZone = useCallback((zone: Zone) => {
    setEditingZone(zone);
    setShowZoneModal(true);
  }, []);

  return (
    <div className={cn('min-h-screen', className)}>
      <div className="mx-auto max-w-7xl px-4 py-8">
        <PageHeader
          className="mb-8"
          title="Fleet Management"
          subtitle="Monitor robots and manage facility zones"
          actions={
            activeTab === 'map' && (
              <>
                <Button
                  variant={showZonePanel ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => setShowZonePanel(!showZonePanel)}
                >
                  {showZonePanel ? 'Hide Zones' : 'Manage Zones'}
                </Button>
                <Button
                  variant={editorMode === 'draw' ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={handleToggleDrawMode}
                >
                  {editorMode === 'draw' ? 'Exit Draw Mode' : 'Draw Zone'}
                </Button>
              </>
            )
          }
        />

        <Tabs
          activeTab={activeTab}
          onTabChange={(id) => setActiveTab(id as FleetTab)}
          tabs={[
            {
              id: 'map',
              label: 'Map',
              content: (
                <div className="flex gap-6">
                  <div className={cn('flex-1', showZonePanel && 'max-w-[calc(100%-320px)]')}>
                    <FleetMap
                      robots={robotMarkers}
                      zones={zones}
                      selectedFloor={selectedFloor}
                      onFloorChange={setSelectedFloor}
                      onRobotClick={handleRobotClick}
                      onRobotMapClick={handleRobotMapClick}
                      editorMode={editorMode}
                      selectedZoneId={selectedZone?.id || null}
                      onSelectZone={selectZone}
                      onEditZone={handleEditZone}
                      onZoneDrawn={handleZoneDrawn}
                    />
                  </div>
                  {showZonePanel && (
                    <div className="w-80 shrink-0">
                      <ZoneConfigPanel />
                    </div>
                  )}
                </div>
              ),
            },
            {
              id: 'list',
              label: 'List',
              content: <RobotsPage />,
            },
          ]}
        />

        {/* Zone Form Modal */}
        <ZoneFormModal
          isOpen={showZoneModal}
          zone={editingZone}
          defaultBounds={drawnBounds || undefined}
          currentFloor={selectedFloor}
          onClose={handleModalClose}
          onSuccess={handleZoneSaved}
        />
      </div>
    </div>
  );
}
