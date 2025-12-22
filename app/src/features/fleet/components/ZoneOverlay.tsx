/**
 * @file ZoneOverlay.tsx
 * @description Futuristic zone overlay component for fleet map with gradient borders and glow
 * @feature fleet
 * @dependencies @/features/fleet/types
 */

import type { ZoneOverlayProps, FloorZone } from '../types/fleet.types';

// ============================================================================
// CONSTANTS
// ============================================================================

// Futuristic zone colors with transparency
const ZONE_COLORS = {
  operational: {
    fill: 'rgba(42, 95, 255, 0.08)',
    stroke: '#2A5FFF',
    strokeOpacity: 0.4,
  },
  charging: {
    fill: 'rgba(24, 228, 195, 0.08)',
    stroke: '#18E4C3',
    strokeOpacity: 0.5,
  },
  maintenance: {
    fill: 'rgba(249, 115, 22, 0.08)',
    stroke: '#f97316',
    strokeOpacity: 0.4,
  },
  restricted: {
    fill: 'rgba(239, 68, 68, 0.06)',
    stroke: '#ef4444',
    strokeOpacity: 0.5,
  },
} as const;

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

/** Single zone rectangle with futuristic styling */
function ZoneRect({
  zone,
  scale,
  offset,
}: {
  zone: FloorZone;
  scale: number;
  offset: { x: number; y: number };
}) {
  const colors = ZONE_COLORS[zone.type] || ZONE_COLORS.operational;
  const x = zone.bounds.x * scale + offset.x;
  const y = zone.bounds.y * scale + offset.y;
  const width = zone.bounds.width * scale;
  const height = zone.bounds.height * scale;

  return (
    <g>
      {/* Zone background with subtle fill */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={colors.fill}
        stroke={colors.stroke}
        strokeWidth="1"
        strokeOpacity={colors.strokeOpacity}
        rx="4"
      />

      {/* Corner accents for futuristic look */}
      <g stroke={colors.stroke} strokeWidth="2" strokeOpacity={colors.strokeOpacity * 1.5}>
        {/* Top-left corner */}
        <path d={`M ${x} ${y + 12} L ${x} ${y + 4} Q ${x} ${y} ${x + 4} ${y} L ${x + 12} ${y}`} fill="none" />
        {/* Top-right corner */}
        <path d={`M ${x + width - 12} ${y} L ${x + width - 4} ${y} Q ${x + width} ${y} ${x + width} ${y + 4} L ${x + width} ${y + 12}`} fill="none" />
        {/* Bottom-left corner */}
        <path d={`M ${x} ${y + height - 12} L ${x} ${y + height - 4} Q ${x} ${y + height} ${x + 4} ${y + height} L ${x + 12} ${y + height}`} fill="none" />
        {/* Bottom-right corner */}
        <path d={`M ${x + width - 12} ${y + height} L ${x + width - 4} ${y + height} Q ${x + width} ${y + height} ${x + width} ${y + height - 4} L ${x + width} ${y + height - 12}`} fill="none" />
      </g>

      {/* Hatching pattern for restricted zones */}
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
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="8"
                stroke={colors.stroke}
                strokeWidth="0.5"
                opacity="0.15"
              />
            </pattern>
            <clipPath id={`clip-${zone.id}`}>
              <rect x={x} y={y} width={width} height={height} rx="4" />
            </clipPath>
          </defs>
          <rect
            x={x}
            y={y}
            width={width}
            height={height}
            fill={`url(#hatch-${zone.id})`}
            clipPath={`url(#clip-${zone.id})`}
            rx="4"
          />
        </g>
      )}

      {/* Zone label - monospace, subtle */}
      <text
        x={x + 8}
        y={y + 14}
        fontSize="8"
        fontFamily="monospace"
        fontWeight="500"
        fill={colors.stroke}
        opacity="0.7"
      >
        {zone.name.toUpperCase()}
      </text>
    </g>
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Futuristic zone overlay component showing facility zones on the fleet map.
 * Features gradient borders, corner accents, and subtle glow effects.
 *
 * @example
 * ```tsx
 * <svg>
 *   <ZoneOverlay zones={zones} scale={10} offset={{ x: 40, y: 40 }} />
 * </svg>
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
