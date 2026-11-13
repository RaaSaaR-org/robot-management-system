/**
 * @file SiteMap.tsx
 * @description The fleet map is a site map (TASK-331): pick a digital twin, see
 *   it top-down with its zones and the robots bound to it, and E-stop a zone by
 *   clicking it. Every role may stop a zone, a viewer included: the server
 *   grants the zone stop as a halt (`SAFETY_HALT_WRITES`, TASK-374).
 *   Only robots whose pose is in the twin frame (`siteAligned`) are
 *   plotted — a pose in any other frame would sit in the wrong room. Bound but
 *   unaligned robots and robots with no site are listed beside the map instead.
 *   An expected robot (no agent yet) has no pose at all: one whose
 *   `metadata.plannedPlace` names a zone of the site is drawn in that zone as
 *   a dashed outline marked "planned" and listed as not connected, so it is
 *   never read as a live position (TASK-493).
 *   Imports the twin feature by path: its barrel pulls in three.js.
 * @feature fleet
 * @dependencies @/features/digitaltwin, @/features/robots, @/features/safety
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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
import {
  ROBOT_PROVISIONING_LABELS,
  robotProvisioning,
  type Robot,
} from '@/features/robots/types/robots.types';
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

/** An expected robot and the zone of the site it is planned to stand in. */
export interface PlannedRobot {
  robot: Robot;
  zone: TwinZoneDTO;
}

export interface SiteRobotGroups {
  /** Bound to the site and posed in its frame — drawn on the map */
  plotted: Robot[];
  /** Expected, bound to the site, planned into one of its zones — drawn there as planned, never as live */
  planned: PlannedRobot[];
  /** Expected, bound to the site, no planned place — listed as not connected */
  expected: Robot[];
  /** Bound to the site, pose in some other frame — listed, fence not enforcing */
  unaligned: Robot[];
  /** Bound to no site at all */
  unbound: Robot[];
}

/** Split the fleet by what the site map may honestly do with each robot. */
export function groupSiteRobots(
  robots: Robot[],
  twinId: string | null,
  zones: TwinZoneDTO[] = [],
): SiteRobotGroups {
  const groups: SiteRobotGroups = { plotted: [], planned: [], expected: [], unaligned: [], unbound: [] };
  for (const r of robots) {
    if (!r.twinId) groups.unbound.push(r);
    else if (r.twinId !== twinId) continue;
    else if (r.location?.siteAligned === true) groups.plotted.push(r);
    else if (robotProvisioning(r)) {
      // No agent, so no pose: "not aligned" would blame a frame that does not exist yet.
      const place = r.metadata?.plannedPlace;
      const zone =
        typeof place === 'string' ? zones.find((z) => z.name === place && z.type !== 'keepout' && z.points.length > 0) : undefined;
      if (zone) groups.planned.push({ robot: r, zone });
      else groups.expected.push(r);
    } else groups.unaligned.push(r);
  }
  return groups;
}

/** Rows of planned markers in one zone are this far apart, in viewBox px. */
const PLANNED_ROW_GAP = 18;

/**
 * Where to write each planned robot's label, in viewBox px: over its zone's
 * name (drawn at the centroid), one row per robot of that zone going up, so
 * two robots planned into the same zone do not sit on top of each other or on
 * the name. `at` is the label's centre; the marker sits at its left end.
 */
export function plannedMarkerPositions(
  planned: PlannedRobot[],
  worldToScreen: (p: { x: number; y: number }) => { x: number; y: number },
): Array<PlannedRobot & { at: { x: number; y: number } }> {
  const rowOf = new Map<string, number>();
  return planned.map((entry) => {
    const { points } = entry.zone;
    const centroid = worldToScreen({
      x: points.reduce((a, p) => a + p.x, 0) / points.length,
      y: points.reduce((a, p) => a + p.y, 0) / points.length,
    });
    const row = rowOf.get(entry.zone.id) ?? 0;
    rowOf.set(entry.zone.id, row + 1);
    return { ...entry, at: { x: centroid.x, y: centroid.y - 16 - row * PLANNED_ROW_GAP } };
  });
}

