/**
 * @file RobotCockpitPage.tsx
 * @description Robot Control Center — a single-screen "cockpit" that fuses what
 *   the robot sees (camera + LiDAR), how it feels (live telemetry vitals) and how
 *   you act on it (quick commands, natural-language control, emergency stop) into
 *   one futuristic-but-legible view. Bound to a robot via `/robots/:id/cockpit`,
 *   or to the first available robot via `/control-center`.
 * @feature robots
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, Bot, ChevronDown, Wifi, WifiOff } from 'lucide-react';
import { DemoFeaturePlaceholder } from '@/components/demo/DemoFeaturePlaceholder';
import { Spinner } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { useRobots } from '../hooks/useRobots';
import { useTelemetryStream } from '../hooks/useTelemetryStream';
import {
  CockpitViewport,
  CockpitPerceptionPanel,
  CockpitVitals,
  CockpitCommandDock,
} from '../components/cockpit';
import {
  ROBOT_STATUS_LABELS,
  isRobotAvailable,
  type Robot,
  type RobotType,
} from '../types/robots.types';

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

const STATUS_DOT: Record<string, string> = {
  online: 'bg-[#18E4C3]',
  busy: 'bg-[#2A5FFF]',
  charging: 'bg-amber-400',
  error: 'bg-red-500',
  protective_stop: 'bg-red-500',
  maintenance: 'bg-amber-400',
  offline: 'bg-theme-tertiary',
};

export function RobotCockpitPage() {
  if (import.meta.env.VITE_DEMO_MODE === 'true') {
    return (
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
    return fromPool.find((r) => isG1Family(resolveRobotType(r))) ?? fromPool[0];
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

  // ── Loading / empty ──
  if (isLoading && !robots.length) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!robot) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <Bot className="h-12 w-12 text-theme-tertiary/50" />
        <h1 className="text-xl font-semibold text-theme-primary">No robots to pilot</h1>
        <p className="max-w-sm text-sm text-theme-secondary">
          Register a robot first — the Control Center binds to a live robot to stream its camera, LiDAR and telemetry.
        </p>
      </div>
    );
  }

  // Telemetry live (data arriving) means we can drive it, regardless of the
  // list's lagging status field.
  const canExecute = isLive || isRobotAvailable(robot);
  const statusDot = STATUS_DOT[robot.status] ?? 'bg-theme-tertiary';

  return (
    <div className="flex min-h-[calc(100vh-7rem)] flex-col gap-3">
      {/* ── Header ── */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/fleet')}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-theme text-theme-secondary transition-colors hover:bg-theme-elevated hover:text-theme-primary"
            aria-label="Back to fleet"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-theme-primary">{robot.name}</h1>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-theme px-2 py-0.5 text-[11px] text-theme-secondary">
                <span className={cn('h-1.5 w-1.5 rounded-full', statusDot)} />
                {ROBOT_STATUS_LABELS[robot.status] ?? robot.status}
              </span>
            </div>
            <p className="font-mono text-xs text-theme-tertiary">{robot.model}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* telemetry link */}
          <span className={cn('flex items-center gap-1.5 font-mono text-[11px]', isLive ? 'text-[#18E4C3]' : 'text-theme-tertiary')}>
            {isLive ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            {isLive ? 'TELEMETRY LIVE' : 'TELEMETRY DOWN'}
          </span>

          {/* robot switcher */}
          <div className="relative">
            <select
              value={robot.id}
              onChange={(e) => navigate(`/robots/${e.target.value}/cockpit`)}
              className="appearance-none rounded-lg border border-theme bg-theme-primary py-2 pl-3 pr-9 text-sm text-theme-primary focus:border-[#2A5FFF]/60 focus:outline-none"
              aria-label="Select robot"
            >
              {robots.map((r) => (
                <option key={r.id} value={r.id}>{r.name} — {r.model}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-theme-tertiary" />
          </div>
        </div>
      </header>

      {/* ── Viewport + Perception ── */}
      <div className="grid flex-1 gap-3 lg:grid-cols-3">
        <CockpitViewport
          robotId={robotId}
          robotType={robotType}
          jointStates={telemetry?.jointStates}
          telemetryConnected={isLive}
          className="min-h-[320px] lg:col-span-2 lg:min-h-[440px]"
        />
        <CockpitPerceptionPanel
          robotId={robotId}
          robotType={robotType}
          jointStates={telemetry?.jointStates}
          supported={supportsPerception}
          enabled={supportsPerception && isLive}
          className="min-h-[320px] lg:min-h-[440px]"
        />
      </div>

      {/* ── Vitals ── */}
      <CockpitVitals telemetry={telemetry} connected={isLive} lastUpdate={lastUpdate} />

      {/* ── Command dock ── */}
      <CockpitCommandDock robotId={robotId} robotName={robot.name} canExecute={canExecute} />
    </div>
  );
}
