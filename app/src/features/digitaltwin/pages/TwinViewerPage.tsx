/**
 * @file TwinViewerPage.tsx
 * @description A single site's digital twin. Two tabs:
 *   - Scan: run a server-driven sweep and watch the room fill in live (client
 *     preview cloud + walked path + live robot pose); on `twin:ready` the
 *     authoritative server-built cloud swaps in. Degrades to the live preview if
 *     the artifact isn't reachable.
 *   - Zones: author L2 polygon zones in a top-down editor, see them as extruded
 *     volumes in 3D, and export Nav2 keep-out + VDA5050 artifacts.
 * @feature digitaltwin
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FlaskConical } from 'lucide-react';
import { Button } from '@/shared/components/ui';
import { useRobots } from '@/features/robots/hooks/useRobots';
import type { RobotType } from '@/features/robots/types/robots.types';
import { useTwinStore, selectTwins } from '../store/twinStore';
import { useTwinZoneStore, selectTwinZones, selectTwinDraftPoints } from '../store/twinZoneStore';
import { useScanSession } from '../hooks/useScanSession';
import { useTwinEvents } from '../hooks/useTwinEvents';
import { TwinViewer } from '../components/TwinViewer';
import { ScanSessionPanel } from '../components/ScanSessionPanel';
import { ZoneAuthoringOverlay } from '../components/ZoneAuthoringOverlay';
import { ZoneLegend } from '../components/ZoneLegend';
import { TwinLifecycleStepper } from '../components/TwinLifecycleStepper';
import { TwinZoneFormModal } from '../components/TwinZoneFormModal';
import { ExportPanel } from '../components/ExportPanel';
import { twinApi } from '../api/twinApi';
import { simulationApi } from '@/features/simulation/api/simulationApi';
import { useOccupancyImage } from '../utils/occupancy';
import { twinGridSize } from '../types/twin.types';

function normalizeRobotType(raw?: string): RobotType {
  const t = (raw ?? 'g1').toLowerCase();
  if (t.startsWith('g1_edu') || t.startsWith('g1-edu')) return 'g1_edu';
  if (t.startsWith('g1')) return 'g1';
  if (t.startsWith('h1')) return 'h1';
  if (t.startsWith('so101')) return 'so101';
  return 'generic';
}

type Tab = 'scan' | 'zones';

export function TwinViewerPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const navigate = useNavigate();

  // Server twin (system of record).
  const twins = useTwinStore(selectTwins);
  const fetchTwins = useTwinStore((s) => s.fetchTwins);
  const upsertTwin = useTwinStore((s) => s.upsertTwin);
  const twin = useMemo(() => twins.find((t) => t.id === siteId), [twins, siteId]);

  useEffect(() => {
    if (siteId && !twin) {
      // Land directly on this page (deep link / refresh) — pull twins.
      void fetchTwins();
    }
  }, [siteId, twin, fetchTwins]);

  // "Simulate in this room": a built scene deep-links straight to Launch; a
  // ready twin without one gets a MuJoCo scene built on demand (from its real
  // occupancy floor-plan + zones) before navigating (TASK-171).
  const [generatingScene, setGeneratingScene] = useState(false);
  const handleSimulate = useCallback(async () => {
    if (!twin) return;
    if (!twin.hasSimScene) {
      setGeneratingScene(true);
      try {
        await simulationApi.generateTwinScene(twin.id);
      } catch (err) {
        console.error('[TwinViewer] Failed to generate sim scene', err);
        setGeneratingScene(false);
        return;
      }
    }
    navigate(`/training?tab=simulation&twinId=${twin.id}`);
  }, [twin, navigate]);

  const { robots, fetchRobots } = useRobots();
  useEffect(() => {
    if (robots.length === 0) void fetchRobots();
  }, [robots.length, fetchRobots]);
  const robot = useMemo(() => robots.find((r) => r.id === twin?.robotId), [robots, twin?.robotId]);
  const robotType = normalizeRobotType(
    (robot?.metadata?.robotType as string | undefined) ?? (robot as { robotType?: string } | undefined)?.robotType,
  );

  const robotId = twin?.robotId ?? '';
  const twinId = twin?.id ?? '';
  const session = useScanSession(robotId, twinId, Boolean(twin?.hasCloud && twin.status === 'ready'));
  const {
    status, framesCaptured, coveragePct, serverProgress, serverStage, cloud, isAuthoritative,
    path, currentPose, isConnected, start, stop,
  } = session;

  // ----- Tabs -----
  const [tab, setTab] = useState<Tab>('scan');

  // ----- Zones -----
  const zones = useTwinZoneStore(selectTwinZones);
  const fetchZones = useTwinZoneStore((s) => s.fetchZones);
  const resetZones = useTwinZoneStore((s) => s.reset);
  const zoneMode = useTwinZoneStore((s) => s.mode);
  const setZoneMode = useTwinZoneStore((s) => s.setMode);
  const selectedZoneId = useTwinZoneStore((s) => s.selectedZoneId);
  const selectZone = useTwinZoneStore((s) => s.selectZone);
  const deleteZone = useTwinZoneStore((s) => s.deleteZone);
  const handleZoneCreated = useTwinZoneStore((s) => s.handleZoneCreated);
  const handleZoneUpdated = useTwinZoneStore((s) => s.handleZoneUpdated);
  const handleZoneDeleted = useTwinZoneStore((s) => s.handleZoneDeleted);

  useEffect(() => {
    if (twinId) void fetchZones(twinId);
    return () => resetZones();
  }, [twinId, fetchZones, resetZones]);

  // Live zone + twin-build events for this twin.
  useTwinEvents({
    twinId,
    onTwinReady: (e) => upsertTwin(e.twin),
    onZoneCreated: (e) => handleZoneCreated(e.zone),
    onZoneUpdated: (e) => handleZoneUpdated(e.zone),
    onZoneDeleted: (e) => handleZoneDeleted(e.zoneId),
  });

  const handleStart = useCallback(() => {
    void start(robot?.location ? { x: robot.location.x, y: robot.location.y } : undefined);
  }, [start, robot?.location]);

  const handleStop = useCallback(() => {
    void stop();
  }, [stop]);

  // The authoritative point cloud is the richest room-scale backdrop, so it is
  // the default once a twin is built. The GLB `mesh` kind stays wired for the
  // Phase-5 Open3D surface reconstruction — the stub only emits a placeholder
  // box, which is a worse view than the 40k-point cloud. Opt in via `?mesh=1`.
  const preferMesh = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('mesh');
  const backdropKind = preferMesh && twin?.hasMesh ? 'mesh' : 'points';
  const meshUrl = twin?.hasMesh && twinId ? twinApi.meshUrl(twinId) : undefined;

  // Occupancy grid underlay for the zone editor + export context.
  const occupancy = useOccupancyImage(twinId, Boolean(twin?.hasOccupancy));
  const gridSize = occupancy
    ? { w: occupancy.width, h: occupancy.height }
    : twinGridSize(twin?.bounds, twin?.resolution);
  const keepoutCount = useMemo(() => zones.filter((z) => z.type === 'keepout').length, [zones]);

  if (!twin) {
    return (
      <div className="p-6">
        <p className="text-sm text-theme-tertiary">Loading twin…</p>
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => navigate('/sites')}>Back to sites</Button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <button onClick={() => navigate('/sites')} className="text-xs text-theme-tertiary hover:text-theme-secondary">
            ← Digital Twin
          </button>
          <h1 className="text-2xl font-bold text-theme-primary">{twin.name}</h1>
        </div>

        <div className="flex items-center gap-3">
          {/* Simulate in this room — a built scene deep-links straight to Launch;
              a ready twin without one builds a scene on demand first. */}
          {twin.hasSimScene || twin.status === 'ready' ? (
            <Button
              variant={twin.hasSimScene ? 'primary' : 'secondary'}
              size="sm"
              leftIcon={<FlaskConical className="w-4 h-4" />}
              disabled={generatingScene}
              onClick={handleSimulate}
              title={
                twin.hasSimScene
                  ? `Run a policy in this scanned room${twin.simSceneBackend ? ` (${twin.simSceneBackend})` : ''}`
                  : 'Build a MuJoCo scene from this scanned room, then simulate in it'
              }
            >
              {generatingScene ? 'Building scene…' : 'Simulate in this room'}
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<FlaskConical className="w-4 h-4" />}
              disabled
              title="Finish scanning this room first"
            >
              Simulate in this room
            </Button>
          )}

          {/* Tab switch */}
          <div className="flex gap-1 rounded-lg border border-surface-700 p-1 bg-surface-900/60">
          <button
            onClick={() => setTab('scan')}
            className={`px-3 py-1.5 text-xs font-medium rounded ${tab === 'scan' ? 'bg-[#FF6700] text-black' : 'text-theme-tertiary hover:text-theme-secondary'}`}
          >
            Scan
          </button>
          <button
            onClick={() => setTab('zones')}
            className={`px-3 py-1.5 text-xs font-medium rounded ${tab === 'zones' ? 'bg-[#FF6700] text-black' : 'text-theme-tertiary hover:text-theme-secondary'}`}
          >
            Zones
          </button>
          </div>
        </div>
      </div>

      {/* Lifecycle: Scan → Build → Zones → Export */}
      <TwinLifecycleStepper
        status={twin.status}
        zoneCount={zones.length}
        hasOccupancy={Boolean(twin.hasOccupancy)}
        onNavigate={setTab}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* Main viewport */}
        <div className="h-[60vh] min-h-[400px]">
          {tab === 'scan' ? (
            <TwinViewer
              cloud={cloud}
              backdropKind={backdropKind}
              meshUrl={meshUrl}
              bounds={twin.bounds}
              zones={zones}
              selectedZoneId={selectedZoneId}
              onSelectZone={selectZone}
              path={path}
              robotPose={currentPose}
              robotType={robotType}
            />
          ) : (
            <ZoneAuthoringOverlay twin={twin} cloud={cloud} occupancyImageUrl={occupancy?.url} />
          )}
        </div>

        {/* Side panel */}
        {tab === 'scan' ? (
          <ScanSessionPanel
            robotName={robot?.name ?? twin.robotId ?? '—'}
            status={status}
            framesCaptured={framesCaptured}
            coveragePct={coveragePct}
            pointCount={cloud?.pointCount ?? 0}
            isConnected={isConnected}
            serverProgress={serverProgress}
            serverStage={serverStage}
            isAuthoritative={isAuthoritative}
            onStart={handleStart}
            onStop={handleStop}
          />
        ) : (
          <div className="space-y-4">
            <ZonePanel
              zoneMode={zoneMode}
              onDraw={() => setZoneMode(zoneMode === 'draw' ? 'view' : 'draw')}
              zones={zones}
              selectedZoneId={selectedZoneId}
              onSelect={selectZone}
              onDelete={(id) => void deleteZone(id)}
            />
            <ExportPanel
              twinId={twin.id}
              baseName={twin.name}
              disabled={!twin.hasOccupancy}
              zoneCount={zones.length}
              keepoutCount={keepoutCount}
              gridSize={gridSize}
            />
          </div>
        )}
      </div>

      {/* Zone create/edit modal (driven by the zone store) */}
      <TwinZoneFormModal twinId={twin.id} />
    </div>
  );
}

