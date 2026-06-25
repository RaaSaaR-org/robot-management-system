/**
 * @file ZoneAuthoringOverlay.tsx
 * @description 2D top-down SVG editor for authoring L2 polygon zones on a twin.
 *   Cloned from the fleet ZoneEditor but extended from single-rect drawing into
 *   MULTI-CLICK POLYGON drawing:
 *     - click to add a vertex
 *     - double-click or Enter to close the polygon (opens the form)
 *     - Backspace removes the last vertex, Esc cancels the draft
 *   The world↔screen transform is driven by the twin's worldOrigin + a derived
 *   world bounds box (its `bounds`, or the live cloud's XY extent as a fallback
 *   before occupancy exists). Existing zones render as filled polygons and are
 *   editable (double-click to edit, click select). Emits zones via the store.
 * @feature digitaltwin
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useTwinZoneStore,
  selectTwinZones,
  selectTwinZoneMode,
  selectTwinDraftPoints,
  TWIN_ZONE_COLORS,
} from '../store/twinZoneStore';
import type { AccumulatedCloud, DigitalTwinDTO, TwinPoint, TwinZoneDTO } from '../types/twin.types';

export interface ZoneAuthoringOverlayProps {
  twin: DigitalTwinDTO;
  /** Live cloud, used to derive the world bounds before occupancy exists. */
  cloud?: AccumulatedCloud | null;
  /** Optional occupancy PGM image URL to draw under the polygons. */
  occupancyImageUrl?: string;
}

const VIEW_W = 720;
const VIEW_H = 540;
const PADDING = 24;

interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Derive world bounds (meters) from the twin, falling back to the cloud XY. */
function deriveWorldBounds(twin: DigitalTwinDTO, cloud?: AccumulatedCloud | null): WorldBounds {
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
  return {
    minX: twin.worldOrigin.x - 6,
    minY: twin.worldOrigin.y - 6,
    maxX: twin.worldOrigin.x + 6,
    maxY: twin.worldOrigin.y + 6,
  };
}

