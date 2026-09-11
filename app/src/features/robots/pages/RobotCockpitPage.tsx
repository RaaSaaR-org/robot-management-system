/**
 * @file RobotCockpitPage.tsx
 * @description Control center: an operator console for one robot — view (model pose
 *   or camera), LiDAR, vitals, and a sticky command dock with the emergency stop.
 *   Bound via `/robots/:id/cockpit`, or auto-picks a robot on `/control-center`.
 * @feature robots
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Bot, WifiOff } from 'lucide-react';
import { DemoFeaturePlaceholder } from '@/components/demo/DemoFeaturePlaceholder';
import { EmptyState, LinkButton, PageHeader, Panel, Select, Skeleton } from '@/shared/components/ui';
import { useRobots } from '../hooks/useRobots';
import { useTelemetryStream } from '../hooks/useTelemetryStream';
import {
  CockpitViewport,
  CockpitPerceptionPanel,
  CockpitVitals,
  CockpitCommandDock,
} from '../components/cockpit';
import { ProvenanceTag, RobotStatusTag, provenanceOf } from '../components/common';
import { isRobotAvailable, type Robot, type RobotType } from '../types/robots.types';

/** Map a robot's model/metadata to a viewer embodiment. */
function resolveRobotType(robot: Robot | null): RobotType {
  const hint = `${robot?.model ?? ''} ${(robot?.metadata?.robotType as string) ?? ''}`.toLowerCase();
  // G1 EDU (Dex3-1 three-finger hands) before the plain-G1 substring match
  if (hint.includes('g1_edu') || hint.includes('g1-edu') || hint.includes('g1 edu') || hint.includes('dex3')) {
    return 'g1_edu';
  }
  if (hint.includes('g1')) return 'g1';
  if (hint.includes('h1')) return 'h1';
  if (hint.includes('so-101') || hint.includes('so101')) return 'so101';
  return 'generic';
}

/** True for the Unitree G1 family (plain G1 and G1 EDU). */
function isG1Family(type: RobotType): boolean {
  return type === 'g1' || type === 'g1_edu';
}

const DESCRIPTION = 'Live view and controls for one robot.';
const VIEWER_HEIGHT = 'h-[280px] sm:h-[320px] lg:h-[440px]';

export function RobotCockpitPage() {
  if (import.meta.env.VITE_DEMO_MODE === 'true') {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Operate" title="Control center" description={DESCRIPTION} />
        <DemoFeaturePlaceholder
        featureName="Robot Control Center"
        icon={<Bot className="h-12 w-12" />}
        description="A single-screen cockpit to see what a robot sees and control it: live camera and LiDAR perception, real-time vitals, quick commands, natural-language control and an emergency stop."
        capabilities={[
          'Live camera feed with a heads-up display',
          'Streaming LiDAR / depth point cloud for the Unitree G1',
          'Real-time battery, compute, thermal and joint telemetry',
          'Quick commands, natural-language control and emergency stop',
        ]}
        docsSlug="architecture"
        />
      </div>
    );
  }

  return <RobotCockpitPageInner />;
}

