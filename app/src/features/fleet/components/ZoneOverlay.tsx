/**
 * @file ZoneOverlay.tsx
 * @description Read-only zone overlay for an SVG map: token-coloured outlines,
 *   a light fill and the zone name in Inter. Restricted zones are hatched.
 * @feature fleet
 * @dependencies @/features/fleet/types, @/features/fleet/utils
 */

import type { ZoneOverlayProps, FloorZone } from '../types/fleet.types';
import { zoneColor } from '../utils/mapColors';

/** Single zone rectangle. */
function ZoneRect({
  zone,
  scale,
  offset,
}: {
  zone: FloorZone & { color?: string };
  scale: number;
  offset: { x: number; y: number };
}) {
  const color = zoneColor(zone.type, zone.color);
  const x = zone.bounds.x * scale + offset.x;
  const y = zone.bounds.y * scale + offset.y;
  const width = zone.bounds.width * scale;
  const height = zone.bounds.height * scale;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={color}
        fillOpacity={0.07}
        stroke={color}
        strokeOpacity={0.55}
        strokeWidth="1"
        rx="4"
      />
      {zone.type === 'restricted' && (
        <g>
          <defs>
            <pattern
              id={`hatch-${zone.id}`}
              patternUnits="userSpaceOnUse"
              width="8"
              height="8"
              patternTransform="rotate(45)"
            >
              <line x1="0" y1="0" x2="0" y2="8" stroke={color} strokeWidth="0.75" opacity="0.25" />
            </pattern>
          </defs>
          <rect x={x} y={y} width={width} height={height} fill={`url(#hatch-${zone.id})`} rx="4" />
        </g>
      )}
      <text
        x={x + 8}
        y={y + 17}
        fontSize="12"
        fontWeight="500"
        fill="var(--text-secondary)"
        style={{ fontFamily: 'var(--font-sans, Inter, system-ui, sans-serif)' }}
      >
        {zone.name}
      </text>
    </g>
  );
}

/**
 * Zone overlay showing facility zones on an SVG map.
 *
 * @example
 * ```tsx
 * <svg><ZoneOverlay zones={zones} scale={10} offset={{ x: 40, y: 40 }} /></svg>
 * ```
 */
export function ZoneOverlay({ zones, scale, offset }: ZoneOverlayProps) {
  return (
    <g className="zone-overlay">
      {zones.map((zone) => (
        <ZoneRect key={zone.id} zone={zone} scale={scale} offset={offset} />
      ))}
    </g>
  );
}
