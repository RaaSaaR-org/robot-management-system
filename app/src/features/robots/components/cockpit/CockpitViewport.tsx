/**
 * @file CockpitViewport.tsx
 * @description The cockpit's signature element: a primary "what the robot sees"
 *   viewport framed by a heads-up display. Shows the live MJPEG camera feed when
 *   a sidecar is streaming; otherwise falls back to the live 3D model posed by
 *   telemetry so the viewport is never blank. HUD corner brackets, a connection
 *   pill, a camera/source selector and a telemetry ticker overlay both.
 * @feature robots
 */

import { memo, useState } from 'react';
import { Camera, Box, Radio } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { Robot3DViewer } from '../visualization/Robot3DViewer';
import type { JointState, RobotType } from '../../types/robots.types';

export interface CockpitViewportProps {
  robotId: string;
  robotType: RobotType;
  jointStates?: JointState[];
  /** Telemetry link is live (drives the LIVE pill + model breathing). */
  telemetryConnected: boolean;
  /** Camera channels to expose in the source selector. */
  cameras?: string[];
  className?: string;
}

type Source = { kind: 'camera'; name: string } | { kind: 'model' };

/** L-shaped HUD bracket pinned to a corner. */
function Bracket({ corner }: { corner: 'tl' | 'tr' | 'bl' | 'br' }) {
  const base = 'pointer-events-none absolute h-7 w-7 border-[#2A5FFF]/70';
  const map: Record<typeof corner, string> = {
    tl: 'top-3 left-3 border-t-2 border-l-2 rounded-tl-md',
    tr: 'top-3 right-3 border-t-2 border-r-2 rounded-tr-md',
    bl: 'bottom-3 left-3 border-b-2 border-l-2 rounded-bl-md',
    br: 'bottom-3 right-3 border-b-2 border-r-2 rounded-br-md',
  };
  return <span className={cn(base, map[corner])} aria-hidden />;
}

export const CockpitViewport = memo(function CockpitViewport({
  robotId,
  robotType,
  jointStates,
  telemetryConnected,
  cameras = ['top', 'wrist'],
  className,
}: CockpitViewportProps) {
  const [source, setSource] = useState<Source>({ kind: 'model' });
  const [cameraErrored, setCameraErrored] = useState<Record<string, boolean>>({});

  const showCamera = source.kind === 'camera' && !cameraErrored[source.name];
  const streamUrl = source.kind === 'camera' ? `/api/robots/${robotId}/camera/${source.name}` : '';

  const sourceLabel = source.kind === 'camera' ? `CAM · ${source.name.toUpperCase()}` : 'MODEL · LIVE POSE';
  const liveLabel = source.kind === 'camera'
    ? (showCamera ? 'STREAMING' : 'NO SIGNAL')
    : (telemetryConnected ? 'LIVE' : 'NO LINK');
  const isLive = source.kind === 'camera' ? showCamera : telemetryConnected;

  return (
    <div
      className={cn(
        'relative w-full overflow-hidden rounded-2xl border border-[#2A5FFF]/20 bg-[#06070A]',
        className,
      )}
    >
      {/* ── Feed layer ── */}
      <div className="absolute inset-0">
        {showCamera ? (
          <img
            key={streamUrl}
            src={streamUrl}
            alt={`${source.kind === 'camera' ? source.name : ''} camera feed`}
            className="h-full w-full object-contain"
            onError={() =>
              source.kind === 'camera' &&
              setCameraErrored((m) => ({ ...m, [source.name]: true }))
            }
          />
        ) : (
          <Robot3DViewer
            robotType={robotType}
            jointStates={jointStates}
            isAnimating={telemetryConnected}
            className="h-full w-full"
          />
        )}
      </div>

      {/* ── HUD overlay ── */}
      <div className="pointer-events-none absolute inset-0">
        {/* faint scan grid */}
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              'linear-gradient(#2A5FFF 1px, transparent 1px), linear-gradient(90deg, #2A5FFF 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
        <Bracket corner="tl" />
        <Bracket corner="tr" />
        <Bracket corner="bl" />
        <Bracket corner="br" />
        {/* centre reticle */}
        <div className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2">
          <span className="absolute left-1/2 top-0 h-2 w-px -translate-x-1/2 bg-[#18E4C3]/50" />
          <span className="absolute left-1/2 bottom-0 h-2 w-px -translate-x-1/2 bg-[#18E4C3]/50" />
          <span className="absolute top-1/2 left-0 h-px w-2 -translate-y-1/2 bg-[#18E4C3]/50" />
          <span className="absolute top-1/2 right-0 h-px w-2 -translate-y-1/2 bg-[#18E4C3]/50" />
        </div>
      </div>

      {/* source pill (top-left) */}
      <div className="absolute left-5 top-5 flex items-center gap-2 rounded-md bg-black/55 px-2.5 py-1 font-mono text-[11px] tracking-wider text-theme-secondary backdrop-blur-sm">
        {source.kind === 'camera' ? <Camera className="h-3.5 w-3.5" /> : <Box className="h-3.5 w-3.5" />}
        {sourceLabel}
      </div>

      {/* live status (top-right) */}
      <div className="absolute right-5 top-5 flex items-center gap-2 rounded-md bg-black/55 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-wider backdrop-blur-sm">
        <span
          className={cn(
            'h-2 w-2 rounded-full',
            isLive ? 'bg-[#18E4C3] animate-pulse' : 'bg-theme-tertiary',
          )}
        />
        <span className={isLive ? 'text-[#18E4C3]' : 'text-theme-tertiary'}>{liveLabel}</span>
      </div>

      {/* source selector (bottom) */}
      <div className="absolute inset-x-0 bottom-4 flex items-center justify-center gap-1.5">
        <SourceChip
          active={source.kind === 'model'}
          onClick={() => setSource({ kind: 'model' })}
          icon={<Box className="h-3 w-3" />}
          label="Model"
        />
        {cameras.map((name) => (
          <SourceChip
            key={name}
            active={source.kind === 'camera' && source.name === name}
            onClick={() => setSource({ kind: 'camera', name })}
            icon={<Camera className="h-3 w-3" />}
            label={name}
          />
        ))}
      </div>

      {/* ticker (bottom-left, above chips on desktop) */}
      <div className="absolute left-5 bottom-14 hidden items-center gap-2 font-mono text-[10px] text-theme-tertiary sm:flex">
        <Radio className="h-3 w-3" />
        <span className="uppercase">{robotId}</span>
      </div>
    </div>
  );
});

function SourceChip({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[11px] capitalize backdrop-blur-sm transition-colors',
        active
          ? 'bg-[#2A5FFF] text-white'
          : 'bg-black/55 text-theme-secondary hover:bg-black/70 hover:text-theme-primary',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