/**
 * Where to draw a plotted robot: its pose in the SITE frame (TASK-342). A robot
 * aligned by a frame registration reports raw odometry in `x`/`y`/`heading`,
 * which is not the twin frame; only a robot that predates `sitePose` (a sim
 * whose world is the twin) falls back to them.
 */
export function sitePoseOf(robot: Robot): { x: number; y: number; heading?: number } {
  return robot.location.sitePose ?? { x: robot.location.x, y: robot.location.y, heading: robot.location.heading };
}

/**
 * Width / height of an element, kept current as it resizes; undefined until it
 * is measured, and where there is no ResizeObserver. A callback ref, because
 * the map is not in the first render (the site list loads first).
 */
function useAspect(): [(el: HTMLElement | null) => void, number | undefined] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [aspect, setAspect] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const { clientWidth: w, clientHeight: h } = el;
      setAspect(w > 0 && h > 0 ? w / h : undefined);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return [setEl, aspect];
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

  const [mapRef, mapAspect] = useAspect();
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

  const groups = useMemo(() => groupSiteRobots(robots, siteId, zones), [robots, siteId, zones]);

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
        <div
          ref={mapRef}
          className={cn('overflow-hidden rounded-control border border-line', compact ? 'h-64' : 'h-[28rem]')}
        >
          <TwinTopDown
            twin={site}
            zones={zones}
            fitZones
            viewAspect={mapAspect}
            onZoneClick={(z) => void stopZone(z)}
            zoneLabel={(z) => `Stop zone ${z.name} (${ZONE_TYPE_LABELS[z.type] ?? z.type})`}
            aria-label={`Site map of ${site.name}`}
          >
            {(t) => (
              <>
                <g data-testid="site-map-planned-robots">
                  {plannedMarkerPositions(groups.planned, t.worldToScreen).map(({ robot, zone, at }) => (
                    <PlannedMarker key={robot.id} robot={robot} zoneName={zone.name} at={at} />
                  ))}
                </g>
                <g data-testid="site-map-robots">
                  {groups.plotted.map((r) => (
                    <RobotDot key={r.id} robot={r} at={t.worldToScreen(sitePoseOf(r))} />
                  ))}
                </g>
              </>
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
  const heading = sitePoseOf(robot).heading;
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

/**
 * An expected robot at its planned place: a dashed, hollow ring in the muted
 * ink — nothing of the solid, primary-coloured dot a live robot gets — and the
 * word "planned" in its label.
 */
function PlannedMarker({ robot, zoneName, at }: { robot: Robot; zoneName: string; at: { x: number; y: number } }) {
  const ink = useCssColor('--color-ink-primary', 'gray');
  const halo = useCssColor('--color-canvas', 'white');
  const state = robotProvisioning(robot)?.state ?? 'awaiting_agent';
  const label = `${robot.name} (planned)`;
  // Centre ring + label on `at`: about 6 px a character at this size.
  const left = at.x - (label.length * 6 + 16) / 2;
  return (
    <g data-testid={`site-map-planned-${robot.id}`} pointerEvents="none">
      <title>{`${robot.name} — planned position in ${zoneName}. ${ROBOT_PROVISIONING_LABELS[state]}, not a live position.`}</title>
      <circle cx={left + 6} cy={at.y - 4} r={5.5} fill={halo} fillOpacity={0.6} stroke={ink} strokeWidth={1.5} strokeDasharray="3,2.5" />
      {/* The halo keeps the label readable where it runs over a zone edge. */}
      <text
        x={left + 16}
        y={at.y}
        fontSize={12}
        fill={ink}
        stroke={halo}
        strokeWidth={3}
        strokeOpacity={0.75}
        paintOrder="stroke"
        strokeLinejoin="round"
      >
        {label}
      </text>
    </g>
  );
}

/** The dashed ring of {@link PlannedMarker}, as the key beside the list heading. */
function PlannedGlyph() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0 text-ink-secondary" aria-hidden="true">
      <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3,2.5" />
    </svg>
  );
}

/** Why an unaligned robot is listed and not drawn — the tag's hover text where the tag is shortened. */
const UNALIGNED_REASON = 'Its pose is not in this site\u2019s frame, so it is not drawn and the site\u2019s fences do not hold it.';