function RobotCockpitPageInner() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { robots, isLoading, fetchRobots } = useRobots();

  useEffect(() => {
    void fetchRobots();
  }, [fetchRobots]);

  // When auto-picking (no :id), robots whose telemetry never arrives get parked
  // here so the page advances to the next candidate — self-healing against a
  // stale/phantom default (e.g. an "online" robot whose agent is unreachable).
  const [skip, setSkip] = useState<Set<string>>(new Set());

  // Bind to the routed robot, else auto-pick the most recently active robot —
  // preferring a G1. `lastSeen` is the live signal (a connected agent heartbeats
  // continuously), which list-level `status` lags behind, so recency lands us on
  // the robot that's actually streaming rather than a stale phantom.
  const robot = useMemo<Robot | null>(() => {
    if (!robots.length) return null;
    if (id) return robots.find((r) => r.id === id) ?? null;
    const byRecency = [...robots].sort((a, b) => (b.lastSeen ?? '').localeCompare(a.lastSeen ?? ''));
    const pool = byRecency.filter((r) => !skip.has(r.id));
    const fromPool = pool.length ? pool : byRecency;
    // Reachability outranks embodiment: a G1 that is offline still loses to a
    // robot that is actually streaming, so the preference never parks the page
    // on a dead default and makes the operator wait out the self-heal timer.
    const reachable = fromPool.filter(isRobotAvailable);
    const ranked = reachable.length ? reachable : fromPool;
    return ranked.find((r) => isG1Family(resolveRobotType(r))) ?? ranked[0];
  }, [robots, id, skip]);

  const robotId = robot?.id ?? '';
  const robotType = resolveRobotType(robot);
  const supportsPerception = isG1Family(robotType) || robotType === 'h1';

  const { telemetry, lastUpdate } = useTelemetryStream(robotId, {
    autoConnect: !!robotId,
  });

  // The dev poller reports "connected" as soon as it starts, even against an
  // unreachable robot — so treat *received telemetry* as the real liveness
  // signal. This also gates the LiDAR stream so an offline robot doesn't flood
  // the console with point-cloud 404s.
  const isLive = telemetry !== null;

  // Self-heal the auto-pick: if a non-routed default hasn't streamed telemetry
  // within a grace window, park it and let the memo advance to the next robot.
  useEffect(() => {
    if (id || !robotId || isLive || skip.has(robotId)) return;
    const t = window.setTimeout(() => {
      setSkip((prev) => (prev.has(robotId) ? prev : new Set(prev).add(robotId)));
    }, 4000);
    return () => window.clearTimeout(t);
  }, [id, robotId, isLive, skip]);

  const back = id ? { to: `/robots/${id}`, label: 'Robot' } : { to: '/fleet?tab=list', label: 'Fleet' };

  // ── Loading / empty ──
  if (isLoading && !robots.length) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader eyebrow="Operate" back={back} title="Control center" description={DESCRIPTION} />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Panel className="lg:col-span-2"><Skeleton className={VIEWER_HEIGHT + ' w-full'} /></Panel>
          <Panel><Skeleton className={VIEWER_HEIGHT + ' w-full'} /></Panel>
        </div>
      </div>
    );
  }

  if (!robot) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader eyebrow="Operate" back={back} title="Control center" description={DESCRIPTION} />
        <Panel>
          <EmptyState
            icon={<Bot />}
            title={id ? 'Robot not found' : 'No robots to control'}
            description={
              id
                ? `No robot with the ID ${id} is registered. Pick one from the fleet.`
                : 'Register a robot first. The control center binds to a live robot to stream its camera, LiDAR and telemetry.'
            }
            action={<LinkButton to="/fleet?tab=list">Go to fleet</LinkButton>}
          />
        </Panel>
      </div>
    );
  }

  // Telemetry live (data arriving) means we can drive it, regardless of the
  // list's lagging status field.
  const canExecute = isLive || isRobotAvailable(robot);
  const provenance = provenanceOf(telemetry);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Operate"
        back={back}
        title={robot.name}
        description={DESCRIPTION}
        meta={
          <>
            <RobotStatusTag status={robot.status} />
            <ProvenanceTag source={provenance} />
          </>
        }
        actions={
          <Select
            aria-label="Robot"
            fullWidth={false}
            className="w-full sm:w-64"
            value={robot.id}
            options={robots.map((r) => ({ value: r.id, label: r.name }))}
            onChange={(e) => navigate(`/robots/${e.target.value}/cockpit`)}
          />
        }
      />

      {!isLive && (
        <Panel variant="inset" padding="sm" className="flex items-center gap-3 text-sm text-ink-secondary">
          <WifiOff className="h-4 w-4 shrink-0 text-ink-tertiary" strokeWidth={1.75} />
          <span>
            {robot.status === 'offline'
              ? `${robot.name} is offline. Start its robot agent to see live telemetry and send commands.`
              : `No telemetry from ${robot.name} yet. Values appear as soon as its agent streams.`}
          </span>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <CockpitViewport
          key={robotId}
          robotId={robotId}
          robotType={robotType}
          jointStates={telemetry?.jointStates}
          telemetryConnected={isLive}
          className="lg:col-span-2"
          bodyClassName={VIEWER_HEIGHT}
        />
        <CockpitPerceptionPanel
          robotId={robotId}
          robotType={robotType}
          jointStates={telemetry?.jointStates}
          supported={supportsPerception}
          enabled={supportsPerception && isLive}
          provenance={provenance}
          bodyClassName={VIEWER_HEIGHT}
        />
      </div>

      <CockpitVitals telemetry={telemetry} connected={isLive} lastUpdate={lastUpdate} />

      <CockpitCommandDock robotId={robotId} robotName={robot.name} canExecute={canExecute} />
    </div>
  );
}
