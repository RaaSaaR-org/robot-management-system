/**
 * @file TwinTopDown.tsx
 * @description Read-only top-down SVG of a twin: the world↔screen transform
 *   (twin bounds → live cloud XY → a 12 m square around the origin), the
 *   occupancy image or a faint cloud projection, and the zones as polygons
 *   coloured by type (keep-outs dashed and stronger so they read as walls).
 *   Shared by the zone editor (`ZoneAuthoringOverlay`) and the fleet site map;
 *   it imports no three.js, so the fleet chunk can use it.
 * @feature digitaltwin
 */

import { useCssColor } from '@/shared/components/ui';
import { useMemo, type MouseEvent, type ReactNode, type Ref } from 'react';
import { TWIN_ZONE_COLORS } from '../store/twinZoneStore';
import type { AccumulatedCloud, DigitalTwinDTO, TwinPoint, TwinZoneDTO } from '../types/twin.types';

export const TOP_DOWN_VIEW_W = 720;
export const TOP_DOWN_VIEW_H = 540;
export const TOP_DOWN_PADDING = 24;

export interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** World ↔ SVG-viewBox mapping for one set of world bounds. */
export interface TopDownTransform {
  bounds: WorldBounds;
  /** viewBox px per world meter */
  scale: number;
  worldToScreen: (p: TwinPoint) => { x: number; y: number };
  screenToWorld: (sx: number, sy: number) => TwinPoint;
}

