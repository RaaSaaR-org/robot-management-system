/**
 * @file RobotMapPanel.tsx
 * @description The robot's own map (TASK-206/207): its occupancy grid, the
 *              keep-outs it knows, itself, and the other robots it is allowed
 *              to see — a top-down canvas, robot-centred, north-up or
 *              heading-up. Polls the server proxy at 1 Hz while mounted.
 * @feature agentmode
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/shared/utils';
import { formatTimeAgo } from '@/shared/utils/format';
import { SegmentedControl, Tooltip } from '@/shared/components/ui';
import { TWIN_ZONE_COLORS } from '@/features/digitaltwin/store/twinZoneStore';
import { useAgentModeStore } from '../store/agentmodeStore';
import type { RobotMapGrid, RobotMapPayload } from '../types/agentmode.types';
import { PlaceChip } from './PlaceChip';

export interface RobotMapPanelProps {
  robotId: string | null;
  className?: string;
  /** Poll cadence while mounted; the panel is only mounted while its tab shows. */
  pollMs?: number;
}

type Orientation = 'north' | 'heading';

/** Half-width of the view in metres — the zoom steps. */
const RANGES_M = [2, 3, 6, 12, 24] as const;
/** ±3 m: a 6 m room fills a 300 px rail; the operator zooms out for a hall. */
const DEFAULT_RANGE_INDEX = 1;
/** Keep-out names are drawn only when there is room for them (px per metre). */
const KEEPOUT_LABEL_MIN_PX_PER_M = 40;

/** Cobalt / turquoise from the brand palette; keep-out is the twin's own token. */
const COLOR_SELF = '#2A5FFF';
const COLOR_PEER = '#18E4C3';
const COLOR_KEEPOUT = TWIN_ZONE_COLORS.keepout;
/** Free cells: cobalt at ~10 % — faint on purpose, so occupied and unknown carry the picture. */
const FREE_RGBA: [number, number, number, number] = [42, 95, 255, 26];

/**
 * Decode the wire grid to one RGBA byte per cell. Cell (0,0) is the lowest-y
 * corner, so the image is drawn with a y-flip by the caller.
 */
export function decodeGridToImage(grid: RobotMapGrid, occupiedRgb: [number, number, number]): ImageData | null {
  if (typeof document === 'undefined' || typeof ImageData === 'undefined') return null;
  let bytes: Uint8Array;
  try {
    const bin = atob(grid.cells);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return null;
  }
  const n = grid.width * grid.height;
  if (bytes.length !== n) return null;
  const cells = new Int8Array(bytes.buffer, bytes.byteOffset, n);
  const occ = Math.round(grid.occupiedAbove * 25);
  const free = Math.round(grid.freeBelow * 25);
  const img = new ImageData(grid.width, grid.height);
  const d = img.data;
  for (let i = 0; i < n; i++) {
    const v = cells[i];
    const o = i * 4;
    if (v > occ) {
      d[o] = occupiedRgb[0];
      d[o + 1] = occupiedRgb[1];
      d[o + 2] = occupiedRgb[2];
      d[o + 3] = 230;
    } else if (v < free) {
      d[o] = FREE_RGBA[0];
      d[o + 1] = FREE_RGBA[1];
      d[o + 2] = FREE_RGBA[2];
      d[o + 3] = FREE_RGBA[3];
    }
    // unknown: transparent
  }
  return img;
}

function parseRgb(color: string): [number, number, number] {
  const m = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(color);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [120, 130, 150];
}

/** One line for the footer: frame, peers, dropped, age. */
export function mapFooterText(map: RobotMapPayload | null, fetchedAt: string | null): string {
  if (!map) return '';
  const parts: string[] = [];
  parts.push(map.frameId ? `frame: ${map.frameId.kind}` : 'frame: odom');
  if (map.peersEnabled) {
    parts.push(`${map.peers.length} ${map.peers.length === 1 ? 'peer' : 'peers'}`);
    if (map.peersDropped > 0) parts.push(`${map.peersDropped} dropped (different frame)`);
  } else {
    parts.push('peers off');
  }
  if (map.grid?.lastIntegratedAt) parts.push(`scan ${formatTimeAgo(map.grid.lastIntegratedAt)}`);
  else parts.push('no scan yet');
  if (map.nav) {
    parts.push(
      map.nav.planned && map.nav.lengthM !== null
        ? `→ ${map.nav.target}: ${map.nav.lengthM.toFixed(1)} m planned`
        : `→ ${map.nav.target}: by sight`,
    );
  }
  if (fetchedAt) parts.push(`read ${formatTimeAgo(fetchedAt)}`);
  return parts.join(' · ');
}

