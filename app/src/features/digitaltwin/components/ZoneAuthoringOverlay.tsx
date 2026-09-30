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
 *   The read-only drawing (bounds, transform, cloud, polygons) lives in
 *   `TwinTopDown`, which the fleet site map shares.
 * @feature digitaltwin
 */

import { useCssColor } from '@/shared/components/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useTwinZoneStore,
  selectTwinZones,
  selectTwinZoneMode,
  selectTwinDraftPoints,
} from '../store/twinZoneStore';
import type { AccumulatedCloud, DigitalTwinDTO, TwinPoint } from '../types/twin.types';
import {
  TwinTopDown,
  deriveWorldBounds,
  makeTopDownTransform,
  TOP_DOWN_PADDING as PADDING,
  TOP_DOWN_VIEW_H as VIEW_H,
  TOP_DOWN_VIEW_W as VIEW_W,
} from './TwinTopDown';

export interface ZoneAuthoringOverlayProps {
  twin: DigitalTwinDTO;
  /** Live cloud, used to derive the world bounds before occupancy exists. */
  cloud?: AccumulatedCloud | null;
  /** Optional occupancy PGM image URL to draw under the polygons. */
  occupancyImageUrl?: string;
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

  const transform = useMemo(() => makeTopDownTransform(bounds), [bounds]);

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

  // UI strokes (draft polygon, hint) use the primary token; zone fills are data.
  const primary = useCssColor('--color-primary');

  const draftScreen = draftPoints.map(transform.worldToScreen);
  const draftPath =
    draftScreen.length > 0
      ? draftScreen.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') +
        (hover && mode === 'draw' ? ` L${transform.worldToScreen(hover).x},${transform.worldToScreen(hover).y}` : '')
      : '';

  return (
    <TwinTopDown
      twin={twin}
      cloud={cloud}
      occupancyImageUrl={occupancyImageUrl}
      zones={zones}
      selectedZoneId={selectedZoneId}
      onZoneClick={(z) => selectZone(z.id)}
      onZoneDoubleClick={(z) => startEditingZone(z)}
      svgRef={svgRef}
      cursor={mode === 'draw' ? 'crosshair' : 'default'}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseMove={handleMouseMove}
      aria-label={`Zone editor for ${twin.name}`}
    >
      {() => (
        <>
          {/* Active draft polygon */}
          {draftScreen.length > 0 && (
            <g pointerEvents="none">
              {draftPath && <path d={draftPath} fill={primary} fillOpacity={0.12} stroke={primary} strokeWidth={2} strokeDasharray="5,4" />}
              {draftScreen.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={4} fill={primary} />
              ))}
            </g>
          )}

          {/* Draw-mode hint */}
          {mode === 'draw' && (
            <text x={PADDING} y={PADDING} fontSize={12} fill={primary} opacity={0.9} pointerEvents="none">
              Click to add vertices · double-click / Enter to close · Backspace undo · Esc cancel
            </text>
          )}
        </>
      )}
    </TwinTopDown>
  );
}
