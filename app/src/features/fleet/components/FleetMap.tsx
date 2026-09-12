/**
 * @file FleetMap.tsx
 * @description SVG fleet map: robots and zones on a facility grid, with a floor
 *   switch and legend, marker clustering and a robot popover. Matte and
 *   token-coloured; renders no title (the host Panel carries it).
 * @feature fleet
 * @dependencies @/shared/utils/cn, @/features/fleet/types, @/features/fleet/utils
 */

import { useState, useMemo, useCallback } from 'react';
import { cn } from '@/shared/utils/cn';
import type { FleetMapProps, Zone } from '../types/fleet.types';
import { MAP_CANVAS_SIZE, MOCK_ZONES } from '../types/fleet.types';
import { RobotMarker } from './RobotMarker';
import { ZoneEditor } from './ZoneEditor';
import { FleetMapPopover } from './FleetMapPopover';
import { FleetMapToolbar } from './FleetMapToolbar';
import { clusterRobots, type Cluster } from '../utils/markerClustering';

const PADDING = 72; // room for centred robot names at the map edge
const SCALE = 10; // pixels per map unit

// Cluster count bubbles are lifted above the actual cluster point so they
// don't sit on zone labels; a thin stem keeps the badge tied to its point.
const CLUSTER_BADGE_OFFSET = 26;

/**
 * Fleet map showing robot positions on a facility grid.
 *
 * @example
 * ```tsx
 * <FleetMap robots={robotMarkers} selectedFloor={floor} onFloorChange={setFloor}
 *   onRobotClick={(id) => navigate(`/robots/${id}`)} />
 * ```
 */
export function FleetMap({
  robots,
  zones = MOCK_ZONES,
  selectedFloor,
  onFloorChange,
  onRobotClick,
  onRobotMapClick,
  editorMode: _editorMode = 'view', // ZoneEditor reads the mode from the store
  selectedZoneId = null,
  onSelectZone,
  onEditZone,
  onZoneDrawn,
  floorPlanUrl,
  clusterThreshold = 20,
  className,
}: FleetMapProps) {
  const [selectedRobotId, setSelectedRobotId] = useState<string | null>(null);
  const [hoveredCluster, setHoveredCluster] = useState<Cluster | null>(null);

  const floors = useMemo(() => {
    const floorSet = new Set([...robots.map((r) => r.floor), ...zones.map((z) => z.floor)]);
    return Array.from(floorSet).sort();
  }, [robots, zones]);

  const filteredRobots = useMemo(() => robots.filter((r) => r.floor === selectedFloor), [robots, selectedFloor]);
  const filteredZones = useMemo(() => zones.filter((z) => z.floor === selectedFloor), [zones, selectedFloor]);

  const bounds = useMemo(() => {
    const allX = [
      ...filteredRobots.map((r) => r.position.x),
      ...filteredZones.flatMap((z) => [z.bounds.x, z.bounds.x + z.bounds.width]),
    ];
    const allY = [
      ...filteredRobots.map((r) => r.position.y),
      ...filteredZones.flatMap((z) => [z.bounds.y, z.bounds.y + z.bounds.height]),
    ];
    return {
      minX: Math.min(...allX, 0),
      maxX: Math.max(...allX, 50),
      minY: Math.min(...allY, 0),
      maxY: Math.max(...allY, 35),
    };
  }, [filteredRobots, filteredZones]);

  const transformPoint = useCallback(
    (x: number, y: number) => ({
      x: PADDING + (x - bounds.minX) * SCALE,
      y: PADDING + (y - bounds.minY) * SCALE,
    }),
    [bounds],
  );

  const viewWidth = Math.max((bounds.maxX - bounds.minX) * SCALE + PADDING * 2, MAP_CANVAS_SIZE.width);
  const viewHeight = Math.max((bounds.maxY - bounds.minY) * SCALE + PADDING * 2, MAP_CANVAS_SIZE.height);

  const selectedRobot = useMemo(
    () => filteredRobots.find((r) => r.robotId === selectedRobotId),
    [filteredRobots, selectedRobotId],
  );

  // A marker click opens the popover; navigation happens from its buttons.
  const handleRobotClick = useCallback((robotId: string) => {
    setSelectedRobotId((current) => (current === robotId ? null : robotId));
  }, []);

  const clusters = useMemo(() => {
    const markers = filteredRobots.map((r) => {
      const pos = transformPoint(r.position.x, r.position.y);
      return { id: r.robotId, x: pos.x, y: pos.y, name: r.name, status: r.status };
    });
    return clusterRobots(markers, clusterThreshold);
  }, [filteredRobots, transformPoint, clusterThreshold]);

  const clusteredRobotIds = useMemo(() => {
    const ids = new Set<string>();
    for (const cluster of clusters) {
      if (cluster.robots.length > 1) cluster.robots.forEach((r) => ids.add(r.id));
    }
    return ids;
  }, [clusters]);

  const popoverAnchor = selectedRobot
    ? (() => {
        const p = transformPoint(selectedRobot.position.x, selectedRobot.position.y);
        return { x: p.x / viewWidth, y: p.y / viewHeight };
      })()
    : null;

  return (
    <div className={cn('flex flex-col', className)}>
      <FleetMapToolbar
        floors={floors.length > 0 ? floors : [selectedFloor]}
        selectedFloor={selectedFloor}
        onFloorChange={onFloorChange}
        robotCount={filteredRobots.length}
      />

      {/* A diagram may scroll sideways on phones: below ~560px the labels
          would shrink under 10px, so the map keeps a minimum width. */}
      <div className="overflow-x-auto bg-inset">
      <div className="relative min-w-[560px]">
        <svg
          viewBox={`0 0 ${viewWidth} ${viewHeight}`}
          className="block h-auto w-full"
          role="group"
          aria-label={`Fleet map, floor ${selectedFloor}`}
        >
          <defs>
            <pattern id="fleetGrid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="var(--border-color)" strokeWidth="0.5" opacity="0.6" />
            </pattern>
          </defs>

          {floorPlanUrl && (
            <image href={floorPlanUrl} x="0" y="0" width="100%" height="100%" opacity={0.3} preserveAspectRatio="xMidYMid slice" />
          )}

          <rect x="0" y="0" width="100%" height="100%" fill="url(#fleetGrid)" />

          <ZoneEditor
            zones={filteredZones as Zone[]}
            scale={SCALE}
            offset={{ x: PADDING - bounds.minX * SCALE, y: PADDING - bounds.minY * SCALE }}
            selectedZoneId={selectedZoneId}
            onSelectZone={onSelectZone || (() => {})}
            onEditZone={onEditZone || (() => {})}
            onZoneDrawn={onZoneDrawn || (() => {})}
          />

          {filteredRobots
            .filter((robot) => !clusteredRobotIds.has(robot.robotId))
            .map((robot) => (
              <RobotMarker
                key={robot.robotId}
                robot={robot}
                position={transformPoint(robot.position.x, robot.position.y)}
                isSelected={robot.robotId === selectedRobotId}
                onClick={() => handleRobotClick(robot.robotId)}
              />
            ))}

          {clusters
            .filter((c) => c.robots.length > 1)
            .map((cluster) => (
              <ClusterBadge
                key={cluster.robots.map((r) => r.id).join('-')}
                cluster={cluster}
                isHovered={hoveredCluster === cluster}
                onHover={setHoveredCluster}
              />
            ))}
        </svg>

        {selectedRobot && popoverAnchor && (
          <FleetMapPopover
            robot={selectedRobot}
            anchor={popoverAnchor}
            onClose={() => setSelectedRobotId(null)}
            onViewDetails={() => onRobotClick?.(selectedRobot.robotId)}
            onViewMap={onRobotMapClick ? () => onRobotMapClick(selectedRobot.robotId) : undefined}
          />
        )}
      </div>
      </div>
    </div>
  );
}

