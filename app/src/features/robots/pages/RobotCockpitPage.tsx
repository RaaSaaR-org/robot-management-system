/**
 * @file RobotCockpitPage.tsx
 * @description Control center: an operator console for one robot — view (model pose
 *   or camera), LiDAR, vitals, and a sticky command dock with the emergency stop.
 *   Bound via `/robots/:id/cockpit`, or auto-picks a robot on `/control-center`.
 * @feature robots
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Bot, WifiOff } from 'lucide-react';
import { DemoFeaturePlaceholder } from '@/components/demo/DemoFeaturePlaceholder';
import { EmptyState, LinkButton, PageHeader, Panel, Select, Skeleton } from '@/shared/components/ui';
import { usePermission } from '@/features/auth/hooks/useAuth';
import { useRobots } from '../hooks/useRobots';
import { useTelemetryStream } from '../hooks/useTelemetryStream';
import {
  CockpitViewport,
  CockpitPerceptionPanel,
  CockpitVitals,
  CockpitCommandDock,
} from '../components/cockpit';
import { ProvenanceTag, RobotStatusTag, provenanceOf } from '../components/common';
import { isRobotAvailable, type Robot } from '../types/robots.types';
import { isG1Family, pickCockpitRobot, resolveRobotType } from './cockpitPick';

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
  // Above the early returns: the cockpit's own equivalent of the detail panel's
  // command gate. A role without `robots:command` gets the console read-only.
  const canCommand = usePermission('robots:command');

  useEffect(() => {
    void fetchRobots();
  }, [fetchRobots]);

  // When auto-picking (no :id), robots whose telemetry never arrives get parked
  // here so the page advances to the next candidate — self-healing against a
  // stale/phantom default (e.g. an "online" robot whose agent is unreachable).
  const [skip, setSkip] = useState<Set<string>>(new Set());

  // The auto-pick currently on screen. Held across renders because `status`
  // changes under the operator, and re-ranking on every tick would rebind the
  // console to a robot they never selected — see `pickCockpitRobot`.
  const heldRef = useRef<string | null>(null);

  // Bind to the routed robot, else auto-pick one.
  const robot = useMemo<Robot | null>(() => {
    if (!robots.length) return null;
    if (id) return robots.find((r) => r.id === id) ?? null;
    return pickCockpitRobot(robots, skip, heldRef.current);
  }, [robots, id, skip]);

  // Record the pick after commit so the next status tick holds it rather than
  // re-ranking. Only the id-less route auto-picks; a routed robot is the choice.
  useEffect(() => {
    if (!id) heldRef.current = robot?.id ?? null;
  }, [id, robot]);

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
  const canExecute = canCommand && (isLive || isRobotAvailable(robot));
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