/**
 * Draw the whole map. Pure canvas code, kept out of the component so it can be
 * reasoned about (and, one day, tested) as a function of (payload, view).
 */
export function drawMap(
  ctx: CanvasRenderingContext2D,
  map: RobotMapPayload,
  view: { widthPx: number; heightPx: number; rangeM: number; orientation: Orientation; occupiedColor: string },
  gridImage: HTMLCanvasElement | null,
): void {
  const { widthPx, heightPx, rangeM, orientation } = view;
  ctx.clearRect(0, 0, widthPx, heightPx);
  const pxPerM = Math.min(widthPx, heightPx) / (2 * rangeM);
  // Centre on the robot when it has a pose, else on the grid's centre, else origin.
  const grid = map.grid;
  const cx =
    map.pose?.x ?? (grid ? grid.originX + (grid.width * grid.resolution) / 2 : 0);
  const cy =
    map.pose?.y ?? (grid ? grid.originY + (grid.height * grid.resolution) / 2 : 0);
  const rot = orientation === 'heading' && map.pose ? (map.pose.yawDeg - 90) * (Math.PI / 180) : 0;

  ctx.save();
  // World → screen: translate to centre, flip y (north up), optional rotation.
  ctx.translate(widthPx / 2, heightPx / 2);
  ctx.scale(pxPerM, -pxPerM);
  ctx.rotate(-rot);
  ctx.translate(-cx, -cy);

  // Occupancy cells.
  if (grid && gridImage) {
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    // The image's row 0 is the LOWEST y; with the y-flip above we draw it
    // flipped once more so it lands right side up.
    ctx.translate(grid.originX, grid.originY + grid.height * grid.resolution);
    ctx.scale(1, -1);
    ctx.drawImage(gridImage, 0, 0, grid.width * grid.resolution, grid.height * grid.resolution);
    ctx.restore();
  }

  // Keep-outs: red outline, faint hatch.
  for (const k of map.keepouts) {
    if (k.polygon.length < 3) continue;
    ctx.beginPath();
    ctx.moveTo(k.polygon[0][0], k.polygon[0][1]);
    for (let i = 1; i < k.polygon.length; i++) ctx.lineTo(k.polygon[i][0], k.polygon[i][1]);
    ctx.closePath();
    ctx.fillStyle = `${COLOR_KEEPOUT}22`;
    ctx.fill();
    ctx.lineWidth = 2 / pxPerM;
    ctx.setLineDash([0.2, 0.15]);
    ctx.strokeStyle = COLOR_KEEPOUT;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Peers: labelled discs with a heading tick.
  for (const p of map.peers) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.footprintRadiusM, 0, Math.PI * 2);
    ctx.fillStyle = `${COLOR_PEER}66`;
    ctx.fill();
    ctx.lineWidth = 2 / pxPerM;
    ctx.strokeStyle = COLOR_PEER;
    ctx.stroke();
    if (p.headingDeg !== null) {
      const a = (p.headingDeg * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + Math.cos(a) * p.footprintRadiusM * 1.6, p.y + Math.sin(a) * p.footprintRadiusM * 1.6);
      ctx.stroke();
    }
  }

  // The navigator's planned route (TASK-208): a cobalt polyline from the robot
  // to where the plan ends, and a ring on the goal. Only when planned — a
  // "by sight" navigation has no line to draw, and drawing one would be a claim.
  const nav = map.nav ?? null;
  if (nav?.planned && nav.path && nav.path.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(nav.path[0][0], nav.path[0][1]);
    for (let i = 1; i < nav.path.length; i++) ctx.lineTo(nav.path[i][0], nav.path[i][1]);
    ctx.lineWidth = 3 / pxPerM;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = COLOR_SELF;
    ctx.setLineDash([0.25, 0.15]);
    ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 1; i < nav.path.length - 1; i++) {
      ctx.beginPath();
      ctx.arc(nav.path[i][0], nav.path[i][1], 3 / pxPerM, 0, Math.PI * 2);
      ctx.fillStyle = COLOR_SELF;
      ctx.fill();
    }
  }
  if (nav?.goal) {
    ctx.beginPath();
    ctx.arc(nav.goal.x, nav.goal.y, 0.15, 0, Math.PI * 2);
    ctx.lineWidth = 2 / pxPerM;
    ctx.strokeStyle = COLOR_SELF;
    ctx.stroke();
  }

  // Self: heading triangle.
  if (map.pose) {
    const a = (map.pose.yawDeg * Math.PI) / 180;
    const r = 0.3;
    ctx.beginPath();
    ctx.moveTo(map.pose.x + Math.cos(a) * r * 1.4, map.pose.y + Math.sin(a) * r * 1.4);
    ctx.lineTo(map.pose.x + Math.cos(a + 2.4) * r, map.pose.y + Math.sin(a + 2.4) * r);
    ctx.lineTo(map.pose.x + Math.cos(a - 2.4) * r, map.pose.y + Math.sin(a - 2.4) * r);
    ctx.closePath();
    ctx.fillStyle = COLOR_SELF;
    ctx.fill();
  }
  ctx.restore();

  // Labels in screen space (text must not be flipped).
  ctx.save();
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'center';
  const toScreen = (x: number, y: number): [number, number] => {
    const dx = x - cx;
    const dy = y - cy;
    const rx = dx * Math.cos(-rot) - dy * Math.sin(-rot);
    const ry = dx * Math.sin(-rot) + dy * Math.cos(-rot);
    return [widthPx / 2 + rx * pxPerM, heightPx / 2 - ry * pxPerM];
  };
  for (const p of map.peers) {
    const [sx, sy] = toScreen(p.x, p.y);
    ctx.fillStyle = view.occupiedColor;
    ctx.fillText(p.name, sx, sy - p.footprintRadiusM * pxPerM - 3);
  }
  if (pxPerM >= KEEPOUT_LABEL_MIN_PX_PER_M) {
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
    for (const k of map.keepouts) {
      if (k.polygon.length < 3) continue;
      const mx = k.polygon.reduce((s, [x]) => s + x, 0) / k.polygon.length;
      const my = k.polygon.reduce((s, [, y]) => s + y, 0) / k.polygon.length;
      const [sx, sy] = toScreen(mx, my);
      ctx.fillStyle = COLOR_KEEPOUT;
      ctx.textBaseline = 'middle';
      // "Person (do not walk into)" → "Person": the parenthetical is a rule, not a name.
      ctx.fillText(k.name.replace(/\s*\(.*\)\s*$/, '').replace(/ footprint$/i, ''), sx, sy);
      ctx.textBaseline = 'bottom';
    }
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  }
  // Scale bar: 1 m, bottom-left.
  const bar = pxPerM;
  ctx.strokeStyle = view.occupiedColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(10, heightPx - 10);
  ctx.lineTo(10 + bar, heightPx - 10);
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.fillStyle = view.occupiedColor;
  ctx.fillText('1 m', 12, heightPx - 13);
  // North arrow: world +y after the view rotation. Points straight up in
  // north-up mode; swings with the robot in heading-up mode.
  const na = orientation === 'north' ? 0 : -rot;
  const nx = widthPx - 18;
  const ny = 20;
  const ex = nx - Math.sin(na) * 8;
  const ey = ny - Math.cos(na) * 8;
  ctx.beginPath();
  ctx.moveTo(nx + Math.sin(na) * 8, ny + Math.cos(na) * 8);
  ctx.lineTo(ex, ey);
  ctx.strokeStyle = view.occupiedColor;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', ex - Math.sin(na) * 7, ey - Math.cos(na) * 7);
  ctx.restore();
}

