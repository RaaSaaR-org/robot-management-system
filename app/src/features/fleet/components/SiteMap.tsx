/**
 * @file SiteMap.tsx
 * @description The fleet map is a site map (TASK-331): pick a digital twin, see
 *   it top-down with its zones and the robots bound to it, and E-stop a zone by
 *   clicking it. Only robots whose pose is in the twin frame (`siteAligned`) are
 *   plotted — a pose in any other frame would sit in the wrong room. Bound but
 *   unaligned robots and robots with no site are listed beside the map instead.
 *   Imports the twin feature by path: its barrel pulls in three.js.
 * @feature fleet
 * @dependencies @/features/digitaltwin, @/features/robots, @/features/safety
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Map as MapIcon } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import {
  EmptyState,
  LinkButton,
  Select,
  SkeletonText,
  StatusTag,
  confirm,
  toast,
  useCssColor,
} from '@/shared/components/ui';
import { TwinTopDown } from '@/features/digitaltwin/components/TwinTopDown';
import { ZoneLegend, ZONE_TYPE_LABELS } from '@/features/digitaltwin/components/ZoneLegend';
import { useTwinStore, selectTwins } from '@/features/digitaltwin/store/twinStore';
import { twinZoneApi } from '@/features/digitaltwin/api/twinZoneApi';
import type { DigitalTwinDTO, TwinZoneDTO } from '@/features/digitaltwin/types/twin.types';
import { useRobots } from '@/features/robots/hooks/useRobots';
import type { Robot } from '@/features/robots/types/robots.types';
import { useSafetyStore } from '@/features/safety/store/safetyStore';

/** Per-viewer memory of the last site shown (a convenience, never state). */
export const LAST_SITE_KEY = 'fleet.siteMap.lastTwinId';

function readLastSite(): string | null {
  try {
    return window.localStorage.getItem(LAST_SITE_KEY);
  } catch {
    return null;
  }
}

function writeLastSite(twinId: string): void {
  try {
    window.localStorage.setItem(LAST_SITE_KEY, twinId);
  } catch {
    // Private window / blocked storage: the picker just forgets.
  }
}

export interface SiteRobotGroups {
  /** Bound to the site and posed in its frame — drawn on the map */
  plotted: Robot[];
  /** Bound to the site, pose in some other frame — listed, fence not enforcing */
  unaligned: Robot[];
  /** Bound to no site at all */
  unbound: Robot[];
}

/** Split the fleet by what the site map may honestly do with each robot. */
export function groupSiteRobots(robots: Robot[], twinId: string | null): SiteRobotGroups {
  const groups: SiteRobotGroups = { plotted: [], unaligned: [], unbound: [] };
  for (const r of robots) {
    if (!r.twinId) groups.unbound.push(r);
    else if (r.twinId !== twinId) continue;
    else if (r.location?.siteAligned === true) groups.plotted.push(r);
    else groups.unaligned.push(r);
  }
  return groups;
}

export interface SiteMapProps {
  /** `compact` is the dashboard's: shorter map, no legend */
  size?: 'full' | 'compact';
  className?: string;
}

