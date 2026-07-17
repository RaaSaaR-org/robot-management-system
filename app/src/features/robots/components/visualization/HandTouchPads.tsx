/**
 * @file HandTouchPads.tsx
 * @description Stylized Dex3-1 hand schematics with fingertip pads colored by live touch pressure
 * @feature robots
 */

import { memo, useRef, useState } from 'react';
import { cn } from '@/shared/utils/cn';
import { SimBadge } from '../SimBadge';
import type { RobotTelemetry, TouchPad } from '../../types/robots.types';

// ============================================================================
// TYPES & CONSTANTS
// ============================================================================

type HandSide = 'left' | 'right';

interface PadSegment {
  /** Human label for the pad */
  label: string;
  /** Rect geometry in the left-hand coordinate space */
  x: number;
  y: number;
  w: number;
  h: number;
  rx: number;
  /** Group the segment belongs to (thumb segments share a rotation) */
  thumb?: boolean;
}

/**
 * Dex3-1 pad layout: 3 fingers × 3 sensor arrays = 9 segments per hand,
 * matching the 9 `press_sensor_state` entries the real Dex3-1 publishes
 * (measured live 2026-07-17; each array carries 12 cells of which only some
 * are physically populated). Assumed order: thumb base→tip, index, middle —
 * mirroring the hand-joint order. Segment index 1 = base, 3 = tip.
 */
const PAD_SEGMENTS: PadSegment[] = [
  { label: 'Thumb 1', x: 22, y: 96, w: 22, h: 20, rx: 8, thumb: true },
  { label: 'Thumb 2', x: 22, y: 72, w: 22, h: 22, rx: 8, thumb: true },
  { label: 'Thumb 3', x: 22, y: 46, w: 22, h: 24, rx: 10, thumb: true },
  { label: 'Index 1', x: 32, y: 62, w: 24, h: 24, rx: 8 },
  { label: 'Index 2', x: 32, y: 36, w: 24, h: 24, rx: 8 },
  { label: 'Index 3', x: 32, y: 10, w: 24, h: 24, rx: 10 },
  { label: 'Middle 1', x: 60, y: 56, w: 24, h: 24, rx: 8 },
  { label: 'Middle 2', x: 60, y: 30, w: 24, h: 24, rx: 8 },
  { label: 'Middle 3', x: 60, y: 4, w: 24, h: 24, rx: 10 },
];

/**
 * Sensor-array index → segment index, keyed by how many pads the frame
 * carries. 9 = real Dex3-1; 7 = the older thumb-3/index-2/middle-2 guess;
 * ≤3 = one pad per fingertip (the dev simulator). Other counts map
 * sequentially.
 */
const SEGMENT_MAP: Record<number, number[]> = {
  9: [0, 1, 2, 3, 4, 5, 6, 7, 8],
  7: [0, 1, 2, 3, 4, 6, 7],
  3: [2, 5, 8],
  2: [2, 5],
  1: [2],
};

function segmentForPad(padIndex: number, padCount: number): number | undefined {
  const map = SEGMENT_MAP[padCount];
  return map ? map[padIndex] : padIndex < PAD_SEGMENTS.length ? padIndex : undefined;
}

const VIEWBOX = '-38 0 156 152';
/** Mirror for the right hand: x' = (minX + maxX) - x = 80 - x */
const MIRROR_TRANSFORM = 'translate(80 0) scale(-1 1)';
const THUMB_TRANSFORM = 'rotate(-50 34 120)';

// ============================================================================
// PRESSURE CALIBRATION
// ============================================================================

/**
 * The Dex3-1 arrays sit at a large raw baseline when untouched (~99 000 units,
 * jitter ±30; measured live 2026-07-17) — the absolute reading is meaningless,
 * only the rise above baseline is. Each pad therefore tracks a rolling
 * baseline (min ever seen) and colors by delta above it, normalized against
 * the largest delta seen so far. The floor keeps sensor jitter dark: 2 % of
 * baseline for raw-unit sensors, at least 1 for small-unit (sim) sources.
 */
interface PadCalibration {
  baseline: number;
  peakDelta: number;
}