function provisioningNote(robot: Robot): string {
  return ROBOT_PROVISIONING_LABELS[robotProvisioning(robot)?.state ?? 'awaiting_agent'].toLowerCase();
}

/** The robots the map does not draw as live, and why. */
function SiteRobotList({ groups, compact }: { groups: SiteRobotGroups; compact: boolean }) {
  const { plotted, planned, expected, unaligned, unbound } = groups;
  if (compact && planned.length + expected.length + unaligned.length + unbound.length === 0) return null;
  const plannedZone = new Map(planned.map((p) => [p.robot.id, p.zone.name]));
  return (
    <div className="flex flex-col gap-4 text-[13px]" aria-label="Robots not live on the map">
      {!compact && (
        <p className="text-ink-tertiary" data-testid="site-map-count">
          {plotted.length} robot{plotted.length === 1 ? '' : 's'} live on the map.
          {planned.length > 0 &&
            ` ${planned.length} expected robot${planned.length === 1 ? ' is' : 's are'} drawn where ${planned.length === 1 ? 'it is' : 'they are'} planned to stand.`}
        </p>
      )}
      <RobotGroup
        title="Planned position"
        glyph={<PlannedGlyph />}
        robots={planned.map((p) => p.robot)}
        note={provisioningNote}
        detail={(r) => `planned in ${plannedZone.get(r.id)}`}
        tone="neutral"
        testId="site-map-planned"
        compact={compact}
      />
      <RobotGroup
        title="Not connected"
        robots={expected}
        note={provisioningNote}
        tone="neutral"
        testId="site-map-expected"
        compact={compact}
      />
      <RobotGroup
        title="Not aligned"
        robots={unaligned}
        // Under the dashboard's map a row is half the panel wide: the long tag left "Sim…" of the name.
        note={compact ? 'not aligned' : 'not aligned — fence not enforcing'}
        noteTitle={UNALIGNED_REASON}
        tone="warning"
        testId="site-map-unaligned"
        compact={compact}
      />
      <RobotGroup
        title="No site"
        robots={unbound}
        note="no site"
        tone="neutral"
        testId="site-map-unbound"
        compact={compact}
      />
    </div>
  );
}

function RobotGroup({
  title,
  robots,
  note,
  tone,
  testId,
  compact,
  glyph,
  detail,
  noteTitle,
}: {
  title: string;
  robots: Robot[];
  /** The tag beside each robot: one reason for the group, or one per robot */
  note: string | ((robot: Robot) => string);
  tone: 'warning' | 'neutral';
  testId: string;
  /** The map marker this group is the key for */
  glyph?: ReactNode;
  /** A second, quieter line per robot (where it is planned) */
  detail?: (robot: Robot) => string;
  /** Hover text of the tag */
  noteTitle?: string;
  /** Under the dashboard's map the list has the panel's width: one line a robot, in columns */
  compact: boolean;
}) {
  if (robots.length === 0) return null;
  const noteOf = (r: Robot) => (typeof note === 'function' ? note(r) : note);
  return (
    <section data-testid={testId} className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-tertiary">
        {glyph}
        {title}
        <span className="tabular-nums text-ink-muted">{robots.length}</span>
      </h3>
      <ul className={cn(compact ? 'grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2' : 'flex flex-col gap-2')}>
        {robots.map((r) => (
          <li
            key={r.id}
            className={cn(
              'flex min-w-0',
              compact ? 'items-center justify-between gap-3' : 'flex-col items-start gap-1',
            )}
          >
            <span className="flex min-w-0 max-w-full flex-col">
              <Link to={`/robots/${r.id}`} className="min-w-0 max-w-full truncate text-ink-primary hover:underline">
                {r.name}
              </Link>
              {detail && (
                <span className="truncate text-xs text-ink-tertiary">
                  {detail(r)}
                  {/* One line a robot under the dashboard's map: the state rides on the detail line. */}
                  {compact && ` · ${noteOf(r)}`}
                </span>
              )}
            </span>
            {!(compact && detail) && (
              <StatusTag tone={tone} size="sm" className="shrink-0" title={noteTitle}>
                {noteOf(r)}
              </StatusTag>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