export function SiteMap({ size = 'full', className }: SiteMapProps) {
  const compact = size === 'compact';
  const twins = useTwinStore(selectTwins);
  const twinsLoading = useTwinStore((s) => s.isLoading);
  const fetchTwins = useTwinStore((s) => s.fetchTwins);
  const { robots, fetchRobots } = useRobots();
  const triggerZoneEStop = useSafetyStore((s) => s.triggerZoneEStop);

  const [pickedId, setPickedId] = useState<string | null>(readLastSite);
  const [zones, setZones] = useState<TwinZoneDTO[]>([]);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    void fetchTwins().finally(() => setFetched(true));
    void fetchRobots();
  }, [fetchTwins, fetchRobots]);

  // A remembered site that no longer exists falls back to the first one.
  const site: DigitalTwinDTO | null = twins.find((t) => t.id === pickedId) ?? twins[0] ?? null;
  const siteId = site?.id ?? null;

  useEffect(() => {
    if (!siteId) {
      setZones([]);
      return;
    }
    let cancelled = false;
    twinZoneApi
      .getZones(siteId)
      .then((z) => !cancelled && setZones(z))
      .catch(() => !cancelled && setZones([]));
    return () => {
      cancelled = true;
    };
  }, [siteId]);

  const pickSite = useCallback((id: string) => {
    setPickedId(id);
    writeLastSite(id);
  }, []);

  const groups = useMemo(() => groupSiteRobots(robots, siteId), [robots, siteId]);

  const stopZone = useCallback(
    async (zone: TwinZoneDTO) => {
      const ok = await confirm({
        title: `Stop every robot in ${zone.name}?`,
        description: 'Each robot inside this zone latches a protective stop and stays stopped until it is reset.',
        confirmLabel: 'Stop zone',
        tone: 'danger',
        testId: 'site-map-zone-stop',
      });
      if (!ok) return;
      if (await triggerZoneEStop(zone.id, `Zone emergency stop for ${zone.name} (site map)`)) {
        const result = useSafetyStore.getState().lastZoneEStop;
        const n = result?.successCount;
        toast.warning(`${zone.name} stopped`, {
          description:
            typeof n === 'number'
              ? `${n} robot${n === 1 ? '' : 's'} received the stop.`
              : `Every robot in ${zone.name} received the stop.`,
        });
      } else {
        toast.error(`Couldn't stop ${zone.name}`, {
          description:
            useSafetyStore.getState().lastActionError ?? 'The stop did not reach the server. Use the hardware stop.',
          duration: null,
        });
      }
    },
    [triggerZoneEStop],
  );

  if (!site) {
    if (twinsLoading || !fetched) {
      return <SkeletonText lines={compact ? 3 : 6} className={cn('p-4', className)} />;
    }
    return (
      <EmptyState
        className={className}
        size={compact ? 'sm' : 'md'}
        icon={<MapIcon />}
        title="No site to show yet"
        description="A site map needs a room a robot has scanned. Scan one, then pick it here."
        action={
          <LinkButton to="/fleet?tab=sites" variant="secondary" size="sm">
            Go to Sites
          </LinkButton>
        }
      />
    );
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select
          aria-label="Site"
          size="sm"
          fullWidth={false}
          className="w-56"
          value={site.id}
          onChange={(e) => pickSite(e.target.value)}
          options={twins.map((t) => ({ value: t.id, label: t.name }))}
        />
        {!compact && <ZoneLegend />}
      </div>
      <div className={cn('grid grid-cols-1 gap-4', !compact && 'lg:grid-cols-[1fr_16rem]')}>
        <div className={cn('overflow-hidden rounded-control border border-line', compact ? 'h-64' : 'h-[28rem]')}>
          <TwinTopDown
            twin={site}
            zones={zones}
            onZoneClick={(z) => void stopZone(z)}
            zoneLabel={(z) => `Stop zone ${z.name} (${ZONE_TYPE_LABELS[z.type] ?? z.type})`}
            aria-label={`Site map of ${site.name}`}
          >
            {(t) => (
              <g data-testid="site-map-robots">
                {groups.plotted.map((r) => (
                  <RobotDot key={r.id} robot={r} at={t.worldToScreen({ x: r.location.x, y: r.location.y })} />
                ))}
              </g>
            )}
          </TwinTopDown>
        </div>
        <SiteRobotList groups={groups} compact={compact} />
      </div>
    </div>
  );
}

/** A plotted robot: a dot, a heading tick (degrees, CCW from +x) and its name. */
function RobotDot({ robot, at }: { robot: Robot; at: { x: number; y: number } }) {
  const fill = useCssColor('--color-primary');
  const halo = useCssColor('--color-canvas', 'white');
  const heading = robot.location.heading;
  const rad = typeof heading === 'number' ? (heading * Math.PI) / 180 : null;
  return (
    <g data-testid={`site-map-robot-${robot.id}`} pointerEvents="none">
      <title>{robot.name}</title>
      {rad !== null && (
        // World +y is up, screen +y is down: flip the sine.
        <line
          x1={at.x}
          y1={at.y}
          x2={at.x + Math.cos(rad) * 16}
          y2={at.y - Math.sin(rad) * 16}
          stroke={fill}
          strokeWidth={3}
          strokeLinecap="round"
        />
      )}
      <circle cx={at.x} cy={at.y} r={7} fill={fill} stroke={halo} strokeWidth={2} />
      <text x={at.x + 10} y={at.y - 10} fontSize={12} fill={fill}>
        {robot.name}
      </text>
    </g>
  );
}

/** The robots the map cannot honestly draw, and why. */
function SiteRobotList({ groups, compact }: { groups: SiteRobotGroups; compact: boolean }) {
  const { plotted, unaligned, unbound } = groups;
  if (compact && unaligned.length === 0 && unbound.length === 0) return null;
  return (
    <div className="flex flex-col gap-4 text-[13px]" aria-label="Robots not on the map">
      {!compact && (
        <p className="text-ink-tertiary">
          {plotted.length} robot{plotted.length === 1 ? '' : 's'} on the map.
        </p>
      )}
      <RobotGroup
        title="Not aligned"
        robots={unaligned}
        note="not aligned — fence not enforcing"
        tone="warning"
        testId="site-map-unaligned"
      />
      <RobotGroup title="No site" robots={unbound} note="no site" tone="neutral" testId="site-map-unbound" />
    </div>
  );
}

function RobotGroup({
  title,
  robots,
  note,
  tone,
  testId,
}: {
  title: string;
  robots: Robot[];
  note: string;
  tone: 'warning' | 'neutral';
  testId: string;
}) {
  if (robots.length === 0) return null;
  return (
    <section data-testid={testId} className="flex flex-col gap-1.5">
      <h3 className="text-xs font-medium uppercase tracking-wide text-ink-tertiary">{title}</h3>
      <ul className="flex flex-col gap-1">
        {robots.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2">
            <Link to={`/robots/${r.id}`} className="truncate text-ink-primary hover:underline">
              {r.name}
            </Link>
            <StatusTag tone={tone} size="sm">
              {note}
            </StatusTag>
          </li>
        ))}
      </ul>
    </section>
  );
}