function padRatio(cal: Record<string, PadCalibration>, key: string, value: number): number {
  const entry = (cal[key] ??= { baseline: value, peakDelta: 0 });
  entry.baseline = Math.min(entry.baseline, value);
  const delta = value - entry.baseline;
  entry.peakDelta = Math.max(entry.peakDelta, delta);
  const floor = Math.max(1, entry.baseline * 0.02);
  const scale = Math.max(floor, entry.peakDelta);
  return Math.max(0, Math.min(1, delta / scale));
}

// ============================================================================
// COLOR SCALE
// ============================================================================

type Rgba = [number, number, number, number];

// surface tint → warning yellow → danger red (status hues used app-wide)
const IDLE_RGBA: Rgba = [125, 135, 155, 0.16];
const WARN_RGBA: Rgba = [234, 179, 8, 0.6];
const DANGER_RGBA: Rgba = [239, 68, 68, 0.92];

function mix(a: Rgba, b: Rgba, t: number): string {
  const c = a.map((v, i) => v + (b[i] - v) * t);
  return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${c[3].toFixed(2)})`;
}

/** Pressure ratio 0..1 → fill color (surface → yellow → red) */
function pressureColor(t: number): string {
  if (t <= 0) return mix(IDLE_RGBA, IDLE_RGBA, 0);
  if (t < 0.5) return mix(IDLE_RGBA, WARN_RGBA, t / 0.5);
  return mix(WARN_RGBA, DANGER_RGBA, Math.min(1, (t - 0.5) / 0.5));
}

/** Representative value for a pad: peak of its pressure array */
function padValue(pad: TouchPad | undefined): number | null {
  if (!pad || pad.pressure.length === 0) return null;
  return Math.max(...pad.pressure);
}

/** Hottest populated cell of a pad, if the array reports temperatures */
function padTemperature(pad: TouchPad | undefined): number | null {
  if (!pad?.temperature?.length) return null;
  const max = Math.max(...pad.temperature);
  return max > 0 ? max : null;
}

// ============================================================================
// HAND SCHEMATIC
// ============================================================================

interface HoveredPad {
  side: HandSide;
  label: string;
  delta: number;
  raw: number;
  temperature: number | null;
}

interface HandSchematicProps {
  side: HandSide;
  pads: TouchPad[] | undefined;
  /** Rolling per-pad calibration (mutated in place) */
  calibration: Record<string, PadCalibration>;
  onHover: (pad: HoveredPad | null) => void;
}

function HandSchematic({ side, pads, calibration, onHover }: HandSchematicProps) {
  const mirrored = side === 'right';
  const padCount = pads?.length ?? 0;

  // segment index → its pad data for this frame
  const bySegment = new Map<number, { pad: TouchPad; key: string }>();
  pads?.forEach((pad, i) => {
    const seg = segmentForPad(i, padCount);
    if (seg !== undefined) bySegment.set(seg, { pad, key: `${side}-${i}` });
  });

  return (
    <div className="flex flex-col items-center">
      <svg
        viewBox={VIEWBOX}
        className="w-full max-w-[150px]"
        role="img"
        aria-label={`${side} hand touch pressure`}
      >
        <g transform={mirrored ? MIRROR_TRANSFORM : undefined}>
          {/* Palm (not a sensor pad) */}
          <rect
            x="30"
            y="88"
            width="56"
            height="52"
            rx="14"
            className="fill-[var(--glass-bg-subtle)] stroke-[var(--border-color)]"
            strokeWidth="1"
          />
          {PAD_SEGMENTS.map((seg, segIndex) => {
            const entry = bySegment.get(segIndex);
            const value = padValue(entry?.pad);
            let ratio = 0;
            let delta = 0;
            if (entry && value !== null) {
              ratio = padRatio(calibration, entry.key, value);
              delta = value - calibration[entry.key].baseline;
            }
            const temperature = padTemperature(entry?.pad);
            const rect = (
              <rect
                key={seg.label}
                x={seg.x}
                y={seg.y}
                width={seg.w}
                height={seg.h}
                rx={seg.rx}
                strokeWidth="1"
                className="stroke-[var(--border-color)] transition-[fill] duration-200 cursor-default"
                style={{ fill: value !== null ? pressureColor(ratio) : 'var(--glass-bg-subtle)' }}
                onMouseEnter={() =>
                  value !== null
                    ? onHover({ side, label: seg.label, delta, raw: value, temperature })
                    : onHover(null)
                }
                onMouseLeave={() => onHover(null)}
              >
                <title>
                  {value !== null
                    ? `${seg.label}: Δ${delta.toFixed(0)} above baseline (raw ${value.toFixed(0)})`
                    : `${seg.label}: no data`}
                </title>
              </rect>
            );
            return seg.thumb ? (
              <g key={seg.label} transform={THUMB_TRANSFORM}>
                {rect}
              </g>
            ) : (
              rect
            );
          })}
        </g>
      </svg>
      <span className="mt-1 text-xs text-theme-tertiary capitalize">
        {side}
        {padCount > 0 && <span className="text-theme-muted"> · {padCount} pads</span>}
      </span>
    </div>
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

export interface HandTouchPadsProps {
  /** Current telemetry frame (reads `telemetry.touch`) */
  telemetry: RobotTelemetry | null;
  /** Additional class names */
  className?: string;
}

/**
 * Two stylized Dex3-1 hand schematics whose sensor pads light up with live
 * touch pressure (surface tint → warning → danger as pressure rises above the
 * pad's rolling baseline). Shows an empty state without touch data.
 */
export const HandTouchPads = memo(function HandTouchPads({
  telemetry,
  className,
}: HandTouchPadsProps) {
  const [hovered, setHovered] = useState<HoveredPad | null>(null);
  const calibrationRef = useRef<Record<string, PadCalibration>>({});

  const touch = telemetry?.touch;
  const hasData =
    (touch?.left?.length ?? 0) > 0 || (touch?.right?.length ?? 0) > 0;

  if (!hasData) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-8 text-center', className)}>
        <div className="glass-subtle rounded-2xl p-4 mb-3">
          <svg
            className="h-8 w-8 text-theme-tertiary"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10.05 4.575a1.575 1.575 0 10-3.15 0v3m3.15-3v-1.5a1.575 1.575 0 013.15 0v1.5m-3.15 0l.075 5.925m3.075.75V4.575m0 0a1.575 1.575 0 013.15 0V15M6.9 7.575a1.575 1.575 0 10-3.15 0v8.175a6.75 6.75 0 006.75 6.75h2.018a5.25 5.25 0 003.712-1.538l1.732-1.732a5.25 5.25 0 001.538-3.712l.003-2.024a.668.668 0 01.198-.471 1.575 1.575 0 10-2.228-2.228 3.818 3.818 0 00-1.12 2.687M6.9 7.575V12m6.27 4.318A4.49 4.49 0 0116.35 15m.002 0h-.002"
            />
          </svg>
        </div>
        <p className="text-theme-secondary font-medium">No touch data</p>
        <p className="text-sm text-theme-tertiary mt-1">
          Hand pressure pads have not reported yet
        </p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between">
        <span className="card-label">Fingertip pressure</span>
        <SimBadge telemetry={telemetry} group="touch" />
      </div>
      <div className="grid grid-cols-2 gap-3 max-w-sm mx-auto">
        <HandSchematic
          side="left"
          pads={touch?.left}
          calibration={calibrationRef.current}
          onHover={setHovered}
        />
        <HandSchematic
          side="right"
          pads={touch?.right}
          calibration={calibrationRef.current}
          onHover={setHovered}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-theme-tertiary">
        <span className="flex items-center gap-1.5" aria-hidden="true">
          {[0, 0.55, 1].map((t) => (
            <span
              key={t}
              className="h-2.5 w-2.5 rounded-[3px] border border-[var(--border-color)]"
              style={{ backgroundColor: pressureColor(t) }}
            />
          ))}
          <span className="ml-0.5 text-theme-muted">idle → firm</span>
        </span>
        <span className="text-right" aria-live="polite">
          {hovered ? (
            <>
              <span className="capitalize">{hovered.side}</span> · {hovered.label} —{' '}
              <span className="font-mono text-theme-secondary">Δ{hovered.delta.toFixed(0)}</span>
              {hovered.temperature !== null && (
                <span className="font-mono text-theme-muted"> · {hovered.temperature.toFixed(0)}°C</span>
              )}
            </>
          ) : (
            <span className="text-theme-muted">Hover a pad for its value</span>
          )}
        </span>
      </div>
    </div>
  );
});