/** Count bubble for robots too close together to draw one by one. */
function ClusterBadge({
  cluster,
  isHovered,
  onHover,
}: {
  cluster: Cluster;
  isHovered: boolean;
  onHover: (cluster: Cluster | null) => void;
}) {
  const names = cluster.robots.map((r) => r.name);
  return (
    <g
      transform={`translate(${cluster.x}, ${cluster.y})`}
      className="cursor-default"
      onMouseEnter={() => onHover(cluster)}
      onMouseLeave={() => onHover(null)}
      role="img"
      aria-label={`${names.length} robots: ${names.join(', ')}`}
    >
      <circle cx="0" cy="0" r="2.5" fill="var(--color-primary)" />
      <line x1="0" y1="-3" x2="0" y2={-(CLUSTER_BADGE_OFFSET - 13)} stroke="var(--color-primary)" strokeWidth="1" opacity="0.6" />
      <circle
        cx="0"
        cy={-CLUSTER_BADGE_OFFSET}
        r="13"
        fill="var(--bg-secondary)"
        stroke="var(--color-primary)"
        strokeWidth={isHovered ? 2 : 1.5}
      />
      <text
        x="0"
        y={1 - CLUSTER_BADGE_OFFSET}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="12"
        fontWeight="600"
        fill="var(--text-primary)"
      >
        {names.length}
      </text>
      {isHovered && (
        <g transform={`translate(20, ${-10 - CLUSTER_BADGE_OFFSET})`}>
          <rect
            x="0"
            y="0"
            width="140"
            height={names.length * 16 + 12}
            rx="6"
            fill="var(--bg-elevated)"
            stroke="var(--border-color)"
            strokeWidth="1"
          />
          {names.map((name, i) => (
            <text key={cluster.robots[i].id} x="10" y={18 + i * 16} fontSize="11" fill="var(--text-primary)">
              {name}
            </text>
          ))}
        </g>
      )}
    </g>
  );
}