interface ZonePanelProps {
  zoneMode: string;
  onDraw: () => void;
  zones: ReturnType<typeof selectTwinZones>;
  selectedZoneId: string | null;
  onSelect: (id: string | null) => void;
  onDelete: (id: string) => void;
}

function ZonePanel({ zoneMode, onDraw, zones, selectedZoneId, onSelect, onDelete }: ZonePanelProps) {
  const draftPoints = useTwinZoneStore(selectTwinDraftPoints);
  const popDraftPoint = useTwinZoneStore((s) => s.popDraftPoint);
  const closeDraft = useTwinZoneStore((s) => s.closeDraft);
  const cancelDraft = useTwinZoneStore((s) => s.cancelDraft);
  const drawing = zoneMode === 'draw';

  return (
    <div className="rounded-lg border border-surface-700 bg-surface-900/60 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-theme-primary">Zones</h3>
        <Button variant={drawing ? 'primary' : 'secondary'} size="sm" onClick={onDraw}>
          {drawing ? 'Drawing…' : 'New polygon'}
        </Button>
      </div>

      <ZoneLegend />

      {drawing ? (
        <div className="rounded-md border border-[#FF6700]/40 bg-[#FF6700]/5 p-2.5 space-y-2">
          <p className="text-xs text-theme-secondary">
            Click vertices in the editor. <span className="font-mono">{draftPoints.length}</span> placed —
            {draftPoints.length >= 3 ? ' ready to close.' : ' need at least 3.'}
          </p>
          <div className="flex gap-2">
            <Button variant="primary" size="sm" disabled={draftPoints.length < 3} onClick={() => closeDraft()}>Done</Button>
            <Button variant="ghost" size="sm" disabled={draftPoints.length === 0} onClick={() => popDraftPoint()}>Undo</Button>
            <Button variant="ghost" size="sm" onClick={() => cancelDraft()}>Cancel</Button>
          </div>
          <p className="text-[11px] text-theme-tertiary">Shortcuts: Enter close · Backspace undo · Esc cancel</p>
        </div>
      ) : (
        <p className="text-xs text-theme-tertiary">
          Press <span className="text-theme-secondary">New polygon</span>, then click vertices in the top-down editor.
        </p>
      )}

      {zones.length === 0 ? (
        <p className="text-xs text-theme-tertiary">No zones yet.</p>
      ) : (
        <ul className="space-y-1">
          {zones.map((z) => (
            <li
              key={z.id}
              className={`flex items-center justify-between gap-2 rounded px-2 py-1.5 text-xs cursor-pointer ${z.id === selectedZoneId ? 'bg-surface-700' : 'hover:bg-surface-800'}`}
              onClick={() => onSelect(z.id)}
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: z.color || '#FF6700' }} />
                <span className="truncate text-theme-secondary">{z.name}</span>
                <span className="text-theme-tertiary uppercase text-[10px]">{z.type}</span>
              </span>
              <button
                className="text-theme-tertiary hover:text-red-400"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(z.id);
                }}
                aria-label={`Delete ${z.name}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