/**
 * The map card body. Headerless like `ScenePanel`: `KnowledgePanel` owns the
 * title and the tab. Empty states are sentences, never a blank canvas — a
 * blank map reads as "the room is unknown", which is a claim.
 */
export const RobotMapPanel = memo(function RobotMapPanel({ robotId, className, pollMs = 1000 }: RobotMapPanelProps) {
  const map = useAgentModeStore((s) => s.robotMap);
  const status = useAgentModeStore((s) => s.robotMapStatus);
  const error = useAgentModeStore((s) => s.robotMapError);
  const fetchedAt = useAgentModeStore((s) => s.robotMapFetchedAt);
  const fetchRobotMap = useAgentModeStore((s) => s.fetchRobotMap);

  const [orientation, setOrientation] = useState<Orientation>('north');
  const [rangeIndex, setRangeIndex] = useState(DEFAULT_RANGE_INDEX);
  const rangeM = RANGES_M[rangeIndex];

  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Poll while mounted and the tab is visible; stop when hidden.
  useEffect(() => {
    if (!robotId) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void fetchRobotMap(robotId);
    };
    tick();
    timer = setInterval(tick, pollMs);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [robotId, pollMs, fetchRobotMap]);

  // Size the canvas to its host.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  // Decode the grid once per payload, not once per frame.
  const gridCanvas = useMemo(() => {
    if (!map?.grid || typeof document === 'undefined') return null;
    const canvas = canvasRef.current;
    const color = canvas ? getComputedStyle(canvas).color : 'rgb(120,130,150)';
    const img = decodeGridToImage(map.grid, parseRgb(color));
    if (!img) return null;
    const off = document.createElement('canvas');
    off.width = map.grid.width;
    off.height = map.grid.height;
    const c = off.getContext('2d');
    if (!c) return null;
    c.putImageData(img, 0, 0);
    return off;
  }, [map?.grid]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !map || size.w === 0 || size.h === 0) return;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.floor(size.w * dpr);
    canvas.height = Math.floor(size.h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawMap(
      ctx,
      map,
      { widthPx: size.w, heightPx: size.h, rangeM, orientation, occupiedColor: getComputedStyle(canvas).color },
      gridCanvas,
    );
  }, [map, size, rangeM, orientation, gridCanvas]);

  useEffect(() => {
    draw();
  }, [draw]);

  const footer = mapFooterText(map, fetchedAt);
  const stale = status === 'unavailable' && map !== null;

  return (
    <div className={cn('flex flex-col min-h-0 flex-1', className)} data-testid="agent-map-panel">
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-glass-subtle">
        <SegmentedControl<Orientation>
          label="Map orientation"
          value={orientation}
          onChange={setOrientation}
          options={[
            { value: 'north', label: 'North up', title: 'Map north (the odometry +y axis) points up' },
            { value: 'heading', label: 'Heading up', title: 'The robot always faces up' },
          ]}
        />
        <div className="ml-auto inline-flex items-center gap-1">
          <button
            type="button"
            aria-label="Zoom out"
            className="glass-subtle px-2 py-0.5 text-xs rounded-brand disabled:opacity-40"
            disabled={rangeIndex >= RANGES_M.length - 1}
            onClick={() => setRangeIndex((i) => Math.min(RANGES_M.length - 1, i + 1))}
          >
            −
          </button>
          <span className="card-meta tabular-nums w-10 text-center" data-testid="agent-map-range">
            ±{rangeM} m
          </span>
          <button
            type="button"
            aria-label="Zoom in"
            className="glass-subtle px-2 py-0.5 text-xs rounded-brand disabled:opacity-40"
            disabled={rangeIndex <= 0}
            onClick={() => setRangeIndex((i) => Math.max(0, i - 1))}
          >
            +
          </button>
        </div>
      </div>

      <div ref={hostRef} className="relative flex-1 min-h-[220px] overflow-hidden">
        {map ? (
          <>
            <canvas
              ref={canvasRef}
              data-testid="agent-map-canvas"
              role="img"
              aria-label={`Occupancy map: ${map.grid?.knownCells ?? 0} known cells, ${map.peers.length} peers`}
              className="absolute inset-0 w-full h-full text-theme-primary"
              style={{ width: size.w || undefined, height: size.h || undefined }}
            />
            {/* Only a KNOWN place is repeated here; the rail's chip owns the
                unknown state, and two "Place unknown" chips on one page would
                be two chances to disagree. */}
            {map.place && (
              <div className="absolute left-2 top-2">
                <PlaceChip place={map.place} testId={null} />
              </div>
            )}
            {!map.grid && (
              <p
                data-testid="agent-map-empty"
                className="absolute inset-x-0 bottom-8 text-center card-meta px-4"
              >
                No scan integrated yet — the map fills in as the robot looks and walks.
              </p>
            )}
            {!map.registered && (
              <Tooltip
                content={
                  map.registrationReason ??
                  'The place graph is not registered to this odometry frame, so keep-outs are not drawn on the map.'
                }
                side="left"
                className="absolute right-2 bottom-2"
              >
                <span className="card-meta text-[11px]" data-testid="agent-map-unregistered">
                  keep-outs not shown
                </span>
              </Tooltip>
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center" data-testid="agent-map-empty">
            <p className="card-meta max-w-[26ch]">
              {status === 'disabled'
                ? 'This robot does not publish a map (AGENT_MAP_ENABLED).'
                : status === 'unavailable'
                  ? `Map unavailable: ${error ?? 'the robot did not answer'}.`
                  : robotId
                    ? 'Reading the robot’s map…'
                    : 'No robot selected.'}
            </p>
          </div>
        )}
      </div>

      {map && (
        <div
          className={cn('shrink-0 px-3 py-1.5 border-t border-glass-subtle card-meta text-[11px] tabular-nums truncate')}
          data-testid="agent-map-footer"
          title={stale ? `Last read failed: ${error ?? 'unknown'} — showing the last map.` : footer}
        >
          {footer}
          {stale && ' · stale'}
        </div>
      )}
    </div>
  );
});