export function ZoneAuthoringOverlay({ twin, cloud, occupancyImageUrl }: ZoneAuthoringOverlayProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const zones = useTwinZoneStore(selectTwinZones);
  const mode = useTwinZoneStore(selectTwinZoneMode);
  const draftPoints = useTwinZoneStore(selectTwinDraftPoints);
  const selectedZoneId = useTwinZoneStore((s) => s.selectedZoneId);
  const addDraftPoint = useTwinZoneStore((s) => s.addDraftPoint);
  const popDraftPoint = useTwinZoneStore((s) => s.popDraftPoint);
  const closeDraft = useTwinZoneStore((s) => s.closeDraft);
  const cancelDraft = useTwinZoneStore((s) => s.cancelDraft);
  const selectZone = useTwinZoneStore((s) => s.selectZone);
  const startEditingZone = useTwinZoneStore((s) => s.startEditingZone);

  const [hover, setHover] = useState<TwinPoint | null>(null);

  const bounds = useMemo(() => deriveWorldBounds(twin, cloud), [twin, cloud]);

  // World → screen transform: fit world bounds into the padded viewport,
  // preserving aspect ratio. World +y is up, so the screen y axis is flipped.
  const transform = useMemo(() => {
    const wWidth = Math.max(0.001, bounds.maxX - bounds.minX);
    const wHeight = Math.max(0.001, bounds.maxY - bounds.minY);
    const scale = Math.min((VIEW_W - 2 * PADDING) / wWidth, (VIEW_H - 2 * PADDING) / wHeight);
    const offsetX = (VIEW_W - wWidth * scale) / 2;
    const offsetY = (VIEW_H - wHeight * scale) / 2;
    const worldToScreen = (p: TwinPoint) => ({
      x: offsetX + (p.x - bounds.minX) * scale,
      y: VIEW_H - (offsetY + (p.y - bounds.minY) * scale), // flip Y (world up → screen down)
    });
    const screenToWorld = (sx: number, sy: number): TwinPoint => ({
      x: bounds.minX + (sx - offsetX) / scale,
      y: bounds.minY + (VIEW_H - sy - offsetY) / scale,
    });
    return { scale, worldToScreen, screenToWorld };
  }, [bounds]);

  const screenToMap = useCallback(
    (clientX: number, clientY: number): TwinPoint | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      // Map client px → SVG viewBox px (the SVG scales to its container).
      const sx = ((clientX - rect.left) / rect.width) * VIEW_W;
      const sy = ((clientY - rect.top) / rect.height) * VIEW_H;
      return transform.screenToWorld(sx, sy);
    },
    [transform],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (mode !== 'draw') {
        selectZone(null);
        return;
      }
      const world = screenToMap(e.clientX, e.clientY);
      if (world) addDraftPoint(world);
    },
    [mode, screenToMap, addDraftPoint, selectZone],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (mode !== 'draw') return;
      e.preventDefault();
      // The first click of the dblclick already added a vertex; close the polygon.
      closeDraft();
    },
    [mode, closeDraft],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (mode !== 'draw') return;
      setHover(screenToMap(e.clientX, e.clientY));
    },
    [mode, screenToMap],
  );

  // Keyboard: Enter closes, Esc cancels, Backspace pops last vertex.
  useEffect(() => {
    if (mode !== 'draw') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        closeDraft();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelDraft();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        popDraftPoint();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, closeDraft, cancelDraft, popDraftPoint]);

  const zoneColor = (z: TwinZoneDTO) => z.color || TWIN_ZONE_COLORS[z.type] || '#FF6700';

  const draftScreen = draftPoints.map(transform.worldToScreen);
  const draftPath =
    draftScreen.length > 0
      ? draftScreen.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') +
        (hover && mode === 'draw' ? ` L${transform.worldToScreen(hover).x},${transform.worldToScreen(hover).y}` : '')
      : '';

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="w-full h-full bg-surface-950 rounded-lg select-none"
      style={{ cursor: mode === 'draw' ? 'crosshair' : 'default' }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseMove={handleMouseMove}
    >
      {/* Optional occupancy image, stretched to the world bounds box. */}
      {occupancyImageUrl && (
        <image
          href={occupancyImageUrl}
          x={transform.worldToScreen({ x: bounds.minX, y: bounds.maxY }).x}
          y={transform.worldToScreen({ x: bounds.minX, y: bounds.maxY }).y}
          width={(bounds.maxX - bounds.minX) * transform.scale}
          height={(bounds.maxY - bounds.minY) * transform.scale}
          opacity={0.9}
          preserveAspectRatio="none"
          style={{ imageRendering: 'pixelated' }}
        />
      )}

      {/* Top-down cloud projection (light dots) when no occupancy image. */}
      {!occupancyImageUrl && cloud && cloud.pointCount > 0 && (
        <CloudProjection cloud={cloud} worldToScreen={transform.worldToScreen} />
      )}

      {/* Existing zones */}
      {zones.map((z) => {
        const pts = z.points.map(transform.worldToScreen).map((p) => `${p.x},${p.y}`).join(' ');
        const selected = z.id === selectedZoneId;
        const color = zoneColor(z);
        const centroid = z.points.length
          ? transform.worldToScreen({
              x: z.points.reduce((a, p) => a + p.x, 0) / z.points.length,
              y: z.points.reduce((a, p) => a + p.y, 0) / z.points.length,
            })
          : { x: 0, y: 0 };
        return (
          <g key={z.id}>
            <polygon
              points={pts}
              fill={color}
              fillOpacity={selected ? 0.32 : 0.18}
              stroke={color}
              strokeWidth={selected ? 2.5 : 1.5}
              style={{ cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation();
                selectZone(z.id);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                startEditingZone(z);
              }}
            />
            <text x={centroid.x} y={centroid.y} fontSize={12} fontFamily="monospace" fill={color} textAnchor="middle" pointerEvents="none">
              {z.name}
            </text>
          </g>
        );
      })}

      {/* Active draft polygon */}
      {draftScreen.length > 0 && (
        <g pointerEvents="none">
          {draftPath && <path d={draftPath} fill="rgba(255,103,0,0.12)" stroke="#FF6700" strokeWidth={2} strokeDasharray="5,4" />}
          {draftScreen.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={4} fill="#FF6700" stroke="#fff" strokeWidth={1} />
          ))}
        </g>
      )}

      {/* Draw-mode hint */}
      {mode === 'draw' && (
        <text x={PADDING} y={PADDING} fontSize={11} fontFamily="monospace" fill="#FF6700" opacity={0.85} pointerEvents="none">
          Click to add vertices · double-click / Enter to close · Backspace undo · Esc cancel
        </text>
      )}
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
        <circle key={i} cx={d.x} cy={d.y} r={0.7} fill="#5b6472" opacity={0.6} />
      ))}
    </g>
  );
}