/** Derive world bounds (meters) from the twin, falling back to the cloud XY. */
export function deriveWorldBounds(twin: DigitalTwinDTO, cloud?: AccumulatedCloud | null): WorldBounds {
  const tb = twin.bounds;
  const hasTwinBounds = tb && (tb.maxX - tb.minX > 0.5 || tb.maxY - tb.minY > 0.5);
  if (hasTwinBounds) {
    return { minX: tb.minX, minY: tb.minY, maxX: tb.maxX, maxY: tb.maxY };
  }
  if (cloud && cloud.pointCount > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const p = cloud.positions;
    for (let i = 0; i < cloud.pointCount; i++) {
      const x = p[i * 3];
      const y = p[i * 3 + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (Number.isFinite(minX)) return { minX, minY, maxX, maxY };
  }
  // Default 12 m square centered on world origin.
  const origin = twin.worldOrigin ?? { x: 0, y: 0 };
  return { minX: origin.x - 6, minY: origin.y - 6, maxX: origin.x + 6, maxY: origin.y + 6 };
}

/**
 * Fit world bounds into the padded viewBox, preserving aspect ratio. World +y
 * is up, so the screen y axis is flipped.
 */
export function makeTopDownTransform(bounds: WorldBounds): TopDownTransform {
  const wWidth = Math.max(0.001, bounds.maxX - bounds.minX);
  const wHeight = Math.max(0.001, bounds.maxY - bounds.minY);
  const scale = Math.min(
    (TOP_DOWN_VIEW_W - 2 * TOP_DOWN_PADDING) / wWidth,
    (TOP_DOWN_VIEW_H - 2 * TOP_DOWN_PADDING) / wHeight,
  );
  const offsetX = (TOP_DOWN_VIEW_W - wWidth * scale) / 2;
  const offsetY = (TOP_DOWN_VIEW_H - wHeight * scale) / 2;
  return {
    bounds,
    scale,
    worldToScreen: (p) => ({
      x: offsetX + (p.x - bounds.minX) * scale,
      y: TOP_DOWN_VIEW_H - (offsetY + (p.y - bounds.minY) * scale),
    }),
    screenToWorld: (sx, sy) => ({
      x: bounds.minX + (sx - offsetX) / scale,
      y: bounds.minY + (TOP_DOWN_VIEW_H - sy - offsetY) / scale,
    }),
  };
}

/** The colour a zone is drawn in: its own, else its type's. */
export function twinZoneColor(zone: TwinZoneDTO, fallback: string): string {
  return zone.color || TWIN_ZONE_COLORS[zone.type] || fallback;
}

export interface TwinTopDownProps {
  twin: DigitalTwinDTO;
  /** Live cloud, used for the bounds fallback and a faint projection. */
  cloud?: AccumulatedCloud | null;
  /** Occupancy image URL drawn under the zones (replaces the projection). */
  occupancyImageUrl?: string;
  zones: TwinZoneDTO[];
  selectedZoneId?: string | null;
  /** Makes zones clickable (and keyboard-reachable) */
  onZoneClick?: (zone: TwinZoneDTO, e: MouseEvent<SVGPolygonElement>) => void;
  onZoneDoubleClick?: (zone: TwinZoneDTO, e: MouseEvent<SVGPolygonElement>) => void;
  /** Accessible name of a clickable zone (default: the zone's name) */
  zoneLabel?: (zone: TwinZoneDTO) => string;
  svgRef?: Ref<SVGSVGElement>;
  onClick?: (e: MouseEvent<SVGSVGElement>) => void;
  onDoubleClick?: (e: MouseEvent<SVGSVGElement>) => void;
  onMouseMove?: (e: MouseEvent<SVGSVGElement>) => void;
  cursor?: string;
  className?: string;
  'aria-label'?: string;
  /** Drawn above the zones, in viewBox coordinates */
  children?: (t: TopDownTransform) => ReactNode;
}

export function TwinTopDown({
  twin,
  cloud,
  occupancyImageUrl,
  zones,
  selectedZoneId,
  onZoneClick,
  onZoneDoubleClick,
  zoneLabel,
  svgRef,
  onClick,
  onDoubleClick,
  onMouseMove,
  cursor = 'default',
  className = 'h-full w-full select-none bg-inset',
  children,
  ...rest
}: TwinTopDownProps) {
  const bounds = useMemo(() => deriveWorldBounds(twin, cloud), [twin, cloud]);
  const t = useMemo(() => makeTopDownTransform(bounds), [bounds]);
  const primary = useCssColor('--color-primary');
  const interactive = Boolean(onZoneClick);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${TOP_DOWN_VIEW_W} ${TOP_DOWN_VIEW_H}`}
      className={className}
      style={{ cursor }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseMove={onMouseMove}
      role={interactive ? 'group' : 'img'}
      aria-label={rest['aria-label'] ?? `Top-down map of ${twin.name}`}
    >
      {occupancyImageUrl && (
        <image
          href={occupancyImageUrl}
          x={t.worldToScreen({ x: bounds.minX, y: bounds.maxY }).x}
          y={t.worldToScreen({ x: bounds.minX, y: bounds.maxY }).y}
          width={(bounds.maxX - bounds.minX) * t.scale}
          height={(bounds.maxY - bounds.minY) * t.scale}
          opacity={0.9}
          preserveAspectRatio="none"
          style={{ imageRendering: 'pixelated' }}
        />
      )}

      {!occupancyImageUrl && cloud && cloud.pointCount > 0 && (
        <CloudProjection cloud={cloud} worldToScreen={t.worldToScreen} />
      )}

      {zones.map((z) => {
        const pts = z.points.map(t.worldToScreen).map((p) => `${p.x},${p.y}`).join(' ');
        const selected = z.id === selectedZoneId;
        const keepout = z.type === 'keepout';
        const color = twinZoneColor(z, primary);
        const centroid = z.points.length
          ? t.worldToScreen({
              x: z.points.reduce((a, p) => a + p.x, 0) / z.points.length,
              y: z.points.reduce((a, p) => a + p.y, 0) / z.points.length,
            })
          : { x: 0, y: 0 };
        return (
          <g key={z.id} data-zone-type={z.type}>
            <polygon
              points={pts}
              fill={color}
              fillOpacity={selected ? 0.36 : keepout ? 0.28 : 0.18}
              stroke={color}
              strokeWidth={selected ? 2.5 : keepout ? 2 : 1.5}
              strokeDasharray={keepout ? '6,4' : undefined}
              style={{ cursor: interactive ? 'pointer' : undefined }}
              role={interactive ? 'button' : undefined}
              tabIndex={interactive ? 0 : undefined}
              aria-label={interactive ? (zoneLabel ? zoneLabel(z) : z.name) : undefined}
              onClick={
                onZoneClick
                  ? (e) => {
                      e.stopPropagation();
                      onZoneClick(z, e);
                    }
                  : undefined
              }
              onKeyDown={
                onZoneClick
                  ? (e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      e.stopPropagation();
                      onZoneClick(z, e as unknown as MouseEvent<SVGPolygonElement>);
                    }
                  : undefined
              }
              onDoubleClick={
                onZoneDoubleClick
                  ? (e) => {
                      e.stopPropagation();
                      onZoneDoubleClick(z, e);
                    }
                  : undefined
              }
            />
            <text x={centroid.x} y={centroid.y} fontSize={12} fill={color} textAnchor="middle" pointerEvents="none">
              {z.name}
            </text>
          </g>
        );
      })}

      {children?.(t)}
    </svg>
  );
}

/** Faint top-down projection of the cloud (subsampled) for context. */
function CloudProjection({
  cloud,
  worldToScreen,
}: {
  cloud: AccumulatedCloud;
  worldToScreen: (p: TwinPoint) => { x: number; y: number };
}) {
  const dotColor = useCssColor('--color-ink-muted', 'gray');
  const dots = useMemo(() => {
    const out: Array<{ x: number; y: number }> = [];
    const n = cloud.pointCount;
    const step = Math.max(1, Math.floor(n / 6000)); // cap ~6k dots
    const p = cloud.positions;
    for (let i = 0; i < n; i += step) {
      out.push(worldToScreen({ x: p[i * 3], y: p[i * 3 + 1] }));
    }
    return out;
  }, [cloud, worldToScreen]);

  return (
    <g pointerEvents="none">
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={0.7} fill={dotColor} opacity={0.6} />
      ))}
    </g>
  );
}
