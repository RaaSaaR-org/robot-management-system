/**
 * @file FleetPage.tsx
 * @description Fleet management page with map and zone configuration
 * @feature fleet
 * @dependencies @/features/fleet/components, @/features/fleet/hooks, @/features/robots/hooks
 */

import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/components/ui/Button';
import { FleetMap } from '../components/FleetMap';
import { ZoneConfigPanel } from '../components/ZoneConfigPanel';
import { ZoneFormModal } from '../components/ZoneFormModal';
import { useZones, useZoneEditor } from '../hooks';
import { useRobots } from '@/features/robots/hooks/useRobots';
import type { Zone, ZoneBounds, RobotMapMarker } from '../types/fleet.types';

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
  }));

  // Handle robot click - navigate to detail
  const handleRobotClick = useCallback(
    (robotId: string) => {
      navigate(`/robots/${robotId}`);
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
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-theme-primary">
                Fleet Management
              </h1>
              <p className="mt-1 text-sm text-theme-secondary">
                Monitor robots and manage facility zones
              </p>
            </div>
            <div className="flex items-center gap-2">
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
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex gap-6">
          {/* Map */}
          <div className={cn('flex-1', showZonePanel && 'max-w-[calc(100%-320px)]')}>
            <FleetMap
              robots={robotMarkers}
              zones={zones}
              selectedFloor={selectedFloor}
              onFloorChange={setSelectedFloor}
              onRobotClick={handleRobotClick}
              editorMode={editorMode}
              selectedZoneId={selectedZone?.id || null}
              onSelectZone={selectZone}
              onEditZone={handleEditZone}
              onZoneDrawn={handleZoneDrawn}
            />
          </div>

          {/* Zone Panel - manages its own state internally via hooks */}
          {showZonePanel && (
            <div className="w-80 shrink-0">
              <ZoneConfigPanel />
            </div>
          )}
        </div>

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
