/**
 * @file FleetPage.tsx
 * @description Fleet: where every robot is (map) and the zones they work in,
 *   with zone create/draw/edit/delete; the Robots tab embeds the robot list and
 *   the Sites tab the gallery of rooms a robot has scanned in 3D.
 * @feature fleet
 * @dependencies @/shared/components/ui, @/features/fleet/components, @/features/fleet/hooks, @/features/robots, @/features/digitaltwin
 */

import { useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PenSquare, Plus, X } from 'lucide-react';
import { Button, PageHeader, Panel, Tabs } from '@/shared/components/ui';
import { FleetMap } from '../components/FleetMap';
import { ZoneConfigPanel } from '../components/ZoneConfigPanel';
import { ZoneFormModal } from '../components/ZoneFormModal';
import { useZones, useZoneEditor } from '../hooks';
import { useRobots } from '@/features/robots/hooks/useRobots';
import { RobotsPage } from '@/features/robots/pages/RobotsPage';
// By path, not through the feature barrel: that barrel re-exports the three.js
// twin viewer, which has no business in the fleet chunk.
import { SitesGallery } from '@/features/digitaltwin/components/SitesGallery';
import type { Zone, ZoneBounds, RobotMapMarker } from '../types/fleet.types';

const TABS = [
  { id: 'map', label: 'Map' },
  { id: 'list', label: 'Robots' },
  { id: 'sites', label: 'Sites' },
] as const;
type FleetTab = (typeof TABS)[number]['id'];

export interface FleetPageProps {
  /** Additional class names */
  className?: string;
}

/**
 * Fleet page. Tab state lives in ?tab= (default `map`), so the legacy
 * /robots → /fleet?tab=list and /sites → /fleet?tab=sites redirects land on the
 * Robots and Sites tabs.
 */
export function FleetPage({ className }: FleetPageProps) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: FleetTab = TABS.some((t) => t.id === raw) ? (raw as FleetTab) : 'map';
  const setTab = (id: string) =>
    setParams(
      (p) => {
        if (id === 'map') p.delete('tab');
        else p.set('tab', id);
        return p;
      },
      { replace: true },
    );

  const [selectedFloor, setSelectedFloor] = useState('1');
  const [formOpen, setFormOpen] = useState(false);
  // The Sites tab's "New scan" button lives in this header, so the flag lives
  // here too and the gallery renders the modal from it.
  const [scanOpen, setScanOpen] = useState(false);
  const [editingZone, setEditingZone] = useState<Zone | null>(null);
  const [drawnBounds, setDrawnBounds] = useState<ZoneBounds | null>(null);

  const { zones, selectedZone, selectZone, setCurrentFloor } = useZones();
  const { editorMode, setEditorMode } = useZoneEditor();
  const { robots, fetchRobots } = useRobots();
  const drawing = editorMode === 'draw';

  useEffect(() => {
    fetchRobots();
  }, [fetchRobots]);

  useEffect(() => {
    setCurrentFloor(selectedFloor);
  }, [selectedFloor, setCurrentFloor]);

  // Esc cancels drawing; leaving the map tab or the page does too.
  useEffect(() => {
    if (!drawing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEditorMode('view');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawing, setEditorMode]);
  useEffect(() => {
    if (tab !== 'map') setEditorMode('view');
  }, [tab, setEditorMode]);
  useEffect(() => () => setEditorMode('view'), [setEditorMode]);

  const robotMarkers: RobotMapMarker[] = useMemo(
    () =>
      robots.map((robot) => ({
        robotId: robot.id,
        name: robot.name,
        status: robot.status,
        batteryLevel: robot.batteryLevel,
        position: { x: robot.location.x, y: robot.location.y },
        floor: robot.location.floor || '1',
        currentTask: robot.currentTaskName,
        metadata: robot.metadata,
      })),
    [robots],
  );

  const openCreate = useCallback(() => {
    setEditorMode('view');
    setEditingZone(null);
    setDrawnBounds(null);
    setFormOpen(true);
  }, [setEditorMode]);

  const openEdit = useCallback((zone: Zone) => {
    setEditingZone(zone);
    setDrawnBounds(null);
    setFormOpen(true);
  }, []);

  const handleZoneDrawn = useCallback(
    (bounds: ZoneBounds) => {
      setEditorMode('view');
      setEditingZone(null);
      setDrawnBounds(bounds);
      setFormOpen(true);
    },
    [setEditorMode],
  );

  const closeForm = useCallback(() => {
    setFormOpen(false);
    setEditingZone(null);
    setDrawnBounds(null);
  }, []);

  // Every tab brings its own actions; the Robots tab has none in the header.
  let headerActions: ReactNode;
  if (tab === 'map') {
    headerActions = (
      <>
        <Button
          variant="secondary"
          leftIcon={drawing ? <X className="h-4 w-4" /> : <PenSquare className="h-4 w-4" />}
          onClick={() => setEditorMode(drawing ? 'view' : 'draw')}
          aria-pressed={drawing}
        >
          {drawing ? 'Cancel drawing' : 'Draw zone'}
        </Button>
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={openCreate}>
          New zone
        </Button>
      </>
    );
  } else if (tab === 'sites') {
    headerActions = (
      <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setScanOpen(true)}>
        New scan
      </Button>
    );
  }

  return (
    <div className={className ? `flex flex-col gap-6 ${className}` : 'flex flex-col gap-6'}>
      <PageHeader
        eyebrow="Operate"
        title="Fleet"
        description="Where every robot is, the zones they work in, and the rooms they have scanned."
        actions={headerActions}
      />

      <Tabs tabs={TABS.map(({ id, label }) => ({ id, label }))} activeTab={tab} onTabChange={setTab} />

      {tab === 'map' && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="flex flex-col gap-3 xl:col-span-2">
            {drawing && (
              <div
                role="status"
                className="flex items-center justify-between gap-3 rounded-control border border-primary/30 bg-primary/10 px-4 py-2 text-[13px] text-ink-primary"
              >
                <span>Drag on the map to draw the zone. Esc cancels.</span>
                <Button variant="ghost" size="sm" onClick={() => setEditorMode('view')}>
                  Cancel
                </Button>
              </div>
            )}
            <Panel padding="none">
              <FleetMap
                robots={robotMarkers}
                zones={zones}
                selectedFloor={selectedFloor}
                onFloorChange={setSelectedFloor}
                onRobotClick={(id) => navigate(`/robots/${id}`)}
                onRobotMapClick={(id) => navigate(`/agent?robot=${encodeURIComponent(id)}&tab=map`)}
                editorMode={editorMode}
                selectedZoneId={selectedZone?.id || null}
                onSelectZone={selectZone}
                onEditZone={openEdit}
                onZoneDrawn={handleZoneDrawn}
              />
            </Panel>
          </div>
          <ZoneConfigPanel onEditZone={openEdit} onCreateZone={openCreate} />
        </div>
      )}

      {tab === 'list' && <RobotsPage />}

      {tab === 'sites' && <SitesGallery newScanOpen={scanOpen} onNewScanOpenChange={setScanOpen} />}

      <ZoneFormModal
        isOpen={formOpen}
        zone={editingZone}
        defaultBounds={drawnBounds || undefined}
        currentFloor={selectedFloor}
        onClose={closeForm}
      />
    </div>
  );
}
