/**
 * @file TwinViewerPage.tsx
 * @description A single site's digital twin, framed like every detail page:
 *   PageHeader (status, Simulate in this room, Delete site) and two tabs in
 *   `?tab=`:
 *   - Scan (default): run a server-driven sweep and watch the room fill in live
 *     (client preview cloud + walked path + live robot pose); on `twin:ready`
 *     the authoritative server-built cloud swaps in. Import a recorded scan.
 *   - Zones: author L2 polygon zones in a top-down editor, see them as extruded
 *     volumes in 3D, and export Nav2 keep-out + VDA5050 artifacts.
 * @feature digitaltwin
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FlaskConical, Trash2 } from 'lucide-react';
import {
  Button,
  ErrorState,
  PageHeader,
  Panel,
  RowActions,
  Skeleton,
  StatusTag,
  Tabs,
  Tooltip,
  confirm,
  toast,
} from '@/shared/components/ui';
import { useRobots } from '@/features/robots/hooks/useRobots';
import type { RobotType } from '@/features/robots/types/robots.types';
import { simulationApi } from '@/features/simulation/api/simulationApi';
import { UI_DATE_LOCALE } from '@/shared/utils/format';
import { useTwinStore, selectTwins } from '../store/twinStore';
import { useTwinZoneStore, selectTwinZones } from '../store/twinZoneStore';
import { useScanSession } from '../hooks/useScanSession';
import { useTwinEvents } from '../hooks/useTwinEvents';
import { TwinViewer } from '../components/TwinViewer';
import { ScanSessionPanel } from '../components/ScanSessionPanel';
import { ZoneAuthoringOverlay } from '../components/ZoneAuthoringOverlay';
import { ZonePanel } from '../components/ZonePanel';
import { TwinZoneFormModal } from '../components/TwinZoneFormModal';
import { ExportPanel } from '../components/ExportPanel';
import { TWIN_STATUS_TAG } from '../components/SiteCard';
import { twinApi } from '../api/twinApi';
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

function errorMessage(err: unknown, fallback: string): string {
  return (
    (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
    (err instanceof Error ? err.message : fallback)
  );
}

const TAB_IDS = ['scan', 'zones'] as const;
type Tab = (typeof TAB_IDS)[number];
const VIEWPORT = 'h-[50vh] min-h-[300px] sm:h-[60vh] sm:min-h-[360px]';
const BACK = { to: '/sites', label: 'Digital Twin' };

export function TwinViewerPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'zones' ? 'zones' : 'scan';
  const setTab = (id: string) =>
    setParams((p) => {
      if (id === 'scan') p.delete('tab');
      else p.set('tab', id);
      return p;
    }, { replace: true });

  // Server twin (system of record).
  const twins = useTwinStore(selectTwins);
  const fetchTwins = useTwinStore((s) => s.fetchTwins);
  const upsertTwin = useTwinStore((s) => s.upsertTwin);
  const removeTwin = useTwinStore((s) => s.removeTwin);
  const twinsError = useTwinStore((s) => s.error);
  const twin = useMemo(() => twins.find((t) => t.id === siteId), [twins, siteId]);
  const [checked, setChecked] = useState(false);

  const loadTwins = useCallback(() => {
    setChecked(false);
    void fetchTwins().finally(() => setChecked(true));
  }, [fetchTwins]);

  useEffect(() => {
    // Land directly on this page (deep link / refresh) — pull twins.
    if (siteId && !twin) loadTwins();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

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
        toast.error("Couldn't build the simulation scene", { description: errorMessage(err, 'Scene generation failed') });
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

  // ----- Zones -----
  const zones = useTwinZoneStore(selectTwinZones);
  const fetchZones = useTwinZoneStore((s) => s.fetchZones);
  const resetZones = useTwinZoneStore((s) => s.reset);
  const selectedZoneId = useTwinZoneStore((s) => s.selectedZoneId);
  const selectZone = useTwinZoneStore((s) => s.selectZone);
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

  // Import a recorded .ply/.pcd capture as a one-frame sweep. The server flips
  // the twin to 'processing'; session:progress / twin:ready events then drive
  // the same build UI as a live sweep.
  const [importing, setImporting] = useState(false);
  const handleImport = useCallback(
    async (file: File) => {
      if (!twin) return;
      setImporting(true);
      try {
        // Attribute the scan to the twin's robot, else any registered robot.
        const attributedRobot = twin.robotId ?? robots[0]?.id;
        await twinApi.importScan(twin.id, file, attributedRobot);
        await fetchTwins();
        toast.success('Scan imported', { description: `${file.name} — the twin is building.` });
      } catch (err) {
        toast.error("Couldn't import scan", { description: errorMessage(err, 'Import failed') });
      } finally {
        setImporting(false);
      }
    },
    [twin, robots, fetchTwins],
  );

  const askDeleteSite = useCallback(async () => {
    if (!twin) return;
    const ok = await confirm({
      title: `Delete ${twin.name}?`,
      description: 'The scan, its zones and exports are removed. This cannot be undone.',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await removeTwin(twin.id);
      toast.success('Site deleted', { description: twin.name });
      navigate('/sites');
    } catch (err) {
      toast.error("Couldn't delete site", { description: errorMessage(err, 'Delete failed') });
    }
  }, [twin, removeTwin, navigate]);

  // The authoritative point cloud is the richest room-scale backdrop, so it is
  // the default once a twin is built. The GLB `mesh` kind stays wired for the
  // Phase-5 Open3D surface reconstruction — the stub only emits a placeholder
  // box, which is a worse view than the 40k-point cloud. Opt in via `?mesh=1`.
  const preferMesh = params.has('mesh');
  const backdropKind = preferMesh && twin?.hasMesh ? 'mesh' : 'points';
  const meshUrl = twin?.hasMesh && twinId ? twinApi.meshUrl(twinId) : undefined;

  // Occupancy grid underlay for the zone editor + export context.
  const occupancy = useOccupancyImage(twinId, Boolean(twin?.hasOccupancy));
  const gridSize = occupancy ? { w: occupancy.width, h: occupancy.height } : twinGridSize(twin?.bounds, twin?.resolution);
  const keepoutCount = useMemo(() => zones.filter((z) => z.type === 'keepout').length, [zones]);

  if (!twin) {
    const notFound = checked && Boolean(siteId);
    return (
      <div className="flex flex-col gap-6">
        <PageHeader eyebrow="Operate" back={BACK} title={notFound ? 'Site not found' : 'Loading…'} />
        {notFound ? (
          <Panel>
            <ErrorState
              title="Couldn't find this site"
              message={twinsError ?? 'It may have been deleted. Go back to the gallery or try again.'}
              onRetry={loadTwins}
            />
          </Panel>
        ) : (
          <Panel padding="none">
            <Skeleton className={VIEWPORT + ' w-full rounded-none'} />
          </Panel>
        )}
      </div>
    );
  }

  const statusTag = TWIN_STATUS_TAG[twin.status] ?? TWIN_STATUS_TAG.draft;
  const canSimulate = twin.hasSimScene || twin.status === 'ready';
  const simulateButton = (
    <Button
      variant="secondary"
      leftIcon={<FlaskConical className="h-4 w-4" strokeWidth={1.75} />}
      disabled={!canSimulate}
      isLoading={generatingScene}
      loadingText="Building scene…"
      onClick={() => void handleSimulate()}
    >
      Simulate in this room
    </Button>
  );

  return (
    <div className="flex flex-col gap-6 min-w-0">
      <PageHeader
        eyebrow="Operate"
        back={BACK}
        title={twin.name}
        meta={
          <>
            <StatusTag tone={statusTag.tone} dot pulse={twin.status === 'recording'}>{statusTag.label}</StatusTag>
            {twin.pointCount ? (
              <span className="text-[13px] tabular-nums text-ink-tertiary">{twin.pointCount.toLocaleString(UI_DATE_LOCALE)} points</span>
            ) : null}
          </>
        }
        actions={
          <>
            {canSimulate ? (
              simulateButton
            ) : (
              <Tooltip content="Finish scanning this room first">
                <span tabIndex={0} className="inline-flex rounded-control">{simulateButton}</span>
              </Tooltip>
            )}
            <RowActions
              label="More actions"
              items={[{ label: 'Delete site', icon: <Trash2 />, tone: 'danger', onSelect: () => void askDeleteSite() }]}
            />
          </>
        }
      />

      <Tabs
        tabs={[
          { id: 'scan', label: 'Scan' },
          { id: 'zones', label: 'Zones', count: zones.length },
        ]}
        activeTab={tab}
        onTabChange={setTab}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px] min-w-0">
        <Panel padding="none" className={VIEWPORT}>
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
        </Panel>

        <div className="flex flex-col gap-6 min-w-0">
          {tab === 'scan' ? (
            <ScanSessionPanel
              robotName={robot?.name ?? twin.robotId ?? 'No robot'}
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
              onImport={(file) => void handleImport(file)}
              importing={importing}
            />
          ) : (
            <>
              <ZonePanel />
              <ExportPanel
                twinId={twin.id}
                baseName={twin.name}
                disabled={!twin.hasOccupancy}
                zoneCount={zones.length}
                keepoutCount={keepoutCount}
                gridSize={gridSize}
              />
            </>
          )}
        </div>
      </div>

      {/* Zone create/edit modal (driven by the zone store) */}
      <TwinZoneFormModal twinId={twin.id} />
    </div>
  );
}
